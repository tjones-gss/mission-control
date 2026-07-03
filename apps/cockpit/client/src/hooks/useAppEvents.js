import { useCallback, useRef, useState } from 'react'
import { useSSE } from './useSSE.js'
import { getNotificationPrefs } from './useNotifications.js'

// The app's SSE spine, extracted from App.jsx: one hook that owns the event
// stream and everything derived from it — the activity feed, the version
// counters that drive useApi refetches, the anomaly lifecycle, degraded-parser
// reports, and event sounds. App.jsx destructures the counters under their
// original names, so consumers are unchanged.

// Map SSE event types to sound event names
const SSE_SOUND_MAP = {
  session_update: 'sessionUpdate',
  task_update: 'taskUpdate',
  intelligence_update: 'intelligenceReady',
  new_session: 'newSession',
  team_update: 'teamUpdate',
  history_update: 'historyUpdate',
  sdk_message: 'sessionUpdate',
}

// Throttle interval for session_update sounds (ms)
const SESSION_UPDATE_SOUND_COOLDOWN = 5000

export function useAppEvents({
  streaming,
  soundEngine,
  onNewSession,
  refetchWorkflows,
  refetchSkills,
}) {
  const [events, setEvents] = useState([])
  // V3 hook instrumentation: the most recent real tool_call SSE event. MeshView
  // turns it into a live packet; null until a hook bridge is installed (then the
  // mesh falls back to simulated packets).
  const [lastToolCall, setLastToolCall] = useState(null)
  const [anomalies, setAnomalies] = useState([])
  const anomalySeqRef = useRef(0)
  const [sessionsVersion, setSessionsVersion] = useState(0)
  const [tasksVersion, setTasksVersion] = useState(0)
  const [intelligenceVersion, setIntelligenceVersion] = useState(0)
  const [teamsVersion, setTeamsVersion] = useState(0)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [planVersion, setPlanVersion] = useState(0)
  const [configVersion, setConfigVersion] = useState(0)
  const [memoryVersion, setMemoryVersion] = useState(0)
  const [hooksVersion, setHooksVersion] = useState(0)
  const [conductorVersion, setConductorVersion] = useState(0)
  const [harnessVersion, setHarnessVersion] = useState(0)
  const [fleetVersion, setFleetVersion] = useState(0)
  // Parsers that reported a present-but-unparseable (degraded) ~/.claude read.
  // Keyed by `${parser}:${reason}` so a banner shows the distinct failures
  // without churning on repeated emits of the same one.
  const [degradedParsers, setDegradedParsers] = useState([])
  // Per-run escalation dedupe: only fire sound + notification on the
  // transition into a paused/escalated state, not on every status.json
  // rewrite that keeps the same escalation_reason. Key = `${projectPath}::${adr}`,
  // value = the last seen escalation_reason string (or null when running).
  const lastEscalationRef = useRef(new Map())
  const lastSessionSoundRef = useRef(0)
  const sessionsDebounceRef = useRef(null)

  // Latest-value refs so the SSE handler identity stays stable without
  // re-subscribing when callers re-render.
  const onNewSessionRef = useRef(onNewSession)
  onNewSessionRef.current = onNewSession
  const refetchWorkflowsRef = useRef(refetchWorkflows)
  refetchWorkflowsRef.current = refetchWorkflows
  const refetchSkillsRef = useRef(refetchSkills)
  refetchSkillsRef.current = refetchSkills

  const { connected } = useSSE(
    useCallback(
      (evt) => {
        // Forward SDK events to streaming handler
        streaming.handleSdkEvent(evt)

        setEvents((prev) => [...prev.slice(-199), evt])
        if (evt.type === 'session_update' || evt.type === 'new_session') {
          if (evt.type === 'new_session') {
            onNewSessionRef.current?.()
          }
          if (!sessionsDebounceRef.current) {
            sessionsDebounceRef.current = setTimeout(() => {
              sessionsDebounceRef.current = null
              setSessionsVersion((v) => v + 1)
            }, 100)
          }
        }
        if (evt.type === 'task_update') {
          setTasksVersion((v) => v + 1)
        }
        if (evt.type === 'tool_call') {
          setLastToolCall(evt.data)
        }
        if (evt.type === 'anomaly' && evt.data) {
          const id = `an-${(anomalySeqRef.current += 1)}`
          setAnomalies((prev) => {
            const next = [...prev, { id, state: 'new', ts: Date.now(), ...evt.data }]
            // Retention cap so a noisy long-running session can't grow the
            // list (and the panel) without bound: evict settled entries
            // (resolved first, then acknowledged) before ever dropping an
            // unseen 'new' one; oldest go first within each state.
            const MAX_ANOMALIES = 50
            let overflow = next.length - MAX_ANOMALIES
            if (overflow <= 0) return next
            for (const state of ['resolved', 'acknowledged', 'new']) {
              for (let i = 0; i < next.length && overflow > 0; ) {
                if (next[i].state === state) {
                  next.splice(i, 1)
                  overflow -= 1
                } else {
                  i += 1
                }
              }
              if (overflow <= 0) break
            }
            return next
          })
        }
        if (evt.type === 'intelligence_update') {
          setIntelligenceVersion((v) => v + 1)
        }
        if (evt.type === 'team_update') {
          setTeamsVersion((v) => v + 1)
        }
        if (evt.type === 'history_update') {
          setHistoryVersion((v) => v + 1)
        }
        if (evt.type === 'plan_update') {
          setPlanVersion((v) => v + 1)
        }
        if (evt.type === 'config_update') {
          setConfigVersion((v) => v + 1)
        }
        if (evt.type === 'memory_update') {
          setMemoryVersion((v) => v + 1)
        }
        if (evt.type === 'hooks_update') {
          setHooksVersion((v) => v + 1)
        }
        if (evt.type === 'conductor_update') {
          setConductorVersion((v) => v + 1)
          // The watcher payload only tells us *something* in this run's
          // .conductor/<adr>/ changed — it doesn't include the parsed
          // status. Fetch the run and check isPaused so we can fire the
          // escalation sound + notification exactly once on transition.
          const { projectPath, adr } = evt.data || {}
          if (projectPath && adr) {
            const key = `${projectPath}::${adr}`
            fetch(`/api/conductor/${encodeURIComponent(projectPath)}/${adr}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((run) => {
                if (!run) return
                const lastReason = lastEscalationRef.current.get(key) ?? null
                const currentReason = run.isPaused ? run.escalationReason || 'paused' : null
                lastEscalationRef.current.set(key, currentReason)
                // Fire only on transition from running/different-reason to paused
                if (currentReason && currentReason !== lastReason) {
                  if (getNotificationPrefs().sound) {
                    soundEngine.play('conductorEscalation', {
                      projectLabel: run.projectLabel,
                      adr: run.adr,
                      escalationReason: run.escalationReason || 'paused',
                    })
                  }
                  if (
                    typeof Notification !== 'undefined' &&
                    Notification.permission === 'granted'
                  ) {
                    new Notification('Conductor paused', {
                      body: `${run.projectLabel} ADR ${run.adr}: ${run.escalationReason || 'awaiting your decision'}`,
                      tag: `conductor-${key}`,
                    })
                  }
                }
              })
              .catch(() => {
                /* network errors swallowed — next event will retry */
              })
          }
        }
        if (evt.type === 'harness_update') {
          setHarnessVersion((v) => v + 1)
        }
        if (evt.type === 'fleet_update') {
          setFleetVersion((v) => v + 1)
        }
        if (evt.type === 'parser_degraded') {
          const { parser, reason } = evt.data || {}
          if (parser) {
            setDegradedParsers((prev) => {
              const key = `${parser}:${reason || ''}`
              if (prev.some((d) => `${d.parser}:${d.reason || ''}` === key)) return prev
              return [...prev, { parser, reason }]
            })
          }
        }
        if (evt.type === 'workflows_update') {
          refetchWorkflowsRef.current?.()
        }
        if (evt.type === 'skills_update') {
          refetchSkillsRef.current?.()
        }

        // Play sound for non-session events (needsInput is handled by useNotifications)
        const soundEvent = SSE_SOUND_MAP[evt.type]
        if (soundEvent && getNotificationPrefs().sound) {
          // Throttle session_update sounds to avoid noise
          if (evt.type === 'session_update') {
            const now = Date.now()
            if (now - lastSessionSoundRef.current < SESSION_UPDATE_SOUND_COOLDOWN) return
            lastSessionSoundRef.current = now
          }
          soundEngine.play(
            soundEvent,
            evt.sessionId ? { projectLabel: evt.projectLabel || 'session' } : undefined,
          )
        }
      },
      [soundEngine, streaming.handleSdkEvent],
    ),
  )

  // Anomaly lifecycle: new → acknowledged (toast dismissed / seen) → resolved.
  const acknowledgeAnomaly = useCallback((id) => {
    setAnomalies((prev) =>
      prev.map((a) => (a.id === id && a.state === 'new' ? { ...a, state: 'acknowledged' } : a)),
    )
  }, [])
  const resolveAnomaly = useCallback((id) => {
    setAnomalies((prev) => prev.map((a) => (a.id === id ? { ...a, state: 'resolved' } : a)))
  }, [])

  return {
    connected,
    events,
    lastToolCall,
    anomalies,
    acknowledgeAnomaly,
    resolveAnomaly,
    degradedParsers,
    sessionsVersion,
    tasksVersion,
    intelligenceVersion,
    teamsVersion,
    historyVersion,
    planVersion,
    configVersion,
    memoryVersion,
    hooksVersion,
    conductorVersion,
    harnessVersion,
    fleetVersion,
  }
}
