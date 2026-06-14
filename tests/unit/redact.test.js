import { describe, it, expect } from 'vitest';
import { redact, restore } from '../../src/preprocess/redact.js';

describe('Local PII Redaction & Restoration (Tier 1 rules)', () => {
  it('should redact emails', async () => {
    const text = 'Send questions to support@example.com and contact admin@domain.org.';
    const { redacted, map } = await redact(null, text, { rules: { email: true } });

    expect(redacted).toContain('{{EMAIL_1}}');
    expect(redacted).toContain('{{EMAIL_2}}');
    expect(redacted).not.toContain('support@example.com');
    expect(redacted).not.toContain('admin@domain.org');

    expect(map['{{EMAIL_1}}']).toBe('support@example.com');
    expect(map['{{EMAIL_2}}']).toBe('admin@domain.org');
  });

  it('should preserve identity of the same email across multiple occurrences', async () => {
    const text = 'Contact support@example.com. Again, support@example.com.';
    const { redacted, map } = await redact(null, text, { rules: { email: true } });

    expect(redacted).toBe('Contact {{EMAIL_1}}. Again, {{EMAIL_1}}.');
    expect(Object.keys(map)).toHaveLength(1);
    expect(map['{{EMAIL_1}}']).toBe('support@example.com');
  });

  it('should redact phone numbers', async () => {
    const text = 'Call us at 123-456-7890 or +1 (555) 019-9999.';
    const { redacted, map } = await redact(null, text, { rules: { phone: true } });

    expect(redacted).toContain('{{PHONE_1}}');
    expect(redacted).toContain('{{PHONE_2}}');
    expect(map['{{PHONE_1}}']).toBe('+1 (555) 019-9999');
    expect(map['{{PHONE_2}}']).toBe('123-456-7890');
  });

  it('should redact SSNs', async () => {
    const text = 'My SSN is 999-12-3456.';
    const { redacted, map } = await redact(null, text, { rules: { ssn: true } });

    expect(redacted).toBe('My SSN is {{SSN_1}}.');
    expect(map['{{SSN_1}}']).toBe('999-12-3456');
  });

  it('should redact valid Luhn credit cards and ignore invalid ones', async () => {
    // 4111111111111111 is a valid Visa credit card (Luhn check passes)
    // 4111111111111112 is invalid (Luhn check fails)
    const text = 'Use CC 4111-1111-1111-1111 but do not use 4111-1111-1111-1112.';
    const { redacted, map } = await redact(null, text, { rules: { creditCard: true } });

    expect(redacted).toContain('{{CREDIT_CARD_1}}');
    expect(redacted).toContain('4111-1111-1111-1112'); // invalid card remains unredacted
    expect(map['{{CREDIT_CARD_1}}']).toBe('4111-1111-1111-1111');
  });

  it('should redact IPv4 and IPv6 addresses', async () => {
    const text = 'Server IP is 192.168.1.1 and IPv6 is 2001:db8:3333:4444:5555:6666:7777:8888.';
    const { redacted, map } = await redact(null, text, { rules: { ip: true } });

    expect(redacted).toContain('{{IP_ADDRESS_1}}');
    expect(redacted).toContain('{{IP_ADDRESS_2}}');
    expect(map['{{IP_ADDRESS_1}}']).toBe('2001:db8:3333:4444:5555:6666:7777:8888');
    expect(map['{{IP_ADDRESS_2}}']).toBe('192.168.1.1');
  });

  it('should redact common API keys and secret formats', async () => {
    const text = 'Key sk-1234567890abcdef1234567890abcdef1234567890abcdef and AWS key AKIAIOSFODNN7EXAMPLE.';
    const { redacted, map } = await redact(null, text, { rules: { apiKey: true } });

    expect(redacted).toContain('{{API_KEY_1}}');
    expect(redacted).toContain('{{API_KEY_2}}');
    expect(map['{{API_KEY_1}}']).toBe('sk-1234567890abcdef1234567890abcdef1234567890abcdef');
    expect(map['{{API_KEY_2}}']).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('should restore placeholders case-insensitively and with varying spaces', () => {
    const map = {
      '{{EMAIL_1}}': 'support@example.com',
      '{{PHONE_1}}': '123-456-7890'
    };

    const response = 'The email was {{email_1}} and phone was {{ PHONE_1 }}.';
    const restored = restore(response, map);

    expect(restored).toBe('The email was support@example.com and phone was 123-456-7890.');
  });

  it('should respect allowList and denyList', async () => {
    const text = 'Contact John at john@example.com. Do NOT redact public@example.com. Also hide SECRET_PROJECT.';
    const { redacted, map } = await redact(null, text, {
      rules: { email: true },
      allowList: ['public@example.com'],
      denyList: ['SECRET_PROJECT']
    });

    expect(redacted).toContain('{{EMAIL_1}}'); // john@example.com
    expect(redacted).toContain('public@example.com'); // allowed, not redacted
    expect(redacted).toContain('{{CUSTOM_DENIED_1}}'); // SECRET_PROJECT redacted
    expect(map['{{CUSTOM_DENIED_1}}']).toBe('SECRET_PROJECT');
  });

  it('should support custom regex patterns', async () => {
    const text = 'Order number is ORD-12345 and user ID is USER-987.';
    const { redacted, map } = await redact(null, text, {
      rules: {}, // disable standard rules
      customPatterns: [
        { name: 'ORDER_NUM', regex: /ORD-\d+/g },
        { name: 'USER_ID', regex: /USER-\d+/g }
      ]
    });

    expect(redacted).toContain('{{ORDER_NUM_1}}');
    expect(redacted).toContain('{{USER_ID_1}}');
    expect(map['{{ORDER_NUM_1}}']).toBe('ORD-12345');
    expect(map['{{USER_ID_1}}']).toBe('USER-987');
  });

  it('should support format-preserving redaction', async () => {
    const text = 'Send a message to contact@acme.org or call +1 (555) 019-9999.';
    const { redacted, map } = await redact(null, text, {
      rules: { email: true, phone: true },
      formatPreserving: true
    });

    expect(redacted).toContain('{{EMAIL_1:');
    expect(redacted).toContain('{{PHONE_1:');
    
    const restored = restore(redacted, map);
    expect(restored).toBe(text);
  });

  it('should restore values containing $ replacement-pattern sequences literally', () => {
    // "$&", "$1", "$$" are special in String.replace replacement strings and must
    // not be interpreted when restoring original values (e.g. org/product names).
    const map = {
      '{{NAME_1}}': 'A$&B$1C',
      '{{ORG_1}}': 'Ca$h App',
      '{{KEY_1}}': 'p$$word'
    };
    const restored = restore('Names: {{NAME_1}}, {{ORG_1}}, {{KEY_1}}.', map);
    expect(restored).toBe('Names: A$&B$1C, Ca$h App, p$$word.');
  });
});
