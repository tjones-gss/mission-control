import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

import {
  isNotifyEnabled,
  initNotify,
  shutdownNotify,
  __flushForTest,
  __setNamesFileForTest,
} from '../../lib/notify.js'
import { emit } from '../../sse.js'
import { logger } from '../../lib/logger.js'
import { config } from '../../lib/config.js'

const ORIGINAL_ENV = process.env.OVERSIGHT_WEBHOOK_URL

// Local fake HTTP receiver — the provability seam. The notifier POSTs to a real
// (ephemeral-port, loopback-only) node http server and the test asserts on the
// captured payload. No external service is ever contacted.
function startReceiver({ statusCode = 200 } = {}) {
  return new Promise((resolve) => {
    const requests = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        requests.push({ method: req.method, headers: req.headers, body })
        res.statusCode = statusCode
        res.end('ok')
      })
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${server.address().port}/hook`,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

// A URL on a port that NOTHING is listening on (bind, read the port, close).
async function deadReceiverUrl() {
  const r = await startReceiver()
  await r.close()
  return r.url
}

afterEach(async () => {
  shutdownNotify()
  __setNamesFileForTest(null)
  if (ORIGINAL_ENV === undefined) delete process.env.OVERSIGHT_WEBHOOK_URL
  else process.env.OVERSIGHT_WEBHOOK_URL = ORIGINAL_ENV
  vi.restoreAllMocks()
})

describe('notify: env-gated, OFF by default (mirrors lib/otel.js)', () => {
  beforeEach(() => {
    delete process.env.OVERSIGHT_WEBHOOK_URL
  })

  it('isNotifyEnabled() is false when OVERSIGHT_WEBHOOK_URL is unset or blank', () => {
    expect(isNotifyEnabled()).toBe(false)
    process.env.OVERSIGHT_WEBHOOK_URL = ''
    expect(isNotifyEnabled()).toBe(false)
    process.env.OVERSIGHT_WEBHOOK_URL = '   '
    expect(isNotifyEnabled()).toBe(false)
  })

  it('isNotifyEnabled() is true when OVERSIGHT_WEBHOOK_URL is set', () => {
    process.env.OVERSIGHT_WEBHOOK_URL = 'http://127.0.0.1:9/hook'
    expect(isNotifyEnabled()).toBe(true)
  })

  it('initNotify() is a total no-op when disabled: returns null, no subscription, no fetch', async () => {
    const receiver = await startReceiver()
    try {
      expect(initNotify()).toBe(null)
      emit('tool_approval_request', {
        sessionId: 'sess-1',
        toolName: 'Bash',
        riskLevel: 'dangerous',
        riskDescription: 'rm -rf',
        ts: Date.now(),
      })
      await __flushForTest()
      expect(receiver.requests).toHaveLength(0)
    } finally {
      await receiver.close()
    }
  })
})

describe('notify: tool_approval_request → webhook POST', () => {
  it('POSTs the compact payload with action_url pointing at the local cockpit', async () => {
    const receiver = await startReceiver()
    try {
      process.env.OVERSIGHT_WEBHOOK_URL = receiver.url
      initNotify()
      emit('tool_approval_request', {
        sessionId: 'sess-abc',
        approvalId: 'appr-1',
        toolName: 'Bash',
        input: { raw: 'rm -rf build' },
        riskLevel: 'dangerous',
        riskDescription: 'Recursive delete',
        ts: Date.now(),
      })
      await __flushForTest()

      expect(receiver.requests).toHaveLength(1)
      const req = receiver.requests[0]
      expect(req.method).toBe('POST')
      expect(req.headers['content-type']).toContain('application/json')
      const payload = JSON.parse(req.body)
      expect(payload).toEqual({
        sessionId: 'sess-abc',
        displayName: null,
        riskLevel: 'dangerous',
        riskDescription: 'Recursive delete',
        toolName: 'Bash',
        action_url: `http://localhost:${config.port}`,
      })
    } finally {
      await receiver.close()
    }
  })

  it('resolves displayName from the session-names store when one exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notify-names-'))
    const namesFile = path.join(dir, 'session-names.json')
    await fs.writeFile(namesFile, JSON.stringify({ 'sess-abc': 'refactor auth' }))
    __setNamesFileForTest(namesFile)

    const receiver = await startReceiver()
    try {
      process.env.OVERSIGHT_WEBHOOK_URL = receiver.url
      initNotify()
      emit('tool_approval_request', {
        sessionId: 'sess-abc',
        toolName: 'Edit',
        riskLevel: null,
        riskDescription: null,
        ts: Date.now(),
      })
      await __flushForTest()

      expect(receiver.requests).toHaveLength(1)
      const payload = JSON.parse(receiver.requests[0].body)
      expect(payload.displayName).toBe('refactor auth')
      expect(payload.toolName).toBe('Edit')
    } finally {
      await receiver.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('ignores unrelated SSE events (no POST for session_update etc.)', async () => {
    const receiver = await startReceiver()
    try {
      process.env.OVERSIGHT_WEBHOOK_URL = receiver.url
      initNotify()
      emit('session_update', { filePath: 'projects/x/y.jsonl', ts: Date.now() })
      emit('harness_update', { projectPath: 'C:\\proj', ts: Date.now() })
      await __flushForTest()
      expect(receiver.requests).toHaveLength(0)
    } finally {
      await receiver.close()
    }
  })

  it('stops POSTing after shutdownNotify() unsubscribes', async () => {
    const receiver = await startReceiver()
    try {
      process.env.OVERSIGHT_WEBHOOK_URL = receiver.url
      initNotify()
      shutdownNotify()
      emit('tool_approval_request', { sessionId: 's', toolName: 'Bash', ts: Date.now() })
      await __flushForTest()
      expect(receiver.requests).toHaveLength(0)
    } finally {
      await receiver.close()
    }
  })
})

