import '@testing-library/jest-dom';
import './jest.response-polyfill';

// jsdom does not currently expose Node's structuredClone implementation.
// OpenPlait adapters use it to isolate server-side connection configuration.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}
