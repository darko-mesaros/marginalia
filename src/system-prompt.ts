import * as fs from "node:fs/promises";
import * as path from "node:path";

const FILENAME = "system-prompt.md";

/**
 * Load the system prompt from disk. Returns null if the file doesn't exist.
 */
export async function loadSystemPrompt(dataDir: string): Promise<string | null> {
  try {
    const content = await fs.readFile(path.join(dataDir, FILENAME), "utf-8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    console.warn(`[system-prompt] Failed to read ${FILENAME}: ${e.message}`);
    return null;
  }
}

/**
 * Save the system prompt to disk. If content is empty, deletes the file.
 */
export async function saveSystemPrompt(dataDir: string, content: string): Promise<void> {
  const filePath = path.join(dataDir, FILENAME);
  if (content.trim().length === 0) {
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        console.error(`[system-prompt] Failed to delete ${FILENAME}: ${e.message}`);
      }
    }
    return;
  }
  try {
    await fs.writeFile(filePath, content, "utf-8");
  } catch (err: unknown) {
    const e = err as Error;
    console.error(`[system-prompt] Failed to write ${FILENAME}: ${e.message}`);
  }
}
