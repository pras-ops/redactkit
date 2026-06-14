import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createShieldedFetch } from '../../src/utils/fetch.js';
import { Preprocessor } from '../../src/index.js';

describe('createShieldedFetch (fetch proxy wrapper)', () => {
  let preprocessor;
  let mockFetch;

  beforeEach(() => {
    preprocessor = new Preprocessor();
    preprocessor.setLogging(false);
    mockFetch = vi.fn();
  });

  it('should ignore non-LLM endpoints', async () => {
    const shielded = createShieldedFetch(preprocessor, { fetch: mockFetch });
    const init = {
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Email me at john@doe.com' }]
      })
    };

    mockFetch.mockResolvedValue({
      text: async () => 'Received request'
    });

    await shielded('https://some-other-api.com/v1/data', init);

    // Verify mockFetch was called with the exact unmodified body
    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.messages[0].content).toBe('Email me at john@doe.com');
  });

  it('should redact and restore LLM endpoints for json responses', async () => {
    const shielded = createShieldedFetch(preprocessor, { fetch: mockFetch });
    const init = {
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Contact me at john@doe.com or call 555-019-9999.' }]
      })
    };

    mockFetch.mockResolvedValue({
      text: async () => 'Unused text call',
      json: async () => ({
        choices: [{
          message: {
            content: 'Hello, I will email {{EMAIL_1}} and dial {{PHONE_1}}.'
          }
        }]
      })
    });

    const response = await shielded('https://api.openai.com/v1/chat/completions', init);

    // Verify request body was redacted
    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.messages[0].content).toContain('{{EMAIL_1}}');
    expect(calledBody.messages[0].content).toContain('{{PHONE_1}}');

    // Verify response body is restored on .json()
    const result = await response.json();
    expect(result.choices[0].message.content).toBe('Hello, I will email john@doe.com and dial 555-019-9999.');
  });

  it('should redact and restore LLM endpoints for text responses', async () => {
    const shielded = createShieldedFetch(preprocessor, { fetch: mockFetch });
    const init = {
      body: JSON.stringify({
        prompt: 'Call +1 (555) 019-9999 and email john@doe.com'
      })
    };

    mockFetch.mockResolvedValue({
      text: async () => 'Answer containing {{EMAIL_1}} and {{PHONE_1}}'
    });

    const response = await shielded('https://api.openai.com/v1/engines/davinci', init);

    // Verify request body was redacted
    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.prompt).toContain('{{EMAIL_1}}');
    expect(calledBody.prompt).toContain('{{PHONE_1}}');

    // Verify response body is restored on .text()
    const result = await response.text();
    expect(result).toBe('Answer containing john@doe.com and +1 (555) 019-9999');
  });

  it('should avoid placeholder collisions in multi-message payloads', async () => {
    const shielded = createShieldedFetch(preprocessor, { fetch: mockFetch });
    const init = {
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'First user is alice@one.com' },
          { role: 'user', content: 'Second user is bob@two.com' }
        ]
      })
    };

    mockFetch.mockResolvedValue({
      json: async () => ({
        choices: [{
          message: {
            content: 'Hello, first is {{EMAIL_1}} and second is {{EMAIL_2}}.'
          }
        }]
      })
    });

    const response = await shielded('https://api.openai.com/v1/chat/completions', init);

    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.messages[0].content).toBe('First user is {{EMAIL_1}}');
    expect(calledBody.messages[1].content).toBe('Second user is {{EMAIL_2}}');

    const result = await response.json();
    expect(result.choices[0].message.content).toBe('Hello, first is alice@one.com and second is bob@two.com.');
  });

  it('should intercept and restore streaming response bodies', async () => {
    const shielded = createShieldedFetch(preprocessor, { fetch: mockFetch });
    const init = {
      body: JSON.stringify({
        prompt: 'Contact alice@one.com'
      })
    };

    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('Answer containing {{EM'),
      encoder.encode('AIL_1}} here.')
    ];

    let chunkIndex = 0;
    const mockStream = {
      getReader: () => ({
        read: async () => {
          if (chunkIndex < chunks.length) {
            return { done: false, value: chunks[chunkIndex++] };
          }
          return { done: true, value: undefined };
        }
      })
    };

    mockFetch.mockResolvedValue({
      body: mockStream,
      text: async () => 'Answer containing {{EMAIL_1}} here.'
    });

    const response = await shielded('https://api.openai.com/v1/engines/davinci', init);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamText += decoder.decode(value);
    }

    expect(streamText).toBe('Answer containing alice@one.com here.');
  });
});
