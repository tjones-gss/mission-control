import {
  classify,
  splitCompound,
  getBaseCommand,
  Classification,
} from '../../utils/commandClassifier.js'

describe('Classification enum', () => {
  it('has all expected values', () => {
    expect(Classification.SAFE_READONLY).toBe('SAFE_READONLY')
    expect(Classification.DESTRUCTIVE).toBe('DESTRUCTIVE')
    expect(Classification.CODE_EXECUTION).toBe('CODE_EXECUTION')
    expect(Classification.REQUIRES_REVIEW).toBe('REQUIRES_REVIEW')
    expect(Classification.UNKNOWN).toBe('UNKNOWN')
  })
})

describe('splitCompound()', () => {
  it('splits on &&', () => {
    expect(splitCompound('git add . && git commit')).toEqual(['git add .', 'git commit'])
  })

  it('splits on ||', () => {
    expect(splitCompound('test -f foo || echo missing')).toEqual(['test -f foo', 'echo missing'])
  })

  it('splits on ;', () => {
    expect(splitCompound('ls; pwd')).toEqual(['ls', 'pwd'])
  })

  it('splits on |', () => {
    expect(splitCompound('cat file | grep pattern')).toEqual(['cat file', 'grep pattern'])
  })

  it('splits on mixed operators', () => {
    const parts = splitCompound('ls && cat foo | grep bar; echo done')
    expect(parts).toEqual(['ls', 'cat foo', 'grep bar', 'echo done'])
  })

  it('handles single command with no operators', () => {
    expect(splitCompound('git log --oneline')).toEqual(['git log --oneline'])
  })

  it('filters empty parts', () => {
    expect(splitCompound('ls && ')).toEqual(['ls'])
  })
})

describe('getBaseCommand()', () => {
  it('returns first word of simple command', () => {
    expect(getBaseCommand('ls -la')).toBe('ls')
  })

  it('strips env prefix: FOO=bar npm run', () => {
    expect(getBaseCommand('FOO=bar npm run build')).toBe('npm')
  })

  it('strips multiple env prefixes', () => {
    expect(getBaseCommand('NODE_ENV=production DEBUG=1 node app.js')).toBe('node')
  })

  it('returns empty string for empty input', () => {
    expect(getBaseCommand('')).toBe('')
  })

  it('returns empty string for env-only assignment', () => {
    expect(getBaseCommand('FOO=bar')).toBe('FOO=bar')
  })

  it('handles command with no args', () => {
    expect(getBaseCommand('pwd')).toBe('pwd')
  })
})

