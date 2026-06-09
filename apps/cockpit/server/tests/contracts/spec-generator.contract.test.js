import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  generateSpec,
  renderSpec,
  loadSchemas,
  listSchemaFiles,
  SPEC_PATH,
} from '../../../../../packages/contracts/tools/generate-spec.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONTRACTS_DIR = path.resolve(__dirname, '../../../../../packages/contracts')
const SCHEMAS_DIR = path.join(CONTRACTS_DIR, 'schemas')
const SIDECAR_PATH = path.join(CONTRACTS_DIR, 'schema-version.json')

const sidecar = JSON.parse(readFileSync(SIDECAR_PATH, 'utf-8'))

// The spec generator (B-contract-spec) publishes the contract as a versioned,
// vendor-neutral spec rendered FROM the schemas. This unit test guards the
// generator itself: it is deterministic, covers every schema (including
// audit-event), surfaces the surface version, and produces the exact bytes that
// are committed to SPEC.md (so the freshness gate is meaningful). It also asserts
// the generated prose is vendor-neutral.
describe('contract spec generator', () => {
  it('lists every schema file, including the audit-event schema', () => {
    const files = listSchemaFiles(SCHEMAS_DIR)
    expect(files).toContain('audit-event.schema.json')
    expect(files).toContain('harness-status.schema.json')
    // One entry per .schema.json file in the directory — none silently dropped.
    const onDisk = files.filter((f) => f.endsWith('.schema.json'))
    expect(files.length).toBe(onDisk.length)
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  it('is deterministic: same inputs render identical bytes', () => {
    const a = generateSpec()
    const b = generateSpec()
    expect(a).toBe(b)
  })

  it('renders the contract surface version from the sidecar', () => {
    const spec = generateSpec()
    expect(spec).toContain(`schemaVersion): ${sidecar.schemaVersion}`)
    expect(spec).toContain(`approvalSchemaVersion): ${sidecar.approvalSchemaVersion}`)
  })

  it('documents every schema title in the rendered spec', () => {
    const spec = generateSpec()
    for (const { schema, file } of loadSchemas(SCHEMAS_DIR)) {
      const heading = schema.title || file
      expect(spec, `spec is missing a section for ${file}`).toContain(`### ${heading}`)
    }
  })

  it('includes the audit-event schema section with its canonical enums', () => {
    const spec = generateSpec()
    expect(spec).toContain('### AuditEvent')
    expect(spec).toContain('audit-event.schema.json')
    // The audit-event enums must surface as readable enum() labels.
    expect(spec).toContain('"spawn"')
    expect(spec).toContain('"approval"')
    expect(spec).toContain('"merge"')
    expect(spec).toContain('"cockpit"')
    expect(spec).toContain('"harness"')
  })

  it('renders vendor-NEUTRAL prose (no claude/anthropic/cursor/codex/openai/gpt/gemini)', () => {
    const blob = generateSpec().toLowerCase()
    for (const vendor of ['claude', 'anthropic', 'cursor', 'codex', 'openai', 'gpt', 'gemini']) {
      expect(blob, `generated spec must be vendor-neutral; found "${vendor}"`).not.toContain(vendor)
    }
  })

  it('marks itself a generated file with a regenerate hint', () => {
    const spec = generateSpec()
    expect(spec).toContain('GENERATED FILE')
    expect(spec).toContain('generate-spec.mjs --write')
  })

  it('the committed SPEC.md equals the regenerated output (freshness)', () => {
    const committed = readFileSync(SPEC_PATH, 'utf-8')
    expect(committed).toBe(generateSpec())
  })

  it('renderSpec is a pure function of (schemas, sidecar)', () => {
    const schemas = loadSchemas(SCHEMAS_DIR)
    const out1 = renderSpec(schemas, sidecar)
    const out2 = renderSpec(schemas, sidecar)
    expect(out1).toBe(out2)
    expect(out1).toContain('# Mission Control Contract Specification')
  })
})
