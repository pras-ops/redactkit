import { validateJSON } from "../utils/validation.js";
import { ModelNotLoadedError } from "../utils/errors.js";

// Helper for Luhn validation
function isValidLuhn(number) {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let val = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      val *= 2;
      if (val > 9) val -= 9;
    }
    sum += val;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// Helper to escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Masking helpers for format-preserving redaction
function maskValue(value, type) {
  switch (type) {
    case "EMAIL": {
      if (!value.includes('@')) return "XXXX@XXXX.XXX";
      const [local, domain] = value.split('@');
      const maskedLocal = local.length > 2 
        ? local[0] + 'X'.repeat(local.length - 2) + local[local.length - 1]
        : 'X'.repeat(local.length);
      return `${maskedLocal}@${domain}`;
    }
    case "PHONE": {
      let digitCount = 0;
      return value.replace(/\d/g, (char) => {
        digitCount++;
        return digitCount > 5 ? 'X' : char;
      });
    }
    case "CREDIT_CARD": {
      const digits = value.replace(/\D/g, "");
      let digitCount = 0;
      return value.replace(/\d/g, (char) => {
        digitCount++;
        return (digitCount > 4 && digitCount <= digits.length - 4) ? 'X' : char;
      });
    }
    case "SSN": {
      let digitCount = 0;
      return value.replace(/\d/g, (char) => {
        digitCount++;
        return digitCount <= 5 ? 'X' : char;
      });
    }
    case "IP_ADDRESS": {
      if (value.includes('.')) {
        const parts = value.split('.');
        return `${parts[0]}.${parts[1]}.X.X`;
      } else {
        const parts = value.split(':');
        return `${parts[0]}:${parts[1]}:XXXX:XXXX:XXXX:XXXX:XXXX:XXXX`;
      }
    }
    case "API_KEY": {
      if (value.length <= 8) return "XXXX";
      return value.substring(0, 4) + 'X'.repeat(8) + value.substring(value.length - 4);
    }
    default:
      return "XXXX";
  }
}

// Default options
const DEFAULT_OPTIONS = {
  rules: {
    email: true,
    phone: true,
    ssn: true,
    creditCard: true,
    ip: true,
    apiKey: true
  },
  llm: {
    enabled: false,
    names: true,
    addresses: true,
    organizations: true
  },
  customPatterns: [],
  allowList: [],
  denyList: [],
  formatPreserving: false
};

/**
 * Redact sensitive PII data locally using rules and/or local LLM
 * @param {LLMEngine|null} engine - LLM engine wrapper
 * @param {string} text - Input text to redact
 * @param {Object} options - Redaction configurations
 * @returns {Promise<{redacted: string, map: Object}>}
 */
