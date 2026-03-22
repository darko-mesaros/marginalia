import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response } from "express";
import {
  initSSE,
  writeSSEEvent,
  writeTokenEvent,
  writeToolUseEvent,
  writeDoneEvent,
  writeErrorEvent,
  writeDelayEvent,
  onClientDisconnect,
} from "../sse.js";

/** Create a minimal mock Express Response for SSE testing. */
function createMockResponse() {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  const listeners: Record<string, Array<() => void>> = {};

  return {
    mock: {
      written,
      headers,
      listeners,
    },
    res: {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      flushHeaders: vi.fn(),
      write(chunk: string) {
        written.push(chunk);
        return true;
      },
      on(event: string, cb: () => void) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
    } as unknown as Response,
  };
}

describe("SSE utilities", () => {
  let mock: ReturnType<typeof createMockResponse>["mock"];
  let res: Response;

  beforeEach(() => {
    const m = createMockResponse();
    mock = m.mock;
    res = m.res;
  });

  describe("initSSE", () => {
    it("sets required SSE headers and flushes them", () => {
      initSSE(res);

      expect(mock.headers["Content-Type"]).toBe("text/event-stream");
      expect(mock.headers["Cache-Control"]).toBe("no-cache");
      expect(mock.headers["Connection"]).toBe("keep-alive");
      expect(res.flushHeaders).toHaveBeenCalled();
    });
  });

  describe("writeSSEEvent", () => {
    it("writes event in correct SSE format", () => {
      writeSSEEvent(res, "test", { foo: "bar" });

      expect(mock.written).toHaveLength(1);
      expect(mock.written[0]).toBe(
        'event: test\ndata: {"foo":"bar"}\n\n'
      );
    });

    it("serializes complex data as JSON", () => {
      writeSSEEvent(res, "complex", { a: 1, b: [2, 3], c: { d: true } });

      expect(mock.written[0]).toBe(
        'event: complex\ndata: {"a":1,"b":[2,3],"c":{"d":true}}\n\n'
      );
    });
  });

  describe("writeTokenEvent", () => {
    it("writes a token event with content", () => {
      writeTokenEvent(res, "Hello world");

      expect(mock.written[0]).toBe(
        'event: token\ndata: {"content":"Hello world"}\n\n'
      );
    });
  });

  describe("writeToolUseEvent", () => {
    it("writes a tool_use event with tool_name, input, and result", () => {
      writeToolUseEvent(res, "search", { query: "test" }, "found 3 results");

      const parsed = JSON.parse(
        mock.written[0].replace("event: tool_use\ndata: ", "").replace("\n\n", "")
      );
      expect(parsed.tool_name).toBe("search");
      expect(parsed.input).toEqual({ query: "test" });
      expect(parsed.result).toBe("found 3 results");
    });
  });

  describe("writeDoneEvent", () => {
    it("writes a done event with message_id", () => {
      writeDoneEvent(res, "msg-123");

      expect(mock.written[0]).toBe(
        'event: done\ndata: {"message_id":"msg-123"}\n\n'
      );
    });
  });

  describe("writeErrorEvent", () => {
    it("writes an error event with message", () => {
      writeErrorEvent(res, "Something went wrong");

      expect(mock.written[0]).toBe(
        'event: error\ndata: {"message":"Something went wrong"}\n\n'
      );
    });
  });

  describe("writeDelayEvent", () => {
    it("writes a delay event with retry_in and attempt", () => {
      writeDelayEvent(res, 2000, 1);

      expect(mock.written[0]).toBe(
        'event: delay\ndata: {"retry_in":2000,"attempt":1}\n\n'
      );
    });
  });

  describe("onClientDisconnect", () => {
    it("registers a close event listener on the response", () => {
      const callback = vi.fn();
      onClientDisconnect(res, callback);

      expect(mock.listeners["close"]).toHaveLength(1);

      // Simulate client disconnect
      mock.listeners["close"][0]();
      expect(callback).toHaveBeenCalledOnce();
    });
  });
});

import fc from "fast-check";

// Feature: marginalia, Property 11: Tool invocations are serialized as SSE events
describe("Property 11: Tool invocations are serialized as SSE events", () => {
  it("should serialize any tool invocation as a tool_use SSE event with correct fields", () => {
    // **Validates: Requirements 12.5**
    fc.assert(
      fc.property(
        // Generate random non-empty tool names
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        // Generate random JSON-serializable input objects
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), { maxLength: 5 }),
          ),
          { minKeys: 0, maxKeys: 5 },
        ),
        // Generate random non-empty result strings
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        (toolName, input, result) => {
          const written: string[] = [];
          const mockRes = {
            write(chunk: string) {
              written.push(chunk);
              return true;
            },
          } as unknown as Response;

          writeToolUseEvent(mockRes, toolName, input, result);

          // Should have written exactly one SSE event
          expect(written).toHaveLength(1);

          const raw = written[0];

          // Should start with event: tool_use
          expect(raw.startsWith("event: tool_use\n")).toBe(true);

          // Extract the data portion
          const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
          expect(dataLine).toBeDefined();

          const jsonStr = dataLine!.replace("data: ", "");
          const parsed = JSON.parse(jsonStr);

          // Assert event data contains tool_name, input, and result
          expect(parsed.tool_name).toBe(toolName);
          expect(parsed.input).toEqual(input);
          expect(parsed.result).toBe(result);
        },
      ),
      { numRuns: 100 },
    );
  });
});
