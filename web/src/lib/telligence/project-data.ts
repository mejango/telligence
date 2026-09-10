import type { ProjectSnapshot } from "./types";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const zeroAddress = /^0x0{40}$/;
const dollarPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;
const projectStates = new Set(["accumulating", "active", "winddown", "closed", "suspended"]);
const capacityStates = new Set(["provisioning", "ready", "exhausted", "stale", "suspended"]);

/** Gate untrusted API data before rendering identity, money, or onchain links. */
export function parseProjectSnapshot(value: unknown): ProjectSnapshot {
  if (!value || typeof value !== "object") throw new Error("The project response is invalid.");
  const project = value as Record<string, unknown>;
  const capacity = project.capacity as Record<string, unknown> | undefined;
  const targetDailyCreditUsd = project.targetDailyCreditUsd ?? null;
  if (
    typeof project.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(project.id) ||
    project.chainId !== 8453 ||
    typeof project.revnetId !== "string" ||
    !/^[1-9]\d{0,77}$/.test(project.revnetId) ||
    BigInt(project.revnetId) >= 2n ** 256n ||
    !["wrapperAddress", "vaultAddress", "creatorAddress"].every(
      (key) =>
        typeof project[key] === "string" &&
        addressPattern.test(project[key] as string) &&
        !zeroAddress.test(project[key] as string),
    ) ||
    !["name", "purpose", "workload", "policyVersion", "createdAt"].every(
      (key) => typeof project[key] === "string",
    ) ||
    !(project.name as string).trim() ||
    (project.name as string).length > 80 ||
    (project.purpose as string).length > 4000 ||
    (project.workload as string).length > 1000 ||
    (targetDailyCreditUsd !== null &&
      (typeof targetDailyCreditUsd !== "string" ||
        !dollarPattern.test(targetDailyCreditUsd) ||
        Number(targetDailyCreditUsd) <= 0)) ||
    (project.policyVersion as string).length > 100 ||
    !Number.isFinite(Date.parse(project.createdAt as string)) ||
    !projectStates.has(project.status as string) ||
    !capacity ||
    !capacityStates.has(capacity.status as string) ||
    typeof capacity.dailyCreditUsd !== "string" ||
    typeof capacity.remainingCreditUsd !== "string" ||
    !(capacity.observedAt === null || typeof capacity.observedAt === "string")
  )
    throw new Error(
      "The project response is invalid. No balance or transaction is being inferred.",
    );
  return { ...project, targetDailyCreditUsd } as ProjectSnapshot;
}

export function parseProjectsResponse(value: unknown) {
  const projects = (value as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(projects) || projects.length > 1000)
    throw new Error("The project index returned an invalid response.");
  const parsed = projects.map(parseProjectSnapshot);
  if (new Set(parsed.map((project) => project.id)).size !== parsed.length)
    throw new Error("The project index returned duplicate project identities.");
  return parsed;
}

export function parseProjectResponse(value: unknown, expectedId?: string) {
  const project = parseProjectSnapshot((value as { project?: unknown } | null)?.project);
  if (expectedId !== undefined && project.id !== expectedId)
    throw new Error("The response does not match the requested project.");
  return project;
}

/**
 * The gateway's own public API origin for bearer-key traffic, from `GET /v1/config`.
 * Null when it is missing or not a plain absolute https URL; never a site-relative path.
 */
export function parseApiBaseUrl(value: unknown): string | null {
  const raw = (value as { apiBaseUrl?: unknown } | null)?.apiBaseUrl;
  if (typeof raw !== "string" || raw.length > 2048 || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    raw.includes("?") ||
    raw.includes("#") ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  )
    return null;
  return url.href.replace(/\/$/, "");
}
