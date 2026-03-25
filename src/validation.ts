import type { Request, Response, NextFunction } from "express";

/**
 * Validates POST /api/ask request body.
 * Expects: { question: string }
 */
export function validateAskBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { question } = req.body ?? {};

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(422).json({ error: "Question must be a non-empty string" });
    return;
  }

  next();
}

/**
 * Validates POST /api/side-question request body.
 * Expects: { selected_text: string, question: string, anchor_position: { start_offset: number, end_offset: number, message_id: string } }
 */
export function validateSideQuestionBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { selected_text, question, anchor_position } = req.body ?? {};

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(422).json({ error: "Question must be a non-empty string" });
    return;
  }

  if (
    !selected_text ||
    typeof selected_text !== "string" ||
    selected_text.trim().length === 0
  ) {
    res.status(422).json({ error: "Selected text must be a non-empty string" });
    return;
  }

  if (!anchor_position || typeof anchor_position !== "object") {
    res.status(422).json({ error: "Anchor position is required" });
    return;
  }

  const { start_offset, end_offset, message_id } = anchor_position;

  if (typeof start_offset !== "number" || typeof end_offset !== "number") {
    res
      .status(422)
      .json({ error: "Anchor position offsets must be numbers" });
    return;
  }

  if (start_offset < 0) {
    res
      .status(422)
      .json({ error: "Anchor position start_offset must not be negative" });
    return;
  }

  if (start_offset > end_offset) {
    res.status(422).json({
      error:
        "Invalid anchor position: start_offset must be less than end_offset",
    });
    return;
  }

  if (!message_id || typeof message_id !== "string" || message_id.trim().length === 0) {
    res
      .status(422)
      .json({ error: "Anchor position message_id must be a non-empty string" });
    return;
  }

  next();
}

/**
 * Validates POST /api/side-followup request body.
 * Expects: { thread_id: string, question: string }
 */
export function validateSideFollowupBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { thread_id, question } = req.body ?? {};

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(422).json({ error: "Question must be a non-empty string" });
    return;
  }

  if (
    !thread_id ||
    typeof thread_id !== "string" ||
    thread_id.trim().length === 0
  ) {
    res.status(422).json({ error: "Thread ID must be a non-empty string" });
    return;
  }

  next();
}

/**
 * Validates POST /api/continue request body.
 * Expects: { question: string }
 */
export function validateContinueBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { question } = req.body ?? {};

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(422).json({ error: "Question must be a non-empty string" });
    return;
  }

  next();
}
