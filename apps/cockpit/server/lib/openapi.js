// OpenAPI for the cockpit's OWN HTTP surface (Phase 4 / C-openapi).
//
// This describes the cockpit Express API — it is a SEPARATE artifact from the
// harness/contracts schema (packages/contracts). Do NOT conflate the two: the
// contracts spec versions `harness status --json`; this versions the cockpit's
// REST surface, and its version tracks the server package version (S3 → 0.4.0).
//
// Scope (per SCOPE.md / ADR-0007): only CORE routers carry @openapi JSDoc this
// phase (health, sessions, fleet, harness, conductor, rails). The ~13
// EXPERIMENTAL routers stay unannotated by design — an intentional incremental
// strategy, not an omission. The SSE stream route is excluded (no clean OpenAPI
// representation of a long-lived text/event-stream).

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'
import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'

const require = createRequire(import.meta.url)
// info.version READS the server package version (set to 0.4.0 by S3) — never
// hardcoded, so the published API version moves in lockstep with the package.
const { version: serverVersion } = require('../package.json')

// Resolve the annotation glob ABSOLUTELY from this module's own location, NOT
// from process.cwd() — swagger-jsdoc globs are cwd-relative by default, which
// would silently produce an empty `paths` when the server is launched from a
// different directory (e.g. the repo root via `npm run up`, or vitest). Anchor
// to <server>/routes so the spec is deterministic regardless of cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTES_GLOB = path.resolve(__dirname, '../routes/*.js')

// The CORE paths this step annotates, exported so the parity test (and any
// future drift guard) can assert the served spec actually contains them. Path
// templating uses the OpenAPI `{param}` form, not Express's `:param`.
export const CORE_PATHS = [
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/api/sessions',
  '/api/sessions/{sessionId}',
  '/api/sessions/{sessionId}/tool-approval',
  '/api/sessions/{sessionId}/cancel',
  '/api/fleet',
  '/api/fleet/{id}',
  '/api/harness',
  '/api/harness/{projectKey}',
  '/api/conductor',
  '/api/rails/adopt-candidates',
  '/api/rails/adopt',
  '/api/search',
]

// Build the spec from the JSDoc @openapi blocks in the CORE routers. Pure and
// deterministic — given the same source it returns the same document.
export function buildOpenApiSpec() {
  return swaggerJsdoc({
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'Mission Control Cockpit API',
        version: serverVersion,
        description:
          "The Mission Control cockpit's own HTTP surface. SEPARATE from the " +
          'harness/contracts schema (packages/contracts) — see ADR-0005. Only ' +
          'CORE routers are annotated this phase.',
      },
    },
    apis: [ROUTES_GLOB],
  })
}

// Memoize at module load: the spec is static for the process lifetime, and a
// malformed definition should fail LOUD here at boot rather than on first
// request. No bare catch — a throw propagates with swagger-jsdoc's own context.
const spec = buildOpenApiSpec()

// Mount the docs surface onto an existing app. Called from buildApp() AFTER
// express.json + the routers but BEFORE the '/api' 404 catch-all, so neither
// the body parser nor the catch-all shadows these routes.
//
// CSP NOTE: swagger-ui ships inline styles/scripts that the global helmet CSP
// (default-src 'self') would block. We scope a relaxed CSP to the /api/docs
// sub-path ONLY via swagger-ui-express's customCssUrl-free setup with an
// explicit per-route helmet override — the GLOBAL CSP is never weakened. The
// raw /api/docs.json (machine-readable spec) carries no inline assets, so it
// needs no override.
export function mountOpenApi(app) {
  // Machine-readable spec — plain JSON, no inline assets, no CSP concern.
  app.get('/api/docs.json', (_req, res) => {
    res.json(spec)
  })

  // Interactive swagger-ui. The setup middleware serves an HTML page with
  // inline styles; relaxing CSP is scoped to this sub-path only (below) so the
  // rest of the API keeps the strict global policy.
  app.use('/api/docs', swaggerUiCspRelax, swaggerUi.serve, swaggerUi.setup(spec))
}

// Per-route CSP relaxation, scoped to /api/docs only. swagger-ui injects inline
// <style>/<script>, so allow 'unsafe-inline' for style/script HERE and nowhere
// else. Documented dev caveat: this is acceptable because /api/docs is a
// localhost developer surface, not a data-bearing endpoint. The override sets
// only the directives swagger-ui needs and leaves the rest of the response to
// the global helmet stack.
function swaggerUiCspRelax(_req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:",
  )
  next()
}
