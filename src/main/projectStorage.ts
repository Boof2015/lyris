import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { AudioReference, LyrisProject, OpenProjectResult, RecentProject, SaveProjectResult } from '../types/project'
import { migrateProject } from '../shared/project'

const MAX_RECENTS = 8

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
  await rename(tempPath, path)
}

function portableAudioReference(reference: AudioReference, projectPath: string, sourceProjectPath: string | null): AudioReference {
  const absolute = resolveAudioPath(reference, sourceProjectPath)
  const candidate = relative(dirname(projectPath), absolute)
  const canBeRelative = candidate !== '' && !candidate.startsWith('..') && !isAbsolute(candidate)
  return {
    ...reference,
    path: canBeRelative ? candidate : absolute,
    pathKind: canBeRelative ? 'relative' : 'absolute',
  }
}

export function resolveAudioPath(reference: AudioReference, projectPath: string | null): string {
  if (reference.pathKind === 'relative' && projectPath) return resolve(dirname(projectPath), reference.path)
  return resolve(reference.path)
}

export class ProjectStorage {
  private readonly recoveryPath: string
  private readonly recentsPath: string

  constructor(private readonly registerAudio: (path: string) => string) {
    this.recoveryPath = resolve(app.getPath('userData'), 'recovery.lyris')
    this.recentsPath = resolve(app.getPath('userData'), 'recent-projects.json')
  }

  async open(path: string): Promise<OpenProjectResult> {
    const project = migrateProject(await readJson(path))
    const audioPath = project.audio ? resolveAudioPath(project.audio, path) : null
    const missingAudio = Boolean(audioPath && !existsSync(audioPath))
    const audioUrl = audioPath && !missingAudio ? this.registerAudio(audioPath) : null
    await this.touchRecent(path, project.document.metadata.title || basename(path, '.lyris'))
    return { path, project, audioUrl, missingAudio }
  }

  async save(project: LyrisProject, path: string, sourceProjectPath: string | null = path): Promise<SaveProjectResult> {
    const now = new Date().toISOString()
    const saved: LyrisProject = {
      ...structuredClone(project),
      updatedAt: now,
      audio: project.audio ? portableAudioReference(project.audio, path, sourceProjectPath) : null,
    }
    await atomicWrite(path, `${JSON.stringify(saved, null, 2)}\n`)
    await this.touchRecent(path, saved.document.metadata.title || basename(path, '.lyris'))
    return { path, project: saved }
  }

  async writeRecovery(project: LyrisProject): Promise<void> {
    await atomicWrite(this.recoveryPath, `${JSON.stringify(project, null, 2)}\n`)
  }

  async loadRecovery(): Promise<LyrisProject | null> {
    if (!existsSync(this.recoveryPath)) return null
    try {
      return migrateProject(await readJson(this.recoveryPath))
    } catch {
      return null
    }
  }

  async clearRecovery(): Promise<void> {
    await unlink(this.recoveryPath).catch(() => undefined)
  }

  async recent(): Promise<RecentProject[]> {
    try {
      const value = await readJson(this.recentsPath)
      if (!Array.isArray(value)) return []
      return value.filter((entry): entry is RecentProject => (
        Boolean(entry) && typeof entry === 'object' &&
        typeof (entry as RecentProject).path === 'string' &&
        typeof (entry as RecentProject).name === 'string' &&
        typeof (entry as RecentProject).lastOpenedAt === 'string' &&
        existsSync((entry as RecentProject).path)
      )).slice(0, MAX_RECENTS)
    } catch {
      return []
    }
  }

  private async touchRecent(path: string, name: string): Promise<void> {
    const current = await this.recent()
    const next = [
      { path, name, lastOpenedAt: new Date().toISOString() },
      ...current.filter((entry) => entry.path !== path),
    ].slice(0, MAX_RECENTS)
    await atomicWrite(this.recentsPath, `${JSON.stringify(next, null, 2)}\n`)
  }
}
