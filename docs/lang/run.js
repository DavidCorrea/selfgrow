/**
 * Runtime core with a hard execution timeout guard.
 * Evaluates source in a Web Worker so infinite loops cannot freeze the UI.
 * If evaluation does not complete within 2000ms, the worker is terminated
 * and a clear timeout error is thrown.
 */

const TIMEOUT_MS = 2000;

/**
 * Run a selfgrow program and return its printed result.
 * Throws a timeout error (or other error) if the program does not finish in time.
 */
export function run(source) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          `Execution timed out after ${TIMEOUT_MS}ms — the program did not finish within the allowed time. This usually means an infinite loop.`
        )
      );
    }, TIMEOUT_MS);

    worker.addEventListener('message', (event) => {
      clearTimeout(timer);
      worker.terminate();
      const { result, error } = event.data;
      if (error) {
        reject(new Error(error));
      } else {
        resolve(result);
      }
    });

    worker.addEventListener('error', (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || 'Worker error'));
    });

    worker.postMessage(source);
  });
}
