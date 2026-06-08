// Workflow → canonical pipeline phase compiler (ADR-0006).
//
// "A Workflow is a degenerate single-phase pipeline compiled to this same
// shape." A cockpit workflow (~/.claude/workflows/*.json: { name, description,
// steps[] }) is not a separate orchestration engine — it compiles to ONE
// canonical phase that conforms to packages/contracts/schemas/
// pipeline-phase.schema.json. This keeps Workflows on the same spine contract as
// the harness pipeline and Fleet, rather than a parallel paradigm.
//
// The output is intentionally minimal and schema-valid: only the keys the
// relaxed pipeline-phase schema allows (additionalProperties:false), with the
// canonical defaults (strategy:'single', empty gate set) materialized.

/**
 * Compile a cockpit workflow object into a single canonical pipeline phase.
 * @param {{name?: string, description?: string, steps?: Array<{agentType?: string}>}} workflow
 * @returns {{id: string, agent: string, gate: {required: string[]}, strategy: 'single', goal: string, description?: string}}
 */
export function compileWorkflowToPhase(workflow) {
  const wf = workflow && typeof workflow === 'object' ? workflow : {}

  const id = nonEmpty(wf.name) ? wf.name : 'workflow'
  // A workflow's steps each name an agentType; the degenerate phase runs under a
  // representative agent — the first step's agentType, else the orchestrator.
  const firstAgent = Array.isArray(wf.steps)
    ? wf.steps.map((s) => s && s.agentType).find(nonEmpty)
    : null
  const agent = nonEmpty(firstAgent) ? firstAgent : 'orchestrator'

  // The goal carried through for alignment checks: the workflow's description,
  // falling back to its name (goal must be a non-empty string per the schema).
  const goal = nonEmpty(wf.description) ? wf.description : id

  const phase = {
    id,
    agent,
    gate: { required: [] },
    strategy: 'single',
    goal,
  }
  if (nonEmpty(wf.description)) phase.description = wf.description
  return phase
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0
}
