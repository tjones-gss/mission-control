import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Phase 4 (L3) — ADR-0005 Amendment 2026-06-08: the cross-vendor *viewing* label
// was DROPPED. Oversight is scoped to Claude Code only (the cockpit reads only
// ~/.claude). Cross-vendor lives in the RAILS + the versioned contract, NOT in the
// viewer. This guard fails if README.md or CLAUDE.md regress to the unqualified
// "(and Cursor/Codex) ... see and steer" VIEWING promise — closing the
// silent-regression gap the label-drop opened.

// This file lives at apps/cockpit/server/tests/docs → repo root is five levels up.
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

// The forbidden promise: the "(and Cursor/Codex)" parenthetical anywhere in the
// SEE/STEER viewing pitch. We assert the literal parenthetical is gone from the
// two high-propagation front-door docs.
const FORBIDDEN_VIEWING_PARENTHETICAL = /\(and Cursor\/Codex\)/

describe('cross-vendor viewing label (ADR-0005 Phase 4 drop)', () => {
  it('README.md does not promise cross-vendor VIEWING via "(and Cursor/Codex)"', () => {
    expect(read('README.md')).not.toMatch(FORBIDDEN_VIEWING_PARENTHETICAL)
  })

  it('CLAUDE.md does not promise cross-vendor VIEWING via "(and Cursor/Codex)"', () => {
    expect(read('CLAUDE.md')).not.toMatch(FORBIDDEN_VIEWING_PARENTHETICAL)
  })

  it('the viewing promise stays scoped to Claude Code in both front-door docs', () => {
    // "see and steer" is the viewing pitch; it must NOT sit next to the
    // multi-vendor parenthetical in the same paragraph.
    for (const rel of ['README.md', 'CLAUDE.md']) {
      const text = read(rel)
      const steerIdx = text.indexOf('see and steer')
      expect(steerIdx, `${rel} should keep the "see and steer" promise`).toBeGreaterThan(-1)
      // No "(and Cursor/Codex)" within the surrounding viewing sentence.
      const window = text.slice(Math.max(0, steerIdx - 200), steerIdx + 200)
      expect(window).not.toMatch(FORBIDDEN_VIEWING_PARENTHETICAL)
    }
  })
})
