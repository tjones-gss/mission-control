import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Theme-cascade guard (redesign next-step "make themes cascade"). The gray +
// indigo Tailwind palettes resolve through --mc-* channel variables so themes
// cascade across all ~850 existing utility usages. Two invariants:
//   1. tailwind.config.js maps EVERY used rung through rgb(var(...) /
//      <alpha-value>) — alpha-modifier forms (bg-gray-900/50) keep working.
//   2. :root pins the EXACT default Tailwind channels (classic stays
//      pixel-identical), and every theme block overrides every rung.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
const config = readFileSync(path.resolve(__dirname, '../../tailwind.config.js'), 'utf8')

const RUNGS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

// Exact Tailwind v3 default channels — the classic look's ground truth.
const TAILWIND_DEFAULTS = {
  'gray-100': '243 244 246',
  'gray-200': '229 231 235',
  'gray-300': '209 213 219',
  'gray-400': '156 163 175',
  'gray-500': '107 114 128',
  'gray-600': '75 85 99',
  'gray-700': '55 65 81',
  'gray-800': '31 41 55',
  'gray-900': '17 24 39',
  'gray-950': '3 7 18',
  'indigo-100': '224 231 255',
  'indigo-200': '199 210 254',
  'indigo-300': '165 180 252',
  'indigo-400': '129 140 248',
  'indigo-500': '99 102 241',
  'indigo-600': '79 70 229',
  'indigo-700': '67 56 202',
  'indigo-800': '55 48 163',
  'indigo-900': '49 46 129',
  'indigo-950': '30 27 75',
}

function blockFor(selector) {
  // All blocks for the selector, concatenated (themes appear twice: semantic
  // tokens + cascade channels).
  const re = new RegExp(`${selector.replace(/[[\]']/g, '\\$&')}\\s*{([^}]*)}`, 'g')
  let out = ''
  let m
  while ((m = re.exec(css))) out += m[1]
  return out
}

describe('theme cascade: tailwind.config.js routes gray/indigo through --mc channels', () => {
  it('maps every used rung of gray AND indigo with an <alpha-value> slot', () => {
    // The config builds the palette programmatically; assert the building
    // blocks: the rung list and the rgb(var(--mc-<palette>-<rung>)) template.
    for (const rung of RUNGS) {
      expect(config).toContain(String(rung))
    }
    expect(config).toMatch(/rgb\(var\(--mc-\$\{palette\}-\$\{r\}\) \/ <alpha-value>\)/)
    expect(config).toMatch(/gray: themed\('gray'\)/)
    expect(config).toMatch(/indigo: themed\('indigo'\)/)
  })
})

describe('theme cascade: :root pins the EXACT Tailwind default channels (classic is pixel-identical)', () => {
  const root = blockFor(':root')
  for (const [name, channels] of Object.entries(TAILWIND_DEFAULTS)) {
    it(`--mc-${name} is ${channels}`, () => {
      expect(root).toContain(`--mc-${name}: ${channels};`)
    })
  }
})

describe('theme cascade: every theme overrides every rung (no classic bleed-through)', () => {
  for (const theme of ['calm', 'tron', 'warm']) {
    it(`[data-theme='${theme}'] overrides all gray + indigo channels`, () => {
      const block = blockFor(`[data-theme='${theme}']`)
      for (const palette of ['gray', 'indigo']) {
        for (const rung of RUNGS) {
          expect(block, `${theme} must override --mc-${palette}-${rung}`).toContain(
            `--mc-${palette}-${rung}:`,
          )
        }
      }
    })
  }
})
