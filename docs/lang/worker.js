/**
 * Web Worker that evaluates source code in isolation.
 * Receives source via postMessage, posts back the result or error.
 */
self.addEventListener('message', (event) => {
  const source = event.data;
  try {
    const result = eval(source);
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
});
