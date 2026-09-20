export type MatchCandidate = {
  externalId?: string
  title: string
  artist: string
  album?: string
  duration?: number
  musicInfo?: Record<string, any>
}

export type MatchInput = {
  externalId?: string
  title: string
  artist: string
  album?: string
  duration?: number
  platform: string
}

export type MatchResult = {
  method: 'id' | 'metadata' | 'manual'
  score: number
  selected: MatchCandidate | null
  candidates: Array<MatchCandidate & { score: number }>
}

function norm(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '')
}

function scoreMeta(track: MatchInput, cand: MatchCandidate) {
  let score = 0
  // 双方 norm 后非空才参与比较，避免空串 includes('') 恒真导致全括号标题/歌手得高分
  const tTitle = norm(track.title)
  const cTitle = norm(cand.title)
  if (tTitle && cTitle) {
    if (tTitle === cTitle) score += 0.55
    else if (cTitle.includes(tTitle) || tTitle.includes(cTitle)) score += 0.35
  }

  const tArtist = norm(track.artist.split(/[\/,&]/)[0] || '')
  const cArtist = norm(cand.artist)
  if (tArtist && cArtist && cArtist.includes(tArtist)) score += 0.3
  const tAlbum = norm(track.album || '')
  const cAlbum = norm(cand.album || '')
  if (tAlbum && cAlbum && tAlbum === cAlbum) score += 0.1
  if (track.duration && cand.duration && Math.abs(track.duration - cand.duration) <= 3) score += 0.05
  return Math.min(1, score)
}

/**
 * ID 优先 + 元数据回退（一期供单曲/二期歌单复用）
 */
export function matchTrack(
  track: MatchInput,
  opts: { candidatesFromSearch: MatchCandidate[] },
): MatchResult {
  const candidates = opts.candidatesFromSearch || []
  if (track.externalId) {
    const hit = candidates.find((c) => c.externalId && String(c.externalId) === String(track.externalId))
    if (hit) {
      return {
        method: 'id',
        score: 1,
        selected: hit,
        candidates: candidates.map((c) => ({ ...c, score: c === hit ? 1 : scoreMeta(track, c) })),
      }
    }
  }

  const scored = candidates
    .map((c) => ({ ...c, score: scoreMeta(track, c) }))
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best || best.score < 0.45) {
    return { method: 'metadata', score: best?.score || 0, selected: null, candidates: scored }
  }
  return {
    method: 'metadata',
    score: best.score,
    selected: best,
    candidates: scored,
  }
}
