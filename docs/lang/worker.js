/**
 * Web Worker bridge for the selfgrow language runtime.
 * Receives source via postMessage, evaluates it through the interpreter,
 * and posts back structured result or error data with location info.
 */
import { run } from './run.js';
import { SelfgrowError } from './errors.js';

self.addEventListener('message', (event) => {
  const { source, id } = event.data;
  try {
    const result = run(source);
    self.postMessage({ id, result });
  } catch (err) {
    if (err instanceof SelfgrowError) {
      self.postMessage({
        id,
        error: {
          type: err.name,
          message: err.message,
          expected: err.expected,
          found: err.found,
          location: err.location,
        },
      });
    } else {
      self.postMessage({
        id,
        error: {
          type: 'RuntimeError',
          message: err.message || String(err),
          expected: null,
          found: null,
          location: null,
        },
      });
    }
  }
});
