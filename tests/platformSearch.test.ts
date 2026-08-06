import { describe, it, expect } from 'vitest'
import { parseLooseJson, cleanArtist } from '../server/services/platformSearch'

describe('parseLooseJson', () => {
  it('parses Kuwo single-quoted pseudo JSON', () => {
    const raw =
      "{'HIT':'1','abslist':[{'NAME':'堆积情感','ARTIST':'邝美云','DURATION':'272','MUSICRID':'MUSIC_1'}]}"
    const data = parseLooseJson(raw)
    expect(data.HIT).toBe('1')
    expect(data.abslist[0].NAME).toBe('堆积情感')
    expect(data.abslist[0].DURATION).toBe('272')
  })

  it('parses standard JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('strips JSONP wrapper', () => {
    expect(parseLooseJson("cb({'a':'b'});")).toEqual({ a: 'b' })
  })
})

describe('cleanArtist', () => {
  it('strips trailing dash slash junk', () => {
    expect(cleanArtist('周杰伦- / A-LNK')).toBe('周杰伦')
  })
})
