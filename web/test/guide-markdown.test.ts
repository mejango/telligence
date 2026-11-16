import { BUILD_GUIDE } from "@/lib/build-guide";
import { guideMarkdown } from "@/lib/guide-markdown";
import { LEARN_GUIDE } from "@/lib/learn-guide";
import { describe, expect, it } from "vitest";

const count = (text: string, part: string) => text.split(part).length - 1;

describe("guide markdown", () => {
  const learn = guideMarkdown(LEARN_GUIDE, "/learn");
  const build = guideMarkdown(BUILD_GUIDE, "/build");

  it("renders every section once, with its anchor, and nothing unrendered", () => {
    for (const [guide, text] of [
      [LEARN_GUIDE, learn],
      [BUILD_GUIDE, build],
    ] as const) {
      for (const section of guide.sections) {
        expect(count(text, `## ${section.title} {#${section.id}}\n`), section.id).toBe(1);
        expect(count(text, `{#${section.id}}`), section.id).toBe(1);
      }
      expect(count(text, "\n## ")).toBe(guide.sections.length);
      expect(text).not.toMatch(/undefined|\[object Object\]|·/);
      // Every link is absolute: no in-page or site-relative target survives.
      expect(text).not.toMatch(/\]\([#/]/);
    }
  });

  it("keeps the glossary, the worked example, diagrams, and fenced code", () => {
    const glossary = [LEARN_GUIDE.sections.find((section) => section.id === "glossary")!.table!]
      .flat()
      .flatMap((table) => table.rows);
    expect(glossary.length).toBeGreaterThan(20);
    for (const [term, meaning] of glossary) expect(learn).toContain(`| ${term} | ${meaning} |`);

    expect(learn).toContain("| Tax | Cash out returns | Stays |\n| --- | --- | --- |");
    expect(learn).toContain("| 0.2 | 8.2 ETH | 1.8 ETH |");
    expect(learn).toContain("```text\n1. Someone PAYS the revnet");
    expect(learn).toContain("/learn#stages)");

    const fences = build.match(/^```\w+$/gm) ?? [];
    const code = BUILD_GUIDE.sections.flatMap((section) => section.codePoints ?? []);
    expect(fences).toEqual(
      code.filter((point) => point.code).map((point) => `\`\`\`${point.lang}`),
    );
    expect(build).toContain(
      "```bash\nclaude mcp add --transport http juicebox https://juicebox.center/mcp\n```",
    );
    expect(build).toContain("](https://juicebox.money/build#apps-set-up-the-sdk)");
  });
});
