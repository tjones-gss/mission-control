/**
 * Synthesized Web Audio sound presets.
 * Each preset is a function (ctx: AudioContext, masterGain: GainNode) => void
 */

function makeOsc(ctx, masterGain, { type = 'sine', freq, start, duration, volume = 0.3, fadeOut }) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(masterGain)
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(volume, start)
  if (fadeOut) {
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
  } else {
    gain.gain.setValueAtTime(volume, start + duration - 0.01)
    gain.gain.linearRampToValueAtTime(0, start + duration)
  }
  osc.start(start)
  osc.stop(start + duration)
}

export const PRESETS = {
  chime(ctx, masterGain) {
    const t = ctx.currentTime
    makeOsc(ctx, masterGain, { freq: 523, start: t, duration: 0.1, fadeOut: true })        // C5
    makeOsc(ctx, masterGain, { freq: 659, start: t + 0.1, duration: 0.15, fadeOut: true })  // E5
  },

  ping(ctx, masterGain) {
    const t = ctx.currentTime
    makeOsc(ctx, masterGain, { freq: 800, start: t, duration: 0.2, fadeOut: true })
  },

  alert(ctx, masterGain) {
    const t = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const offset = i * 0.12 // 80ms on + 40ms off
      makeOsc(ctx, masterGain, { type: 'square', freq: 1000, start: t + offset, duration: 0.08, volume: 0.2 })
    }
  },

  gentle(ctx, masterGain) {
    const t = ctx.currentTime
    makeOsc(ctx, masterGain, { freq: 440, start: t, duration: 0.5, volume: 0.15, fadeOut: true })
  },

  urgent(ctx, masterGain) {
    const t = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const offset = i * 0.2
      makeOsc(ctx, masterGain, { type: 'sawtooth', freq: 800, start: t + offset, duration: 0.1, volume: 0.2, fadeOut: true })
      makeOsc(ctx, masterGain, { type: 'sawtooth', freq: 1000, start: t + offset + 0.1, duration: 0.1, volume: 0.2, fadeOut: true })
    }
  },

  success(ctx, masterGain) {
    const t = ctx.currentTime
    makeOsc(ctx, masterGain, { freq: 523, start: t, duration: 0.1, fadeOut: true })        // C5
    makeOsc(ctx, masterGain, { freq: 659, start: t + 0.1, duration: 0.1, fadeOut: true })  // E5
    makeOsc(ctx, masterGain, { freq: 784, start: t + 0.2, duration: 0.15, fadeOut: true }) // G5
  },

  fail(ctx, masterGain) {
    const t = ctx.currentTime
    makeOsc(ctx, masterGain, { freq: 330, start: t, duration: 0.2, fadeOut: true })        // E4
    makeOsc(ctx, masterGain, { freq: 311, start: t + 0.2, duration: 0.3, fadeOut: true })  // Eb4
  },

  none() { /* no-op */ },
}
