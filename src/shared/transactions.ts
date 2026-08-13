import type {
  DocumentOperation,
  DocumentProposal,
  DocumentTransaction,
  LyrisProject,
  LyricsDocument,
} from '../types/project'
import { cloneProject, validateProject } from './project'

export class StaleTransactionError extends Error {
  constructor(expected: number, received: number) {
    super(`This change was based on revision ${received}, but the project is now at revision ${expected}.`)
    this.name = 'StaleTransactionError'
  }
}

function applyOperation(document: LyricsDocument, operation: DocumentOperation): LyricsDocument {
  if (operation.type === 'replace-document') return structuredClone(operation.document)
  if (operation.type === 'update-metadata') {
    return { ...document, metadata: { ...document.metadata, ...operation.patch } }
  }
  if (operation.type === 'insert-line') {
    const lines = [...document.lines]
    const index = Math.max(0, Math.min(operation.index, lines.length))
    lines.splice(index, 0, structuredClone(operation.line))
    return { ...document, lines }
  }

  const index = document.lines.findIndex((line) => line.id === operation.lineId)
  if (index < 0) throw new Error(`Lyric row ${operation.lineId} no longer exists.`)
  const lines = [...document.lines]
  if (operation.type === 'delete-line') {
    lines.splice(index, 1)
  } else if (operation.type === 'move-line') {
    const [line] = lines.splice(index, 1)
    lines.splice(Math.max(0, Math.min(operation.toIndex, lines.length)), 0, line)
  } else {
    lines[index] = { ...lines[index], ...structuredClone(operation.patch), id: operation.lineId }
  }
  return { ...document, lines }
}

export function applyTransaction(project: LyrisProject, transaction: DocumentTransaction): LyrisProject {
  if (transaction.baseRevision !== project.revision) {
    throw new StaleTransactionError(project.revision, transaction.baseRevision)
  }
  let document = structuredClone(project.document)
  for (const operation of transaction.operations) document = applyOperation(document, operation)

  const next = cloneProject(project)
  next.document = document
  next.revision += 1
  next.updatedAt = new Date().toISOString()
  const fatal = validateProject(next).find((issue) => issue.severity === 'error' && issue.code === 'duplicate-line-id')
  if (fatal) throw new Error(fatal.message)
  return next
}

export function applyProposal(project: LyrisProject, proposal: DocumentProposal): LyrisProject {
  if (proposal.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new Error('This proposal contains blocking diagnostics and cannot be applied.')
  }
  return applyTransaction(project, proposal)
}
