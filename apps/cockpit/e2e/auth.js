// Fixed auth token for the e2e suite. The server now enforces a local auth
// token on every non-/api/health request (feat/local-auth-token). For e2e we
// pin a known token via OVERSIGHT_AUTH_TOKEN (set in playwright.config.js's
// webServer env) instead of letting the server generate a random one, so the
// browser and the API request contexts can present the matching credential.
//
// Two channels, because the app authenticates two ways:
//   - Browser pages read the token from localStorage `mc_auth_token` (seeded via
//     Playwright storageState in playwright.config.js); the client then attaches
//     it to fetch (Authorization) and to SSE (?token=) itself.
//   - The APIRequestContext (api-*.spec.js) is not a browser and has no
//     localStorage, so it sends the Bearer header directly via E2E_API_HEADERS.
export const E2E_AUTH_TOKEN = 'e2e-fixed-auth-token-not-a-secret'

// Headers for direct-API tests: the existing Origin pin (originGuard / CSRF) plus
// the Bearer token the auth middleware now requires.
export const E2E_API_HEADERS = {
  Origin: 'http://localhost:5173',
  Authorization: `Bearer ${E2E_AUTH_TOKEN}`,
}
