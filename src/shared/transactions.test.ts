import { describe, expect, it } from 'vitest'
import type { DocumentProposal, DocumentTransaction } from '../types/project'
import { createLine, createProject } from './project'
import { applyProposal, applyTransaction, StaleTransactionError } from './transactions'

describe('document transactions', () => {
  it('applies a multi-operation transaction atomically', () => {
    const project = createProject('2026-01-01T00:00:00.000Z')
    const line = createLine({ text: 'hello' })
    const transaction: DocumentTransaction = {
      id: 'tx_1', label: 'Import', baseRevision: 0, createdAt: '2026-01-01T00:00:00.000Z',
      operations: [
        { type: 'insert-line', index: 0, line },
        { type: 'update-metadata', patch: { title: 'Song' } },
      ],
    }
    const next = applyTransaction(project, transaction)
    expect(next.revision).toBe(1)
    expect(next.document.lines[0].text).toBe('hello')
    expect(next.document.metadata.title).toBe('Song')
    expect(project.document.lines).toHaveLength(0)
  })

  it('rejects stale proposals', () => {
    const project = createProject()
    project.revision = 2
    const proposal: DocumentProposal = {
      id: 'proposal', label: 'Align', baseRevision: 1, operations: [], createdAt: new Date().toISOString(),
      provenance: { kind: 'alignment', createdAt: new Date().toISOString() }, diagnostics: [],
    }
    expect(() => applyProposal(project, proposal)).toThrow(StaleTransactionError)
  })
})
