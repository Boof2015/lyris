export interface AudioLevelAnalysis {
  peak: number
  rms: number
}

/**
 * Match the conservative loudness normalization used by the XLRCDB editor.
 * The RMS target brings quiet material up while the peak ceiling prevents
 * normalization itself from clipping transient-heavy audio.
 */
export function normalizationGain({ peak, rms }: AudioLevelAnalysis): number {
  if (!Number.isFinite(rms) || rms <= 0) return 1
  const targetRms = 0.1
  const peakCeiling = 0.97
  let gain = targetRms / rms
  if (Number.isFinite(peak) && peak > 0) gain = Math.min(gain, peakCeiling / peak)
  return Math.max(0.1, Math.min(gain, 4))
}

export function gainToDecibels(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY
}
