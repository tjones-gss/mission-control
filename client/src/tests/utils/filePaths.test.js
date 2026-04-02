import { extractFilePaths, makeVscodeUrl } from '../../utils/filePaths.js'

describe('extractFilePaths()', () => {
  it('extracts Unix absolute path', () => {
    const result = extractFilePaths('Reading /home/user/project/file.js')
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/home/user/project/file.js')
  })

  it('extracts Windows path with backslashes', () => {
    const result = extractFilePaths('Edit C:\\Users\\Travesty\\file.js')
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('C:\\Users\\Travesty\\file.js')
  })

  it('extracts Windows path with forward slashes', () => {
    const result = extractFilePaths('Read C:/Users/Travesty/file.js')
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('C:/Users/Travesty/file.js')
  })

  it('extracts path with line number', () => {
    const result = extractFilePaths('/Users/dev/src/main.rs:42')
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/Users/dev/src/main.rs')
    expect(result[0].line).toBe(42)
  })

  it('returns empty for text with no paths', () => {
    expect(extractFilePaths('hello world')).toEqual([])
  })

  it('returns empty for null input', () => {
    expect(extractFilePaths(null)).toEqual([])
  })

  it('extracts multiple paths', () => {
    const text = 'Copied /home/user/a.js to /home/user/b.js'
    const result = extractFilePaths(text)
    expect(result).toHaveLength(2)
  })

  it('extracts /tmp paths', () => {
    const result = extractFilePaths('Writing to /tmp/output.log')
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/tmp/output.log')
  })
})

describe('makeVscodeUrl()', () => {
  it('generates correct URI for Unix path', () => {
    expect(makeVscodeUrl('/home/user/file.js')).toBe('vscode://file//home/user/file.js')
  })

  it('generates URI with line number', () => {
    expect(makeVscodeUrl('/home/user/file.js', 42)).toBe('vscode://file//home/user/file.js:42')
  })

  it('normalizes Windows backslashes', () => {
    expect(makeVscodeUrl('C:\\Users\\file.js')).toBe('vscode://file/C:/Users/file.js')
  })
})
