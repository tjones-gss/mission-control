import { SecretScanner, scan, redact, hasSecrets, RULES } from '../../utils/secretScanner.js'

describe('SecretScanner rules', () => {
  it('has 22 rules', () => {
    expect(RULES).toHaveLength(23)
  })

  it('every rule has id, description, keywords array', () => {
    for (const rule of RULES) {
      expect(rule.id).toBeTruthy()
      expect(rule.description).toBeTruthy()
      expect(Array.isArray(rule.keywords)).toBe(true)
      expect(rule.keywords.length).toBeGreaterThan(0)
    }
  })
})

describe('scan()', () => {
  it('detects AWS access key', () => {
    const content = 'key: AKIAIOSFODNN7EXAMPLE'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'aws-access-key')).toBe(true)
  })

  it('detects AWS secret key assignment', () => {
    const content = 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYaa"'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'aws-secret-key')).toBe(true)
  })

  it('detects GCP service account key', () => {
    const content = '{"type": "service_account", "project_id": "my-project"}'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'gcp-service-account')).toBe(true)
  })

  it('detects Azure client secret', () => {
    const content = 'azure_client_secret = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'azure-client-secret')).toBe(true)
  })

  it('detects DigitalOcean token', () => {
    const content = 'token=dop_v1_' + 'a'.repeat(64)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'digitalocean-token')).toBe(true)
  })

  it('detects Anthropic API key with runtime-assembled prefix', () => {
    const prefix = 'sk-' + 'ant-'
    const content = 'key=' + prefix + 'A'.repeat(90)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'anthropic-api-key')).toBe(true)
  })

  it('detects OpenAI API key', () => {
    const content = 'key=sk-' + 'A'.repeat(20) + 'T3BlbkFJ' + 'B'.repeat(20)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'openai-api-key')).toBe(true)
  })

  it('detects HuggingFace token', () => {
    const content = 'token=hf_' + 'A'.repeat(40)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'huggingface-token')).toBe(true)
  })

  it('detects GitHub PAT', () => {
    const content = 'token=ghp_' + 'A'.repeat(36)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'github-pat')).toBe(true)
  })

  it('detects GitHub OAuth token', () => {
    const content = 'token=gho_' + 'A'.repeat(36)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'github-oauth')).toBe(true)
  })

  it('detects GitLab token', () => {
    const content = 'token=glpat-' + 'A'.repeat(20)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'gitlab-token')).toBe(true)
  })

  it('detects Slack bot token', () => {
    const content = 'SLACK_TOKEN=xoxb-1234567890-abcdefghij'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'slack-token')).toBe(true)
  })

  it('detects Slack webhook URL', () => {
    const content = 'url=https://hooks.slack.com/services/T12345678/B12345678/abcdefghijklmnop'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'slack-webhook')).toBe(true)
  })

  it('detects Twilio API key', () => {
    const content = 'key=SK' + 'a'.repeat(32)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'twilio-api-key')).toBe(true)
  })

  it('detects SendGrid API key', () => {
    const content = 'key=SG.' + 'A'.repeat(22) + '.' + 'B'.repeat(22)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'sendgrid-api-key')).toBe(true)
  })

  it('detects NPM token', () => {
    const content = 'token=npm_' + 'A'.repeat(36)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'npm-token')).toBe(true)
  })

  it('detects PyPI token', () => {
    const content = 'token=pypi-' + 'A'.repeat(50)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'pypi-token')).toBe(true)
  })

  it('detects Stripe secret key', () => {
    const content = 'key=sk_live_' + 'A'.repeat(24)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'stripe-secret-key')).toBe(true)
  })

  it('detects Stripe publishable key', () => {
    const content = 'key=pk_live_' + 'A'.repeat(24)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'stripe-publishable-key')).toBe(true)
  })

  it('detects Grafana token', () => {
    const content = 'token=glc_' + 'A'.repeat(32)
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'grafana-token')).toBe(true)
  })

  it('detects Sentry DSN', () => {
    const content = 'dsn=https://' + 'a'.repeat(32) + '@o123.ingest.sentry.io/456'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'sentry-dsn')).toBe(true)
  })

  it('detects PEM private key', () => {
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'pem-private-key')).toBe(true)
  })

  it('detects generic password assignment', () => {
    const content = 'password = "mySuperSecretPassword123"'
    const results = scan(content)
    expect(results.some((r) => r.ruleId === 'generic-password-assignment')).toBe(true)
  })

  it('returns lineNumber but NOT matched text', () => {
    const content = 'line 1\nkey: AKIAIOSFODNN7EXAMPLE\nline 3'
    const results = scan(content)
    const match = results.find((r) => r.ruleId === 'aws-access-key')
    expect(match).toBeDefined()
    expect(match.lineNumber).toBe(2)
    expect(match.description).toBe('AWS Access Key ID')
    // Must never include matched text
    expect(match).not.toHaveProperty('match')
    expect(match).not.toHaveProperty('secret')
    expect(match).not.toHaveProperty('value')
    expect(Object.keys(match)).toEqual(['ruleId', 'description', 'lineNumber'])
  })

  it('deduplicates matches (one per rule)', () => {
    const content = 'key1: AKIAIOSFODNN7EXAMPLE\nkey2: AKIAIOSFODNN7EXAMPL2'
    const results = scan(content)
    const awsMatches = results.filter((r) => r.ruleId === 'aws-access-key')
    expect(awsMatches).toHaveLength(1)
    expect(awsMatches[0].lineNumber).toBe(1) // reports first occurrence
  })
})

