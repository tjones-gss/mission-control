vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  }
  return {
    default: { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    promises,
  }
})

import fs from 'fs'
import { getAllWorkflows } from '../../parsers/workflows.js'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getAllWorkflows()', () => {
  it('returns [] when dir does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getAllWorkflows()).toEqual([])
  })

  it('returns [] when dir is empty', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([])
    expect(getAllWorkflows()).toEqual([])
  })

  it('parses valid JSON files into array', () => {
    const workflow = { id: 'wf1', name: 'My Workflow', steps: [] }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['a.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify(workflow))

    const result = getAllWorkflows()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(workflow)
  })

  it('skips malformed JSON (readFileSync throws)', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['bad.json'])
    fs.readFileSync.mockImplementation(() => {
      throw new Error('parse error')
    })

    expect(getAllWorkflows()).toEqual([])
  })

  it('ignores non-.json files', () => {
    const workflow = { id: 'wf2', name: 'Valid' }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['a.txt', 'b.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify(workflow))

    const result = getAllWorkflows()
    // Only b.json should be processed
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(workflow)
    // readFileSync called exactly once (for b.json only)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
  })

  it('returns multiple workflows from multiple JSON files', () => {
    const wf1 = { id: '1', name: 'First' }
    const wf2 = { id: '2', name: 'Second' }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['first.json', 'second.json'])
    fs.readFileSync
      .mockReturnValueOnce(JSON.stringify(wf1))
      .mockReturnValueOnce(JSON.stringify(wf2))

    const result = getAllWorkflows()
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(wf1)
    expect(result[1]).toEqual(wf2)
  })

  it('filters out null results from mixed valid/invalid files', () => {
    const workflow = { id: 'ok', name: 'OK' }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['good.json', 'bad.json'])
    fs.readFileSync.mockReturnValueOnce(JSON.stringify(workflow)).mockImplementationOnce(() => {
      throw new Error('bad')
    })

    const result = getAllWorkflows()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(workflow)
  })
})
