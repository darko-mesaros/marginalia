/**
 * Retry logic with exponential backoff for Bedrock throttling errors.
 *
 * The delay function is injectable so tests can skip actual waiting.
 */

export type DelayEvent = {
  event: "delay";
  data: { retryIn: number; attempt: number };
};

/**
 * Detects whether an error is a Bedrock ThrottlingException.
 */
export function isThrottlingError(err: unknown): boolean {
  return (
    err instanceof Error && "name" in err && err.name === "ThrottlingException"
  );
}

/**
 * Async generator that calls `fn()` and yields its result on success.
 * On throttling errors, yields a `delay` event and retries with
 * exponential backoff: `baseDelay * 2^attempt + jitter(0–500ms)`.
 *
 * Non-throttling errors are re-thrown immediately.
 * After `maxRetries` exhausted, the throttling error is re-thrown.
 *
 * @param fn        - The async function to call
 * @param maxRetries - Maximum number of retries (default 3)
 * @param baseDelay  - Base delay in ms (default 1000)
 * @param delayFn    - Injectable delay function for testing (default: real setTimeout)
 */
export async function* retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  delayFn: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): AsyncGenerator<DelayEvent | T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      yield await fn();
      return;
    } catch (err: unknown) {
      if (!isThrottlingError(err) || attempt === maxRetries) {
        throw err;
      }
      const delay = baseDelay * 2 ** attempt + Math.random() * 500;
      yield { event: "delay", data: { retryIn: delay, attempt: attempt + 1 } };
      await delayFn(delay);
    }
  }
}
