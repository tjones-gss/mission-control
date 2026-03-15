import { X, Eye, ListTodo, Users, Command, Circle } from 'lucide-react';

export function LegendModal({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg max-w-lg w-full mx-4 overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">Oversight — Help</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">

          {/* Layout */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Layout</h3>
            <ul className="space-y-1">
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Left panel</span> — Sessions grouped by Active / Recent / Older (older collapsed by default)
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Center panel</span> — Active tab content (Agents / Tasks / Teams / Skills)
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Right panel</span> — Live event feed (SSE stream of file change events)
              </li>
            </ul>
          </section>

          {/* Tabs */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Tabs</h3>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <Eye size={14} className="text-gray-500 mt-0.5 shrink-0" />
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400 font-medium">Agents</span> — Session detail: agent tree, conversation view, Intel analysis
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ListTodo size={14} className="text-gray-500 mt-0.5 shrink-0" />
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400 font-medium">Tasks</span> — Claude Code task boards per session
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Users size={14} className="text-gray-500 mt-0.5 shrink-0" />
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400 font-medium">Teams</span> — Team inboxes and configs
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Command size={14} className="text-gray-500 mt-0.5 shrink-0" />
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400 font-medium">Skills</span> — Installed skills (user + plugins)
                </span>
              </li>
            </ul>
          </section>

          {/* Colors & Status */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Colors & Status</h3>
            <ul className="space-y-2">
              <li className="flex items-center gap-2">
                <Circle size={10} className="fill-green-500 text-green-500 shrink-0" />
                <span className="text-xs text-gray-500">Green dot — active session (modified &lt; 5 min)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                <span className="text-xs text-gray-500">Amber — warning / flag / session waiting for human input</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400 shrink-0" />
                <span className="text-xs text-gray-500">Cyan — recommendation / in-progress status</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
                <span className="text-xs text-gray-500">Purple badge — team assignment</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full ring-2 ring-indigo-500 bg-transparent shrink-0" />
                <span className="text-xs text-gray-500">Indigo ring — selected item</span>
              </li>
            </ul>
          </section>

          {/* Notifications */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notifications</h3>
            <ul className="space-y-1">
              <li className="text-xs text-gray-500">
                Oversight detects when an agent is waiting for input (end_turn or pending tool approval).
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Amber pulse</span> — session needs human input
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Bell icon</span> — click to enable desktop notifications
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Settings (gear icon)</span> — toggle notifications and sound on/off
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Dismiss (X)</span> — mute a specific session's waiting indicator
              </li>
            </ul>
          </section>

          {/* Terminology */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Terminology</h3>
            <ul className="space-y-1">
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Session</span> — one Claude Code invocation (one JSONL file in ~/.claude/projects/)
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">isActive</span> — session file modified within the last 5 minutes
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Subagent</span> — child agent spawned via the Agent tool
              </li>
              <li className="text-xs text-gray-500">
                <span className="text-gray-400 font-medium">Intel</span> — opt-in AI analysis of session content (~$0.04/call, disabled by default)
              </li>
            </ul>
          </section>

          {/* Intel note */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Intel Analysis</h3>
            <p className="text-xs text-gray-500">
              Intel analysis is disabled by default. Enable via the toggle in the Agents tab Intel sub-view.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
