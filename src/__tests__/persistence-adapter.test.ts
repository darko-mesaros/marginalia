import { describe, it, expect, afterEach } from "vitest";
import * as fc from "fast-check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { JsonFilePersistenceAdapter, PersistenceError } from "../persistence-adapter.js";
import type { Conversation } from "../models.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbDate = fc
  .date({ min: new Date("2000-01-01"), max: new Date("2030-12-31") })
  .filter((d) => !isNaN(d.getTime()));

const arbMessage = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom("user" as const, "assistant" as const),
  content: fc.string({ minLength: 0, maxLength: 200 }),
  toolInvocations: fc.constant([] as import("../models.js").ToolInvocation[]),
  timestamp: arbDate,
});

const arbAnchor = fc.record({
  messageId: fc.uuid(),
  startOffset: fc.nat(1000),
  endOffset: fc.nat(1000),
  selectedText: fc.string({ minLength: 1, maxLength: 100 }),
});

const arbSideThread = fc.record({
  id: fc.uuid(),
  anchor: arbAnchor,
  messages: fc.array(arbMessage, { minLength: 0, maxLength: 5 }),
  collapsed: fc.boolean(),
});

const arbConversation: fc.Arbitrary<Conversation> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 0, maxLength: 100 }),
  mainThread: fc.array(arbMessage, { minLength: 0, maxLength: 10 }),
  sideThreads: fc.array(arbSideThread, { minLength: 0, maxLength: 3 }),
  createdAt: arbDate,
  updatedAt: arbDate,
});

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `marginalia-test-${randomUUID()}`);
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Property 1: Conversation serialisation round-trip
// Feature: conversation-saving, Property 1: serialisation round-trip
// ---------------------------------------------------------------------------

describe("JsonFilePersistenceAdapter", () => {
  it(
    "Property 1: serialisation round-trip — load(save(c)) produces structurally equivalent conversation\n  Validates: Requirements 7.1, 7.2",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbConversation, async (conversation) => {
          const dataDir = makeTempDir();
          const adapter = new JsonFilePersistenceAdapter(dataDir);

          await adapter.save(conversation);
          const loaded = await adapter.load(conversation.id);

          // Scalar fields
          expect(loaded.id).toBe(conversation.id);
          expect(loaded.title).toBe(conversation.title);

          // createdAt / updatedAt are Date instances with matching time
          expect(loaded.createdAt).toBeInstanceOf(Date);
          expect(loaded.updatedAt).toBeInstanceOf(Date);
          expect(loaded.createdAt.getTime()).toBe(conversation.createdAt.getTime());
          expect(loaded.updatedAt.getTime()).toBe(conversation.updatedAt.getTime());

          // mainThread messages
          expect(loaded.mainThread).toHaveLength(conversation.mainThread.length);
          for (let i = 0; i < conversation.mainThread.length; i++) {
            expect(loaded.mainThread[i].timestamp).toBeInstanceOf(Date);
            expect(loaded.mainThread[i].timestamp.getTime()).toBe(
              conversation.mainThread[i].timestamp.getTime()
            );
            expect(loaded.mainThread[i].id).toBe(conversation.mainThread[i].id);
            expect(loaded.mainThread[i].role).toBe(conversation.mainThread[i].role);
            expect(loaded.mainThread[i].content).toBe(conversation.mainThread[i].content);
          }

          // sideThread messages
          expect(loaded.sideThreads).toHaveLength(conversation.sideThreads.length);
          for (let i = 0; i < conversation.sideThreads.length; i++) {
            const origSt = conversation.sideThreads[i];
            const loadedSt = loaded.sideThreads[i];
            expect(loadedSt.messages).toHaveLength(origSt.messages.length);
            for (let j = 0; j < origSt.messages.length; j++) {
              expect(loadedSt.messages[j].timestamp).toBeInstanceOf(Date);
              expect(loadedSt.messages[j].timestamp.getTime()).toBe(
                origSt.messages[j].timestamp.getTime()
              );
            }
          }
        }),
        { numRuns: 100 }
      );
    }
  );

  // ---------------------------------------------------------------------------
  // Property 7: Deserialisation validates required fields
  // Feature: conversation-saving, Property 7: deserialisation validates required fields
  // ---------------------------------------------------------------------------

  it(
    "Property 7: deserialisation validates required fields — load() throws PersistenceError for malformed JSON\n  Validates: Requirements 7.3",
    async () => {
      // Arbitrary for a valid base object so we can selectively corrupt fields
      const arbMalformedConversation = fc.record({
        id: fc.oneof(fc.constant(undefined), fc.constant(null), fc.integer(), fc.boolean()),
        mainThread: fc.oneof(fc.constant(undefined), fc.constant(null), fc.string(), fc.integer()),
        sideThreads: fc.oneof(fc.constant(undefined), fc.constant(null), fc.string(), fc.integer()),
        createdAt: fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant("not-a-date"),
          fc.integer()
        ),
      }).chain((base) => {
        // Pick at least one field to be bad — ensure at least one required field is missing/invalid
        // by always using the generated bad values (all four are always bad in this generator)
        return fc.constant(base);
      });

      await fc.assert(
        fc.asyncProperty(arbMalformedConversation, async (malformed) => {
          const dataDir = makeTempDir();
          const adapter = new JsonFilePersistenceAdapter(dataDir);
          const id = randomUUID();

          // Write the malformed object directly to disk
          await fs.mkdir(dataDir, { recursive: true });
          await fs.writeFile(
            path.join(dataDir, `${id}.json`),
            JSON.stringify(malformed),
            "utf-8"
          );

          await expect(adapter.load(id)).rejects.toThrow(PersistenceError);
        }),
        { numRuns: 100 }
      );
    }
  );
});
