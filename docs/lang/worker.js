/**
 * Web Worker bridge for the selfgrow language runtime.
 * Receives source via postMessage, evaluates it through the interpreter,
 * and posts back the string result or a user-facing error message.
 */
import { run } from './run.js';

self.addEventListener('message', (event) => {
  const source = event.data;
  try {
    const result = run(source);
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
});
