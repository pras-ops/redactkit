/**
 * Helper to recursively restore redacted values in an object structure
 */
function restoreObject(obj, preprocessor, map) {
  if (typeof obj === "string") {
    return preprocessor.restore(obj, map);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => restoreObject(item, preprocessor, map));
  }
  if (typeof obj === "object" && obj !== null) {
    const restored = {};
    for (const [key, value] of Object.entries(obj)) {
      restored[key] = restoreObject(value, preprocessor, map);
    }
    return restored;
  }
  return obj;
}

/**
 * Creates a drop-in fetch replacement that auto-redacts PII from requests
 * and auto-restores them in responses (including streaming responses).
 * 
 * @param {Preprocessor} preprocessor - The Preprocessor instance
 * @param {Object} options - Configurations
 * @param {Function} [options.shouldRedact] - Filter function returning true for LLM request URLs
 * @param {Object} [options.redactOptions] - Configurations for redact()
 * @param {Function} [options.fetch] - Fallback fetch function (defaults to globalThis.fetch)
 * @returns {Function} Wrapped fetch function
 */
export function createShieldedFetch(preprocessor, options = {}) {
  const originalFetch = options.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  
  if (!originalFetch) {
    throw new Error("fetch is not defined. Please provide a fetch implementation in options.");
  }

  return async function shieldedFetch(url, init = {}) {
    if (!init || !init.body || typeof init.body !== "string") {
      return originalFetch(url, init);
    }

    // Identify endpoints that should be redacted
    const isLLMRequest = options.shouldRedact
      ? options.shouldRedact(url, init)
      : /api\.openai\.com|api\.anthropic\.com|api\.cohere\.ai|api\.groq\.com|openrouter\.ai/i.test(url.toString());

    if (!isLLMRequest) {
      return originalFetch(url, init);
    }

    try {
      const bodyObj = JSON.parse(init.body);
      
      // Thread a single state object to avoid multi-message counter clashes / collisions
      const state = { map: {}, reverseMap: {}, placeholderCounts: {} };
      const redactOpts = { ...options.redactOptions, state };

      // Redact OpenAI / Anthropic messages array
      if (Array.isArray(bodyObj.messages)) {
        for (const msg of bodyObj.messages) {
          if (typeof msg.content === "string") {
            const result = await preprocessor.redact(msg.content, redactOpts);
            msg.content = result.redacted;
          } else if (Array.isArray(msg.content)) {
            for (const contentPart of msg.content) {
              if (contentPart.type === "text" && typeof contentPart.text === "string") {
                const result = await preprocessor.redact(contentPart.text, redactOpts);
                contentPart.text = result.redacted;
              }
            }
          }
        }
      }

      // Redact legacy prompt format
      if (typeof bodyObj.prompt === "string") {
        const result = await preprocessor.redact(bodyObj.prompt, redactOpts);
        bodyObj.prompt = result.redacted;
      }

      const newInit = {
        ...init,
        body: JSON.stringify(bodyObj)
      };

      const response = await originalFetch(url, newInit);
      const map = state.map;

      // Wrap response object to intercept read streams and restore PII
      const originalText = response.text ? response.text.bind(response) : null;
      const originalJson = response.json ? response.json.bind(response) : null;

      if (originalText) {
        response.text = async function() {
          const text = await originalText();
          return preprocessor.restore(text, map);
        };
      }

      if (originalJson) {
        response.json = async function() {
          const data = await originalJson();
          return restoreObject(data, preprocessor, map);
        };
      }

      // Handle streaming responses (ReadableStream)
      if (response.body && typeof response.body.getReader === 'function') {
        const originalBody = response.body;
        const reader = originalBody.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";

        const newStream = new ReadableStream({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  if (buffer) {
                    const restored = preprocessor.restore(buffer, map);
                    controller.enqueue(encoder.encode(restored));
                  }
                  controller.close();
                  break;
                }

                // Decode current chunk
                const chunkStr = decoder.decode(value, { stream: true });
                buffer += chunkStr;

                // Look-back check to avoid splitting a placeholder across chunks
                // Keep the suffix in the buffer only if it is an incomplete placeholder token
                let lastBrace = buffer.lastIndexOf('{');
                // Adjust to the first brace of '{{' if they are adjacent
                if (lastBrace > 0 && buffer[lastBrace - 1] === '{') {
                  lastBrace = lastBrace - 1;
                }
                
                let emitStr = buffer;
                let keepStr = "";

                if (lastBrace !== -1 && lastBrace > buffer.length - 60) {
                  const remaining = buffer.substring(lastBrace);
                  if (!remaining.includes('}}')) {
                    emitStr = buffer.substring(0, lastBrace);
                    keepStr = remaining;
                  }
                }

                if (emitStr) {
                  const restored = preprocessor.restore(emitStr, map);
                  controller.enqueue(encoder.encode(restored));
                  buffer = keepStr;
                }
              }
            } catch (err) {
              controller.error(err);
            }
          }
        });

        Object.defineProperty(response, 'body', {
          get() { return newStream; },
          configurable: true
        });
      }

      return response;
    } catch (e) {
      // On error, fall back to standard fetch behavior
      return originalFetch(url, init);
    }
  };
}
