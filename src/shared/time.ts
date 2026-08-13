export function clampMs(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
}

export function formatTimestamp(ms: number | null, precision: 'ms' | 'centisecond' = 'ms'): string {
  if (ms === null) return '--:--.---'
  const value = clampMs(ms)
  const minutes = Math.floor(value / 60_000)
  const seconds = Math.floor((value % 60_000) / 1_000)
  const remainder = value % 1_000
  return precision === 'centisecond'
    ? `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(Math.floor(remainder / 10)).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`
}

export function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(\d+):([0-5]\d)(?:[.:](\d{1,3}))?$/u)
  if (!match) return null
  const fraction = match[3] ?? '0'
  const milliseconds = fraction.length === 1 ? Number(fraction) * 100 : fraction.length === 2 ? Number(fraction) * 10 : Number(fraction)
  return Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + milliseconds
}

export function formatClock(ms: number): string {
  return formatTimestamp(ms, 'centisecond')
}