describe('classify() — safe read-only commands', () => {
  it('classifies git log as SAFE_READONLY', () => {
    const result = classify('git log --oneline')
    expect(result.classification).toBe(Classification.SAFE_READONLY)
    expect(result.isReadOnly).toBe(true)
    expect(result.isDestructive).toBe(false)
  })

  it('classifies git status as SAFE_READONLY', () => {
    expect(classify('git status').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies git diff as SAFE_READONLY', () => {
    expect(classify('git diff HEAD~1').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies ls as SAFE_READONLY', () => {
    expect(classify('ls -la').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies cat as SAFE_READONLY', () => {
    expect(classify('cat /etc/hosts').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies rg (ripgrep) as SAFE_READONLY', () => {
    expect(classify('rg "pattern" src/').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies grep as SAFE_READONLY', () => {
    expect(classify('grep -rn TODO .').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies find as SAFE_READONLY', () => {
    expect(classify('find . -name "*.js"').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies echo as SAFE_READONLY', () => {
    expect(classify('echo hello').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies docker ps as SAFE_READONLY', () => {
    expect(classify('docker ps -a').classification).toBe(Classification.SAFE_READONLY)
  })

  it('classifies gh pr view as SAFE_READONLY', () => {
    expect(classify('gh pr view 123').classification).toBe(Classification.SAFE_READONLY)
  })
})

describe('classify() — destructive commands', () => {
  it('classifies rm -rf as DESTRUCTIVE', () => {
    const result = classify('rm -rf /tmp/build')
    expect(result.classification).toBe(Classification.DESTRUCTIVE)
    expect(result.isDestructive).toBe(true)
    expect(result.isReadOnly).toBe(false)
  })

  it('classifies rm (any form) as DESTRUCTIVE', () => {
    expect(classify('rm file.txt').classification).toBe(Classification.DESTRUCTIVE)
  })

  it('classifies git push --force as DESTRUCTIVE', () => {
    const result = classify('git push --force origin main')
    expect(result.classification).toBe(Classification.DESTRUCTIVE)
    expect(result.description).toMatch(/[Ff]orce push/)
  })

  it('classifies git push -f as DESTRUCTIVE', () => {
    expect(classify('git push -f').classification).toBe(Classification.DESTRUCTIVE)
  })

  it('classifies git reset --hard as DESTRUCTIVE', () => {
    const result = classify('git reset --hard HEAD~3')
    expect(result.classification).toBe(Classification.DESTRUCTIVE)
  })

  it('classifies dd as DESTRUCTIVE', () => {
    expect(classify('dd if=/dev/zero of=/dev/sda').classification).toBe(Classification.DESTRUCTIVE)
  })

  it('classifies git clean as DESTRUCTIVE', () => {
    expect(classify('git clean -fd').classification).toBe(Classification.DESTRUCTIVE)
  })

  it('classifies mkfs as DESTRUCTIVE', () => {
    expect(classify('mkfs /dev/sda1').classification).toBe(Classification.DESTRUCTIVE)
  })

  it('classifies truncate as DESTRUCTIVE', () => {
    expect(classify('truncate -s 0 logfile').classification).toBe(Classification.DESTRUCTIVE)
  })
})

describe('classify() — code execution', () => {
  it('classifies python script.py as CODE_EXECUTION', () => {
    const result = classify('python script.py')
    expect(result.classification).toBe(Classification.CODE_EXECUTION)
    expect(result.description).toMatch(/[Pp]ython/)
  })

  it('classifies node app.js as CODE_EXECUTION', () => {
    expect(classify('node app.js').classification).toBe(Classification.CODE_EXECUTION)
  })

  it('classifies npm run build as CODE_EXECUTION', () => {
    expect(classify('npm run build').classification).toBe(Classification.CODE_EXECUTION)
  })

  it('classifies npx as CODE_EXECUTION', () => {
    expect(classify('npx vitest run').classification).toBe(Classification.CODE_EXECUTION)
  })

  it('classifies bash -c as CODE_EXECUTION', () => {
    expect(classify('bash -c "echo hi"').classification).toBe(Classification.CODE_EXECUTION)
  })

  it('classifies ssh as CODE_EXECUTION', () => {
    expect(classify('ssh user@host').classification).toBe(Classification.CODE_EXECUTION)
  })

  it('classifies eval as CODE_EXECUTION', () => {
    expect(classify('eval "echo hi"').classification).toBe(Classification.CODE_EXECUTION)
  })
})

describe('classify() — compound commands (worst-case)', () => {
  it('ls && rm -rf / -> DESTRUCTIVE (worst case wins)', () => {
    const result = classify('ls && rm -rf /')
    expect(result.classification).toBe(Classification.DESTRUCTIVE)
    expect(result.isDestructive).toBe(true)
  })

  it('git status && python test.py -> CODE_EXECUTION', () => {
    expect(classify('git status && python test.py').classification).toBe(
      Classification.CODE_EXECUTION,
    )
  })

  it('all safe parts -> SAFE_READONLY', () => {
    expect(classify('ls && pwd && cat file.txt').classification).toBe(Classification.SAFE_READONLY)
  })

  it('safe | destructive -> DESTRUCTIVE', () => {
    expect(classify('cat file | rm target').classification).toBe(Classification.DESTRUCTIVE)
  })
})

describe('classify() — dangerous env vars', () => {
  it('PATH=... triggers REQUIRES_REVIEW', () => {
    expect(classify('PATH=/evil:$PATH ls').classification).toBe(Classification.REQUIRES_REVIEW)
  })

  it('LD_PRELOAD=... triggers REQUIRES_REVIEW', () => {
    expect(classify('LD_PRELOAD=./evil.so cmd').classification).toBe(Classification.REQUIRES_REVIEW)
  })

  it('NODE_OPTIONS=... triggers REQUIRES_REVIEW', () => {
    expect(classify('NODE_OPTIONS=--inspect node app.js').classification).toBe(
      Classification.REQUIRES_REVIEW,
    )
  })

  it('BASH_FUNC_ prefix triggers REQUIRES_REVIEW', () => {
    expect(classify('BASH_FUNC_foo=bar cmd').classification).toBe(Classification.REQUIRES_REVIEW)
  })
})

describe('classify() — dangerous zsh commands', () => {
  it('classifies zmodload as DESTRUCTIVE', () => {
    expect(classify('zmodload zsh/net/tcp').classification).toBe(Classification.DESTRUCTIVE)
  })

  it('classifies zsocket as DESTRUCTIVE', () => {
    expect(classify('zsocket -l 8080').classification).toBe(Classification.DESTRUCTIVE)
  })

  it('classifies zf_rm as DESTRUCTIVE', () => {
    expect(classify('zf_rm file').classification).toBe(Classification.DESTRUCTIVE)
  })
})

describe('classify() — unknown commands', () => {
  it('unknown command defaults to UNKNOWN', () => {
    expect(classify('mycustomtool --flag').classification).toBe(Classification.UNKNOWN)
  })

  it('empty string returns UNKNOWN', () => {
    expect(classify('').classification).toBe(Classification.UNKNOWN)
  })

  it('null returns UNKNOWN', () => {
    expect(classify(null).classification).toBe(Classification.UNKNOWN)
  })

  it('undefined returns UNKNOWN', () => {
    expect(classify(undefined).classification).toBe(Classification.UNKNOWN)
  })
})

describe('classify() — result shape', () => {
  it('returns all expected fields', () => {
    const result = classify('ls')
    expect(result).toHaveProperty('classification')
    expect(result).toHaveProperty('description')
    expect(result).toHaveProperty('isReadOnly')
    expect(result).toHaveProperty('isDestructive')
    expect(typeof result.description).toBe('string')
    expect(typeof result.isReadOnly).toBe('boolean')
    expect(typeof result.isDestructive).toBe('boolean')
  })

  it('provides specific descriptions for destructive commands', () => {
    const result = classify('rm -rf /')
    expect(result.description).toBe('Recursive force remove')
  })

  it('provides specific descriptions for code execution', () => {
    const result = classify('node app.js')
    expect(result.description).toBe('Node.js runtime')
  })
})
