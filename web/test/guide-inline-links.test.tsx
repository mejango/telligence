import { Inline } from "@/components/guides/RevnetGuide";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const html = (text: string) => renderToStaticMarkup(createElement(Inline, { text }));

describe("guide inline links", () => {
  it("renders [label](href) as a link and leaves other text alone", () => {
    expect(html("Use the [launch form](/create) first.")).toMatch(
      /^Use the <a href="\/create"[^>]*>launch form<\/a> first\.$/,
    );
    expect(html("Plain [brackets] and (parens).")).toBe("Plain [brackets] and (parens).");
  });

  it("points every in-page link at a section or alias that exists", () => {
    for (const page of ["src/lib/build-guide.ts", "src/lib/learn-guide.ts"]) {
      const source = readFileSync(page, "utf8");
      const ids = new Set(
        [
          ...source.matchAll(/\bid: "([^"]+)"/g),
          ...source.matchAll(/aliases: \[([^\]]*)\]/g),
        ].flatMap((m) =>
          m[0].startsWith("id") ? [m[1]] : [...m[1].matchAll(/"([^"]+)"/g)].map((a) => a[1]),
        ),
      );
      const missing = [...source.matchAll(/\]\(#([^)]+)\)/g)]
        .map((m) => m[1])
        .filter((id) => !ids.has(id));
      expect(missing, page).toEqual([]);
    }
  });
});
