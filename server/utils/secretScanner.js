// Secret scanner ported from Claw Code (Python) to JavaScript
// Regex-based credential detector with keyword pre-filtering.
// Never returns matched text — only rule IDs and line numbers.

// Anthropic key prefix assembled at runtime to avoid self-detection
const _ANTHROPIC_PREFIX = 'sk-' + 'ant-'

const RULES = [
  // -- Cloud --
  {
    id: 'aws-access-key',
    description: 'AWS Access Key ID',
    pattern: /(?:^|[^A-Za-z0-9/+=])(?<secret>AKIA[0-9A-Z]{16})(?:[^A-Za-z0-9/+=]|$)/,
    keywords: ['AKIA'],
  },
  {
    id: 'aws-secret-key',
    description: 'AWS Secret Access Key',
    pattern:
      /(?:aws)[_\-]?secret[_\-]?access[_\-]?key[\s]*[=:]\s*["']?(?<secret>[A-Za-z0-9/+=]{40})["']?/i,
    keywords: ['aws', 'secret'],
  },
  {
    id: 'gcp-service-account',
    description: 'GCP Service Account Key',
    pattern: /"type"\s*:\s*"service_account"/,
    keywords: ['service_account'],
  },
  {
    id: 'azure-client-secret',
    description: 'Azure Client Secret',
    pattern:
      /(?:azure|ad)[_\-]?(?:client|tenant)[_\-]?secret[\s]*[=:]\s*["']?(?<secret>[A-Za-z0-9~_.]{32,})["']?/i,
    keywords: ['azure', 'client', 'secret'],
  },
  {
    id: 'digitalocean-token',
    description: 'DigitalOcean Personal Access Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>dop_v1_[a-f0-9]{64})(?:[^A-Za-z0-9]|$)/,
    keywords: ['dop_v1_'],
  },

  // -- AI --
  {
    id: 'anthropic-api-key',
    description: 'Anthropic API Key',
    // Pattern uses the runtime-assembled prefix to avoid self-detection
    pattern: null, // compiled lazily in _compileRules()
    _rawPattern: `(?:^|[^A-Za-z0-9])(?<secret>${_ANTHROPIC_PREFIX.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}[A-Za-z0-9_\\-]{80,})(?:[^A-Za-z0-9]|$)`,
    keywords: ['sk-', 'ant-'],
  },
  {
    id: 'openai-api-key',
    description: 'OpenAI API Key',
    pattern:
      /(?:^|[^A-Za-z0-9])(?<secret>sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['sk-', 'T3BlbkFJ'],
  },
  {
    id: 'huggingface-token',
    description: 'HuggingFace Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>hf_[A-Za-z0-9]{34,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['hf_'],
  },

  // -- VCS --
  {
    id: 'github-pat',
    description: 'GitHub Personal Access Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>ghp_[A-Za-z0-9]{36,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['ghp_'],
  },
  {
    id: 'github-oauth',
    description: 'GitHub OAuth Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>gho_[A-Za-z0-9]{36,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['gho_'],
  },
  {
    id: 'gitlab-token',
    description: 'GitLab Personal/Project Access Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>glpat-[A-Za-z0-9\-_]{20,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['glpat-'],
  },

  // -- Comms --
  {
    id: 'slack-token',
    description: 'Slack Bot/User Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>xox[bprs]-[A-Za-z0-9\-]{10,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['xox'],
  },
  {
    id: 'slack-webhook',
    description: 'Slack Webhook URL',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/,
    keywords: ['hooks.slack.com'],
  },
  {
    id: 'twilio-api-key',
    description: 'Twilio API Key',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>SK[0-9a-fA-F]{32})(?:[^A-Za-z0-9]|$)/,
    keywords: ['SK'],
  },
  {
    id: 'sendgrid-api-key',
    description: 'SendGrid API Key',
    pattern:
      /(?:^|[^A-Za-z0-9])(?<secret>SG\.[A-Za-z0-9_\-]{22,}\.[A-Za-z0-9_\-]{22,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['SG.'],
  },

  // -- Dev --
  {
    id: 'npm-token',
    description: 'NPM Access Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>npm_[A-Za-z0-9]{36,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['npm_'],
  },
  {
    id: 'pypi-token',
    description: 'PyPI API Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>pypi-[A-Za-z0-9\-_]{50,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['pypi-'],
  },

  // -- Payment --
  {
    id: 'stripe-secret-key',
    description: 'Stripe Secret Key',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>sk_live_[A-Za-z0-9]{24,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['sk_live_'],
  },
  {
    id: 'stripe-publishable-key',
    description: 'Stripe Publishable Key',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>pk_live_[A-Za-z0-9]{24,})(?:[^A-Za-z0-9]|$)/,
    keywords: ['pk_live_'],
  },

  // -- Observability --
  {
    id: 'grafana-token',
    description: 'Grafana API Token',
    pattern: /(?:^|[^A-Za-z0-9])(?<secret>glc_[A-Za-z0-9+/]{32,}={0,2})(?:[^A-Za-z0-9]|$)/,
    keywords: ['glc_'],
  },
  {
    id: 'sentry-dsn',
    description: 'Sentry DSN',
    pattern: /https:\/\/[a-f0-9]{32}@[a-z0-9\-.]+\.ingest\.sentry\.io\/[0-9]+/,
    keywords: ['sentry.io', 'ingest'],
  },

  // -- Crypto --
  {
    id: 'pem-private-key',
    description: 'PEM-encoded Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    keywords: ['PRIVATE KEY'],
  },

  // -- Generic --
  {
    id: 'generic-password-assignment',
    description: 'Password Assignment in Code',
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"']{8,}["']/i,
    keywords: ['password', 'passwd', 'pwd'],
  },
]

class SecretScanner {
  constructor(rules) {
    this._rules = rules || RULES
    this._compiled = new Map()
    this._initialized = false
  }

  /** Lazily compile any rules that need runtime pattern assembly */
  _ensureCompiled() {
    if (this._initialized) return
    for (const rule of this._rules) {
      if (rule._rawPattern && !rule.pattern) {
        rule.pattern = new RegExp(rule._rawPattern)
      }
    }
    this._initialized = true
  }

  /** Get compiled pattern for a rule (lazy) */
  _getPattern(rule) {
    if (this._compiled.has(rule.id)) return this._compiled.get(rule.id)
    this._ensureCompiled()
    this._compiled.set(rule.id, rule.pattern)
    return rule.pattern
  }

  /** Fast pre-filter: check if any keyword appears in the line (case-insensitive) */
  static _keywordMatch(line, keywords) {
    const lower = line.toLowerCase()
    return keywords.some((kw) => lower.includes(kw.toLowerCase()))
  }

  /**
   * Scan content for secrets.
   * Returns deduplicated matches (one per rule) with ruleId, description, lineNumber.
   * Never returns the matched text itself.
   */
  scan(content) {
    const matches = []
    const seenRules = new Set()
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNumber = i + 1

      for (const rule of this._rules) {
        if (seenRules.has(rule.id)) continue
        if (
          rule.keywords &&
          rule.keywords.length > 0 &&
          !SecretScanner._keywordMatch(line, rule.keywords)
        )
          continue

        const pattern = this._getPattern(rule)
        if (pattern.test(line)) {
          matches.push({
            ruleId: rule.id,
            description: rule.description,
            lineNumber,
          })
          seenRules.add(rule.id)
        }
      }
    }

    return matches
  }

  /**
   * Redact secrets from content, replacing matches with [REDACTED: description].
   * Returns a new string with all secret values replaced.
   */
  redact(content) {
    this._ensureCompiled()
    let result = content
    const lines = result.split('\n')

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]

      for (const rule of this._rules) {
        if (
          rule.keywords &&
          rule.keywords.length > 0 &&
          !SecretScanner._keywordMatch(line, rule.keywords)
        )
          continue

        const pattern = this._getPattern(rule)
        // Use a replacer that targets the <secret> group if present, otherwise the whole match
        if (pattern.source.includes('secret>')) {
          // Pattern has a named group — replace just the secret portion
          line = line.replace(pattern, (...args) => {
            const groups = args[args.length - 1]
            if (groups && groups.secret) {
              const full = args[0]
              return full.replace(groups.secret, `[REDACTED: ${rule.description}]`)
            }
            return `[REDACTED: ${rule.description}]`
          })
        } else {
          // No named group — replace the whole match
          line = line.replace(pattern, `[REDACTED: ${rule.description}]`)
        }
      }

      lines[i] = line
    }

    return lines.join('\n')
  }

  /** Fast boolean check — stops at first match */
  hasSecrets(content) {
    const lines = content.split('\n')
    for (const line of lines) {
      for (const rule of this._rules) {
        if (
          rule.keywords &&
          rule.keywords.length > 0 &&
          !SecretScanner._keywordMatch(line, rule.keywords)
        )
          continue
        const pattern = this._getPattern(rule)
        if (pattern.test(line)) return true
      }
    }
    return false
  }

  /** Get the rule definitions (for inspection/debugging) */
  get rules() {
    return this._rules
  }
}

// Singleton instance
const scanner = new SecretScanner()

// Convenience functions that delegate to the singleton
export function scan(content) {
  return scanner.scan(content)
}

export function redact(content) {
  return scanner.redact(content)
}

export function hasSecrets(content) {
  return scanner.hasSecrets(content)
}

export { SecretScanner, RULES, scanner }
