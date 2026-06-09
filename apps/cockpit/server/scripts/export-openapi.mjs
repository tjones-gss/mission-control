#!/usr/bin/env node
// Export the cockpit OpenAPI spec to a JSON file WITHOUT booting the server.
//
// Usage:  node scripts/export-openapi.mjs [outPath]   (default: openapi.json)
//
// CI calls this to publish the spec as an artifact. It imports the spec builder
// directly (lib/openapi.js is import-safe — no socket), serializes it, and
// writes to argv[2] or ./openapi.json.
//
// FAIL-CLOSED: if the spec has an empty `paths` object the annotations did not
// resolve (e.g. a bad glob), which would publish a useless empty contract — so
// exit non-zero with a clear message rather than writing a hollow file.

import { writeFileSync } from 'node:fs'
import { buildOpenApiSpec } from '../lib/openapi.js'

const outPath = process.argv[2] || 'openapi.json'

const spec = buildOpenApiSpec()

const pathCount = spec && spec.paths ? Object.keys(spec.paths).length : 0
if (pathCount === 0) {
  console.error(
    'export-openapi: refusing to write a spec with no paths — the @openapi ' +
      'annotation glob resolved to nothing. Check lib/openapi.js ROUTES_GLOB.',
  )
  process.exit(1)
}

writeFileSync(outPath, JSON.stringify(spec, null, 2))
console.log(`export-openapi: wrote ${pathCount} paths to ${outPath}`)
