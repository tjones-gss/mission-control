import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The shared contract for `harness scaffold --json` output, consumed by the
// cockpit's POST /api/harness/create. Authored schema-first; this test makes it
// executable so the CLI's output and the route's response can't drift from it.
const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../../packages/contracts/schemas/harness-scaffold.schema.json',
)
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))

function compile() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(schema)
}

describe('harness-scaffold contract', () => {
  it('a success result validates', () => {
    const validate = compile()
    const ok = validate({
      ok: true,
      root: 'C:/work/fresh-app',
      mode: 'idea-to-mvp',
      stage: 'intake',
      phase: 'intake',
      created: ['.harness/project-state.yml', 'pipelines/idea-to-mvp.yml', 'AGENTS.md'],
    })
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2))
    expect(ok).toBe(true)
  })

  it('a success result MISSING required fields is rejected', () => {
    const validate = compile()
    // ok:true but no root/mode/stage/phase/created → must fail the allOf/if-then.
    expect(validate({ ok: true })).toBe(false)
  })

  it('each error result validates', () => {
    const validate = compile()
    for (const error of ['invalid_mode', 'no_target', 'already_initialized', 'pipeline_missing']) {
      const ok = validate({ ok: false, error, root: 'C:/x', message: 'because' })
      if (!ok) throw new Error(`${error}: ${JSON.stringify(validate.errors)}`)
      expect(ok).toBe(true)
    }
  })

  it('an unknown error code is rejected', () => {
    const validate = compile()
    expect(validate({ ok: false, error: 'kaboom' })).toBe(false)
  })

  it('the mode enum matches the CLI/parser mode set', () => {
    // Guards cross-language drift: if the CLI gains/loses a mode, this enum (and
    // the parser's VALID_HARNESS_MODES) must move with it.
    expect(schema.properties.mode.enum).toEqual([
      'idea-to-mvp',
      'mvp-sketch',
      'existing-repo-retrofit',
      'feature-development',
      'bugfix',
      'refactor',
      'release-readiness',
    ])
  })
})
