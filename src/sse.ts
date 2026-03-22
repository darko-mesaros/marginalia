import type { Response } from "express";

/**
 * SSE streaming utilities for Marginalia.
 *
 * Provides helpers to write Server-Sent Events to an Express response,
 * covering all event types used by the frontend (token, tool_use, done,
 * error, delay) plus client disconnect detection.
 */

/**
 * Set SSE headers on an Express response and flush them immediately.
 */
export function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

/**
 * Write a single SSE event to the response.
 *
 * Format:
 * ```
 * event: {eventType}
 * data: {JSON.stringify(data)}
 *
 * ```
 */
export function writeSSEEvent(
  res: Response,
  eventType: string,
  data: unknown
): void {
  res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Write a `token` SSE event with the given content string.
 */
export function writeTokenEvent(res: Response, content: string): void {
  writeSSEEvent(res, "token", { content });
}

/**
 * Write a `tool_use` SSE event with tool name, input, and result.
 */
export function writeToolUseEvent(
  res: Response,
  toolName: string,
  input: unknown,
  result: string
): void {
  writeSSEEvent(res, "tool_use", { tool_name: toolName, input, result });
}

/**
 * Write a `done` SSE event signalling the stream is complete.
 */
export function writeDoneEvent(res: Response, messageId: string): void {
  writeSSEEvent(res, "done", { message_id: messageId });
}

/**
 * Write an `error` SSE event with a human-readable message.
 */
export function writeErrorEvent(res: Response, message: string): void {
  writeSSEEvent(res, "error", { message });
}

/**
 * Write a `delay` SSE event informing the client of a retry wait.
 */
export function writeDelayEvent(
  res: Response,
  retryIn: number,
  attempt: number
): void {
  writeSSEEvent(res, "delay", { retry_in: retryIn, attempt });
}

/**
 * Register a callback for when the client disconnects (closes the SSE
 * connection). Useful for cancelling in-flight LLM requests.
 */
export function onClientDisconnect(res: Response, callback: () => void): void {
  res.on("close", callback);
}
