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
    expect(a.config).toEqual({ goal: '', cwd: '' })
    expect(a.id).not.toBe(b.id)
  })

  it('throws on an unknown type', () => {
    expect(() => makeNode('nope', 0, 0)).toThrow()
  })
})

describe('serializeToFleetSpec', () => {
  function agent(goal, cwd) {
    const n = makeNode('agent', 0, 0)
    n.config.goal = goal
    if (cwd !== undefined) n.config.cwd = cwd
    return n
  }

  it('maps each agent node to a child {cwd, prompt} and folds goals into the goal text', () => {
    const spec = serializeToFleetSpec(
      [agent('write the parser', '/repo/a'), agent('write the tests', '/repo/b')],
      [],
      'Build parser',
    )
    expect(spec.children).toEqual([
      { cwd: '/repo/a', prompt: 'write the parser' },
      { cwd: '/repo/b', prompt: 'write the tests' },
    ])
    expect(spec.goal).toContain('Build parser')
    expect(spec.goal).toContain('write the parser')
    expect(spec.goal).toContain('write the tests')
  })

  it('produces the shape /api/fleet validates: children is a non-empty array, each with a string cwd and a non-empty prompt', () => {
    const spec = serializeToFleetSpec([agent('do work', '/repo/x')], [], 'Job')
    expect(Array.isArray(spec.children)).toBe(true)
    expect(spec.children.length).toBeGreaterThan(0)
    for (const child of spec.children) {
      expect(typeof child.cwd).toBe('string')
      expect(typeof child.prompt).toBe('string')
      expect(child.prompt.trim().length).toBeGreaterThan(0)
    }
  })

  it('falls back to the pipeline name as the prompt when an agent has no goal', () => {
    const spec = serializeToFleetSpec([agent('', '/repo/x')], [], 'Fallback name')
    expect(spec.children[0].prompt).toBe('Fallback name')
  })

  it('sends an empty cwd (server rejects it) when an agent node has no working dir', () => {
    const spec = serializeToFleetSpec([agent('do work')], [], 'No cwd')
    expect(spec.children[0].cwd).toBe('')
  })

  it('sets policy.requireApproval true when a Human node is present', () => {
    const human = makeNode('human', 0, 0)
    const spec = serializeToFleetSpec([agent('x', '/repo/a'), human], [], 'Gated build')
    expect(spec.policy.requireApproval).toBe(true)
  })

  it('sets policy.requireApproval false when no Human node is present', () => {
    const spec = serializeToFleetSpec([agent('x', '/repo/a')], [], 'Ungated')
    expect(spec.policy.requireApproval).toBe(false)
  })

  it('produces an empty children array when there are no agent nodes', () => {
    const trigger = makeNode('trigger', 0, 0)
    const spec = serializeToFleetSpec([trigger], [], 'Just a trigger')
    expect(spec.children).toEqual([])
  })
})
