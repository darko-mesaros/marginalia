import { describe, it, expect } from "vitest";
import { retryWithBackoff, isThrottlingError, type DelayEvent } from "../retry.js";

// Helper: create a ThrottlingException
function makeThrottlingError(message = "Rate exceeded"): Error {
  const err = new Error(message);
  err.name = "ThrottlingException";
  return err;
}

// No-op delay so tests don't actually wait
const noDelay = async (_ms: number) => {};

// Collect all yielded values from the async generator
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const val of gen) {
    results.push(val);
  }
  return results;
}

describe("isThrottlingError", () => {
  it("returns true for ThrottlingException", () => {
    expect(isThrottlingError(makeThrottlingError())).toBe(true);
  });

  it("returns false for generic Error", () => {
    expect(isThrottlingError(new Error("something else"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isThrottlingError("string")).toBe(false);
    expect(isThrottlingError(null)).toBe(false);
    expect(isThrottlingError(undefined)).toBe(false);
    expect(isThrottlingError(42)).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  it("yields the result on first success", async () => {
    const gen = retryWithBackoff(() => Promise.resolve("ok"), 3, 1000, noDelay);
    const results = await collect(gen);
    expect(results).toEqual(["ok"]);
  });

  it("re-throws non-throttling errors immediately", async () => {
    const gen = retryWithBackoff(
      () => Promise.reject(new Error("boom")),
      3,
      1000,
      noDelay
    );
    await expect(collect(gen)).rejects.toThrow("boom");
  });

  it("retries on throttling errors and yields delay events", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 3) throw makeThrottlingError();
      return "success";
    };

    const gen = retryWithBackoff(fn, 3, 1000, noDelay);
    const results = await collect(gen);

    // Should have 2 delay events + 1 success result
    expect(results).toHaveLength(3);

    const delays = results.filter(
      (r): r is DelayEvent => typeof r === "object" && r !== null && "event" in r && r.event === "delay"
    );
    expect(delays).toHaveLength(2);
    expect(delays[0].data.attempt).toBe(1);
    expect(delays[1].data.attempt).toBe(2);

    expect(results[2]).toBe("success");
    expect(callCount).toBe(3);
  });

  it("re-throws after max retries exhausted", async () => {
    const fn = async () => {
      throw makeThrottlingError();
    };

    const gen = retryWithBackoff(fn, 2, 1000, noDelay);
    await expect(collect(gen)).rejects.toThrow("Rate exceeded");
  });

  it("yields delay events with increasing retryIn values (exponential backoff)", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount <= 3) throw makeThrottlingError();
      return "done";
    };

    // Use baseDelay=100 so the pattern is clear
    const gen = retryWithBackoff(fn, 3, 100, noDelay);
    const results = await collect(gen);

    const delays = results.filter(
      (r): r is DelayEvent => typeof r === "object" && r !== null && "event" in r && r.event === "delay"
    );
    expect(delays).toHaveLength(3);

    // Base delays: 100*2^0=100, 100*2^1=200, 100*2^2=400 (plus jitter 0-500)
    expect(delays[0].data.retryIn).toBeGreaterThanOrEqual(100);
    expect(delays[0].data.retryIn).toBeLessThan(600); // 100 + 500 max jitter
    expect(delays[1].data.retryIn).toBeGreaterThanOrEqual(200);
    expect(delays[1].data.retryIn).toBeLessThan(700); // 200 + 500
    expect(delays[2].data.retryIn).toBeGreaterThanOrEqual(400);
    expect(delays[2].data.retryIn).toBeLessThan(900); // 400 + 500
  });

  it("calls the injected delayFn with the computed delay", async () => {
    const delaysCalled: number[] = [];
    const trackingDelay = async (ms: number) => {
      delaysCalled.push(ms);
    };

    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 2) throw makeThrottlingError();
      return "ok";
    };

    const gen = retryWithBackoff(fn, 3, 1000, trackingDelay);
    await collect(gen);

    expect(delaysCalled).toHaveLength(1);
    // Should be baseDelay * 2^0 + jitter = 1000 + [0,500)
    expect(delaysCalled[0]).toBeGreaterThanOrEqual(1000);
    expect(delaysCalled[0]).toBeLessThan(1500);
  });
});

import fc from "fast-check";

// Feature: marginalia, Property 9: Exponential backoff on throttle responses
describe("Property 9: Exponential backoff on throttle responses", () => {
  it("retries follow exponential backoff pattern with jitter tolerance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }), // N consecutive throttle responses
        fc.integer({ min: 100, max: 2000 }), // baseDelay
        async (n, baseDelay) => {
          // Create a function that throws ThrottlingException N times then succeeds
          let callCount = 0;
          const fn = async () => {
            callCount++;
            if (callCount <= n) throw makeThrottlingError();
            return "success";
          };

          const gen = retryWithBackoff(fn, 3, baseDelay, noDelay);
          const results = await collect(gen);

          // Extract delay events
          const delays = results.filter(
            (r): r is DelayEvent =>
              typeof r === "object" &&
              r !== null &&
              "event" in r &&
              r.event === "delay"
          );

          // Should have exactly N delay events
          expect(delays).toHaveLength(n);

          // Verify each delay's retryIn >= baseDelay * 2^(attempt-1) (minimum without jitter)
          for (const d of delays) {
            const attemptIndex = d.data.attempt - 1; // convert to 0-indexed
            const minDelay = baseDelay * 2 ** attemptIndex;
            expect(d.data.retryIn).toBeGreaterThanOrEqual(minDelay);
          }

          // Verify exponential growth between consecutive delays.
          // Jitter is [0, 500) per delay, so worst-case swing when doubling is 2*500=1000.
          // Tolerance of 1000ms accounts for: delay[i] at max jitter, delay[i+1] at min jitter.
          for (let i = 0; i < delays.length - 1; i++) {
            expect(delays[i + 1].data.retryIn).toBeGreaterThanOrEqual(
              2 * delays[i].data.retryIn - 1000
            );
          }

          // Final result should be success
          expect(results[results.length - 1]).toBe("success");
        }
      ),
      { numRuns: 100 }
    );
  });
});
