import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptSource = readFileSync(resolve(process.cwd(), "scripts/audit-production.mjs"), "utf8");
const advisoryUrl = "https://github.com/advisories/GHSA-848j-6mx2-7j84";
const severities = ["info", "low", "moderate", "high", "critical"];
const directories: string[] = [];
type Finding = {
  name: string;
  severity: string;
  via: unknown[];
};

function report(vulnerabilities: Record<string, Finding> = {}) {
  const counts: Record<string, number> = Object.fromEntries(
    severities.map((severity) => [severity, 0]),
  );
  for (const finding of Object.values(vulnerabilities)) counts[finding.severity] += 1;
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: { ...counts, total: Object.keys(vulnerabilities).length },
      dependencies: { prod: 1, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 },
    },
  };
}

function elliptic(severity = "low", url = advisoryUrl): Finding {
  return { name: "elliptic", severity, via: [{ source: 1, name: "elliptic", severity, url }] };
}

function fixture({ npmAvailable = true, unsafePara = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "revnet-production-audit-"));
  directories.push(directory);
  const write = (file: string, contents: string, mode?: number) => {
    const path = join(directory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, { mode });
  };
  write("audit-production.mjs", scriptSource);
  write(
    "package.json",
    JSON.stringify({
      dependencies: Object.fromEntries(
        [
          "@getpara/react-component-library",
          "@getpara/react-sdk-lite",
          "@getpara/wagmi-v2-connector",
          "@getpara/web-sdk",
        ].map((name) => [name, "3.15.0"]),
      ),
    }),
  );
  write(
    "node_modules/@getpara/core-sdk/package.json",
    JSON.stringify({ name: "@getpara/core-sdk", version: "3.15.0", main: "dist/cjs/index.js" }),
  );
  write("node_modules/@getpara/core-sdk/dist/cjs/index.js", "");
  write(
    "node_modules/@getpara/core-sdk/dist/esm/utils/formatting.js",
    `import elliptic from "elliptic";
const secp256k1 = new elliptic.ec("secp256k1");
secp256k1.keyFromPublic(pubkey).getPublic(true, "array");
${unsafePara ? "secp256k1.sign(message);" : ""}`,
  );
  const binDirectory = join(directory, "bin");
  mkdirSync(binDirectory);
  const calledPath = join(directory, "npm-called.json");
  if (npmAvailable) {
    // PATH contains only this local stub. Neither the production checker nor
    // any failure path in these tests can invoke the real npm audit client.
    write(
      "bin/npm",
      `#!${process.execPath}
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.AUDIT_STUB_CALLED, JSON.stringify(process.argv.slice(2)));
process.stdout.write(process.env.AUDIT_STUB_STDOUT || "");
process.stderr.write(process.env.AUDIT_STUB_STDERR || "");
if (process.env.AUDIT_STUB_SIGNAL) {
  process.kill(process.pid, process.env.AUDIT_STUB_SIGNAL);
  setTimeout(() => process.exit(99), 1000);
} else {
  process.exit(Number(process.env.AUDIT_STUB_STATUS || 0));
}
`,
      0o755,
    );
  }
  return {
    calledPath,
    run: ({
      output = JSON.stringify(report()),
      status = 0,
      signal = "",
      sourceOnly = false,
    }: {
      output?: string;
      status?: number;
      signal?: string;
      sourceOnly?: boolean;
    } = {}) => {
      const result = spawnSync(
        process.execPath,
        [join(directory, "audit-production.mjs"), ...(sourceOnly ? ["--source-only"] : [])],
        {
          cwd: directory,
          env: {
            ...process.env,
            PATH: binDirectory,
            AUDIT_STUB_CALLED: calledPath,
            AUDIT_STUB_STDOUT: output,
            AUDIT_STUB_STATUS: String(status),
            AUDIT_STUB_SIGNAL: signal,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("production audit runner fails closed", () => {
  it("accepts a complete clean report and invokes only the local npm stub with production audit arguments", () => {
    const build = fixture();
    const result = build.run();
    expect(result.status).toBe(0);
    expect(result.output).toContain("Production dependency audit passed.");
    expect(JSON.parse(readFileSync(build.calledPath, "utf8"))).toEqual([
      "audit",
      "--omit=dev",
      "--json",
    ]);
  });

  it.each([0, 1])(
    "accepts the exact low elliptic advisory and its dependency graph with npm status %s",
    (status) => {
      const result = fixture().run({
        status,
        output: JSON.stringify(
          report({
            elliptic: elliptic(),
            "@getpara/core-sdk": { name: "@getpara/core-sdk", severity: "low", via: ["elliptic"] },
          }),
        ),
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain("one fail-closed Para exception");
    },
  );

  it.each([0, 1])("rejects an npm error payload with process status %s", (status) => {
    const result = fixture().run({
      status,
      output: JSON.stringify({ error: { code: "EAUDITNOLOCK", summary: "Audit failed" } }),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("error response");
    expect(result.output).not.toContain("audit passed");
  });

  it("rejects an error field even alongside an otherwise valid clean report", () => {
    const result = fixture().run({ output: JSON.stringify({ ...report(), error: null }) });
    expect(result.status).toBe(1);
    expect(result.output).toContain("error response");
  });

  it.each(["", "not JSON", "null", "[]", "{}", '{"vulnerabilities":{}}'])(
    "rejects missing or incomplete report case %#",
    (output) => {
      const result = fixture().run({ output });
      expect(result.status).toBe(1);
      expect(result.output).toContain("could not be verified");
      expect(result.output).not.toContain("audit passed");
    },
  );

  it.each([
    { auditReportVersion: 1 },
    { vulnerabilities: null },
    { vulnerabilities: [] },
    { metadata: {} },
    { metadata: { vulnerabilities: [] } },
  ])("rejects malformed report structure case %#", (change) => {
    const result = fixture().run({ output: JSON.stringify({ ...report(), ...change }) });
    expect(result.status).toBe(1);
    expect(result.output).toContain("incomplete or unsupported");
  });

  it.each([
    { name: "other" },
    { severity: "unknown" },
    { via: null },
    { via: [] },
    { via: [null] },
    { via: [{}] },
    { via: ["missing-package"] },
  ])("rejects malformed vulnerability entries case %#", (change) => {
    const result = fixture().run({
      output: JSON.stringify(report({ elliptic: { ...elliptic(), ...change } as Finding })),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("malformed finding");
  });

  it.each([{ total: 1 }, { low: 1 }, { low: -1 }, { low: "0" }, { low: 0.5 }])(
    "rejects inconsistent or invalid vulnerability totals case %#",
    (change) => {
      const audit = report();
      const result = fixture().run({
        output: JSON.stringify({
          ...audit,
          metadata: { vulnerabilities: { ...audit.metadata.vulnerabilities, ...change } },
        }),
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("inconsistent vulnerability counts");
    },
  );

  it("rejects a findings exit status without any reported findings", () => {
    const result = fixture().run({ status: 1 });
    expect(result.status).toBe(1);
    expect(result.output).toContain("without reporting any findings");
  });

  it.each([2, 127])(
    "rejects abnormal npm exit %s even when stdout is a valid clean report",
    (status) => {
      const result = fixture().run({ status });
      expect(result.status).toBe(1);
      expect(result.output).toContain(`npm audit exited with status ${status}`);
    },
  );

  it("rejects a terminated npm process even after valid JSON was written", () => {
    const result = fixture().run({ signal: "SIGTERM" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("terminated with signal SIGTERM");
  });

  it("rejects a failed spawn without falling back to the real npm executable", () => {
    const result = fixture({ npmAvailable: false }).run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("npm audit could not run (ENOENT)");
  });

  it.each([
    elliptic("moderate"),
    elliptic("low", "https://github.com/advisories/GHSA-unexpected"),
    {
      ...elliptic(),
      via: [
        ...elliptic().via,
        { severity: "low", url: "https://github.com/advisories/GHSA-other" },
      ],
    },
  ])("rejects findings outside the existing elliptic exception case %#", (finding) => {
    const result = fixture().run({
      status: 1,
      output: JSON.stringify(report({ elliptic: finding })),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Unexpected production vulnerabilities");
  });

  it("rejects cyclic dependency findings that never reach the scoped advisory", () => {
    const result = fixture().run({
      status: 1,
      output: JSON.stringify(
        report({
          one: { name: "one", severity: "low", via: ["two"] },
          two: { name: "two", severity: "low", via: ["one"] },
        }),
      ),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Unexpected production vulnerabilities");
  });

  it("keeps source-only validation offline and skips npm entirely", () => {
    const build = fixture({ npmAvailable: false });
    const result = build.run({ sourceOnly: true });
    expect(result.status).toBe(0);
    expect(result.output).toContain("Para dependency and elliptic usage invariants verified.");
    expect(existsSync(build.calledPath)).toBe(false);
  });

  it("still rejects changed Para signing usage before invoking npm", () => {
    const build = fixture({ unsafePara: true });
    const result = build.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("Para's elliptic usage changed");
    expect(existsSync(build.calledPath)).toBe(false);
  });
});
