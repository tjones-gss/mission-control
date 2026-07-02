import { Router } from 'express'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { spawn } from 'node:child_process'
import { logger } from '../lib/logger.js'

export const router = Router()

const PICKER_TIMEOUT_MS = 120_000

function pickerCommand(initialPath) {
  if (process.platform === 'win32') {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select working directory'
$dialog.ShowNewFolderButton = $true
if ($env:MC_INITIAL_DIRECTORY -and (Test-Path -LiteralPath $env:MC_INITIAL_DIRECTORY -PathType Container)) {
  $dialog.SelectedPath = $env:MC_INITIAL_DIRECTORY
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.WriteLine($dialog.SelectedPath)
  exit 0
}
exit 2
`
    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      env: { ...process.env, MC_INITIAL_DIRECTORY: initialPath || '' },
      // The PS script exits 2 on user-cancel BY DESIGN, because PowerShell
      // itself exits 1 on a script error (e.g. WinForms unavailable in a
      // headless session) — mapping 1 → cancel here would report a
      // permanently broken picker as "user cancelled" forever.
      cancelCodes: [2],
    }
  }

  if (process.platform === 'darwin') {
    return {
      command: 'osascript',
      args: ['-e', 'POSIX path of (choose folder with prompt "Select working directory")'],
      env: process.env,
      cancelCodes: [1], // osascript: user cancelled
    }
  }

  return {
    command: 'zenity',
    args: ['--file-selection', '--directory', '--title=Select working directory'],
    env: process.env,
    cancelCodes: [1], // zenity: dialog dismissed
  }
}

function pickDirectory(initialPath) {
  return new Promise((resolve, reject) => {
    const { command, args, env, cancelCodes } = pickerCommand(initialPath)
    const child = spawn(command, args, { env, windowsHide: false })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      settled = true
      child.kill()
      const err = new Error('native folder picker timed out')
      err.code = 'ETIMEDOUT'
      reject(err)
    }, PICKER_TIMEOUT_MS)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      if (cancelCodes.includes(code)) {
        resolve(null)
        return
      }
      const err = new Error(stderr.trim() || `native folder picker exited with code ${code}`)
      err.code = 'PICKER_FAILED'
      reject(err)
    })
  })
}

router.get('/home', (_req, res) => {
  res.json({ path: os.homedir(), sep: path.sep })
})

// Single-flight: the picker pops a native modal on the SERVER's desktop, so
// concurrent requests (or a remote teammate in LAN mode hammering the button)
// must not stack dialogs on the operator's screen.
let pickerInFlight = false

router.post('/pick-directory', async (req, res) => {
  const initialPath = typeof req.body?.path === 'string' ? req.body.path : ''
  if (pickerInFlight) {
    return res.status(409).json({ error: 'a folder picker dialog is already open' })
  }
  pickerInFlight = true
  try {
    const selected = await pickDirectory(initialPath)
    if (!selected) return res.status(204).end()
    return res.json({ path: selected })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(501).json({ error: 'native folder picker unavailable' })
    }
    if (err.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'native folder picker timed out' })
    }
    // Log the real cause server-side; don't echo child stderr to the client.
    logger.warn({ detail: err?.message || err }, 'native_folder_picker_failed')
    return res.status(500).json({ error: 'native folder picker failed' })
  } finally {
    pickerInFlight = false
  }
})

// This endpoint performs an unrestricted directory listing of the host filesystem.
// Oversight is a local-only dashboard run by a single user against their own
// machine; the trust boundary is the listen port (bound to localhost by default),
// not per-request path sandboxing. Do not expose this server to other machines
// without adding an allowlist or authentication in front of it.
router.get('/list', async (req, res) => {
  const requested = req.query.path
  if (!requested || typeof requested !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }
  if (requested.includes('\u0000')) {
    return res.status(400).json({ error: 'path contains NUL byte' })
  }
  // Reject UNC / remote share paths before path.isAbsolute runs. The check
  // lives here (rather than under a `process.platform === 'win32'` gate)
  // because it's a pure string-prefix test and the dashboard is local-only
  // on every OS — we don't want anyone enumerating network shares from
  // here. On Windows, path.isAbsolute('\\\\server\\share') also returns
  // true, so without this gate the UNC path would fall through to stat().
  if (/^[\\/]{2}/.test(requested)) {
    return res.status(400).json({ error: 'UNC paths are not allowed' })
  }
  if (!path.isAbsolute(requested)) {
    return res.status(400).json({ error: 'path must be absolute' })
  }

  const abs = path.normalize(requested)

  let stat
  try {
    stat = await fs.promises.stat(abs)
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'not found' })
    }
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: 'permission denied' })
    }
    return res.status(500).json({ error: 'stat failed', detail: err.message })
  }

  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'not a directory' })
  }

  let entries
  try {
    const dirents = await fs.promises.readdir(abs, { withFileTypes: true })
    entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, type: 'dir' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: 'permission denied' })
    }
    return res.status(500).json({ error: 'readdir failed', detail: err.message })
  }

  const parentCandidate = path.dirname(abs)
  const parent = parentCandidate === abs ? null : parentCandidate

  res.json({ path: abs, parent, sep: path.sep, entries })
})