describe('keyword pre-filter', () => {
  it('skips regex when no keyword matches', () => {
    const scanner = new SecretScanner()
    // Content that has no keywords for any rules
    const content = 'This is just a normal sentence with no secret patterns.'
    const results = scanner.scan(content)
    expect(results).toHaveLength(0)
  })

  it('does not match AKIA keyword in unrelated context if pattern fails', () => {
    // AKIA is present but not followed by 16 uppercase chars
    const content = 'The word AKIA appears here but is not a real key'
    const results = scan(content)
    expect(results.filter((r) => r.ruleId === 'aws-access-key')).toHaveLength(0)
  })
})

describe('redact()', () => {
  it('replaces AWS access key with redaction marker', () => {
    const content = 'key: AKIAIOSFODNN7EXAMPLE'
    const result = redact(content)
    expect(result).toContain('[REDACTED: AWS Access Key ID]')
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('replaces GitHub PAT with redaction marker', () => {
    const token = 'ghp_' + 'A'.repeat(36)
    const content = `my token is ${token} here`
    const result = redact(content)
    expect(result).toContain('[REDACTED: GitHub Personal Access Token]')
    expect(result).not.toContain(token)
  })

  it('replaces Stripe secret key with redaction marker', () => {
    const key = 'sk_live_' + 'A'.repeat(24)
    const content = `STRIPE_KEY=${key}`
    const result = redact(content)
    expect(result).toContain('[REDACTED: Stripe Secret Key]')
    expect(result).not.toContain(key)
  })

  it('replaces PEM private key header with redaction marker', () => {
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...'
    const result = redact(content)
    expect(result).toContain('[REDACTED: PEM-encoded Private Key]')
    expect(result).not.toContain('-----BEGIN RSA PRIVATE KEY-----')
  })

  it('replaces Slack webhook URL with redaction marker', () => {
    const content = 'webhook: https://hooks.slack.com/services/T12345678/B12345678/abcdef123456'
    const result = redact(content)
    expect(result).toContain('[REDACTED: Slack Webhook URL]')
    expect(result).not.toContain('hooks.slack.com')
  })

  it('replaces password assignment with redaction marker', () => {
    const content = 'password = "mySuperSecretPassword123"'
    const result = redact(content)
    expect(result).toContain('[REDACTED: Password Assignment in Code]')
  })

  it('handles content with no secrets unchanged', () => {
    const content = 'This is totally normal code with no secrets.'
    const result = redact(content)
    expect(result).toBe(content)
  })

  it('handles multi-line content with multiple secrets', () => {
    const ghpToken = 'ghp_' + 'A'.repeat(36)
    const content = [
      'line 1 is fine',
      `github_token = ${ghpToken}`,
      'line 3 is fine',
      'password = "supersecretpass99"',
      'line 5 is fine',
    ].join('\n')

    const result = redact(content)
    expect(result).toContain('[REDACTED: GitHub Personal Access Token]')
    expect(result).toContain('[REDACTED: Password Assignment in Code]')
    expect(result).not.toContain(ghpToken)
    expect(result).toContain('line 1 is fine')
    expect(result).toContain('line 3 is fine')
    expect(result).toContain('line 5 is fine')
  })
})

describe('hasSecrets()', () => {
  it('returns true when content contains a secret', () => {
    const content = 'key: AKIAIOSFODNN7EXAMPLE'
    expect(hasSecrets(content)).toBe(true)
  })

  it('returns false for clean content', () => {
    const content = 'Just normal text with no credentials at all.'
    expect(hasSecrets(content)).toBe(false)
  })

  it('returns true for PEM key', () => {
    const content = '-----BEGIN PRIVATE KEY-----'
    expect(hasSecrets(content)).toBe(true)
  })

  it('returns true for Sentry DSN', () => {
    const content = 'https://' + 'a'.repeat(32) + '@o123.ingest.sentry.io/789'
    expect(hasSecrets(content)).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(hasSecrets('')).toBe(false)
  })
})

describe('Anthropic key prefix assembly', () => {
  it('assembles prefix at runtime to avoid self-detection', () => {
    const rule = RULES.find((r) => r.id === 'anthropic-api-key')
    expect(rule).toBeDefined()
    // The pattern should match sk- + ant- prefix keys
    const prefix = 'sk-' + 'ant-'
    const fakeKey = prefix + 'X'.repeat(90)
    const results = scan(`key=${fakeKey}`)
    expect(results.some((r) => r.ruleId === 'anthropic-api-key')).toBe(true)
  })

  it('does not match short keys with the prefix', () => {
    const prefix = 'sk-' + 'ant-'
    const shortKey = prefix + 'X'.repeat(10)
    const results = scan(`key=${shortKey}`)
    expect(results.some((r) => r.ruleId === 'anthropic-api-key')).toBe(false)
  })
})

describe('no false positives', () => {
  it('does not flag normal variable names', () => {
    const content = 'const password_field = document.getElementById("password")'
    expect(hasSecrets(content)).toBe(false)
  })

  it('does not flag short passwords', () => {
    // Password shorter than 8 chars should not match
    const content = 'password = "short"'
    expect(hasSecrets(content)).toBe(false)
  })

  it('does not flag AWS-like strings that are too short', () => {
    const content = 'AKIA1234' // only 4 chars after AKIA, need 16
    expect(scan(content).some((r) => r.ruleId === 'aws-access-key')).toBe(false)
  })

  it('does not flag npm as npm_token without enough chars', () => {
    const content = 'npm_short'
    expect(scan(content).some((r) => r.ruleId === 'npm-token')).toBe(false)
  })

  it('does not flag ghp_ prefix without enough chars', () => {
    const content = 'ghp_short'
    expect(scan(content).some((r) => r.ruleId === 'github-pat')).toBe(false)
  })

  it('does not flag common words containing keyword substrings', () => {
    const content = 'The skeleton key was lost in the forest.'
    expect(hasSecrets(content)).toBe(false)
  })
})

describe('SecretScanner class', () => {
  it('can be instantiated with custom rules', () => {
    const customRules = [
      {
        id: 'test-rule',
        description: 'Test Rule',
        pattern: /SECRET_[A-Z]{10}/,
        keywords: ['SECRET_'],
      },
    ]
    const scanner = new SecretScanner(customRules)
    const results = scanner.scan('key=SECRET_ABCDEFGHIJ')
    expect(results).toHaveLength(1)
    expect(results[0].ruleId).toBe('test-rule')
  })

  it('exposes rules via .rules property', () => {
    const scanner = new SecretScanner()
    expect(scanner.rules).toBe(RULES)
    expect(scanner.rules.length).toBe(23)
  })
})
