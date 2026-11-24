import { PII } from '../pii';
import { GuardAction } from '../base';

describe('PII Guard', () => {
  const guard = new PII({ action: 'redact' });
  const denyGuard = new PII({ action: 'deny' });
  const warnGuard = new PII({ action: 'warn' });

  it('detects OpenAI API key', () => {
    const result = guard.evaluate('My key is sk-proj-abc123def456ghi789jklmnopqrst');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('openai-api-key');
  });

  it('detects Anthropic API key', () => {
    const result = guard.evaluate('Key: sk-ant-abcdefghij1234567890abcde');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('anthropic-api-key');
  });

  it('detects AWS access key', () => {
    const result = guard.evaluate('AWS key: AKIAIOSFODNN7EXAMPLE');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('aws-access-key');
  });

  it('detects GitHub token', () => {
    const result = guard.evaluate('Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('github-token');
  });

  it('detects email addresses', () => {
    const result = guard.evaluate('Contact me at user@example.com for details');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('email');
  });

  it('detects SSN', () => {
    const result = guard.evaluate('My SSN is 123-45-6789');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('ssn');
  });

  it('detects credit card numbers', () => {
    const result = guard.evaluate('Card: 4111 1111 1111 1111');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('credit-card');
  });

  it('detects phone numbers', () => {
    const result = guard.evaluate('Call me at (555) 123-4567');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('phone-us');
  });

  it('detects IPv4 addresses', () => {
    const result = guard.evaluate('Server IP: 192.168.1.100');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('ipv4');
  });

  it('detects bearer tokens', () => {
    const result = guard.evaluate('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('bearer-token');
  });

  it('detects private keys', () => {
    const result = guard.evaluate('-----BEGIN RSA PRIVATE KEY-----\nMIIE...');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('private-key');
  });

  it('detects connection strings', () => {
    const result = guard.evaluate('DB: postgresql://user:pass@host:5432/db');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('connection-string');
  });

  it('detects env secrets', () => {
    const result = guard.evaluate('password=mysecretpass123');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('env-secret');
  });

  it('returns allow for clean text', () => {
    const result = guard.evaluate('This is a perfectly normal sentence about the weather.');
    expect(result.action).toBe(GuardAction.ALLOW);
    expect(result.score).toBe(0);
  });

  it('redacts PII with correct placeholders', () => {
    const result = guard.evaluate('Email: user@example.com');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.transformedText).toContain('[REDACTED:email]');
    expect(result.transformedText).not.toContain('user@example.com');
  });

  it('handles multiple matches', () => {
    const result = guard.evaluate('Email: a@b.com and SSN: 123-45-6789');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('email');
    expect(result.classification).toContain('ssn');
    expect(result.score).toBeGreaterThan(0.5);
  });

  it('supports custom patterns', () => {
    const custom = new PII({ action: 'redact', customPatterns: { 'my-token': 'MYTOKEN_[A-Z]{10}' } });
    const result = custom.evaluate('Token: MYTOKEN_ABCDEFGHIJ');
    expect(result.action).toBe(GuardAction.REDACT);
    expect(result.classification).toContain('my-token');
  });

  it('deny action blocks entirely', () => {
    const result = denyGuard.evaluate('Email: user@example.com');
    expect(result.action).toBe(GuardAction.DENY);
    expect(result.transformedText).toBeNull();
  });

  it('warn action emits event only', () => {
    const result = warnGuard.evaluate('Email: user@example.com');
    expect(result.action).toBe(GuardAction.WARN);
    expect(result.transformedText).toBeNull();
  });
  it('redacts the whole value when two patterns overlap', () => {
    // The env-secret span covers the email span; replacing the inner one first used
    // to resize the string and leave the tail of the value behind.
    const result = guard.evaluate('password: a@b.co:hunter2SuperSecret');
    expect(result.transformedText).toBe('[REDACTED:env-secret]');
  });

  it('redacts the whole value when an ipv4 match nests inside a secret', () => {
    const result = guard.evaluate('secret: 1.2.3.4-prod-fallback-value');
    expect(result.transformedText).toBe('[REDACTED:env-secret]');
  });

  it('does not emit an orphan bracket when spans overlap partially', () => {
    const result = guard.evaluate('my password: hunter2@corp.io then continue');
    expect(result.transformedText).toBe('my [REDACTED:env-secret] then continue');
  });

  it('keeps the more specific label when two patterns match the same span', () => {
    const result = guard.evaluate('Key: sk-ant-abcdefghij1234567890abcde');
    expect(result.transformedText).toBe('Key: [REDACTED:anthropic-api-key]');
  });

  it('still redacts disjoint matches separately', () => {
    const result = guard.evaluate('contact bob@example.com or call 415-555-0100');
    expect(result.transformedText).toBe('contact [REDACTED:email] or call [REDACTED:phone-us]');
  });

  it.each(['user@example.co.uk', 'user@mail.example.com', 'user@cs.dept.example.edu'])(
    'redacts the whole domain of %s',
    (email) => {
      const result = guard.evaluate(`Email: ${email}, thanks`);
      expect(result.transformedText).toBe('Email: [REDACTED:email], thanks');
    },
  );

  it('keeps the period that ends a sentence after an email', () => {
    const result = guard.evaluate('Write to user@example.co.uk. Thanks');
    expect(result.transformedText).toBe('Write to [REDACTED:email]. Thanks');
  });

  it.each(['378282246310005', '3782 822463 10005', '3714-496353-98431'])(
    'redacts the American Express number %s',
    (number) => {
      const result = guard.evaluate(`Card: ${number}.`);
      expect(result.transformedText).toBe('Card: [REDACTED:credit-card].');
    },
  );

  describe('private keys', () => {
    const body = 'MIIEowIBAAKCAQEAxg7a2n3V5h8mQ0\n9fKq+/Zt4b1c6d7e8f9g0h1i2j3k4l\nAbCd==';

    for (const kind of ['', 'RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED ']) {
      for (const separator of ['\n', '\\n', '\r\n']) {
        it(`redacts a whole ${kind}key with ${JSON.stringify(separator)} line breaks`, () => {
          const key = `-----BEGIN ${kind}PRIVATE KEY-----\n${body}\n-----END ${kind}PRIVATE KEY-----`
            .split('\n')
            .join(separator);
          const result = guard.evaluate(`before ${key} after`);
          expect(result.transformedText).toBe('before [REDACTED:private-key] after');
        });
      }
    }

    it('redacts a key with PEM headers', () => {
      const result = guard.evaluate(
        '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n' +
          `DEK-Info: AES-128-CBC,0A1B2C\n\n${body}\n-----END RSA PRIVATE KEY-----`,
      );
      expect(result.transformedText).toBe('[REDACTED:private-key]');
    });

    it('redacts a PGP key block', () => {
      const result = guard.evaluate(
        `-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n${body}\n-----END PGP PRIVATE KEY BLOCK-----`,
      );
      expect(result.transformedText).toBe('[REDACTED:private-key]');
    });

    it('redacts a key that is cut off', () => {
      const cut = body.slice(0, body.lastIndexOf('\n'));
      const result = guard.evaluate(`-----BEGIN PRIVATE KEY-----\n${cut}`);
      expect(result.transformedText).toBe('[REDACTED:private-key]');
    });

    it.each(['-', '+', '> '])('redacts a key with %j before every line', (prefix) => {
      const lines = ['-----BEGIN RSA PRIVATE KEY-----', ...body.split('\n'), '-----END RSA PRIVATE KEY-----'];
      const add = (part: string[]) => part.map((line) => prefix + line).join('\n');
      expect(guard.evaluate(add(lines)).transformedText).toBe(`${prefix}[REDACTED:private-key]`);
      expect(guard.evaluate(add(lines.slice(0, -2))).transformedText).toBe(`${prefix}[REDACTED:private-key]`);
    });

    it('redacts a key with PEM headers that is cut off', () => {
      const cut = body.slice(0, body.lastIndexOf('\n'));
      const result = guard.evaluate(
        '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n' +
          `DEK-Info: AES-128-CBC,0A1B2C\n\n${cut}`,
      );
      expect(result.transformedText).toBe('[REDACTED:private-key]');
    });

    it('keeps the text between two keys', () => {
      const key = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
      const result = guard.evaluate(`${key} and ${key}`);
      expect(result.transformedText).toBe('[REDACTED:private-key] and [REDACTED:private-key]');
    });

    it('keeps the text after a header that is only mentioned', () => {
      const result = guard.evaluate('It starts with -----BEGIN PRIVATE KEY----- in PEM.');
      expect(result.transformedText).toBe('It starts with [REDACTED:private-key] in PEM.');
    });
  });
});