export async function redact(engine, text, options = {}) {
  if (!text) {
    return { redacted: "", map: {} };
  }

  // Merge options deeply
  const rules = { ...DEFAULT_OPTIONS.rules, ...options.rules };
  const llm = { ...DEFAULT_OPTIONS.llm, ...options.llm };
  const customPatterns = options.customPatterns || DEFAULT_OPTIONS.customPatterns;
  const allowList = options.allowList || DEFAULT_OPTIONS.allowList;
  const denyList = options.denyList || DEFAULT_OPTIONS.denyList;
  const formatPreserving = options.formatPreserving !== undefined ? options.formatPreserving : DEFAULT_OPTIONS.formatPreserving;

  // Support shared state for multi-message / conversational context
  const state = options.state || { map: {}, reverseMap: {}, placeholderCounts: {} };
  const map = state.map || {};
  const reverseMap = state.reverseMap || {};
  const placeholderCounts = state.placeholderCounts || {};

  const checkAllowed = (val) => {
    return allowList.some(item => item.toLowerCase() === val.toLowerCase());
  };

  function getPlaceholder(value, type) {
    if (reverseMap[value]) {
      return reverseMap[value];
    }
    placeholderCounts[type] = (placeholderCounts[type] || 0) + 1;
    
    let placeholder;
    if (formatPreserving) {
      const masked = maskValue(value, type);
      placeholder = `{{${type.toUpperCase()}_${placeholderCounts[type]}:${masked}}}`;
    } else {
      placeholder = `{{${type.toUpperCase()}_${placeholderCounts[type]}}}`;
    }
    
    map[placeholder] = value;
    reverseMap[value] = placeholder;
    return placeholder;
  }

  let redactedText = text;

  // Custom Deny List (exact matches) processed first
  if (denyList.length > 0) {
    const sortedDeny = [...denyList].sort((a, b) => b.length - a.length);
    for (const deniedVal of sortedDeny) {
      if (deniedVal && redactedText.includes(deniedVal)) {
        if (checkAllowed(deniedVal)) continue;
        const placeholder = getPlaceholder(deniedVal, "CUSTOM_DENIED");
        redactedText = redactedText.replaceAll(deniedVal, placeholder);
      }
    }
  }

  // Custom regex patterns
  if (customPatterns.length > 0) {
    for (const custom of customPatterns) {
      if (custom.regex && custom.name) {
        // Ensure global flag is set
        const regex = custom.regex.global ? custom.regex : new RegExp(custom.regex.source, custom.regex.flags + "g");
        let match;
        const matches = [];
        while ((match = regex.exec(text)) !== null) {
          matches.push(match[0]);
        }
        const uniqueCustom = Array.from(new Set(matches));
        uniqueCustom.sort((a, b) => b.length - a.length);
        for (const matchVal of uniqueCustom) {
          if (checkAllowed(matchVal)) continue;
          const placeholder = getPlaceholder(matchVal, custom.name);
          redactedText = redactedText.replaceAll(matchVal, placeholder);
        }
      }
    }
  }

  // Tier 1 - Rule-based detection
  if (rules.creditCard) {
    // Match potential CCs (13-19 digits, allowing spaces/dashes)
    const ccRegex = /\b\d(?:[ -]?\d){12,18}\b/g;
    let match;
    const ccMatches = [];
    while ((match = ccRegex.exec(text)) !== null) {
      const original = match[0];
      if (isValidLuhn(original)) {
        ccMatches.push(original);
      }
    }
    // Deduplicate matches to prevent O(N^2) replacements on repeated values
    const uniqueCCs = Array.from(new Set(ccMatches));
    uniqueCCs.sort((a, b) => b.length - a.length);
    for (const matchVal of uniqueCCs) {
      if (checkAllowed(matchVal)) continue;
      const placeholder = getPlaceholder(matchVal, "CREDIT_CARD");
      redactedText = redactedText.replaceAll(matchVal, placeholder);
    }
  }

  if (rules.ssn) {
    const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
    let match;
    const matches = [];
    while ((match = ssnRegex.exec(text)) !== null) {
      matches.push(match[0]);
    }
    const uniqueSSNs = Array.from(new Set(matches));
    for (const matchVal of uniqueSSNs) {
      if (checkAllowed(matchVal)) continue;
      const placeholder = getPlaceholder(matchVal, "SSN");
      redactedText = redactedText.replaceAll(matchVal, placeholder);
    }
  }

  if (rules.apiKey) {
    const patterns = [
      { name: "OPENAI_KEY", regex: /\bsk-[a-zA-Z0-9]{48}\b/g },
      { name: "JWT", regex: /\beyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]\b/g },
      { name: "AWS_KEY", regex: /\bAKIA[A-Z0-9]{16}\b/g },
      { name: "SLACK_TOKEN", regex: /\bxox[bapr]-[0-9a-zA-Z]{10,12}-[0-9a-zA-Z]{10,12}-[0-9a-zA-Z]{24}\b/g }
    ];

    const allKeys = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.regex.exec(text)) !== null) {
        allKeys.push(match[0]);
      }
    }
    const uniqueKeys = Array.from(new Set(allKeys));
    uniqueKeys.sort((a, b) => b.length - a.length);
    for (const matchVal of uniqueKeys) {
      if (checkAllowed(matchVal)) continue;
      const placeholder = getPlaceholder(matchVal, "API_KEY");
      redactedText = redactedText.replaceAll(matchVal, placeholder);
    }
  }

  if (rules.email) {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    let match;
    const matches = [];
    while ((match = emailRegex.exec(text)) !== null) {
      matches.push(match[0]);
    }
    const uniqueEmails = Array.from(new Set(matches));
    uniqueEmails.sort((a, b) => b.length - a.length);
    for (const matchVal of uniqueEmails) {
      if (checkAllowed(matchVal)) continue;
      const placeholder = getPlaceholder(matchVal, "EMAIL");
      redactedText = redactedText.replaceAll(matchVal, placeholder);
    }
  }

  if (rules.ip) {
    const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
    const ipv6Regex = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:(?:[0-9a-fA-F]{1,4}:?){0,6}\b/g;
    
    let match;
    const matches = [];
    while ((match = ipv4Regex.exec(text)) !== null) {
      matches.push(match[0]);
    }
    while ((match = ipv6Regex.exec(text)) !== null) {
      matches.push(match[0]);
    }
    const uniqueIPs = Array.from(new Set(matches));
    uniqueIPs.sort((a, b) => b.length - a.length);
    for (const matchVal of uniqueIPs) {
      if (checkAllowed(matchVal)) continue;
      const placeholder = getPlaceholder(matchVal, "IP_ADDRESS");
      redactedText = redactedText.replaceAll(matchVal, placeholder);
    }
  }

  if (rules.phone) {
    const phoneRegex = /(?:\+?\b\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
    let match;
    const matches = [];
    while ((match = phoneRegex.exec(text)) !== null) {
      matches.push(match[0]);
    }
    const uniquePhones = Array.from(new Set(matches));
    uniquePhones.sort((a, b) => b.length - a.length);
    for (const matchVal of uniquePhones) {
      if (checkAllowed(matchVal)) continue;
      const placeholder = getPlaceholder(matchVal, "PHONE");
      redactedText = redactedText.replaceAll(matchVal, placeholder);
    }
  }

  // Tier 2 - LLM-assisted NER detection
  if (llm.enabled) {
    if (!engine || !engine.isLoaded()) {
      throw new ModelNotLoadedError("LLM-assisted PII redaction");
    }

    const logger = engine.getLogger();
    logger.log('info', 'REDACT', 'Running LLM-assisted entity detection (Tier 2)');

    const prompt = `Identify all names of people, physical addresses (street addresses, cities, locations, zip codes), and organization names (companies, brands, groups) in the following text.
Return the result strictly as a JSON object with this format:
{
  "names": ["name1", "name2"],
  "addresses": ["address1", "address2"],
  "organizations": ["org1", "org2"]
}
Do not include any extra commentary. If none are found, return empty lists.

Text:
${text}`;

    const rawResponse = await engine.run(prompt, { temperature: 0.1 });
    const validation = validateJSON(rawResponse, []);

    if (validation.isValid && validation.data) {
      const data = validation.data;
      const entitiesToRedact = [];

      if (llm.names && Array.isArray(data.names)) {
        for (const val of data.names) {
          if (typeof val === "string" && val.trim().length > 1) {
            entitiesToRedact.push({ value: val.trim(), type: "NAME" });
          }
        }
      }

      if (llm.addresses && Array.isArray(data.addresses)) {
        for (const val of data.addresses) {
          if (typeof val === "string" && val.trim().length > 2) {
            entitiesToRedact.push({ value: val.trim(), type: "ADDRESS" });
          }
        }
      }

      if (llm.organizations && Array.isArray(data.organizations)) {
        for (const val of data.organizations) {
          if (typeof val === "string" && val.trim().length > 1) {
            entitiesToRedact.push({ value: val.trim(), type: "ORGANIZATION" });
          }
        }
      }

      // Sort by length descending to prevent substring collisions (e.g. "John Doe" vs "John")
      entitiesToRedact.sort((a, b) => b.value.length - a.value.length);

      for (const entity of entitiesToRedact) {
        if (checkAllowed(entity.value)) continue;
        if (redactedText.includes(entity.value)) {
          const placeholder = getPlaceholder(entity.value, entity.type);
          redactedText = redactedText.replaceAll(entity.value, placeholder);
        }
      }
    } else {
      logger.log('warn', 'REDACT', 'LLM entity detection returned invalid JSON', { rawResponse });
    }
  }

  return { redacted: redactedText, map };
}

/**
 * Restore redacted placeholders in a response with their original values
 * @param {string} text - The response containing placeholders
 * @param {Object} map - Bidirectional map returned from redact()
 * @returns {string}
 */
export function restore(text, map) {
  if (!text) return "";
  if (!map || Object.keys(map).length === 0) return text;

  let restored = text;
  
  // Sort placeholders by length descending to prevent short matches replacing long placeholders
  const placeholders = Object.keys(map).sort((a, b) => b.length - a.length);

  for (const placeholder of placeholders) {
    const originalValue = map[placeholder];
    const inner = placeholder.replace(/[{}]/g, "").trim();
    // Escape special characters so format-preserved parts like (555) work correctly in RegExp
    const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(inner)}\\s*\\}\\}`, "gi");
    // Use the function form so `$` sequences in the original value (e.g. "$&", "$1")
    // are inserted literally instead of being treated as replacement patterns.
    restored = restored.replace(regex, () => originalValue);
  }

  return restored;
}
