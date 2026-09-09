import { afterEach, describe, expect, it, vi } from "vitest";

const originalMainnetUrl = process.env.NEXT_PUBLIC_BENDYSTRAW_URL;
const originalTestnetUrl = process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL;

afterEach(() => {
  if (originalMainnetUrl === undefined) {
    delete process.env.NEXT_PUBLIC_BENDYSTRAW_URL;
  } else {
    process.env.NEXT_PUBLIC_BENDYSTRAW_URL = originalMainnetUrl;
  }
  if (originalTestnetUrl === undefined) {
    delete process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL;
  } else {
    process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL = originalTestnetUrl;
  }
  vi.resetModules();
});

describe("Bendystraw URL configuration", () => {
  it("uses the public read-only indexers when local environment values are absent", async () => {
    delete process.env.NEXT_PUBLIC_BENDYSTRAW_URL;
    delete process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL;
    vi.resetModules();

    const { getBendystrawUrl } = await import("@/graphql/constants");

    expect(getBendystrawUrl(1)).toBe("https://bendystraw.up.railway.app/graphql");
    expect(getBendystrawUrl(11155111)).toBe("https://testnet.bendystraw.xyz/graphql");
  });

  it("preserves explicit deployment overrides", async () => {
    process.env.NEXT_PUBLIC_BENDYSTRAW_URL = "https://mainnet-indexer.example";
    process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL = "https://testnet-indexer.example/";
    vi.resetModules();

    const { getBendystrawUrl } = await import("@/graphql/constants");

    expect(getBendystrawUrl(8453)).toBe("https://mainnet-indexer.example/graphql");
    expect(getBendystrawUrl(84532)).toBe("https://testnet-indexer.example/graphql");
  });

  it("normalizes GraphQL paths and removes query strings", async () => {
    process.env.NEXT_PUBLIC_BENDYSTRAW_URL = "https://mainnet-indexer.example/graphql/?key=ignored";
    vi.resetModules();

    const { getBendystrawUrl } = await import("@/graphql/constants");

    expect(getBendystrawUrl(1)).toBe("https://mainnet-indexer.example/graphql");
  });
});
