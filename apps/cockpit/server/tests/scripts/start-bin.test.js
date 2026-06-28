import {
  nodeVersionMeetsMin,
  browserOpenCommand,
  dependenciesInstalled,
} from '../../../../../bin/start.mjs'

describe('npx bin — node version gate', () => {
  test('accepts the 22.13 floor and anything above', () => {
    expect(nodeVersionMeetsMin('22.13.0')).toBe(true)
    expect(nodeVersionMeetsMin('22.14.1')).toBe(true)
    expect(nodeVersionMeetsMin('24.0.0')).toBe(true)
  })

  test('rejects anything below the floor', () => {
    expect(nodeVersionMeetsMin('22.12.0')).toBe(false)
    expect(nodeVersionMeetsMin('20.18.0')).toBe(false)
    expect(nodeVersionMeetsMin('18.0.0')).toBe(false)
  })

  test('rejects unparseable input', () => {
    expect(nodeVersionMeetsMin('')).toBe(false)
    expect(nodeVersionMeetsMin('not-a-version')).toBe(false)
  })
})

describe('npx bin — browser open command', () => {
  test('maps each platform to its opener', () => {
    expect(browserOpenCommand('darwin', 'http://x')).toEqual({ cmd: 'open', args: ['http://x'] })
    expect(browserOpenCommand('win32', 'http://x')).toEqual({
      cmd: 'cmd',
      args: ['/c', 'start', '', 'http://x'],
    })
    // linux (and WSL, which reports "linux") use xdg-open
    expect(browserOpenCommand('linux', 'http://x')).toEqual({ cmd: 'xdg-open', args: ['http://x'] })
  })
})

describe('npx bin — dependency detection', () => {
  test('true only when every workspace has node_modules', () => {
    const present = () => true
    expect(dependenciesInstalled('/repo', present)).toBe(true)
  })

  test('false when any workspace is missing node_modules', () => {
    const missingClient = (dir) => !String(dir).includes('client')
    expect(dependenciesInstalled('/repo', missingClient)).toBe(false)
  })
})
