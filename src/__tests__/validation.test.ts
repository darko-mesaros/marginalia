import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  validateAskBody,
  validateSideQuestionBody,
  validateSideFollowupBody,
  validateContinueBody,
} from "../validation.js";

/** Helper to create a mock request with a given body. */
function mockReq(body: unknown): Request {
  return { body } as unknown as Request;
}

/** Helper to create a mock response that captures status + json calls. */
function mockRes() {
  const res = {
    statusCode: 0,
    jsonBody: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; jsonBody: unknown };
}

describe("validateAskBody", () => {
  it("calls next() for a valid question", () => {
    const next = vi.fn();
    validateAskBody(mockReq({ question: "What is Rust?" }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 422 for missing question", () => {
    const next = vi.fn();
    const res = mockRes();
    validateAskBody(mockReq({}), res, next);
    expect(res.statusCode).toBe(422);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 422 for empty string question", () => {
    const next = vi.fn();
    const res = mockRes();
    validateAskBody(mockReq({ question: "   " }), res, next);
    expect(res.statusCode).toBe(422);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 422 for non-string question", () => {
    const next = vi.fn();
    const res = mockRes();
    validateAskBody(mockReq({ question: 42 }), res, next);
    expect(res.statusCode).toBe(422);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("validateSideQuestionBody", () => {
  const validBody = {
    selected_text: "some text",
    question: "What does this mean?",
    anchor_position: {
      start_offset: 0,
      end_offset: 9,
      message_id: "msg-1",
    },
  };

  it("calls next() for a valid body", () => {
    const next = vi.fn();
    validateSideQuestionBody(mockReq(validBody), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 422 for empty question", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({ ...validBody, question: "" }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
    expect(res.jsonBody).toEqual({
      error: "Question must be a non-empty string",
    });
  });

  it("returns 422 for empty selected_text", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({ ...validBody, selected_text: "  " }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
    expect(res.jsonBody).toEqual({
      error: "Selected text must be a non-empty string",
    });
  });

  it("calls next() when start_offset equals end_offset (double-click selection)", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        ...validBody,
        anchor_position: { start_offset: 5, end_offset: 5, message_id: "m1" },
      }),
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it("returns 422 when start_offset > end_offset (inverted range)", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        ...validBody,
        anchor_position: { start_offset: 15, end_offset: 5, message_id: "m1" },
      }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
    expect(res.jsonBody).toEqual({
      error:
        "Invalid anchor position: start_offset must be less than end_offset",
    });
  });

  it("returns 422 for negative start_offset", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        ...validBody,
        anchor_position: {
          start_offset: -1,
          end_offset: 5,
          message_id: "m1",
        },
      }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 for missing anchor_position", () => {
    const next = vi.fn();
    const res = mockRes();
    const { anchor_position, ...rest } = validBody;
    validateSideQuestionBody(mockReq(rest), res, next);
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 for non-numeric offsets", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        ...validBody,
        anchor_position: {
          start_offset: "zero",
          end_offset: "ten",
          message_id: "m1",
        },
      }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 for empty message_id", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        ...validBody,
        anchor_position: { start_offset: 0, end_offset: 5, message_id: "" },
      }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
  });
});

describe("validateSideFollowupBody", () => {
  it("calls next() for valid body", () => {
    const next = vi.fn();
    validateSideFollowupBody(
      mockReq({ thread_id: "t-1", question: "Tell me more" }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it("returns 422 for empty question", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideFollowupBody(
      mockReq({ thread_id: "t-1", question: "" }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 for empty thread_id", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideFollowupBody(
      mockReq({ thread_id: "  ", question: "Tell me more" }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 for missing thread_id", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideFollowupBody(
      mockReq({ question: "Tell me more" }),
      res,
      next
    );
    expect(res.statusCode).toBe(422);
  });
});

describe("validateContinueBody", () => {
  it("calls next() for a valid question", () => {
    const next = vi.fn();
    validateContinueBody(
      mockReq({ question: "Continue please" }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it("returns 422 for empty question", () => {
    const next = vi.fn();
    const res = mockRes();
    validateContinueBody(mockReq({ question: "" }), res, next);
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 for null body", () => {
    const next = vi.fn();
    const res = mockRes();
    validateContinueBody(mockReq(null), res, next);
    expect(res.statusCode).toBe(422);
  });
});
