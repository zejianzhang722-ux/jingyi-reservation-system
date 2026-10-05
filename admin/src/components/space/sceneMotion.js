const route = [
  [-3.2, 1.15],
  [-1.8, 1.15],
  [-1.8, 0],
  [0, 0],
  [1.8, 0],
  [1.8, 1.15],
  [3.2, 1.15]
]

export function getSceneMotion(seconds, reducedMotion = false) {
  const time = reducedMotion ? 0 : Math.max(0, seconds)
  const segment = (time * 0.72) % (route.length - 1)
  const index = Math.floor(segment)
  const progress = segment - index
  const from = route[index]
  const to = route[index + 1]
  return {
    pulseX: from[0] + (to[0] - from[0]) * progress,
    pulseZ: from[1] + (to[1] - from[1]) * progress,
    glow: reducedMotion ? 0.65 : 0.65 + Math.sin(time * 3) * 0.35,
    float: reducedMotion ? 0 : Math.sin(time * 1.1) * 0.055,
    turn: reducedMotion ? 0 : Math.sin(time * 0.28) * 0.12,
    orbitAngle: reducedMotion ? 0 : time * 0.58,
    cameraSweep: reducedMotion ? 0 : Math.sin(time * 0.22) * 0.8,
    beamHeight: reducedMotion ? 0.8 : 0.8 + Math.sin(time * 1.7) * 0.22
  }
}
