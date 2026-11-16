import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import debt from "./fixtures/copy-marks-debt.json";
import { copyMarks, couldSpellMark, parseSource, sourceFiles } from "./support/source-scan";

/*
 * App copy has no dot separators and no em dashes in its sentences. A lone
 * "—" standing for "no value" is a placeholder, not punctuation, and stays
 * (ruling R111): a string that is exactly "—", or JSX text that trims to it.
 *
 * fixtures/copy-marks-debt.json records how many marks each file held when
 * this check was added. A count may only fall: a file that gains a mark
 * fails, a file whose count fell must be recorded lower, and a file at zero
 * leaves the record. Every file off the record stays clean.
 *
 * The check is lexical: it reads string literals, template text and JSX text
 * in src. Copy assembled at runtime from other strings is not read.
 */

const root = resolve(import.meta.dirname, "..");

/** Every sentence mark in a file, with its line. */
function marks(file: string): string[] {
  const text = readFileSync(file, "utf8");
  // Parse only files that can spell a mark: the suite runs this beside other
  // source scans.
  if (!couldSpellMark(text)) return [];
  const source = parseSource(file, text);
  return copyMarks(source, source, { placeholder: "allowed" }).map(
    ({ line, text: copy }) => `${relative(root, file)}:${line}: ${copy.slice(0, 80)}`,
  );
}

/**
 * How the marks counted now differ from the recorded debt: every file whose
 * count rose (a file off the list counts from zero), and every listed file
 * whose count fell and must be recorded lower.
 */
function compareDebt(counts: Record<string, number>, recorded: Record<string, number>) {
  const rose = Object.entries(counts)
    .filter(([file, count]) => count > (recorded[file] ?? 0))
    .map(([file, count]) => `${file}: ${recorded[file] ?? 0} -> ${count}`);
  const fell = Object.entries(recorded)
    .filter(([file, count]) => (counts[file] ?? 0) < count)
    .map(([file, count]) => `${file}: ${count} -> ${counts[file] ?? 0}`);
  return { rose, fell };
}

describe("the copy-marks debt", () => {
  it("fails a listed file that gains a mark, and a file off the list that has one", () => {
    expect(compareDebt({ "a.tsx": 3, "b.tsx": 1 }, { "a.tsx": 2 }).rose).toEqual([
      "a.tsx: 2 -> 3",
      "b.tsx: 0 -> 1",
    ]);
  });

  it("asks for a lower count when a listed file loses marks, and for no entry at zero", () => {
    expect(compareDebt({ "a.tsx": 1 }, { "a.tsx": 2, "b.tsx": 1 }).fell).toEqual([
      "a.tsx: 2 -> 1",
      "b.tsx: 1 -> 0",
    ]);
  });

  it("passes counts that match the record", () => {
    expect(compareDebt({ "a.tsx": 2 }, { "a.tsx": 2 })).toEqual({ rose: [], fell: [] });
  });
});

describe("copy marks", () => {
  const files = sourceFiles(join(root, "src")).map((file) => ({
    path: relative(root, file),
    marks: marks(file),
  }));
  const counts = Object.fromEntries(
    files.filter(({ marks }) => marks.length > 0).map(({ path, marks }) => [path, marks.length]),
  );
  const recorded: Record<string, number> = debt;
  /** A finding's file, and every mark in it, so a failure shows where to look. */
  const withMarks = (entry: string) => [
    entry,
    ...(files.find(({ path }) => entry.startsWith(`${path}:`))?.marks ?? []),
  ];

  it("reads the app's source", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("adds no mark to any file", () => {
    expect(compareDebt(counts, recorded).rose.flatMap(withMarks)).toEqual([]);
  });

  it("records each fall in the debt, and lists no file at zero", () => {
    expect(compareDebt(counts, recorded).fell).toEqual([]);
    expect(Object.entries(recorded).filter(([, count]) => count <= 0)).toEqual([]);
  });
});
