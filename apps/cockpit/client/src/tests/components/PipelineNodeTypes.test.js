import { describe, it, expect } from 'vitest'
import {
  NODE_TYPES,
  makeNode,
  serializeToFleetSpec,
} from '../../components/PipelineCanvas/NodeTypes.js'

describe('NODE_TYPES', () => {
  it('defines exactly the seven spec node types', () => {
    const ids = NODE_TYPES.map((t) => t.id).sort()
    expect(ids).toEqual(
      ['agent', 'condition', 'fanout', 'human', 'merge', 'skill', 'trigger'].sort(),
    )
  })

  it('every type has a label and a default config object', () => {
    for (const t of NODE_TYPES) {
      expect(typeof t.label).toBe('string')
      expect(t.label.length).toBeGreaterThan(0)
      expect(typeof t.defaultConfig).toBe('object')
    }
  })
})

describe('makeNode', () => {
  it('creates a node with a unique id, the type, position, and the type default config', () => {
    const a = makeNode('agent', 10, 20)
    const b = makeNode('agent', 30, 40)
    expect(a.type).toBe('agent')
    expect(a.x).toBe(10)
    expect(a.y).toBe(20)
    expect(a.config).toEqual({ goal: '' })
    expect(a.id).not.toBe(b.id)
  })

  it('throws on an unknown type', () => {
    expect(() => makeNode('nope', 0, 0)).toThrow()
  })
})

describe('serializeToFleetSpec', () => {
  const agentA = makeNode('agent', 0, 0)
  agentA.config.goal = 'write the parser'
  const agentB = makeNode('agent', 0, 0)
  agentB.config.goal = 'write the tests'

  it('maps agent nodes to children count and folds their goals into the goal text', () => {
    const spec = serializeToFleetSpec([agentA, agentB], [], 'Build parser')
    expect(spec.children).toBe(2)
    expect(spec.goal).toContain('Build parser')
    expect(spec.goal).toContain('write the parser')
    expect(spec.goal).toContain('write the tests')
  })

  it('sets policy.requireApproval true when a Human node is present', () => {
    const human = makeNode('human', 0, 0)
    const spec = serializeToFleetSpec([agentA, human], [], 'Gated build')
    expect(spec.policy.requireApproval).toBe(true)
  })

  it('sets policy.requireApproval false when no Human node is present', () => {
    const spec = serializeToFleetSpec([agentA], [], 'Ungated')
    expect(spec.policy.requireApproval).toBe(false)
  })

  it('defaults children to 1 when there are no agent nodes', () => {
    const trigger = makeNode('trigger', 0, 0)
    const spec = serializeToFleetSpec([trigger], [], 'Just a trigger')
    expect(spec.children).toBe(1)
  })
})
