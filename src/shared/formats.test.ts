import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { importLyrics, reconcileSourceDocument, serializeLyrics } from './formats'

const richSource = `[ti:夜の歌]
[ar:Example]
[lang:ja]
[langs:ja,en]
[custom:value]

[00:01.20][v:A]<00:01.20>私[わたし]<00:01.80>は歌[うた]う
[>en]I sing
[00:04.00]
`

describe('lyrics formats', () => {
  it('round-trips rich XLRC semantics', () => {
    const imported = importLyrics(richSource)
    expect(imported.detectedFormat).toBe('xlrc')
    expect(imported.document.lines[0].words).toHaveLength(2)
    expect(imported.document.lines[0].translations[0].text).toBe('I sing')
    expect(imported.document.metadata.extra.custom).toBe('value')

    const serialized = serializeLyrics(imported.document, 'xlrc')
    const reopened = importLyrics(serialized.content)
    expect(reopened.document.lines[0].voice).toBe('A')
    expect(reopened.document.lines[0].furigana[0].reading).toBe('わたし')
    expect(reopened.document.lines[1].kind).toBe('instrumental')
  })

  it('describes lossy exports', () => {
    const document = importLyrics(richSource).document
    const lrc = serializeLyrics(document, 'lrc')
    expect(lrc.notices.map((notice) => notice.code)).toEqual(expect.arrayContaining(['translations', 'voices', 'furigana', 'word-timing']))
    expect(lrc.content).not.toContain('[>en]')
  })

  it('imports plain text as untimed rows and preserves stanza breaks', () => {
    const imported = importLyrics('First\n\nSecond\n')
    expect(imported.detectedFormat).toBe('plain')
    expect(imported.document.lines[1].sectionBreakBefore).toBe(true)
    expect(imported.document.lines.every((line) => line.startMs === null)).toBe(true)
  })

  it('ignores non-semantic XLRC blank lines in the real fixture', async () => {
    const source = await readFile(new URL('../../test/fixtures/real-project/balalaika.xlrc', import.meta.url), 'utf8')
    const imported = importLyrics(source)
    expect(imported.document.lines).toHaveLength(49)
    expect(imported.document.lines.filter((line) => line.sectionBreakBefore)).toHaveLength(0)
    expect(imported.document.lines.reduce((count, line) => count + line.translations.length, 0)).toBe(78)
  })

  it('preserves stable IDs for semantically unchanged source rows', () => {
    const imported = importLyrics('[00:01.00]one\n[00:02.00]two\n')
    imported.document.lines[0].reviewState = 'reviewed'
    const reconciled = reconcileSourceDocument(imported.document, '[00:01.00]one\n[00:03.00]two\n')
    expect(reconciled.document.lines[0].id).toBe(imported.document.lines[0].id)
    expect(reconciled.document.lines[0].reviewState).toBe('reviewed')
    expect(reconciled.document.lines[1].id).toBe(imported.document.lines[1].id)
    expect(reconciled.document.lines[1].reviewState).toBe('unreviewed')
  })
})
