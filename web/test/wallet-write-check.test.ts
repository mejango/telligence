import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const marker = "wallet-action:send";
const receiveMarker = "wallet-action:receive";
const sends = `it("${marker} sends", () => {});`;
const receives = `it("${receiveMarker} receives", () => {});`;
let root: string;

function write(file: string, content: string) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

function check(...args: string[]) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts/check-wallet-write-sites.mjs"), ...args],
    { encoding: "utf8" },
  );
}

/**
 * Runs the check over test files with these sources. The `send` action lists test/send.test.ts, the
 * `receive` action lists test/receive.test.ts, and no action lists test/unlisted.test.ts.
 */
function checkTestFiles(files: { send: string; receive?: string; unlisted?: string }) {
  for (const [name, source] of Object.entries({
    send: files.send,
    receive: files.receive ?? receives,
    unlisted: files.unlisted ?? "",
  })) {
    write(`test/${name}.test.ts`, `import { describe, it } from "vitest";\n${source}\n`);
  }
  return check();
}

/** A project with two reviewed writes, one action for each, and the one test file each action lists. */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "revnet-wallet-writes-"));
  for (const script of ["check-wallet-write-sites.mjs", "lib/test-titles.mjs"]) {
    mkdirSync(dirname(join(root, "scripts", script)), { recursive: true });
    cpSync(resolve("scripts", script), join(root, "scripts", script));
  }
  symlinkSync(resolve("node_modules"), join(root, "node_modules"));
  write("TESTING.md", "<!-- wallet-inventory:writes -->\n");
  for (const [file, hook] of [
    ["send", "useSend"],
    ["receive", "useReceive"],
  ]) {
    write(
      `src/${file}.ts`,
      [
        'import { useWriteContract } from "@/hooks/useReviewedWriteContract";',
        `export function ${hook}() {`,
        "  const { writeContractAsync } = useWriteContract();",
        "  return () => writeContractAsync({});",
        "}",
        "",
      ].join("\n"),
    );
  }
  const sites = JSON.parse(check("--print").stdout) as {
    kind: string;
    file: string;
    owner: string;
    callee: string;
    count: number;
  }[];
  write(
    "test/fixtures/wallet-write-sites.json",
    JSON.stringify({
      format: "revnet-wallet-write-sites-1",
      surfaces: [
        {
          id: "writes",
          sites: sites.map(({ kind, file, owner, callee, count }) => [
            kind,
            file,
            owner,
            callee,
            count,
          ]),
        },
      ],
      actions: [
        { id: "send", risk: "money", files: ["src/send.ts"], tests: ["test/send.test.ts"] },
        {
          id: "receive",
          risk: "money",
          files: ["src/receive.ts"],
          tests: ["test/receive.test.ts"],
        },
      ],
    }),
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the wallet-write check counts an action's marker only in the title of a test that runs", () => {
  it("counts a marker in the title of a test that runs", () => {
    const result = checkTestFiles({ send: `describe("send", () => { ${sends} });` });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified");
  });

  it.each([
    ["a comment", `// ${marker}\nit("sends", () => {});`],
    ["a string", `const note = "${marker}";\nit("sends", () => {});`],
    ["a describe title", `describe("${marker}", () => { it("sends", () => {}); });`],
    ["a skipped test", `it.skip("${marker} sends", () => {});`],
    ["a test whose options skip it", `it("${marker} sends", { skip: true }, () => {});`],
    ["dead code", `if (Date.now() < 0) { it("${marker} sends", () => {}); }`],
  ])("refuses a marker in %s", (_, source) => {
    const result = checkTestFiles({ send: source });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `needs the marker ${marker} in the title of a test in test/send.test.ts that runs and proves it (see TESTING.md)`,
    );
  });
});

describe("the wallet-write check reads an action's own listed test file", () => {
  const refusal = `Wallet-write action receive needs the marker ${receiveMarker} in the title of a test in test/receive.test.ts that runs and proves it (see TESTING.md)`;

  it("does not count a marker that another action's test file carries", () => {
    const result = checkTestFiles({
      send: `${sends}\n${receives}`,
      receive: `it("receives", () => {});`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(refusal);
  });

  it("does not count a marker that a test file no action lists carries", () => {
    const result = checkTestFiles({
      send: sends,
      receive: `it("receives", () => {});`,
      unlisted: receives,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(refusal);
  });
});
