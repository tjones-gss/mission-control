import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { repoRoot } from '../../../../../scripts/release/version-sources.js'

// The repo-root CHANGELOG.md is the PACKAGE SEMVER axis (E-release-eng owns the
// [Unreleased] -> [0.4.0] flip). This lint asserts the Keep-a-Changelog
// invariants that matter for cutting a release:
//   - exactly one [Unreleased] heading (so contributors always have one inbox)
//   - the top RELEASED heading equals the package version (0.4.0)
//   - headings are well-formed Keep-a-Changelog version headings
const ROOT = repoRoot()
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')

function readChangelog() {
  return readFileSync(CHANGELOG, 'utf-8')
}

function rootPackageVersion() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version
}

// A level-2 heading line that is a version/Unreleased entry.
// e.g. "## [Unreleased]" or "## [0.4.0] - 2026-06-08".
const HEADING_RE = /^## \[([^\]]+)\](?:\s+-\s+(.+))?\s*$/

function headings(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(HEADING_RE))
    .filter(Boolean)
    .map((m) => ({ label: m[1], date: m[2] ? m[2].trim() : null }))
}

describe('CHANGELOG.md lint (Keep-a-Changelog, package semver axis)', () => {
  it('declares Keep a Changelog as its format', () => {
    expect(readChangelog()).toMatch(/keepachangelog\.com/)
  })

  it('has exactly one [Unreleased] heading', () => {
    const unreleased = headings(readChangelog()).filter((h) => h.label === 'Unreleased')
    expect(unreleased).toHaveLength(1)
  })

  it('the top released heading equals the package version (0.4.0)', () => {
    const all = headings(readChangelog())
    const released = all.filter((h) => h.label !== 'Unreleased')
    expect(released.length, 'no released heading found').toBeGreaterThan(0)
    expect(released[0].label).toBe(rootPackageVersion())
    expect(released[0].label).toBe('0.4.0')
  })

  it('[Unreleased] sits above the top released heading', () => {
    const all = headings(readChangelog())
    const firstIdx = all.findIndex((h) => h.label === 'Unreleased')
    const firstReleasedIdx = all.findIndex((h) => h.label !== 'Unreleased')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(firstReleasedIdx).toBeGreaterThan(firstIdx)
  })

  it('the top released heading carries a date token (cut by a human)', () => {
    const released = headings(readChangelog()).filter((h) => h.label !== 'Unreleased')
    // Keep-a-Changelog released sections are "## [x.y.z] - YYYY-MM-DD".
    expect(released[0].date, 'top released heading is missing its "- <date>"').toBeTruthy()
    expect(released[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('every version heading is well-formed Keep-a-Changelog', () => {
    // No "## [ ]" with an empty label, no stray "## []".
    for (const h of headings(readChangelog())) {
      expect(h.label.trim().length, 'empty changelog heading label').toBeGreaterThan(0)
    }
  })
})
