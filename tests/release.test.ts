import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []
const initialManifest = 'appname=miyin\nversion=0.5.0\ndisplay_name=觅音\nchangelog=旧版说明\n'

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function release(unreleased: string, existingVersion = '', manifest = initialManifest) {
  const dir = mkdtempSync(join(tmpdir(), 'miyin-release-'))
  tempDirs.push(dir)
  const repo = join(dir, 'repo')
  const remote = join(dir, 'remote.git')
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  mkdirSync(join(repo, 'packaging/fnos/miyin'), { recursive: true })
  for (const name of ['release.sh', 'generate-release-notes.sh', 'changelog-entry.sh']) {
    copyFileSync(new URL(`../scripts/${name}`, import.meta.url), join(repo, 'scripts', name))
  }
  writeFileSync(join(repo, 'package.json'), '{"version":"0.5.0"}\n')
  writeFileSync(join(repo, 'packaging/fnos/miyin/manifest'), manifest)
  writeFileSync(join(repo, 'CHANGELOG.md'), `# 更新日志

## [Unreleased]

${unreleased}

${existingVersion}
## [0.5.0] - 2026-09-02

### Added

- 旧版本功能

[Unreleased]: https://github.com/qwex888/miyin/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/qwex888/miyin/compare/v0.4.3...v0.5.0
`)
  const env = {
    ...process.env,
    SKIP_CHECKS: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: '发版测试',
    GIT_AUTHOR_EMAIL: 'release@example.invalid',
    GIT_COMMITTER_NAME: '发版测试',
    GIT_COMMITTER_EMAIL: 'release@example.invalid',
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' }).toString()
  git('init', '--quiet', '--initial-branch=main')
  git('init', '--quiet', '--bare', '--initial-branch=main', remote)
  git('remote', 'add', 'origin', remote)
  git('add', '.')
  git('commit', '--quiet', '-m', 'chore: 初始化发版测试')
  git('tag', 'v0.5.0')
  execFileSync('bash', ['scripts/release.sh', 'patch'], { cwd: repo, env, stdio: 'pipe' })
  return {
    manifest: readFileSync(join(repo, 'packaging/fnos/miyin/manifest'), 'utf8'),
    changelog: readFileSync(join(repo, 'CHANGELOG.md'), 'utf8'),
    committedManifest: git('show', 'v0.5.1:packaging/fnos/miyin/manifest'),
  }
}

describe('发版时同步飞牛更新说明', () => {
  it('将当前版本的简短说明与版本号一起写入发版提交', () => {
    const result = release('### Added\n\n- 支持按专辑归档下载\n\n### Fixed\n\n- 修复试听切换失败')

    expect(result.manifest).toBe('appname=miyin\nversion=0.5.1\ndisplay_name=觅音\nchangelog=支持按专辑归档下载；修复试听切换失败。\n')
    expect(result.committedManifest).toBe(result.manifest)
    expect(result.changelog).toContain('## [0.5.1]')
  })

  it('清理格式和附注，仅保留去重后的前三条简短说明', () => {
    const result = release(`### Added

- **支持按专辑归档下载**（默认按专辑名建文件夹）（@贡献者, PR #24）
- **支持按专辑归档下载** (@contributor)
- 支持[试听进度拖动](https://example.com/player)；切换页面仍可播放
  - 内部实现细节
- 修复 \`iOS 15\` 页面白屏。改善旧设备兼容性 (PR #25)
- 优化音源更新提示
`)

    expect(result.manifest).toContain('changelog=支持按专辑归档下载；支持试听进度拖动；修复 iOS 15 页面白屏。\n')
  })

  it('限制过长说明并保持 manifest 为单行字段', () => {
    const result = release(`### Changed\n\n- ${'优化试听体验'.repeat(40)}`)
    const summary = result.manifest.split('\n').find(line => line.startsWith('changelog='))!.slice(10)

    expect(summary.length).toBeLessThanOrEqual(180)
    expect(summary).toMatch(/^优化试听体验.+…$/)
    expect(result.manifest.split('\n')).toHaveLength(initialManifest.split('\n').length)
  })

  it('清理格式时保留配置名、通配符和音质范围中的字面字符', () => {
    const result = release('### Changed\n\n- 支持 `AUTH_TOKEN` 和 `DOWNLOAD_DIR` 设置\n- 识别 *.flac 文件与 160~320 kbps 音质\n- *支持*自定义 MIYIN_DOWNLOAD_DIR')

    expect(result.manifest).toContain('changelog=支持 AUTH_TOKEN 和 DOWNLOAD_DIR 设置；识别 *.flac 文件与 160~320 kbps 音质；支持自定义 MIYIN_DOWNLOAD_DIR。\n')
  })

  it('按中文感叹号和问号提取首句后去重', () => {
    const result = release('### Added\n\n- 支持整专下载！支持试听。\n- 支持整专下载！支持归档。\n- 遇到歌单导入失败？现在可查看失败原因。\n- 优化试听进度条')

    expect(result.manifest).toContain('changelog=支持整专下载；遇到歌单导入失败；优化试听进度条。\n')
  })

  it('目标版本已存在时使用该版本说明，并补齐缺失的 changelog 字段', () => {
    const result = release(
      '### Added\n\n- 尚未发布的新功能',
      '## [0.5.1] - 2026-09-15\n\n### Fixed\n\n- 修复歌单导入失败\n',
      initialManifest.replace('changelog=旧版说明\n', ''),
    )

    expect(result.manifest).toContain('changelog=修复歌单导入失败。\n')
    expect(result.changelog.match(/^## \[0\.5\.1\]/gm)).toHaveLength(1)
    expect(result.manifest).not.toContain('尚未发布的新功能')
  })

  it.each(['', '### Changed'])('没有更新条目时写入维护说明（%s）', (body) => {
    const result = release(body)

    expect(result.manifest).toContain('changelog=维护版本更新。\n')
  })
})
