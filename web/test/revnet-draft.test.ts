import { parseRevnetDraft, revnetDraftFileName } from "@/lib/revnet-draft";
import { describe, expect, it } from "vitest";

describe("Revnet browser drafts", () => {
  it("imports the native wrapper into whitelisted create-form values", () => {
    const parsed = parseRevnetDraft(
      JSON.stringify({
        v: 1,
        app: "revnet.money",
        data: {
          name: "A revnet",
          description: "A durable network",
          tokenSymbol: "REV",
          reserveAsset: "USDC",
          issuanceBaseCurrency: "USD",
          chainIds: [1, "10", "invalid"],
          operator: [{ chainId: 1, address: "0x1111111111111111111111111111111111111111" }],
          stages: [
            {
              initialIssuance: "100",
              priceCeilingIncreasePercentage: "10",
              priceCeilingIncreaseFrequency: "30",
              priceFloorTaxIntensity: "20",
              pause721Transfers: false,
              stageStart: "0",
              splits: [],
              autoIssuance: [],
              ignored: "not imported",
            },
          ],
          ignored: "not imported",
        },
      }),
    );

    expect(parsed).toMatchObject({
      name: "A revnet",
      description: "A durable network",
      tokenSymbol: "REV",
      reserveAsset: "USDC",
      issuanceBaseCurrency: "USD",
      chainIds: [1, 10],
      operator: [{ chainId: "1", address: "0x1111111111111111111111111111111111111111" }],
    });
    expect(parsed.stages).toHaveLength(1);
    expect(parsed.stages[0]).not.toHaveProperty("pause721Transfers");
    expect(parsed.stages[0]).not.toHaveProperty("ignored");
    expect(parsed).not.toHaveProperty("ignored");
  });

  it("rejects JSON which does not contain a Revnet create draft", () => {
    expect(() => parseRevnetDraft(JSON.stringify({ name: "not enough" }))).toThrow(
      /No Revnet create draft/,
    );
  });

  it("keeps a passed start waiting for a new date across a second restore", () => {
    const draft = (start: unknown) =>
      JSON.stringify({ name: "A", stages: [{ futureStartTimestamp: start }] });
    const once = parseRevnetDraft(draft(1));
    expect(once.stages[0].futureStartTimestamp).toBeNull();
    const twice = parseRevnetDraft(draft(once.stages[0].futureStartTimestamp));
    expect(twice.stages[0].futureStartTimestamp).toBeNull();
  });

  it("keeps every shop item a draft holds", () => {
    const items = Array.from({ length: 65 }, (_, index) => ({ name: `Item ${index}`, price: "1" }));
    const parsed = parseRevnetDraft(JSON.stringify({ name: "A", stages: [{}], store: { items } }));
    expect(parsed.store?.items).toHaveLength(65);
  });

  it("keeps a custom asset's unread decimals unread", () => {
    const parsed = parseRevnetDraft(
      JSON.stringify({ name: "A", stages: [{}], customReserveAsset: { decimals: null } }),
    );
    expect(parsed.customReserveAsset.decimals).toBeNull();
  });

  it("uses a stable .jb filename", () => {
    expect(revnetDraftFileName("My Useful Revnet!")).toBe("my-useful-revnet.jb");
    expect(revnetDraftFileName("")).toBe("revnet.jb");
  });
});
