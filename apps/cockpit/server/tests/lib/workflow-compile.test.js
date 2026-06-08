import { describe, it, expect } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { pipelinePhaseSchema } from '@mission-control/contracts'
import { compileWorkflowToPhase } from '../../lib/workflow-compile.js'

function compile(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(schema)
}

describe('compileWorkflowToPhase (ADR-0006: workflow = degenerate single-phase pipeline)', () => {
  const validate = compile(pipelinePhaseSchema)

  it('compiles a full workflow into a schema-valid canonical phase', () => {
    const phase = compileWorkflowToPhase({
      name: 'nightly-audit',
      description: 'Run the nightly security audit',
      steps: [{ type: 'agent', agentType: 'security-reviewer', prompt: 'audit' }],
    })
    expect(phase).toMatchObject({
      id: 'nightly-audit',
      agent: 'security-reviewer',
      strategy: 'single',
      gate: { required: [] },
      goal: 'Run the nightly security audit',
    })
    const ok = validate(phase)
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2))
    expect(ok).toBe(true)
  })

  it('falls back to orchestrator agent and name-as-goal when fields are sparse', () => {
    const phase = compileWorkflowToPhase({ name: 'bare' })
    expect(phase.agent).toBe('orchestrator')
    expect(phase.goal).toBe('bare')
    expect(validate(phase)).toBe(true)
  })

  it('produces a schema-valid phase even for an empty/garbage workflow', () => {
    for (const wf of [null, {}, { steps: [{}] }]) {
      const phase = compileWorkflowToPhase(wf)
      const ok = validate(phase)
      if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2))
      expect(ok).toBe(true)
    }
  })
})
