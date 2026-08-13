import { describe, expect, it } from 'vitest'
import { gainToDecibels, normalizationGain } from './audio'

describe('audio gain helpers', () => {
  it('raises quiet audio toward the target RMS', () => {
    expect(normalizationGain({ rms: 0.025, peak: 0.2 })).toBe(4)
  })

  it('respects the peak ceiling', () => {
    expect(normalizationGain({ rms: 0.05, peak: 0.9 })).toBeCloseTo(0.97 / 0.9)
  })

  it('leaves silence alone and reports useful decibels', () => {
    expect(normalizationGain({ rms: 0, peak: 0 })).toBe(1)
    expect(gainToDecibels(2)).toBeCloseTo(6.0206, 3)
  })
})
