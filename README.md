# Browser PII Shield 🛡️

[![Build Status](https://github.com/pras-ops/Local_processing_llm/actions/workflows/ci.yml/badge.svg)](https://github.com/pras-ops/Local_processing_llm/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Browser PII Shield** is a privacy-first, local JavaScript SDK designed to secure user privacy in the browser. It cleans noise, chunks text, redacts sensitive personal data (PII) client-side before sending prompts to external cloud LLM APIs, and safely restores the original values locally in the model's responses.

By running cleaning, redaction, and restoration entirely client-side, sensitive data **never leaves the user's device**. This makes it easy to maintain compliance with strict security requirements (HIPAA, GDPR, SOC2) without sacrificing cloud LLM capabilities.

---

## 🌟 Key Features

- 🕵️ **Privacy-First Zero-Leakage**: Local processing in the browser memory using WebGPU. No server-side logs or external privacy threats.
- ⚡ **Hybrid Redaction Tiers**:
  - **Tier 1 (Instant Rules)**: Direct pattern matching for common entities (Emails, Phone numbers, SSNs, Credit Cards with Luhn check, IP addresses, API keys) with **0 dependencies** and **no model download**.
  - **Tier 2 (Local LLM NER)**: Uses a local 1B WebLLM model to perform semantic Named Entity Recognition (NER) for complex entities (Names, Addresses, Organizations).
- 🔄 **Bidirectional Reversible Mapping**: Securely maps original sensitive data to placeholders (e.g., `{{EMAIL_1}}`, `{{NAME_1}}`), preserving entity identity and context across conversations.
- 🔌 **One-Line Fetch Proxy**: A drop-in `fetch` wrapper that auto-intercepts prompts, redacts PII, and reconstructs original data on incoming JSON/text streams.
- 🧹 **Robust Text Cleaning**: Strip HTML, URLs, extra whitespaces, line breaks, or use a local LLM for semantic, instruction-driven text cleaning.
- 📊 **Structured Extraction & Hallucination Prevention**: Extract structured JSON fields using local LLMs, validated by deterministic regex guards to eliminate AI hallucinations.
- 📦 **Ordered Pipelines**: Run multi-step preprocessing sequences (clean, chunk, extract, prompt) with built-in pipeline sorting (enforcing clean before extract).

---

## 📦 Installation

```bash
npm install browser-pii-shield
```

---

## 🚀 Quick Start

### 1. Simple Reversible Redaction (No Model Required)

```javascript
import { Preprocessor } from 'browser-pii-shield';

const preprocessor = new Preprocessor();

const rawText = "Hello John, my email is john.doe@acme.org, and card is 4111-1111-1111-1111.";
const { redacted, map } = await preprocessor.redact(rawText);

console.log(redacted);
// Output: "Hello John, my email is {{EMAIL_1}}, and card is {{CREDIT_CARD_1}}."

// Transmit the redacted prompt to any cloud API safely
const cloudResponse = "We registered a request for {{EMAIL_1}} on card {{CREDIT_CARD_1}}.";

// Restore original values locally
const restored = preprocessor.restore(cloudResponse, map);
console.log(restored);
// Output: "We registered a request for john.doe@acme.org on card 4111-1111-1111-1111."
```

### 2. Multi-Step Pipelines

Chain text cleaning, chunking, and custom prompting in a structured pipeline.

```javascript
const preprocessor = new Preprocessor();
await preprocessor.loadModel(); // Default: Llama-3.2-1B-Instruct-q4f16_1-MLC

const rawInput = "<div>Some noisy user feedback...</div>";
const result = await preprocessor.pipeline(rawInput, [
  { clean: { removeHtml: true, removeExtraWhitespace: true } },
  { prompt: "Rewrite this feedback in bullet points." }
]);
```

### 3. Structured Extraction with Validation

Extract structured information safely without cloud provider hallucinations.

```javascript
const result = await preprocessor.extract(rawText, {
  what: "contact details",
  format: "json",
  fields: ["email", "phone"],
  strict: true // Throws an error if extracted values don't exist in source
});
```

### 4. Drop-In Fetch Proxy (Streaming Support)

Automatically intercept LLM outgoing requests (OpenAI, Anthropic, Groq, Cohere, OpenRouter) and decode incoming streams back to their unredacted format.

```javascript
import { Preprocessor, createShieldedFetch } from 'browser-pii-shield';

const preprocessor = new Preprocessor();

// Intercept fetch
globalThis.fetch = createShieldedFetch(preprocessor, {
  redactOptions: {
    formatPreserving: true // optional: keeps structural shape of email/IP/etc.
  }
});

// Outgoing prompts are automatically redacted; incoming responses auto-restored
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Draft an invoice for john.doe@acme.org' }]
  })
});
```

> [!WARNING]
> **Format-Preserving Data Leakage**: In `formatPreserving` mode, structural details (e.g., email domains like `@acme.org` or IP subnets like `192.168.X.X`) remain visible to the cloud provider. Avoid enabling this if domain names or subnets are themselves considered identifying/sensitive for your organization.

---

## 📖 API Reference

### `new Preprocessor(options)`
Creates an instance of the Preprocessor.
- `options.streaming` *(boolean)*: Enable streaming for token-by-token logging during local inference (default: `true`).
- `options.loggerOptions` *(Object)*: Custom options to configure the internal logging outputs.

### `await loadModel(modelName)`
Downloads and caches the MLC/WebLLM model on the client.
- `modelName` *(string)*: WebLLM model identifier (default: `"Llama-3.2-1B-Instruct-q4f16_1-MLC"`).

### `await checkWebGPU()`
Checks if WebGPU support is available and enabled in the browser environment. Returns `Promise<boolean>`.

### `async redact(text, options)`
Identifies and replaces sensitive elements with unique placeholders.
- `options.rules` *(Object)*: Toggle regex-based rules: `email`, `phone`, `ssn`, `creditCard`, `ip`, `apiKey` (all `true` by default).
- `options.llm` *(Object)*: Toggle LLM-assisted NER: `{ enabled: false, names: true, addresses: true, organizations: true }`.
- `options.customPatterns` *(Array)*: Array of `{ name, regex }` objects for custom matching.
- `options.allowList` *(Array<string>)*: Specific string values to exclude from redaction.
- `options.denyList` *(Array<string>)*: Specific strings to target for forced custom redaction.
- `options.formatPreserving` *(boolean)*: Preserves format context (e.g., `{{EMAIL_1:jXXXXn@acme.org}}`).
- `options.state` *(Object)*: Shared state object to maintain sequential counters/mapping across conversational turns.

### `restore(text, map)`
Replaces placeholders with original text securely.
- `text` *(string)*: The redacted response from the LLM.
- `map` *(Object)*: The mapping dictionary returned from `redact()`.

### `async clean(text, options)`
Cleans structural noise. Works without loaded models for rule-based cleaning, and uses the local model for semantic cleanups.
- `options.removeHtml` *(boolean)*: Strip HTML tags.
- `options.removeUrls` *(boolean)*: Strip web URLs.
- `options.removeExtraWhitespace` *(boolean)*: Collapses duplicate spacing/newlines.
- `options.removeLineBreaks` *(boolean)*: Flatten newlines.
- `options.removeSpecialChars` *(boolean)*: Remove special characters.
- `options.decodeHtmlEntities` *(boolean)*: Translate XML/HTML entity codes.
- `options.useLLM` *(boolean)*: Force local LLM engine processing.
- `options.customInstructions` *(string)*: Custom semantic cleanup prompt (requires LLM).

### `async extract(text, options)`
Extracts target information with strict schema guards.
- `options.what` *(string)*: Entity description to extract.
- `options.format` *(string)*: `"text"`, `"json"`, or `"list"`.
- `options.fields` *(Array<string>)*: Target schema keys to extract (requires JSON format).
- `options.validate` *(boolean)*: Ensure JSON structure and rule validation (default: `true`).
- `options.strict` *(boolean)*: Throw error if validation checks fail (default: `false`).

### `chunk(text, options)`
Split text locally without requiring an LLM model.
- `options.size` *(number)*: Character length limit per chunk (default: `500`).
- `options.overlap` *(number)*: Chunk token overlap length (default: `0`).
- `options.strategy` *(string)*: Segment method: `"character"`, `"sentence"`, or `"word"`.

### `async prompt(text, instruction, options)`
Issues custom prompts to the local model.
- `instruction` *(string|Object)*: Raw instruction or config containing `instruction`, `format` (schema structure), `temperature`, and `maxTokens`.

### `async pipeline(text, steps)`
Runs a sequence of tasks (e.g. `['clean', { prompt: '...' }]`), automatically ordering steps to clean input text before processing.

---

## 📊 Performance & Optimization

Run performance suites locally on your system:
```bash
node scripts/benchmark.js
```

### ⚡ Rule-Based Performance (Non-LLM)
Rule-based utilities (regex filters, clean-ups, chunkers) run instantly with zero hardware limitations:

| Input Size | Clean (HTML + URLs) | Chunking (1000 char) | Redact PII (Rules) |
| :--- | :--- | :--- | :--- |
| **10 KB** | < 1ms | < 1ms | ~1ms |
| **1 MB** | ~4ms | < 1ms | ~15ms |
| **5 MB** | ~25ms | < 1ms | ~67ms |

### 🧠 Local LLM Execution (Llama-3.2-1B-Instruct)
- **Model Cache Loading**: 2–5 seconds.
- **VRAM Requirements**: 1.5GB–3.5GB.
- **Inference Speed**: ~15–30 tokens/sec (hardware dependent).

> [!TIP]
> **Token Cost Savings**: Cleaning noise (HTML/CSS) and summarizing documents client-side using Browser PII Shield can reduce cloud token costs by **up to 90–99%** by transmitting only the core insights.

---

## 🌐 Browser Requirements

- **Instant Rules**: All modern desktop/mobile browsers.
- **LLM/WebGPU Engines**:
  - Chrome 113+
  - Edge 113+
  - Safari (Supported)
  - Firefox (Supported)

---

## ⚖️ License

Distributed under the **MIT License**. See `LICENSE` for details.
