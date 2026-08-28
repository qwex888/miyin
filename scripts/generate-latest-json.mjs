#!/usr/bin/env node
/**
 * 从 CHANGELOG 生成 latest.json（发版 CI 使用，勿提交仓库）
 * 用法: node scripts/generate-latest-json.mjs <version> [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const version = process.argv[2]
const outPath = process.argv[3] || join(root, 'latest.json')

if (!version || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
  console.error('用法: node scripts/generate-latest-json.mjs <version> [out.json]')
  process.exit(1)
}

const tag = `v${version}`
const repo = 'qwex888/miyin'
const releasedAt = new Date().toISOString()
const changelogPath = join(root, 'CHANGELOG.md')
const text = readFileSync(changelogPath, 'utf8')

const header = `## [${version}]`
const start = text.indexOf(header)
if (start < 0) {
  console.error(`CHANGELOG 中未找到 ${header}`)
  process.exit(1)
}

const afterHeader = text.slice(start + header.length)
const next = afterHeader.search(/\n## \[[^\]]+\]/)
const section = (next >= 0 ? afterHeader.slice(0, next) : afterHeader).trim()
const dateLine = section.match(/^-\s*(\d{4}-\d{2}-\d{2})/)
const body = section.replace(/^-\s*\d{4}-\d{2}-\d{2}\s*\n?/, '').trim() || '- 维护版本发布'

const manifest = {
  version,
  tag,
  releasedAt: dateLine ? `${dateLine[1]}T00:00:00.000Z` : releasedAt,
  changelog: body,
  downloads: {
    releasePage: `https://github.com/${repo}/releases/tag/${tag}`,
    fpk: `https://github.com/${repo}/releases/download/${tag}/miyin-v${version}.fpk`,
    dockerHub: `qwex333/miyin:${version}`,
    ghcr: `ghcr.io/${repo}:${version}`,
  },
}

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outPath}`)
