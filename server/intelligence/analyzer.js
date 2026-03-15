import { runClaude } from '../claude-cli.js'

export async function analyzeSession(sessionData) {
  const prompt = buildPrompt(sessionData)
  const { stdout } = await runClaude({
    args: [
      '-p', prompt,
      '--output-format', 'json',
      // Skip all MCP server connections — they cause startup to hang for 30+ seconds
      // when spawned as a subprocess without a TTY (MCP servers wait for connections
      // that never complete in non-interactive mode).
      '--mcp-config', '{"mcpServers":{}}',
      '--strict-mcp-config',
      // No need to persist a session for a one-shot analysis call
      '--no-session-persistence',
    ],
    timeoutMs: 60_000,
  })

  try {
    const parsed = JSON.parse(stdout)
    const text = parsed.result ?? parsed.content ?? stdout
    return parseIntelligence(text)
  } catch {
    throw new Error('Failed to parse claude output')
  }
}

function buildPrompt(session) {
  const {
    sessionId, slug, cwd, model, gitBranch, isActive,
    agentTree, toolUseCounts, tokenUsage,
    lastThought, lastAction, lastText,
    messageCount,
  } = session

  const lines = [
    `Session: ${slug || sessionId.slice(0, 8)}`,
    `CWD: ${cwd || 'unknown'}`,
    `Model: ${model || 'unknown'}`,
    `Branch: ${gitBranch || 'unknown'}`,
    `Active: ${isActive}`,
    `Total records: ${messageCount || 0}`,
    '',
    `Agent tree: main=${agentTree?.mainMessageCount || 0} messages, ${agentTree?.subagents?.length || 0} subagents`,
  ]

  if (agentTree?.subagents?.length > 0) {
    for (const sub of agentTree.subagents) {
      lines.push(`  Subagent: ${sub.description?.slice(0, 80) || 'unnamed'} (${sub.messageCount} msgs)`)
    }
  }

  if (toolUseCounts && Object.keys(toolUseCounts).length > 0) {
    const top5 = Object.entries(toolUseCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    lines.push('')
    lines.push('Top tools: ' + top5.map(([n, c]) => `${n}×${c}`).join(', '))
  }

  if (tokenUsage) {
    lines.push(`Tokens: input=${tokenUsage.input} output=${tokenUsage.output} cacheRead=${tokenUsage.cacheRead}`)
  }

  if (lastThought) {
    lines.push('')
    lines.push(`Last thought: ${lastThought.slice(0, 200)}`)
  }

  if (lastAction) {
    lines.push(`Last action: ${lastAction.name} — ${lastAction.summary}`)
  }

  if (lastText) {
    lines.push(`Last assistant text: ${lastText.slice(0, 300)}`)
  }

  const context = lines.join('\n')

  return `Analyze this Claude Code session and respond with ONLY a JSON object (no markdown, no code fences):
{
  "goal": "one sentence — what is this session trying to accomplish",
  "progress": "one sentence — where in that goal, qualitatively",
  "flags": ["concern strings, empty array if none"],
  "subagents": "one sentence about spawned agents, or 'none'",
  "recommendation": "one optional human-actionable suggestion, or null"
}

Session data:
${context}`
}

function parseIntelligence(text) {
  // Strip markdown code fences if present
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  const parsed = JSON.parse(cleaned)
  // Validate shape
  return {
    goal: String(parsed.goal || ''),
    progress: String(parsed.progress || ''),
    flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [],
    subagents: String(parsed.subagents || 'none'),
    recommendation: parsed.recommendation ? String(parsed.recommendation) : null,
  }
}
