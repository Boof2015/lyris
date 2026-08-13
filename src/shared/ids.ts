let fallbackCounter = 0

export function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}_${uuid}`

  fallbackCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${fallbackCounter.toString(36)}`
}
