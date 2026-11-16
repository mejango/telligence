import { describe, expect, it } from "vitest";
import { copyMarks, couldSpellMark, parseSource } from "./support/source-scan";

// The shared copy scan: every way source can spell a dot separator or an em
// dash, and the two rules for a lone "—".

/** The marks the scan finds in a snippet of source, under a rule. */
function marksIn(code: string, placeholder: "allowed" | "refused" = "allowed") {
  const source = parseSource("snippet.tsx", code);
  return copyMarks(source, source, { placeholder }).map(({ mark }) => mark);
}

describe("the copy scan", () => {
  it.each([
    ["a written em dash", 'const copy = "Paid — thanks";', "—"],
    ["\\u2014", String.raw`const copy = "Paid \u2014 thanks";`, "—"],
    ["\\u{2014}", String.raw`const copy = "Paid \u{2014} thanks";`, "—"],
    ["\\u{2014} in template text", "const copy = `Paid \\u{2014} ${who}`;", "—"],
    ["a written dot separator", 'const copy = "Base · #4";', "·"],
    ["\\u00b7", String.raw`const copy = "Base \u00b7 #4";`, "·"],
    ["\\u{b7}", String.raw`const copy = "Base \u{b7} #4";`, "·"],
    ["\\xB7", String.raw`const copy = "Base \xB7 #4";`, "·"],
    ["&mdash; in JSX text", "const copy = <p>Paid &mdash; thanks</p>;", "—"],
    ["&#8212; in JSX text", "const copy = <p>Paid &#8212; thanks</p>;", "—"],
    ["&#x2014; in JSX text", "const copy = <p>Paid &#x2014; thanks</p>;", "—"],
    ["&middot; in JSX text", "const copy = <p>Base &middot; #4</p>;", "·"],
    ["&centerdot; in JSX text", "const copy = <p>Base &centerdot; #4</p>;", "·"],
    ["&#183; in JSX text", "const copy = <p>Base &#183; #4</p>;", "·"],
    ["&#xB7; in JSX text", "const copy = <p>Base &#xB7; #4</p>;", "·"],
    ["&mdash; in a JSX attribute", 'const copy = <p title="Paid &mdash; thanks" />;', "—"],
  ])("reads a mark spelled as %s", (_, code, mark) => {
    expect(couldSpellMark(code)).toBe(true);
    expect(marksIn(code)).toEqual([mark]);
  });

  it("reads JSX text as written: a JavaScript escape there is not a mark", () => {
    // JSX text and attribute strings take entities, not escapes: this renders the backslash.
    expect(marksIn(String.raw`const copy = <p>Paid \u2014 thanks</p>;`)).toEqual([]);
    expect(marksIn(String.raw`const copy = <p title="Paid \u2014 thanks" />;`)).toEqual([]);
  });

  it.each([
    ['a string that is "—"', 'const amount = value ?? "—";'],
    ['JSX text that trims to "—"', "const cell = <td>\n  —\n</td>;"],
    ["a lone &mdash; in JSX text", "const cell = <td>&mdash;</td>;"],
  ])("lets %s stand for no value in app copy, and refuses it in a confirm", (_, code) => {
    expect(marksIn(code, "allowed")).toEqual([]);
    expect(marksIn(code, "refused")).toEqual(["—"]);
  });

  it("parses a file with no mark, escape or entity in it only when it could spell one", () => {
    expect(couldSpellMark('const copy = "Paid, thanks";')).toBe(false);
    expect(couldSpellMark("const copy = <p>Paid &amp; thanked</p>;")).toBe(true);
    expect(couldSpellMark(String.raw`const pattern = /\x41/;`)).toBe(true);
  });
});
