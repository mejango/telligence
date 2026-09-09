import { PermissionHoldersOperation } from "@/lib/bendystraw/operations";
import { projectRefsWhere } from "@/lib/bendystraw/projectRefs";
import { BENDYSTRAW_QUERY_REGISTRY } from "@/lib/bendystraw/registry.server";
import {
  buildClientSchema,
  getIntrospectionQuery,
  parse,
  validate,
  type IntrospectionQuery,
} from "graphql";
import { describe, expect, it } from "vitest";

// Capture Node's real fetch before the deterministic unit-test setup installs
// its network guard. This file is intentionally the one live contract test.
const contractFetch = globalThis.fetch.bind(globalThis);

const ENDPOINTS = [
  process.env.BENDYSTRAW_SCHEMA_MAINNET_URL ?? "https://bendystraw.up.railway.app/graphql",
  process.env.BENDYSTRAW_SCHEMA_TESTNET_URL ?? "https://testnet.bendystraw.xyz/graphql",
];

async function liveSchema(endpoint: string) {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/graphql\/?$/u, "").replace(/\/$/u, "")}/graphql`;
  url.search = "";
  url.hash = "";

  const response = await contractFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "IntrospectionQuery",
      query: getIntrospectionQuery({ descriptions: false }),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  expect(response.ok, `${url.origin} schema request returned ${response.status}`).toBe(true);
  const envelope = (await response.json()) as {
    data?: IntrospectionQuery;
    errors?: Array<{ message?: string }>;
  };
  expect(envelope.errors, `${url.origin} rejected schema introspection`).toBeUndefined();
  expect(envelope.data, `${url.origin} returned no schema`).toBeDefined();
  return buildClientSchema(envelope.data!);
}

// Fields an unmerged indexer PR adds. An entry is only admissible while the client
// tolerates the field being absent from the schema, and can be scoped to one endpoint
// while a rollout is in flight. The contract FAILS as soon as that endpoint serves the
// field, so exceptions cannot quietly rot after the rollout lands there. Empty means
// every registered document is validated against both live schemas.
const PENDING_SCHEMA_FIELDS: Array<{ field: string; endpoint: string; reason: string }> = [];

describe("live Bendystraw schema contract", () => {
  it.each(ENDPOINTS)(
    "validates every registered document against %s",
    async (endpoint) => {
      const schema = await liveSchema(endpoint);
      const failures = Object.entries(BENDYSTRAW_QUERY_REGISTRY).flatMap(([id, registered]) =>
        validate(schema, parse(registered.query)).map((error) => `${id}: ${error.message}`),
      );

      const pending = PENDING_SCHEMA_FIELDS.filter((entry) => entry.endpoint === endpoint);
      // Shipped = the field no longer fails validation. Checking the root-query field set
      // instead would never fire for a NESTED field, letting an entry outlive the indexer PR
      // it names — the one thing this list must not do.
      const shipped = pending.filter(
        ({ field }) => !failures.some((failure) => failure.includes(`\"${field}\"`)),
      );
      expect(
        shipped.map(({ field }) => field),
        "drop these from PENDING_SCHEMA_FIELDS — the endpoint serves them now",
      ).toEqual([]);

      const blocking = failures.filter(
        (failure) => !pending.some(({ field }) => failure.includes(`\"${field}\"`)),
      );
      expect(blocking).toEqual([]);
    },
    30_000,
  );

  it("keeps an exact project-pair filter scoped to Artizen", async () => {
    const endpoint = ENDPOINTS[0];
    const registered = BENDYSTRAW_QUERY_REGISTRY[PermissionHoldersOperation.id];
    const response = await contractFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationName: registered.operationName,
        query: registered.query,
        variables: {
          where: projectRefsWhere([{ chainId: 8453, projectId: 6, version: 6 }]),
          limit: 100,
          offset: 0,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    expect(response.ok).toBe(true);
    const envelope = (await response.json()) as {
      data?: {
        permissionHolders?: {
          items?: Array<{ chainId: number; projectId: number; version: number }>;
        } | null;
      };
      errors?: Array<{ message?: string }>;
    };
    expect(envelope.errors).toBeUndefined();
    const items = envelope.data?.permissionHolders?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.chainId === 8453)).toBe(true);
    expect(items.every((item) => item.projectId === 6)).toBe(true);
    expect(items.every((item) => item.version === 6)).toBe(true);
  }, 30_000);
});
