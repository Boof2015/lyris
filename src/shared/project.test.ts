import { describe, expect, it } from 'vitest'
import { createLine, createProject, deriveLineEnd, migrateProject, validateProject } from './project'

describe('project model', () => {
  it('normalizes a v1 project', () => {
    const project = createProject('2026-01-01T00:00:00.000Z')
    project.document.lines.push(createLine({ text: 'line', startMs: 1000 }))
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)))
    expect(reopened.schema).toBe('dev.astramusic.lyris/project')
    expect(reopened.document.lines[0].text).toBe('line')
  })

  it('repairs the legacy all-lines section-break import signature', () => {
    const project = createProject('2026-01-01T00:00:00.000Z')
    project.document.lines = ['one', 'two', 'three'].map((text, index) => createLine({
      text,
      startMs: (index + 1) * 1000,
      sectionBreakBefore: true,
      provenance: { kind: 'import', createdAt: '2026-01-01T00:00:00.000Z' },
    }))
    const migrated = migrateProject(JSON.parse(JSON.stringify(project)))
    expect(migrated.document.lines.every((line) => !line.sectionBreakBefore)).toBe(true)
  })

  it('finds decreasing and invalid timing', () => {
    const project = createProject()
    project.document.lines = [
      createLine({ startMs: 2000, text: 'two' }),
      createLine({ startMs: 1000, endMs: 900, text: 'one' }),
    ]
    expect(validateProject(project).map((issue) => issue.code)).toEqual(expect.arrayContaining(['decreasing-time', 'invalid-end']))
  })

  it('derives ends from the next distinct timestamp', () => {
    const lines = [createLine({ startMs: 1000 }), createLine({ startMs: 1000 }), createLine({ startMs: 2500 })]
    expect(deriveLineEnd(lines, 0, 5000)).toBe(2500)
    expect(deriveLineEnd(lines, 2, 5000)).toBe(5000)
  })
})
