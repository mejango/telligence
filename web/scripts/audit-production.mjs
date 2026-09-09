import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const ELLIPTIC_ADVISORY = "https://github.com/advisories/GHSA-848j-6mx2-7j84";
const PARA_PACKAGES = [
  "@getpara/react-component-library",
  "@getpara/react-sdk-lite",
  "@getpara/wagmi-v2-connector",
  "@getpara/web-sdk",
];

// Para is not pinned to a version; it is pinned to a shape. Every Para package
// must move together, and the elliptic usage below must stay exactly the one
// audited under GHSA-848j-6mx2-7j84 (compressing a public key, never signing).
// A bump that keeps both passes; one that changes either fails closed.
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const paraVersions = new Set(
  PARA_PACKAGES.map((dependency) => packageJson.dependencies?.[dependency]),
);
if (paraVersions.size !== 1 || paraVersions.has(undefined)) {
  throw new Error(
    `Para packages must share one exact version; found ${[...paraVersions].join(", ")}.`,
  );
}
const [paraVersion] = paraVersions;
if (!/^\d+\.\d+\.\d+$/.test(paraVersion)) {
  throw new Error(`Para packages must be pinned to an exact version, not ${paraVersion}.`);
}

const paraCoreRoot = resolve(dirname(require.resolve("@getpara/core-sdk")), "../..");
const paraCore = JSON.parse(readFileSync(resolve(paraCoreRoot, "package.json"), "utf8"));
if (paraCore.version !== paraVersion) {
  throw new Error(`@getpara/core-sdk must resolve to ${paraVersion}; found ${paraCore.version}.`);
}

const formattingPath = resolve(paraCoreRoot, "dist/esm/utils/formatting.js");
const formattingSource = readFileSync(formattingPath, "utf8");
if (
  !formattingSource.includes('import elliptic from "elliptic"') ||
  !formattingSource.includes('new elliptic.ec("secp256k1")') ||
  !formattingSource.includes('secp256k1.keyFromPublic(pubkey).getPublic(true, "array")') ||
  (formattingSource.match(/\bsecp256k1\./g)?.length ?? 0) !== 1 ||
  formattingSource.includes(".sign(") ||
  formattingSource.includes("keyFromPrivate")
) {
  throw new Error("Para's elliptic usage changed. Reassess GHSA-848j-6mx2-7j84 before releasing.");
}

if (process.argv.includes("--source-only")) {
  console.log("Para dependency and elliptic usage invariants verified.");
  process.exit(0);
}

const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  env: process.env,
});

const failAudit = (message) => {
  console.error(`Production dependency audit could not be verified: ${message}`);
  process.exit(1);
};

if (result.error) {
  failAudit(`npm audit could not run (${result.error.code ?? result.error.message}).`);
}
if (result.signal) {
  failAudit(`npm audit terminated with signal ${result.signal}.`);
}
// npm uses exit 1 for a completed report with findings. Other exit statuses
// are execution failures, even when stdout happens to contain valid JSON.
if (result.status !== 0 && result.status !== 1) {
  failAudit(`npm audit exited with status ${result.status}.`);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  failAudit("npm audit returned invalid or missing JSON.");
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const severities = ["info", "low", "moderate", "high", "critical"];
if (!isRecord(report) || Object.hasOwn(report, "error")) {
  failAudit("npm audit returned an error response or invalid report.");
}
if (
  report.auditReportVersion !== 2 ||
  !isRecord(report.vulnerabilities) ||
  !isRecord(report.metadata) ||
  !isRecord(report.metadata.vulnerabilities)
) {
  failAudit("npm audit returned an incomplete or unsupported vulnerability report.");
}

const vulnerabilities = report.vulnerabilities;
const findings = Object.entries(vulnerabilities);
const counts = Object.fromEntries(severities.map((severity) => [severity, 0]));
for (const [name, vulnerability] of findings) {
  if (
    !isRecord(vulnerability) ||
    vulnerability.name !== name ||
    !severities.includes(vulnerability.severity) ||
    !Array.isArray(vulnerability.via) ||
    vulnerability.via.length === 0 ||
    !vulnerability.via.every((via) =>
      typeof via === "string"
        ? Object.hasOwn(vulnerabilities, via)
        : isRecord(via) &&
          typeof via.url === "string" &&
          via.url.length > 0 &&
          severities.includes(via.severity),
    )
  ) {
    failAudit(`npm audit returned a malformed finding for ${name}.`);
  }
  counts[vulnerability.severity] += 1;
}
for (const severity of [...severities, "total"]) {
  const count = report.metadata.vulnerabilities[severity];
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count !== (severity === "total" ? findings.length : counts[severity])
  ) {
    failAudit("npm audit returned inconsistent vulnerability counts.");
  }
}
if (result.status === 1 && findings.length === 0) {
  failAudit("npm audit exited unsuccessfully without reporting any findings.");
}

const memo = new Map();
const isScopedEllipticFinding = (name, active = new Set()) => {
  if (memo.has(name)) return memo.get(name);
  if (active.has(name)) return false;

  const vulnerability = vulnerabilities[name];
  if (!vulnerability || vulnerability.severity !== "low") return false;

  const nextActive = new Set(active).add(name);
  const allowed =
    vulnerability.via.length > 0 &&
    vulnerability.via.every((via) =>
      typeof via === "string"
        ? isScopedEllipticFinding(via, nextActive)
        : via.url === ELLIPTIC_ADVISORY && via.severity === "low",
    );
  memo.set(name, allowed);
  return allowed;
};

const unexpected = Object.keys(vulnerabilities).filter((name) => !isScopedEllipticFinding(name));
if (unexpected.length > 0) {
  console.error("Unexpected production vulnerabilities:");
  for (const name of unexpected) {
    console.error(`- ${name}: ${vulnerabilities[name].severity}`);
  }
  process.exit(1);
}

if (Object.keys(vulnerabilities).length === 0) {
  console.log("Production dependency audit passed.");
} else {
  console.warn(
    "Production audit passed with one fail-closed Para exception: elliptic GHSA-848j-6mx2-7j84 has no patched release, and the installed Para code uses elliptic only to compress public keys, never to sign.",
  );
}