describe('notify: harness approval-pending events', () => {
  it('POSTs a notification for harness_approval_pending watcher events', async () => {
    const receiver = await startReceiver()
    try {
      process.env.OVERSIGHT_WEBHOOK_URL = receiver.url
      initNotify()
      emit('harness_approval_pending', {
        projectPath: 'C:\\Users\\me\\proj',
        filePath: path.join('approvals', 'pending', 'req-7.json'),
        ts: Date.now(),
      })
      await __flushForTest()

      expect(receiver.requests).toHaveLength(1)
      const payload = JSON.parse(receiver.requests[0].body)
      expect(payload).toEqual({
        sessionId: null,
        displayName: null,
        riskLevel: null,
        riskDescription: expect.stringContaining('C:\\Users\\me\\proj'),
        toolName: 'harness_gate',
        action_url: `http://localhost:${config.port}`,
      })
    } finally {
      await receiver.close()
    }
  })
})

describe('notify: failure is fire-and-forget (never affects the approval flow)', () => {
  it('receiver down → logger.warn, no throw', async () => {
    const url = await deadReceiverUrl()
    process.env.OVERSIGHT_WEBHOOK_URL = url
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    initNotify()
    expect(() =>
      emit('tool_approval_request', {
        sessionId: 'sess-down',
        toolName: 'Bash',
        riskLevel: 'dangerous',
        riskDescription: 'x',
        ts: Date.now(),
      }),
    ).not.toThrow()
    await __flushForTest()
    expect(warn).toHaveBeenCalledWith(expect.any(Object), 'notify_webhook_failed')
  })

  it('non-2xx response → logger.warn, no throw', async () => {
    const receiver = await startReceiver({ statusCode: 500 })
    try {
      process.env.OVERSIGHT_WEBHOOK_URL = receiver.url
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      initNotify()
      emit('tool_approval_request', { sessionId: 's', toolName: 'Bash', ts: Date.now() })
      await __flushForTest()
      expect(receiver.requests).toHaveLength(1)
      expect(warn).toHaveBeenCalledWith(expect.any(Object), 'notify_webhook_non_2xx')
    } finally {
      await receiver.close()
    }
  })
})
