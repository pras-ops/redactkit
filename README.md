# Browser PII Shield 🛡️

[![Build Status](https://github.com/pras-ops/Local_processing_llm/actions/workflows/ci.yml/badge.svg)](https://github.com/pras-ops/Local_processing_llm/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Browser PII Shield** is a privacy-first local JavaScript SDK that redacts sensitive personal data (PII) client-side in the browser before sending text to external cloud LLM APIs, and restores the original values in responses locally.

By moving redaction and restoration entirely to the client, you ensure that sensitive data **never leaves the user's device**, allowing compliance with strict security requirements (HIPAA, GDPR, SOC2) without sacrificing cloud LLM capabilities.

---

## 🌟 Key Features

- 🕵️ **Privacy-First**: Zero-data-leakage architecture. Data is processed locally in the user's browser memory.
- ⚡ **Hybrid Detection (Two Tiers)**:
  - **Tier 1 (Instant, Rules-Based)**: Instant local redaction for common patterns (Emails, Phone numbers, SSNs, Credit Cards with Luhn check, IP addresses, API keys/secrets) with **0 dependencies** and **no model download**.
  - **Tier 2 (Local LLM-Assisted)**: Local fuzzy entity detection (Names, Addresses, Organizations) using WebGPU and a local 1B WebLLM model.
- 🔄 **Reversible mapping**: Securely maps original sensitive data to unique placeholders (e.g. `{{EMAIL_1}}`, `{{NAME_1}}`) preserving context and entity identity.
- 🔌 **Drop-In fetch Proxy**: Wrap your global `fetch` in **one line** to auto-redact outgoing prompts and auto-restore incoming LLM completions.
- 📉 **Format-Preserving Option**: Retain the structural shape of sensitive tokens (e.g. `cXXXXXt@acme.org` or `+1 (555) 0XX-XXXX`) so the cloud model can still reason correctly.

> [!WARNING]
> **Format-Preserving Data Leakage**: Format-preserving mode leaves structural details like email domains (e.g., `@acme.org`) and initial IP subnets visible to the cloud provider. If domain names or subnets are themselves considered identifying/sensitive for your organization, do not enable `formatPreserving` mode.

---

## 🚀 Quick Start

### 1. Reversible PII Redaction (Instant Rules, No Download)

```javascript
import { Preprocessor } from 'browser-pii-shield';

const preprocessor = new Preprocessor();

// 1. Redact locally on device (0 dependencies, instant)
const rawText = "Hello John, my email is john.doe@acme.org, and card is 4111-1111-1111-1111.";
const { redacted, map } = await preprocessor.redact(rawText);

console.log(redacted);
// Output: "Hello John, my email is {{EMAIL_1}}, and card is {{CREDIT_CARD_1}}."

// 2. Transmit `redacted` safely to OpenAI / Claude
const cloudResponse = "Received data for {{EMAIL_1}} on card {{CREDIT_CARD_1}}.";

// 3. Restore placeholders locally back to original values
const restored = preprocessor.restore(cloudResponse, map);
console.log(restored);
// Output: "Received data for john.doe@acme.org on card 4111-1111-1111-1111."
```

### 2. Drop-In fetch Wrapper (One-Line Integration)

Auto-shield all outgoing API requests to OpenAI, Anthropic, Groq, and others, and automatically restore incoming JSON responses.

```javascript
import { Preprocessor, createShieldedFetch } from 'browser-pii-shield';

const preprocessor = new Preprocessor();

// Override global fetch
globalThis.fetch = createShieldedFetch(preprocessor, {
  redactOptions: {
    formatPreserving: true // optional: keep shape
  }
});

// Outgoing prompts are automatically redacted; incoming responses are auto-restored!
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Draft an invoice for john.doe@acme.org' }]
  })
});
const data = await response.json();
console.log(data.choices[0].message.content); // Contains original email restored!
```

### 3. Local LLM-Assisted Redaction (Requires WebGPU)

Load a local model to detect fuzzy entities (names, locations, organisations):

```javascript
const preprocessor = new Preprocessor();
await preprocessor.loadModel('Llama-3.2-1B-Instruct-q4f16_1-MLC');

const { redacted, map } = await preprocessor.redact(rawText, {
  llm: { enabled: true }
});
```

---

## 📦 Installation

```bash
npm install browser-pii-shield
```

---

## 📊 Performance Benchmarks

Run benchmarks locally on your device:
```bash
node scripts/benchmark.js
```

| Input Size | Clean (HTML + URLs) | Chunking (1000 char) | Redact PII (Rules) |
| :--- | :--- | :--- | :--- |
| **10 KB** | < 1ms | < 1ms | ~1ms |
| **1 MB** | ~4ms | < 1ms | ~15ms |
| **5 MB** | ~25ms | < 1ms | ~67ms |

---

## 🌐 Browser Requirements

- **Rule-Based Redaction**: Works in any browser (Chrome, Firefox, Safari, Edge) and Node.js with **0 dependencies**.
- **LLM Features**: Requires **WebGPU** support.
  - ✅ **Chrome 113+** (Windows, macOS, Linux)
  - ✅ **Edge 113+**
  - ✅ **Safari** (Supported)
  - ✅ **Firefox** (Supported)

---

## ⚖️ License

Distributed under the **MIT License**. See `LICENSE` for more information.
