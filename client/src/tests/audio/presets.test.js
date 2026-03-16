import { PRESETS } from '../../audio/presets.js'

// Mock AudioContext primitives
function createMockContext() {
  const oscillators = []
  const gains = []

  const ctx = {
    currentTime: 0,
    createOscillator: () => {
      const osc = {
        connect: vi.fn(),
        type: 'sine',
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
      }
      oscillators.push(osc)
      return osc
    },
    createGain: () => {
      const gain = {
        connect: vi.fn(),
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
      }
      gains.push(gain)
      return gain
    },
  }

  return { ctx, oscillators, gains }
}

function createMasterGain() {
  return { gain: { value: 1 } }
}

describe('PRESETS', () => {
  it('exports all 8 preset names', () => {
    const names = Object.keys(PRESETS)
    expect(names).toContain('chime')
    expect(names).toContain('ping')
    expect(names).toContain('alert')
    expect(names).toContain('gentle')
    expect(names).toContain('urgent')
    expect(names).toContain('success')
    expect(names).toContain('fail')
    expect(names).toContain('none')
    expect(names).toHaveLength(8)
  })

  it('all presets are functions', () => {
    for (const [name, fn] of Object.entries(PRESETS)) {
      expect(typeof fn).toBe('function')
    }
  })

  it('none is a no-op', () => {
    const { ctx } = createMockContext()
    const masterGain = createMasterGain()
    // Should not throw and should not create oscillators
    PRESETS.none(ctx, masterGain)
  })
})

describe('PRESETS — oscillator scheduling', () => {
  it('chime creates 2 oscillators (C5 and E5)', () => {
    const { ctx, oscillators } = createMockContext()
    PRESETS.chime(ctx, createMasterGain())
    expect(oscillators).toHaveLength(2)
    expect(oscillators[0].frequency.value).toBe(523)
    expect(oscillators[1].frequency.value).toBe(659)
  })

  it('ping creates 1 oscillator at 800Hz', () => {
    const { ctx, oscillators } = createMockContext()
    PRESETS.ping(ctx, createMasterGain())
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].frequency.value).toBe(800)
  })

  it('alert creates 3 square-wave oscillators', () => {
    const { ctx, oscillators } = createMockContext()
    PRESETS.alert(ctx, createMasterGain())
    expect(oscillators).toHaveLength(3)
    oscillators.forEach(osc => {
      expect(osc.type).toBe('square')
      expect(osc.frequency.value).toBe(1000)
    })
  })

  it('gentle creates 1 oscillator at 440Hz', () => {
    const { ctx, oscillators } = createMockContext()
    PRESETS.gentle(ctx, createMasterGain())
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].frequency.value).toBe(440)
  })

  it('urgent creates 6 sawtooth oscillators (3 pairs)', () => {
    const { ctx, oscillators } = createMockContext()
    PRESETS.urgent(ctx, createMasterGain())
    expect(oscillators).toHaveLength(6)
    oscillators.forEach(osc => expect(osc.type).toBe('sawtooth'))
    // Alternating 800/1000
    expect(oscillators[0].frequency.value).toBe(800)
    expect(oscillators[1].frequency.value).toBe(1000)
  })

  it('success creates 3 oscillators (C5, E5, G5)', () => {
    const { ctx, oscillators } = createMockContext()
    PRESETS.success(ctx, createMasterGain())
    expect(oscillators).toHaveLength(3)
    expect(oscillators[0].frequency.value).toBe(523)
    expect(oscillators[1].frequency.value).toBe(659)
    expect(oscillators[2].frequency.value).toBe(784)
  })

  it('fail creates 2 oscillators (E4, Eb4)', () => {
    const { ctx, oscillators } = createMockContext()
    PRESETS.fail(ctx, createMasterGain())
    expect(oscillators).toHaveLength(2)
    expect(oscillators[0].frequency.value).toBe(330)
    expect(oscillators[1].frequency.value).toBe(311)
  })

  it('all presets schedule start and stop on every oscillator', () => {
    for (const [name, fn] of Object.entries(PRESETS)) {
      if (name === 'none') continue
      const { ctx, oscillators } = createMockContext()
      fn(ctx, createMasterGain())
      oscillators.forEach(osc => {
        expect(osc.start).toHaveBeenCalledTimes(1)
        expect(osc.stop).toHaveBeenCalledTimes(1)
      })
    }
  })
})
