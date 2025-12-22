// Polyfill for Node.js perf_hooks module
// This provides a browser-compatible version of perf_hooks

const performance = globalThis.performance || {
  now: () => Date.now(),
  timeOrigin: Date.now()
};

// Export as default (web-llm imports it as default)
export default {
  performance
};

// Also export named export for compatibility
export { performance };

