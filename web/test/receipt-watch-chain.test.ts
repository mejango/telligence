import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./support/source-scan";

/*
 * Core's reviewed run waits for each receipt on the chain it sent to. A site watching a receipt
 * itself through wagmi watches the wallet's current chain unless it names one, so no site does.
 * The check is lexical.
 */

const root = resolve(import.meta.dirname, "..");

describe("receipt watchers", () => {
  it("no site watches a receipt through wagmi", () => {
    const watching = sourceFiles(join(root, "src")).filter((file) =>
      readFileSync(file, "utf8").includes("useWaitForTransactionReceipt"),
    );
    expect(watching).toEqual([]);
  });
});
