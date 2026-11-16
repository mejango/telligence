import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptSource = readFileSync(resolve(process.cwd(), "scripts/audit-production.mjs"), "utf8");
const advisoryUrl = "https://github.com/advisories/GHSA-848j-6mx2-7j84";
const nodeForgeAdvisoryUrl = "https://github.com/advisories/GHSA-86w9-cpqp-85rv";
const severities = ["info", "low", "moderate", "high", "critical"];
// The installed Para files that import node-forge, copied into each fixture so
// the source check reads Para's real code.
const paraForgeFiles = [
  "core-sdk/dist/cjs/ParaCore.js",
  "core-sdk/dist/esm/ParaCore.js",
  "core-sdk/dist/cjs/cryptography/utils.js",
  "core-sdk/dist/esm/cryptography/utils.js",
  "core-sdk/dist/cjs/shares/KeyContainer.js",
  "core-sdk/dist/esm/shares/KeyContainer.js",
  "web-sdk/dist/cryptography/webAuth.js",
];
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

function nodeForge(severity = "high", url = nodeForgeAdvisoryUrl): Finding {
  return { name: "node-forge", severity, via: [{ source: 2, name: "node-forge", severity, url }] };
}

/** The production findings npm reports for Para 3.15.0: elliptic and node-forge, reached only through Para. */
function paraFindings(): Record<string, Finding> {
  const dependent = (name: string, severity: string, via: string[]) => ({ name, severity, via });
  return Object.fromEntries(
    [
      elliptic(),
      nodeForge(),
      dependent("@ethersproject/signing-key", "low", ["elliptic"]),
      dependent("@ethersproject/transactions", "low", ["@ethersproject/signing-key"]),
      dependent("@ethersproject/abstract-provider", "low", ["@ethersproject/transactions"]),
      dependent("@ethersproject/abstract-signer", "low", ["@ethersproject/abstract-provider"]),
      dependent("@ethersproject/hash", "low", ["@ethersproject/abstract-signer"]),
      dependent("@ethersproject/abi", "low", ["@ethersproject/hash"]),
      dependent("web3-eth-abi", "low", ["@ethersproject/abi"]),
      dependent("@celo/utils", "low", ["web3-eth-abi"]),
      dependent("@getpara/core-sdk", "high", ["@celo/utils", "elliptic", "node-forge"]),
      dependent("@getpara/web-sdk", "high", ["@getpara/core-sdk", "node-forge"]),
      dependent("@getpara/react-common", "high", ["@getpara/web-sdk"]),
      dependent("@getpara/react-core", "low", ["@getpara/core-sdk"]),
      dependent("@getpara/react-sdk-lite", "high", [
        "@getpara/react-common",
        "@getpara/react-core",
        "@getpara/web-sdk",
      ]),
      dependent("@getpara/viem-v2-integration", "low", ["@getpara/core-sdk"]),
      dependent("@getpara/wagmi-v2-connector", "high", [
        "@getpara/viem-v2-integration",
        "@getpara/web-sdk",
      ]),
    ].map((finding) => [finding.name, finding]),
  );
}

