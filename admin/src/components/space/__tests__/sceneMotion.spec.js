import { describe, expect, it } from 'vitest'
import { getSceneMotion } from '../sceneMotion.js'

describe('space scene motion', () => {
  it('moves a reservation pulse through three rooms over time', () => {
    const start = getSceneMotion(0)
    const later = getSceneMotion(2)
    expect(start.pulseX).not.toBe(later.pulseX)
    expect(start.pulseZ).not.toBe(later.pulseZ)
    expect(later.glow).toBeGreaterThanOrEqual(0.3)
    expect(later.glow).toBeLessThanOrEqual(1)
    expect(start.orbitAngle).not.toBe(later.orbitAngle)
    expect(start.cameraSweep).not.toBe(later.cameraSweep)
    expect(later.beamHeight).toBeGreaterThan(0)
  })

  it('freezes movement when reduced motion is requested', () => {
    expect(getSceneMotion(0, true)).toEqual(getSceneMotion(12, true))
  })
})
