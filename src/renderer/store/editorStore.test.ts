import { beforeEach, describe, expect, it } from 'vitest'
import { createLine, createProject } from '../../shared/project'
import { useEditorStore } from './editorStore'

function resetWithLines(): void {
  const project = createProject()
  project.document.lines = [createLine({ text: 'one', startMs: 1000 }), createLine({ text: 'two', startMs: 2000 })]
  useEditorStore.setState({ project, projectPath: null, audioUrl: null, missingAudio: false, selectedLineId: project.document.lines[0].id, history: [], future: [], dirty: false, lastAction: 'Ready' })
}

describe('editor store commands', () => {
  beforeEach(resetWithLines)

  it('splits, merges, and restores the document through history', () => {
    const first = useEditorStore.getState().project.document.lines[0]
    useEditorStore.getState().splitLine(first.id, 1)
    expect(useEditorStore.getState().project.document.lines.map((line) => line.text)).toEqual(['o', 'ne', 'two'])
    useEditorStore.getState().mergeLine(useEditorStore.getState().project.document.lines[1].id)
    expect(useEditorStore.getState().project.document.lines.map((line) => line.text)).toEqual(['o ne', 'two'])
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project.document.lines.map((line) => line.text)).toEqual(['o', 'ne', 'two'])
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().project.document.lines.map((line) => line.text)).toEqual(['o ne', 'two'])
  })

  it('invalidates dependent enhanced annotations when text changes', () => {
    const line = useEditorStore.getState().project.document.lines[0]
    line.words = [{ id: 'word', text: 'one', startMs: 1000, endMs: null, furigana: [] }]
    const invalidated = useEditorStore.getState().updateLine(line.id, { text: 'changed' })
    expect(invalidated).toBe(true)
    expect(useEditorStore.getState().project.document.lines[0].words).toEqual([])
    expect(useEditorStore.getState().project.document.lines[0].reviewState).toBe('needs-review')
  })

  it('stamps the selected row and advances selection', () => {
    const state = useEditorStore.getState()
    const second = state.project.document.lines[1]
    state.stampSelected(1234)
    expect(useEditorStore.getState().project.document.lines[0].startMs).toBe(1234)
    expect(useEditorStore.getState().selectedLineId).toBe(second.id)
  })

  it('moves a row directly to a requested document position', () => {
    const state = useEditorStore.getState()
    const first = state.project.document.lines[0]
    state.moveLineTo(first.id, 1)
    expect(useEditorStore.getState().project.document.lines.map((line) => line.text)).toEqual(['two', 'one'])
    expect(useEditorStore.getState().lastAction).toBe('Reorder lyric line')
  })

  it('does not create history for an unchanged field commit', () => {
    const state = useEditorStore.getState()
    const first = state.project.document.lines[0]
    state.updateLine(first.id, { startMs: first.startMs })
    expect(useEditorStore.getState().history).toHaveLength(0)
  })

  it('creates explicit word segments and updates their boundaries through history', () => {
    const line = useEditorStore.getState().project.document.lines[0]
    useEditorStore.getState().setWordSegments(line.id, ['o', 'ne'])
    let words = useEditorStore.getState().project.document.lines[0].words
    expect(words.map((word) => word.text)).toEqual(['o', 'ne'])
    expect(words.map((word) => word.startMs)).toEqual([1000, 1000])

    useEditorStore.getState().updateWord(line.id, words[1].id, { startMs: 1400 }, 'Stamp word timing')
    words = useEditorStore.getState().project.document.lines[0].words
    expect(words[0].endMs).toBe(1400)
    expect(words[1].startMs).toBe(1400)
    expect(useEditorStore.getState().lastAction).toBe('Stamp word timing')

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project.document.lines[0].words.map((word) => word.startMs)).toEqual([1000, 1000])
  })

  it('moves enhanced word timing with its line start', () => {
    const line = useEditorStore.getState().project.document.lines[0]
    line.words = [
      { id: 'one_a', text: 'o', startMs: 1000, endMs: 1300, furigana: [] },
      { id: 'one_b', text: 'ne', startMs: 1300, endMs: null, furigana: [] },
    ]
    useEditorStore.getState().updateLine(line.id, { startMs: 1100 }, 'Nudge line timing')
    expect(useEditorStore.getState().project.document.lines[0].words).toMatchObject([
      { startMs: 1100, endMs: 1400 },
      { startMs: 1400, endMs: null },
    ])
  })
})
