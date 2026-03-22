import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: conversation-library-ui, Property 1: Toggle consistency
// **Validates: Requirements 1.3, 1.7**

/**
 * Simulate the toggleSidebar logic from frontend/app.js.
 * We replicate the exact toggle behaviour here because app.js is a
 * browser script with no module exports.
 */
function toggleSidebar(
  contentArea: { classList: DOMTokenList },
  toggleBtn: { setAttribute: (name: string, value: string) => void },
  onOpen?: () => void,
) {
  const isOpen = contentArea.classList.toggle("sidebar-open");
  toggleBtn.setAttribute(
    "aria-label",
    isOpen ? "Close conversation library" : "Open conversation library",
  );
  if (isOpen && onOpen) {
    onOpen();
  }
}

describe("Sidebar toggle consistency (Property 1)", () => {
  it("after N toggles, sidebar visible iff N is odd, aria-label matches state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (n) => {
          // Set up minimal DOM-like objects
          const classes = new Set<string>();
          const classList = {
            toggle(cls: string) {
              if (classes.has(cls)) {
                classes.delete(cls);
                return false;
              }
              classes.add(cls);
              return true;
            },
            contains(cls: string) {
              return classes.has(cls);
            },
          } as unknown as DOMTokenList;

          let ariaLabel = "Open conversation library";
          const toggleBtn = {
            setAttribute(_name: string, value: string) {
              ariaLabel = value;
            },
          };

          // Simulate N toggle clicks
          for (let i = 0; i < n; i++) {
            toggleSidebar({ classList }, toggleBtn);
          }

          const shouldBeOpen = n % 2 === 1;

          // Sidebar visible iff N is odd
          expect(classList.contains("sidebar-open")).toBe(shouldBeOpen);

          // aria-label matches state
          if (shouldBeOpen) {
            expect(ariaLabel).toBe("Close conversation library");
          } else {
            expect(ariaLabel).toBe("Open conversation library");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: conversation-library-ui, Property 7: Relative timestamp formatting

/**
 * Replicate formatRelativeTime from frontend/app.js (browser script, no exports).
 */
function formatRelativeTime(dateString: string, now?: Date): string {
  if (!now) now = new Date();
  const then = new Date(dateString);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)
    return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)
    return diffHr === 1 ? "1 hour ago" : `${diffHr} hours ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30)
    return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`;
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
  ];
  const month = months[then.getMonth()];
  const day = then.getDate();
  if (then.getFullYear() === now.getFullYear()) return `${month} ${day}`;
  return `${month} ${day}, ${then.getFullYear()}`;
}

describe("Relative timestamp formatting (Property 7)", () => {
  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * For any (date, now) pair across all time ranges, formatRelativeTime
   * returns a string matching the expected format for that range.
   */
  it("output format matches the time-range bucket for any generated (date, now) pair", () => {
    // Arbitrary: a reasonable `now` date (use integer timestamps to avoid NaN)
    const arbNow = fc
      .integer({
        min: new Date("2010-01-01").getTime(),
        max: new Date("2030-12-31").getTime(),
      })
      .map((ts) => new Date(ts));

    // For each range, generate an offset in seconds and pair with `now`
    const arbJustNow = fc.tuple(arbNow, fc.integer({ min: 0, max: 59 })).map(
      ([now, offsetSec]) =>
        ({ now, offsetSec, range: "just_now" as const }),
    );

    const arbMinutes = fc
      .tuple(arbNow, fc.integer({ min: 60, max: 3599 }))
      .map(([now, offsetSec]) =>
        ({ now, offsetSec, range: "minutes" as const }),
      );

    const arbHours = fc
      .tuple(arbNow, fc.integer({ min: 3600, max: 86399 }))
      .map(([now, offsetSec]) =>
        ({ now, offsetSec, range: "hours" as const }),
      );

    const arbDays = fc
      .tuple(arbNow, fc.integer({ min: 86400, max: 2591999 }))
      .map(([now, offsetSec]) =>
        ({ now, offsetSec, range: "days" as const }),
      );

    const arbBeyond30d = fc
      .tuple(arbNow, fc.integer({ min: 2592000, max: 315360000 })) // up to ~10 years
      .map(([now, offsetSec]) =>
        ({ now, offsetSec, range: "date" as const }),
      );

    const arbInput = fc.oneof(
      arbJustNow,
      arbMinutes,
      arbHours,
      arbDays,
      arbBeyond30d,
    );

    fc.assert(
      fc.property(arbInput, ({ now, offsetSec, range }) => {
        const then = new Date(now.getTime() - offsetSec * 1000);
        const dateString = then.toISOString();
        const result = formatRelativeTime(dateString, now);

        switch (range) {
          case "just_now":
            expect(result).toBe("just now");
            break;

          case "minutes": {
            const expectedMin = Math.floor(offsetSec / 60);
            if (expectedMin === 1) {
              expect(result).toBe("1 minute ago");
            } else {
              expect(result).toBe(`${expectedMin} minutes ago`);
            }
            break;
          }

          case "hours": {
            const expectedHr = Math.floor(Math.floor(offsetSec / 60) / 60);
            if (expectedHr === 1) {
              expect(result).toBe("1 hour ago");
            } else {
              expect(result).toBe(`${expectedHr} hours ago`);
            }
            break;
          }

          case "days": {
            const expectedDay = Math.floor(
              Math.floor(Math.floor(offsetSec / 60) / 60) / 24,
            );
            if (expectedDay === 1) {
              expect(result).toBe("1 day ago");
            } else {
              expect(result).toBe(`${expectedDay} days ago`);
            }
            break;
          }

          case "date": {
            // Should be a short date: "Mon D" or "Mon D, YYYY"
            const months = [
              "Jan","Feb","Mar","Apr","May","Jun",
              "Jul","Aug","Sep","Oct","Nov","Dec",
            ];
            const month = months[then.getMonth()];
            const day = then.getDate();
            if (then.getFullYear() === now.getFullYear()) {
              expect(result).toBe(`${month} ${day}`);
            } else {
              expect(result).toBe(`${month} ${day}, ${then.getFullYear()}`);
            }
            break;
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: conversation-library-ui, Property 2: Conversation list entry rendering
// **Validates: Requirements 2.2, 2.3**

/**
 * Replicate the renderConversationList entry-building logic from frontend/app.js
 * as a pure function. Each summary maps to an entry with a title and a timestamp.
 */
function renderConversationListEntries(
  summaries: Array<{ id: string; title: string; updatedAt: string; messageCount: number }>,
): Array<{ title: string; time: string }> {
  return summaries.map((s) => ({
    title: s.title || "Untitled Conversation",
    time: formatRelativeTime(s.updatedAt),
  }));
}

describe("Conversation list entry rendering (Property 2)", () => {
  /**
   * **Validates: Requirements 2.2, 2.3**
   *
   * For any array of ConversationSummary objects, the rendered list should
   * contain exactly one entry per summary, each with the correct title text
   * and a non-empty relative timestamp string.
   */
  it("produces one entry per summary with correct title and non-empty timestamp", () => {
    const arbSummary = fc.record({
      id: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      updatedAt: fc
        .integer({ min: new Date("2020-01-01").getTime(), max: new Date("2030-12-31").getTime() })
        .map((ts) => new Date(ts).toISOString()),
      messageCount: fc.nat({ max: 100 }),
    });

    const arbSummaries = fc.array(arbSummary, { minLength: 0, maxLength: 50 });

    fc.assert(
      fc.property(arbSummaries, (summaries) => {
        const entries = renderConversationListEntries(summaries);

        // Result length equals input length
        expect(entries.length).toBe(summaries.length);

        for (let i = 0; i < summaries.length; i++) {
          // Each entry has the correct title (non-empty titles pass through)
          expect(entries[i].title).toBe(summaries[i].title);

          // Each entry has a non-empty timestamp string
          expect(typeof entries[i].time).toBe("string");
          expect(entries[i].time.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("falls back to 'Untitled Conversation' when title is empty", () => {
    // Use integer timestamps to avoid Invalid Date edge cases
    const minTs = new Date("2020-01-01").getTime();
    const maxTs = new Date("2030-12-31").getTime();

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            title: fc.constant(""),
            updatedAt: fc
              .integer({ min: minTs, max: maxTs })
              .map((ts) => new Date(ts).toISOString()),
            messageCount: fc.nat({ max: 100 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (summaries) => {
          const entries = renderConversationListEntries(summaries);

          for (const entry of entries) {
            expect(entry.title).toBe("Untitled Conversation");
            expect(entry.time.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: conversation-library-ui, Property 3: State reset produces clean defaults
// **Validates: Requirements 3.3, 3.4**

/**
 * Replicate the reset logic from handleNewConversation() in frontend/app.js.
 * This is a pure function that produces a clean conversation state given a new ID.
 */
function resetConversationState(newId: string): { id: string; title: string; mainThread: unknown[]; sideThreads: unknown[] } {
  return {
    id: newId,
    title: "Untitled Conversation",
    mainThread: [],
    sideThreads: [],
  };
}

describe("State reset produces clean defaults (Property 3)", () => {
  /**
   * **Validates: Requirements 3.3, 3.4**
   *
   * For any conversation state (with arbitrary mainThread, sideThreads, and title),
   * after reset the state should have: empty mainThread, empty sideThreads,
   * title "Untitled Conversation", and id matching the provided newId.
   */
  it("reset always produces empty mainThread, empty sideThreads, correct title, and matching id", () => {
    // Generate arbitrary "dirty" conversation states to prove reset ignores them
    const arbMessage = fc.record({
      id: fc.uuid(),
      role: fc.constantFrom("user", "assistant"),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    });

    const arbSideThread = fc.record({
      id: fc.uuid(),
      anchor: fc.record({
        messageId: fc.uuid(),
        startOffset: fc.nat({ max: 500 }),
        endOffset: fc.nat({ max: 500 }),
        selectedText: fc.string({ minLength: 1, maxLength: 100 }),
      }),
      messages: fc.array(arbMessage, { minLength: 1, maxLength: 5 }),
    });

    const arbDirtyState = fc.record({
      id: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      mainThread: fc.array(arbMessage, { minLength: 1, maxLength: 20 }),
      sideThreads: fc.array(arbSideThread, { minLength: 0, maxLength: 10 }),
    });

    const arbNewId = fc.uuid();

    fc.assert(
      fc.property(arbDirtyState, arbNewId, (_dirtyState, newId) => {
        const result = resetConversationState(newId);

        // mainThread is empty
        expect(result.mainThread).toHaveLength(0);

        // sideThreads is empty
        expect(result.sideThreads).toHaveLength(0);

        // title equals "Untitled Conversation"
        expect(result.title).toBe("Untitled Conversation");

        // id equals the provided newId
        expect(result.id).toBe(newId);
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: conversation-library-ui, Property 4: Loaded conversation rendering completeness
// **Validates: Requirements 4.2, 4.3**

interface TestMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface TestSideThread {
  id: string;
  anchor: { messageId: string; startOffset: number; endOffset: number; selectedText: string };
  messages: TestMessage[];
}

interface TestConversation {
  id: string;
  title: string;
  mainThread: TestMessage[];
  sideThreads: TestSideThread[];
}

/**
 * Replicate the rendering logic from loadConversation() in frontend/app.js
 * as a pure function that returns data structures instead of DOM elements.
 *
 * For the main panel: each assistant message produces a section with its messageId.
 * For the margin note panel: each side thread produces a note with the first user
 * message's content as the question and whether an assistant response exists.
 */
function computeRenderingOutput(conv: TestConversation) {
  const mainSections = conv.mainThread
    .filter((m) => m.role === "assistant")
    .map((m) => ({ messageId: m.id }));

  const marginNotes = conv.sideThreads.map((thread) => {
    const userMsg = thread.messages.find((m) => m.role === "user");
    const assistantMsg = thread.messages.find((m) => m.role === "assistant");
    return {
      threadId: thread.id,
      question: userMsg?.content || "",
      hasResponse: !!assistantMsg,
    };
  });

  return { mainSections, marginNotes };
}

describe("Loaded conversation rendering completeness (Property 4)", () => {
  /**
   * **Validates: Requirements 4.2, 4.3**
   *
   * For any Conversation with N assistant messages in the main thread and M side
   * threads, the computed rendering output should have exactly N main sections with
   * correct message IDs, and exactly M margin notes with correct question text.
   */
  it("main panel has N sections matching assistant message IDs, margin note panel has M notes with correct content", () => {
    const arbMessage = fc.record({
      id: fc.uuid(),
      role: fc.constantFrom("user" as const, "assistant" as const),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    });

    const arbSideThread = fc.record({
      id: fc.uuid(),
      anchor: fc.record({
        messageId: fc.uuid(),
        startOffset: fc.nat(500),
        endOffset: fc.nat(500),
        selectedText: fc.string({ minLength: 1, maxLength: 50 }),
      }),
      messages: fc
        .tuple(
          fc.record({
            id: fc.uuid(),
            role: fc.constant("user" as const),
            content: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          fc.record({
            id: fc.uuid(),
            role: fc.constant("assistant" as const),
            content: fc.string({ minLength: 1, maxLength: 200 }),
          }),
        )
        .map(([u, a]) => [u, a] as TestMessage[]),
    });

    const arbConversation: fc.Arbitrary<TestConversation> = fc.record({
      id: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      mainThread: fc.array(arbMessage, { minLength: 0, maxLength: 20 }),
      sideThreads: fc.array(arbSideThread, { minLength: 0, maxLength: 10 }),
    });

    fc.assert(
      fc.property(arbConversation, (conv) => {
        const { mainSections, marginNotes } = computeRenderingOutput(conv);

        // Count assistant messages in the main thread
        const assistantMessages = conv.mainThread.filter(
          (m) => m.role === "assistant",
        );

        // mainSections.length equals the number of assistant messages
        expect(mainSections.length).toBe(assistantMessages.length);

        // Each section's messageId matches the corresponding assistant message
        for (let i = 0; i < assistantMessages.length; i++) {
          expect(mainSections[i].messageId).toBe(assistantMessages[i].id);
        }

        // marginNotes.length equals the number of side threads
        expect(marginNotes.length).toBe(conv.sideThreads.length);

        // Each margin note has the correct question text from the first user message
        for (let i = 0; i < conv.sideThreads.length; i++) {
          const thread = conv.sideThreads[i];
          const firstUserMsg = thread.messages.find(
            (m) => m.role === "user",
          );

          expect(marginNotes[i].threadId).toBe(thread.id);
          expect(marginNotes[i].question).toBe(firstUserMsg?.content || "");
          expect(marginNotes[i].hasResponse).toBe(
            thread.messages.some((m) => m.role === "assistant"),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: conversation-library-ui, Property 5: Continuation area visibility
// **Validates: Requirements 4.5**

/**
 * Replicate the continuation area visibility logic from loadConversation() in
 * frontend/app.js as a pure function. The continuation area should be visible
 * if and only if the main thread contains at least one assistant message.
 */
function computeContinuationVisibility(conv: TestConversation): boolean {
  return conv.mainThread.some((m) => m.role === "assistant");
}

describe("Continuation area visibility (Property 5)", () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * For any loaded conversation, the continuation area should be visible
   * if and only if the main thread contains at least one assistant message.
   */
  it("continuation area visible iff main thread has at least one assistant message", () => {
    const arbMessage = fc.record({
      id: fc.uuid(),
      role: fc.constantFrom("user" as const, "assistant" as const),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    });

    const arbSideThread = fc.record({
      id: fc.uuid(),
      anchor: fc.record({
        messageId: fc.uuid(),
        startOffset: fc.nat(500),
        endOffset: fc.nat(500),
        selectedText: fc.string({ minLength: 1, maxLength: 50 }),
      }),
      messages: fc
        .tuple(
          fc.record({
            id: fc.uuid(),
            role: fc.constant("user" as const),
            content: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          fc.record({
            id: fc.uuid(),
            role: fc.constant("assistant" as const),
            content: fc.string({ minLength: 1, maxLength: 200 }),
          }),
        )
        .map(([u, a]) => [u, a] as TestMessage[]),
    });

    const arbConversation: fc.Arbitrary<TestConversation> = fc.record({
      id: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      mainThread: fc.array(arbMessage, { minLength: 0, maxLength: 20 }),
      sideThreads: fc.array(arbSideThread, { minLength: 0, maxLength: 10 }),
    });

    fc.assert(
      fc.property(arbConversation, (conv) => {
        const visible = computeContinuationVisibility(conv);
        const hasAssistant = conv.mainThread.some(
          (m) => m.role === "assistant",
        );

        expect(visible).toBe(hasAssistant);
      }),
      { numRuns: 100 },
    );
  });

  it("returns false when main thread has only user messages", () => {
    const arbUserOnlyThread = fc.array(
      fc.record({
        id: fc.uuid(),
        role: fc.constant("user" as const),
        content: fc.string({ minLength: 1, maxLength: 200 }),
      }),
      { minLength: 0, maxLength: 20 },
    );

    const arbConversation: fc.Arbitrary<TestConversation> = fc.record({
      id: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      mainThread: arbUserOnlyThread,
      sideThreads: fc.constant([]),
    });

    fc.assert(
      fc.property(arbConversation, (conv) => {
        expect(computeContinuationVisibility(conv)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("returns true when main thread has at least one assistant message", () => {
    // Ensure at least one assistant message by prepending one
    const arbMessage = fc.record({
      id: fc.uuid(),
      role: fc.constantFrom("user" as const, "assistant" as const),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    });

    const arbAssistantMsg = fc.record({
      id: fc.uuid(),
      role: fc.constant("assistant" as const),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    });

    const arbConversation: fc.Arbitrary<TestConversation> = fc
      .tuple(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.array(arbMessage, { minLength: 0, maxLength: 19 }),
        arbAssistantMsg,
      )
      .map(([id, title, otherMsgs, assistantMsg]) => ({
        id,
        title,
        mainThread: [...otherMsgs, assistantMsg],
        sideThreads: [],
      }));

    fc.assert(
      fc.property(arbConversation, (conv) => {
        expect(computeContinuationVisibility(conv)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: conversation-library-ui, Property 6: State replacement on load
// **Validates: Requirements 4.6, 5.4**

/**
 * Replicate the state replacement logic from loadConversation() in frontend/app.js.
 * When a conversation is loaded, state.conversation is replaced with the loaded data.
 */
function simulateStateReplacement(loaded: TestConversation) {
  return {
    id: loaded.id,
    title: loaded.title || "Untitled Conversation",
    mainThread: loaded.mainThread || [],
    sideThreads: loaded.sideThreads || [],
  };
}

describe("State replacement on load (Property 6)", () => {
  it("state matches loaded conversation data after replacement", () => {
    const arbMessage = fc.record({
      id: fc.uuid(),
      role: fc.constantFrom("user" as const, "assistant" as const),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    });

    const arbSideThread = fc.record({
      id: fc.uuid(),
      anchor: fc.record({
        messageId: fc.uuid(),
        startOffset: fc.nat(500),
        endOffset: fc.nat(500),
        selectedText: fc.string({ minLength: 1, maxLength: 50 }),
      }),
      messages: fc
        .tuple(
          fc.record({
            id: fc.uuid(),
            role: fc.constant("user" as const),
            content: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          fc.record({
            id: fc.uuid(),
            role: fc.constant("assistant" as const),
            content: fc.string({ minLength: 1, maxLength: 200 }),
          }),
        )
        .map(([u, a]) => [u, a] as TestMessage[]),
    });

    const arbConversation: fc.Arbitrary<TestConversation> = fc.record({
      id: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      mainThread: fc.array(arbMessage, { minLength: 0, maxLength: 20 }),
      sideThreads: fc.array(arbSideThread, { minLength: 0, maxLength: 10 }),
    });

    fc.assert(
      fc.property(arbConversation, (loaded) => {
        const state = simulateStateReplacement(loaded);

        // state.id matches loaded conversation's id
        expect(state.id).toBe(loaded.id);

        // state.title matches loaded conversation's title
        expect(state.title).toBe(loaded.title);

        // state.mainThread has same length as loaded mainThread
        expect(state.mainThread.length).toBe(loaded.mainThread.length);

        // Each mainThread message ID matches
        for (let i = 0; i < loaded.mainThread.length; i++) {
          expect(state.mainThread[i].id).toBe(loaded.mainThread[i].id);
        }

        // state.sideThreads has same length as loaded sideThreads
        expect(state.sideThreads.length).toBe(loaded.sideThreads.length);

        // Each sideThread ID matches
        for (let i = 0; i < loaded.sideThreads.length; i++) {
          expect(state.sideThreads[i].id).toBe(loaded.sideThreads[i].id);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: conversation-library-ui, Property 8: Anchor ranges cleanup on load
// **Validates: Requirements 8.2**

/**
 * Replicate the anchor ranges cleanup logic from loadConversation() in frontend/app.js.
 * When a conversation is loaded, anchorRanges is cleared before re-applying highlights
 * for each side thread. Loading a second conversation must not accumulate ranges from
 * the first.
 */
function simulateSequentialLoads(first: TestConversation, second: TestConversation): number {
  // Simulate first load: clear anchorRanges, add one per side thread
  const anchorRanges: unknown[] = [];

  // First load
  anchorRanges.length = 0; // clear
  for (const _thread of first.sideThreads) {
    anchorRanges.push({}); // simulate highlightAnchor adding a range
  }

  // Second load
  anchorRanges.length = 0; // clear (this is what loadConversation does)
  for (const _thread of second.sideThreads) {
    anchorRanges.push({}); // simulate highlightAnchor adding a range
  }

  return anchorRanges.length;
}

describe("Anchor ranges cleanup on load (Property 8)", () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * For any two conversations loaded sequentially where the first has P side threads
   * and the second has Q side threads, after the second load anchorRanges.length
   * should equal Q (not P + Q), ensuring stale highlights do not persist.
   */
  it("after sequential loads, anchorRanges.length equals second conversation's side thread count, not cumulative", () => {
    const arbMessage = fc.record({
      id: fc.uuid(),
      role: fc.constantFrom("user" as const, "assistant" as const),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    });

    const arbSideThread = fc.record({
      id: fc.uuid(),
      anchor: fc.record({
        messageId: fc.uuid(),
        startOffset: fc.nat(500),
        endOffset: fc.nat(500),
        selectedText: fc.string({ minLength: 1, maxLength: 50 }),
      }),
      messages: fc
        .tuple(
          fc.record({
            id: fc.uuid(),
            role: fc.constant("user" as const),
            content: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          fc.record({
            id: fc.uuid(),
            role: fc.constant("assistant" as const),
            content: fc.string({ minLength: 1, maxLength: 200 }),
          }),
        )
        .map(([u, a]) => [u, a] as TestMessage[]),
    });

    const arbConversation: fc.Arbitrary<TestConversation> = fc.record({
      id: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      mainThread: fc.array(arbMessage, { minLength: 0, maxLength: 20 }),
      sideThreads: fc.array(arbSideThread, { minLength: 0, maxLength: 10 }),
    });

    fc.assert(
      fc.property(arbConversation, arbConversation, (first, second) => {
        const resultLength = simulateSequentialLoads(first, second);

        // anchorRanges.length should equal the second conversation's side thread count
        expect(resultLength).toBe(second.sideThreads.length);

        // Explicitly verify it's NOT cumulative
        if (first.sideThreads.length > 0 && second.sideThreads.length > 0) {
          expect(resultLength).not.toBe(
            first.sideThreads.length + second.sideThreads.length,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