function fixture({
  npmAvailable = true,
  unsafePara = false,
  paraCode = {},
  lockfilePackages = {},
}: {
  npmAvailable?: boolean;
  unsafePara?: boolean;
  paraCode?: Record<string, string>;
  lockfilePackages?: Record<string, unknown>;
} = {}) {
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
  for (const file of paraForgeFiles) {
    write(
      `node_modules/@getpara/${file}`,
      readFileSync(resolve(process.cwd(), "node_modules/@getpara", file), "utf8"),
    );
  }
  for (const [file, code] of Object.entries(paraCode)) {
    const path = join(directory, "node_modules/@getpara", file);
    write(
      `node_modules/@getpara/${file}`,
      (existsSync(path) ? readFileSync(path, "utf8") : "") + code,
    );
  }
  write(
    "package-lock.json",
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/@getpara/core-sdk": {
          version: "3.15.0",
          dependencies: { "node-forge": "^1.4.0" },
        },
        "node_modules/@getpara/web-sdk": {
          version: "3.15.0",
          dependencies: { "@getpara/core-sdk": "3.15.0", "node-forge": "^1.4.0" },
        },
        "node_modules/node-forge": { version: "1.4.0" },
        ...lockfilePackages,
      },
    }),
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
const { existsSync, writeFileSync } = require("node:fs");
writeFileSync(process.env.AUDIT_STUB_CALLED, JSON.stringify(process.argv.slice(2)));
const seen = process.env.AUDIT_STUB_CALLED + ".seen";
const first = process.env.AUDIT_STUB_FIRST_STDOUT && !existsSync(seen);
if (first) writeFileSync(seen, "");
process.stdout.write(first ? process.env.AUDIT_STUB_FIRST_STDOUT : process.env.AUDIT_STUB_STDOUT || "");
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
      firstOutput = "",
    }: {
      output?: string;
      status?: number;
      signal?: string;
      sourceOnly?: boolean;
      firstOutput?: string;
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
            AUDIT_STUB_FIRST_STDOUT: firstOutput,
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
      expect(result.output).toContain("fail-closed exceptions");
      expect(result.output).toContain("GHSA-848j-6mx2-7j84");
      expect(result.output).not.toContain("GHSA-86w9-cpqp-85rv");
    },
  );

  it.each([0, 1])(
    "accepts the elliptic and node-forge advisories reached only through Para with npm status %s",
    (status) => {
      const result = fixture().run({ status, output: JSON.stringify(report(paraFindings())) });
      expect(result.status).toBe(0);
      expect(result.output).toContain("GHSA-848j-6mx2-7j84");
      expect(result.output).toContain("GHSA-86w9-cpqp-85rv");
    },
  );

  it("still rejects an unknown advisory alongside the Para exceptions, and names only it", () => {
    const result = fixture().run({
      status: 1,
      output: JSON.stringify(
        report({
          ...paraFindings(),
          "source-map-js": {
            name: "source-map-js",
            severity: "high",
            via: [
              {
                source: 3,
                name: "source-map-js",
                severity: "high",
                url: "https://github.com/advisories/GHSA-68fv-2mgg-jv7q",
              },
            ],
          },
        }),
      ),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Unexpected production vulnerabilities");
    expect(result.output).toContain("source-map-js: high");
    expect(result.output).not.toContain("@getpara");
    expect(result.output).not.toContain("audit passed");
  });

  it.each([
    ["node-forge advisory at another severity", nodeForge("critical")],
    [
      "second advisory on node-forge",
      {
        ...nodeForge(),
        via: [
          ...nodeForge().via,
          { severity: "high", url: "https://github.com/advisories/GHSA-0000-0000-0000" },
        ],
      },
    ],
    [
      "Para package rated above the advisories it reaches",
      {
        name: "@getpara/core-sdk",
        severity: "critical",
        via: ["@celo/utils", "elliptic", "node-forge"],
      },
    ],
    [
      "elliptic chain package rated at the node-forge severity",
      { name: "@celo/utils", severity: "high", via: ["web3-eth-abi"] },
    ],
  ])("rejects a %s", (_name, finding) => {
    const result = fixture().run({
      status: 1,
      output: JSON.stringify(report({ ...paraFindings(), [finding.name]: finding })),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Unexpected production vulnerabilities");
    expect(result.output).toContain(`- ${finding.name}: `);
  });

  // npm rates some dependents below what they reach: @getpara/react-core is low although it reaches node-forge.
  it("accepts a Para package rated below the only advisory it reaches", () => {
    const result = fixture().run({
      status: 1,
      output: JSON.stringify(
        report({
          "node-forge": nodeForge(),
          "@getpara/web-sdk": { name: "@getpara/web-sdk", severity: "low", via: ["node-forge"] },
        }),
      ),
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("GHSA-86w9-cpqp-85rv");
  });

  it.each([0, 1])("rejects an npm error payload with process status %s", (status) => {
    const result = fixture().run({
      status,
      output: JSON.stringify({ error: { code: "EAUDITNOLOCK", summary: "Audit failed" } }),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("error response");
    expect(result.output).not.toContain("audit passed");
  });

  it("asks again after an error report and passes when the second report is complete", () => {
    const result = fixture().run({
      firstOutput: JSON.stringify({ error: { code: "E503", summary: "Service unavailable" } }),
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("Production dependency audit passed.");
  });

  it("does not retry an error field that sits beside a report", () => {
    const result = fixture().run({
      firstOutput: JSON.stringify({ ...report(), error: null }),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("error response");
  });

  it("stops after one more attempt when the error report repeats", () => {
    const result = fixture().run({
      firstOutput: JSON.stringify({ error: { code: "E503" } }),
      output: JSON.stringify({ error: { code: "E503" } }),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("error response");
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
    expect(result.output).toContain(
      "Para dependency, elliptic and node-forge usage invariants verified.",
    );
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

describe("Para's audited node-forge usage", () => {
  it.each([
    [
      "a verify call on any Para object",
      "react-common/dist/check.js",
      "export const check = (key, digest, signature) => key.verify(digest, signature);\n",
    ],
    [
      "a node-forge API outside the audited set",
      "core-sdk/dist/esm/cryptography/utils.js",
      "forge.pki.verifyCertificateChain(caStore, chain);\n",
    ],
    [
      "the same API change in the CommonJS build",
      "core-sdk/dist/cjs/cryptography/utils.js",
      "import_node_forge.default.pki.certificateFromPem(pem);\n",
    ],
    [
      "a second use of an aliased forge module",
      "core-sdk/dist/esm/ParaCore.js",
      "const certificates = pki.createCaStore();\n",
    ],
    [
      "the forge module passed on whole",
      "web-sdk/dist/cryptography/webAuth.js",
      "export const library = forge;\n",
    ],
    [
      "another Para file importing node-forge",
      "web-sdk/dist/cryptography/random.js",
      'import forge from "node-forge";\nexport const bytes = forge.random.getBytesSync(16);\n',
    ],
  ])("fails closed on %s, before npm runs", (_name, file, code) => {
    const build = fixture({ paraCode: { [file]: code } });
    const result = build.run({ status: 1, output: JSON.stringify(report(paraFindings())) });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Reassess GHSA-86w9-cpqp-85rv");
    expect(result.output).toContain(file);
    expect(existsSync(build.calledPath)).toBe(false);
  });

  it("fails closed when a production package outside Para depends on node-forge", () => {
    const build = fixture({
      lockfilePackages: {
        "node_modules/certificate-checker": {
          version: "1.0.0",
          dependencies: { "node-forge": "^1.4.0" },
        },
      },
    });
    const result = build.run({ sourceOnly: true });
    expect(result.status).toBe(1);
    expect(result.output).toContain("node_modules/certificate-checker");
    expect(result.output).toContain("Reassess GHSA-86w9-cpqp-85rv");
  });

  it("ignores a development-only package that depends on node-forge", () => {
    const build = fixture({
      lockfilePackages: {
        "node_modules/self-signed-dev-server": {
          version: "1.0.0",
          dev: true,
          dependencies: { "node-forge": "^1.4.0" },
        },
      },
    });
    const result = build.run({ sourceOnly: true });
    expect(result.status).toBe(0);
    expect(result.output).toContain("node-forge usage invariants verified");
  });
});

describe("zod GHSA-mrhx-c7xc-m3w5 exception", () => {
  const zodUrl = "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5";
  const zodNodes = ["node_modules/zod", "node_modules/@reown/appkit-wallet/node_modules/zod"];
  const lockfilePackages = {
    "node_modules/@coinbase/cdp-sdk": { version: "1.57.1", dependencies: { zod: "^3.25.76" } },
    "node_modules/@reown/appkit-wallet": { version: "1.8.19", dependencies: { zod: "3.22.4" } },
    "node_modules/zod": { version: "3.25.76" },
    "node_modules/@reown/appkit-wallet/node_modules/zod": { version: "3.22.4" },
  };
  const zod = (nodes: string[] | null = zodNodes, severity = "high") => ({
    name: "zod",
    severity,
    ...(nodes ? { nodes } : {}),
    via: [{ source: 3, name: "zod", severity, url: zodUrl }],
  });
  const dependent = (name: string, via: string[]) => ({ name, severity: "high", via });
  const findings = (zodFinding = zod()) => ({
    zod: zodFinding,
    "@reown/appkit-wallet": dependent("@reown/appkit-wallet", ["zod"]),
    "@reown/appkit": dependent("@reown/appkit", ["@reown/appkit-wallet"]),
    "@coinbase/cdp-sdk": dependent("@coinbase/cdp-sdk", ["zod"]),
  });

  it("accepts zod reached only through @reown/appkit-wallet and @coinbase/cdp-sdk", () => {
    const result = fixture({ lockfilePackages }).run({
      status: 1,
      output: JSON.stringify(report(findings())),
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("GHSA-mrhx-c7xc-m3w5");
  });

  it("rejects a zod copy another production package depends on", () => {
    const result = fixture({
      lockfilePackages: {
        ...lockfilePackages,
        "node_modules/some-wallet-sdk": { version: "1.29.0", dependencies: { zod: "^3.22.4" } },
      },
    }).run({ status: 1, output: JSON.stringify(report(findings())) });
    expect(result.status).toBe(1);
    expect(result.output).toContain("zod: high");
  });

  it("accepts a copy that only a development package or an optional peer reaches", () => {
    const result = fixture({
      lockfilePackages: {
        ...lockfilePackages,
        "node_modules/knip": { version: "6.0.0", dev: true, dependencies: { zod: "^3.0.0" } },
        "node_modules/abitype": {
          version: "1.2.4",
          peerDependencies: { zod: "^3.22.0" },
          peerDependenciesMeta: { zod: { optional: true } },
        },
      },
    }).run({ status: 1, output: JSON.stringify(report(findings())) });
    expect(result.status).toBe(0);
  });

  it.each([
    ["reports no installed copy", zod(null)],
    [
      "reports a copy the lockfile has no dependent for",
      zod(["node_modules/orphan/node_modules/zod"]),
    ],
    ["is rated at another severity", zod(zodNodes, "critical")],
  ])("rejects a zod finding that %s", (_name, finding) => {
    const result = fixture({ lockfilePackages }).run({
      status: 1,
      output: JSON.stringify(report(findings(finding))),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Unexpected production vulnerabilities");
  });
});
