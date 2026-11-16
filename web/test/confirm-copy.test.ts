import { readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { copyMarks, isTextNode, parseSource, sourceFiles, type Mark } from "./support/source-scan";

/*
 * Confirm copy follows the app's copy rules: no dot separators and no em
 * dashes. This reads every TxProgress element in src, with its props and
 * children, and checks each piece of text it renders: string literals,
 * template text and JSX text.
 *
 * The check is lexical: it reads only text written inside the element. Copy
 * that reaches a confirm through state, a variable or a helper defined
 * elsewhere is not read.
 */

const root = resolve(import.meta.dirname, "..");
const BANNED = [
  { mark: "·", name: "a dot separator" },
  { mark: "—", name: "an em dash" },
] as const;

function isConfirm(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement {
  const tag = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node)
      ? node.tagName
      : null;
  return tag !== null && ts.isIdentifier(tag) && tag.text === "TxProgress";
}

/** Every mark in the text a confirm element renders, with where it sits. */
function confirmMarks(file: string): Array<Mark & { at: string }> {
  const source = parseSource(file);
  const found: Array<Mark & { at: string }> = [];
  const find = (node: ts.Node) => {
    if (isConfirm(node)) {
      // A confirm states every value the user agrees to: a lone "—" fails here too.
      for (const mark of copyMarks(node, source, { placeholder: "refused" })) {
        found.push({ ...mark, at: `${relative(root, file)}:${mark.line}` });
      }
    } else ts.forEachChild(node, find);
  };
  find(source);
  return found;
}

/** How many text nodes the confirms render, so the scan cannot pass by reading none. */
function confirmTextCount(file: string): number {
  const source = parseSource(file);
  let count = 0;
  const visit = (node: ts.Node, inside: boolean) => {
    const confirm = inside || isConfirm(node);
    if (confirm && isTextNode(node)) count += 1;
    ts.forEachChild(node, (child) => visit(child, confirm));
  };
  visit(source, false);
  return count;
}

describe("confirm copy", () => {
  const files = sourceFiles(join(root, "src"), (name) => extname(name) === ".tsx").filter((file) =>
    readFileSync(file, "utf8").includes("<TxProgress"),
  );

  it("reads the confirms it checks", () => {
    expect(files.length).toBeGreaterThan(25);
    expect(files.reduce((total, file) => total + confirmTextCount(file), 0)).toBeGreaterThan(100);
  });

  it.each(BANNED)("has no $name", ({ mark }) => {
    const offenders = files
      .flatMap(confirmMarks)
      .filter((found) => found.mark === mark)
      .map(({ text, at }) => `${at}: ${text}`);
    expect(offenders).toEqual([]);
  });

  it("keeps background-service branding out of visible component copy", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, "src"), (name) => extname(name) === ".tsx")) {
      const source = parseSource(file);
      const visit = (node: ts.Node) => {
        if (isTextNode(node) && /\bRelayr\b/.test(node.text))
          offenders.push(`${relative(root, file)}: ${node.text}`);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
    // Parses every component; the default 10 s timed out under a loaded full run.
  }, 30_000);
});
