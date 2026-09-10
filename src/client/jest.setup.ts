import '@testing-library/jest-dom';
import './jest.response-polyfill';

// jsdom does not currently expose Node's structuredClone implementation.
// OpenPlait adapters use it to isolate server-side connection configuration.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

// jsdom's global scope does not include Node's TextEncoder/TextDecoder.
// The safe-fetch streaming helpers decode response bodies with them.
if (typeof globalThis.TextEncoder === 'undefined' || typeof globalThis.TextDecoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('node:util');
  if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = TextEncoder;
  }
  if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
  }
}
