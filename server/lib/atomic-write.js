// Shared atomic-write helpers for routes that persist user data to
// the filesystem. The pattern: write to a unique <final>.tmp.<uuid>
// path then fs.rename() onto the final destination. rename() is
// atomic on the same filesystem, so two concurrent writers can never
// interleave their bytes mid-write — which was producing corrupted
// JSON files in tasks/, workflows/, and skills/ before this fix
// (Run #20 + Run #21 race probes).
//
// On Windows, fs.rename can transiently fail with EPERM/EBUSY/EEXIST
// when another process is currently renaming TO the same destination
// or holding it open. We retry a few times with small backoff to ride
// out the race. If retries are exhausted the error propagates so the
// route can return a clean 5xx and the client can retry.

import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'

const RETRY_DELAYS_MS = [0, 8, 24, 60]
const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EEXIST'])

export async function atomicWrite(filePath, contents) {
  const tmp = filePath + '.tmp.' + randomUUID().slice(0, 8)
  await fs.writeFile(tmp, contents)
  let lastErr
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    try {
      await fs.rename(tmp, filePath)
      return
    } catch (err) {
      lastErr = err
      if (!TRANSIENT_CODES.has(err.code)) break
    }
  }
  // Best-effort cleanup of the orphaned temp file on terminal failure
  try {
    await fs.unlink(tmp)
  } catch {
    /* ignore */
  }
  throw lastErr
}

export async function atomicWriteJson(filePath, data) {
  return atomicWrite(filePath, JSON.stringify(data, null, 2))
}
