import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { getAuthToken, setAuthToken } from './lib/authToken.js'

// First-run token setup. The server prints the auth token once on startup
// (scripts/wait-ready.js); the user copies it from the terminal and pastes it
// here. We persist it to localStorage (mc_auth_token) so useApi / useSSE / the
// global fetch wrapper attach it to every /api request. The token deliberately
// never travels over an unauthenticated API channel — paste-once is the secure
// path.
export default function Setup() {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const existing = getAuthToken()

  function save(e) {
    e.preventDefault()
    const token = value.trim()
    if (!token) return
    setAuthToken(token)
    setSaved(true)
    // Brief confirmation, then send the user into the app.
    setTimeout(() => {
      window.location.href = '/'
    }, 600)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-6 text-gray-100">
      <div className="max-w-md w-full space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center">
            <KeyRound size={20} className="text-indigo-300" />
          </div>
          <h1 className="text-lg font-semibold">Mission Control — Set up access</h1>
        </div>

        <p className="text-sm text-gray-400">
          The cockpit API requires a local auth token. It was printed in your terminal on startup (
          <code className="text-gray-300">🔑 Auth token: …</code>) and saved to{' '}
          <code className="text-gray-300">server/data/.auth-token</code>. Paste it below to connect
          this browser.
        </p>

        {existing && !saved && (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <ShieldCheck size={14} />A token is already saved in this browser. Paste a new one only
            to replace it.
          </div>
        )}

        <form onSubmit={save} className="space-y-3">
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste your auth token"
            className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={!value.trim() || saved}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {saved ? 'Saved — connecting…' : 'Save token & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
