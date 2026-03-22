import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { marked } from "marked";

// Feature: marginalia, Property 2: Markdown rendering produces correct HTML structure
// **Validates: Requirements 2.1**

/**
 * Arbitraries for generating markdown elements.
 * We generate specific markdown constructs and verify the rendered HTML
 * contains the corresponding tags.
 */

const safeText = fc.stringMatching(/^[a-z0-9 ]{1,30}$/);

const headingLevel = fc.integer({ min: 1, max: 6 });

const headingArb = fc.tuple(headingLevel, safeText).map(([level, text]) => ({
  markdown: `${"#".repeat(level)} ${text.trim() || "heading"}`,
  expectedTag: `<h${level}>`,
}));

const paragraphArb = safeText.map((text) => ({
  markdown: text.trim() || "paragraph",
  expectedTag: "<p>",
}));

const codeBlockArb = safeText.map((text) => ({
  markdown: `\`\`\`\n${text.trim() || "code"}\n\`\`\``,
  expectedTag: "<code>",
}));

const inlineCodeArb = safeText.map((text) => {
  const content = text.trim() || "code";
  return {
    markdown: `some text \`${content}\` more text`,
    expectedTag: "<code>",
  };
});

describe("Markdown rendering produces correct HTML structure", () => {
  it("headings render to correct heading tags", () => {
    fc.assert(
      fc.property(headingArb, ({ markdown, expectedTag }) => {
        const html = marked.parse(markdown) as string;
        expect(html).toContain(expectedTag);
      }),
      { numRuns: 100 },
    );
  });

  it("paragraphs render to <p> tags", () => {
    fc.assert(
      fc.property(paragraphArb, ({ markdown, expectedTag }) => {
        const html = marked.parse(markdown) as string;
        expect(html).toContain(expectedTag);
      }),
      { numRuns: 100 },
    );
  });

  it("code blocks render to <code> tags", () => {
    fc.assert(
      fc.property(codeBlockArb, ({ markdown, expectedTag }) => {
        const html = marked.parse(markdown) as string;
        expect(html).toContain(expectedTag);
      }),
      { numRuns: 100 },
    );
  });

  it("inline code renders to <code> tags", () => {
    fc.assert(
      fc.property(inlineCodeArb, ({ markdown, expectedTag }) => {
        const html = marked.parse(markdown) as string;
        expect(html).toContain(expectedTag);
      }),
      { numRuns: 100 },
    );
  });

  it("mixed markdown produces all corresponding HTML tags", () => {
    const mixedArb = fc.tuple(headingLevel, safeText, safeText, safeText).map(
      ([level, headingText, paraText, codeText]) => {
        const h = headingText.trim() || "heading";
        const p = paraText.trim() || "paragraph";
        const c = codeText.trim() || "code";
        return {
          markdown: `${"#".repeat(level)} ${h}\n\n${p}\n\n\`\`\`\n${c}\n\`\`\`\n\nsome \`inline\` code`,
          expectedTags: [`<h${level}>`, "<p>", "<code>"],
        };
      },
    );

    fc.assert(
      fc.property(mixedArb, ({ markdown, expectedTags }) => {
        const html = marked.parse(markdown) as string;
        for (const tag of expectedTags) {
          expect(html).toContain(tag);
        }
      }),
      { numRuns: 100 },
    );
  });
});
