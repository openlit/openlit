/**
 * PII guard -- detects and optionally redacts personally identifiable
 * information, API keys, and secrets using regex patterns.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/pii.py
 */

import { Guard, GuardAction, GuardPhase, GuardResult, makeGuardResult, GuardOptions } from './base';

interface PatternEntry {
  label: string;
  regex: RegExp;
}

// ---- API keys / tokens ----
const PATTERNS: PatternEntry[] = [
  { label: 'openai-api-key', regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { label: 'anthropic-api-key', regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: 'aws-access-key', regex: /(?<![A-Za-z0-9/+=])AKIA[0-9A-Z]{16}(?![A-Za-z0-9/+=])/ },
  { label: 'gcp-api-key', regex: /AIza[0-9A-Za-z_-]{35}/ },
  { label: 'github-token', regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/ },
  { label: 'github-fine-grained', regex: /github_pat_[A-Za-z0-9_]{22,}/ },
  { label: 'stripe-key', regex: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}/ },
  { label: 'slack-token', regex: /xox[bpoas]-[A-Za-z0-9-]{10,}/ },
  { label: 'slack-webhook', regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/ },
  { label: 'twilio-api-key', regex: /SK[0-9a-fA-F]{32}/ },
  { label: 'sendgrid-api-key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  { label: 'mailgun-api-key', regex: /key-[0-9a-zA-Z]{32}/ },
  { label: 'azure-key', regex: /[0-9a-f]{32}/ },
  { label: 'heroku-api-key', regex: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ },
  // ---- PII ----
  { label: 'email', regex: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/ },
  { label: 'phone-us', regex: /(?<!\d)(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)/ },
  { label: 'ssn', regex: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/ },
  { label: 'credit-card', regex: /(?<!\d)(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}(?!\d)/ },
  { label: 'ipv4', regex: /(?<!\d)(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}(?!\d)/ },
  // ---- Secrets / credentials ----
  { label: 'bearer-token', regex: /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/i },
  { label: 'basic-auth', regex: /Basic\s+[A-Za-z0-9+/]+=*/i },
  { label: 'private-key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'connection-string', regex: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/\S+/ },
  { label: 'env-secret', regex: /(?:password|secret|token|api_key|apikey)\s*[=:]\s*\S+/i },
];

export interface PIIOptions extends GuardOptions {
  customPatterns?: Record<string, string>;
}

export class PII extends Guard {
  readonly name = 'pii';
  readonly phases = [GuardPhase.PREFLIGHT, GuardPhase.POSTFLIGHT];

  private readonly _allPatterns: PatternEntry[];

  constructor(opts: PIIOptions = {}) {
    super({ action: opts.action ?? 'redact', maxScanLength: opts.maxScanLength });
    const extra: PatternEntry[] = [];
    if (opts.customPatterns) {
      for (const [label, pat] of Object.entries(opts.customPatterns)) {
        extra.push({ label, regex: new RegExp(pat, 'gi') });
      }
    }
    this._allPatterns = [
      ...PATTERNS.map(({ label, regex }) => ({
        label,
        regex: new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g'),
      })),
      ...extra,
    ];
  }

  evaluate(text: string): GuardResult {
    const matches: Array<{ label: string; start: number; end: number }> = [];

    for (const { label, regex } of this._allPatterns) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        matches.push({ label, start: m.index, end: m.index + m[0].length });
      }
    }

    if (matches.length === 0) {
      return makeGuardResult({ guardName: this.name });
    }

    const labels = [...new Set(matches.map((m) => m.label))].sort();
    const classification = labels.join(', ');
    const bestScore = Math.min(1.0, matches.length * 0.2 + 0.5);

    let transformedText: string | null = null;
    if (this._action === GuardAction.REDACT) {
      const sortedMatches = [...matches].sort((a, b) => b.start - a.start);
      let resultText = text;
      for (const { label, start, end } of sortedMatches) {
        resultText = resultText.slice(0, start) + `[REDACTED:${label}]` + resultText.slice(end);
      }
      transformedText = resultText;
    }

    return makeGuardResult({
      action: this._action,
      score: Math.round(bestScore * 100) / 100,
      guardName: this.name,
      classification,
      explanation: `Detected ${matches.length} PII/secret match(es): ${classification}`,
      transformedText,
    });
  }
}
