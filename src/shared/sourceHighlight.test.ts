import { describe, expect, it } from 'vitest'
import { sourceLineTimestamp, tokenizeSourceLine } from './sourceHighlight'

describe('XLRC source highlighting', () => {
  it('colors timestamps, voice markers, word timing, and furigana', () => {
    expect(tokenizeSourceLine('[00:01.20][v:A]<00:01.20>私[わたし]')).toEqual([
      { kind: 'time', value: '[00:01.20]' },
      { kind: 'voice', value: '[v:A]' },
      { kind: 'time', value: '<00:01.20>' },
      { kind: 'text', value: '私' },
      { kind: 'furigana', value: '[わたし]' },
    ])
  })

  it('colors metadata and translation prefixes', () => {
    expect(tokenizeSourceLine('[lang:ja]')).toEqual([{ kind: 'tag', value: '[lang:ja]' }])
    expect(tokenizeSourceLine('[>en]I sing')[0]).toEqual({ kind: 'translation', value: '[>en]' })
  })

  it('extracts active line timing at either precision', () => {
    expect(sourceLineTimestamp('[01:02.34]Line')).toBe(62_340)
    expect(sourceLineTimestamp('[01:02.345]Line')).toBe(62_345)
    expect(sourceLineTimestamp('[>en]Translation')).toBeNull()
  })
})
