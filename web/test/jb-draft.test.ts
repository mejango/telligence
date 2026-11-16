import { DEFAULT_FORM_DATA, defaultStageData, defaultStoreData } from "@/app/create/constants";
import { getStageCutFrequencySeconds } from "@/app/create/helpers/calculatePickupIssuance";
import { createSchema } from "@/app/create/helpers/createSchema";
import type { RevnetFormData } from "@/app/create/types";
import { newDraftItem } from "@/components/shop/itemDraft";
import {
  fromJbDraft,
  readJbDraftFile,
  shiftDecimal,
  toJbDraft,
  writeJbDraftFile,
} from "@/lib/jb-draft";
import { emptyJbDraft, type JbDraft } from "@bananapus/nana-sdk-core/v6";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

const form = (): RevnetFormData => ({
  ...DEFAULT_FORM_DATA,
  name: "A revnet",
  description: "A durable network",
  tokenSymbol: "REV",
  logoUri: "ipfs://logo",
  infoUri: "https://example.com",
  reserveAsset: "USDC",
  issuanceBaseCurrency: "USD",
  chainIds: [1, 8453],
  operator: [
    { chainId: "1", address: A },
    { chainId: "8453", address: B },
  ],
  stages: [
    {
      ...defaultStageData,
      initialOperator: undefined,
      initialIssuance: "100",
      priceCeilingIncreasePercentage: "10",
      priceCeilingIncreaseFrequency: "30",
      priceFloorTaxIntensity: "20",
      stageStart: "0",
      splits: [
        { percentage: "30", defaultBeneficiary: A, beneficiary: [{ chainId: 8453, address: B }] },
      ],
      autoIssuance: [{ amount: "5000", beneficiary: A, chainId: 1 }],
    },
    {
      ...defaultStageData,
      initialOperator: undefined,
      initialIssuance: "",
      pickUpFromPrevious: true,
      priceCeilingIncreasePercentage: "0",
      priceCeilingIncreaseFrequency: "0",
      priceFloorTaxIntensity: "12.34",
      stageStart: "90",
      splits: [],
      autoIssuance: [],
    },
  ],
  store: {
    ...defaultStoreData,
    pricing: "USD",
    categories: [{ id: 1, name: "Shirts" }],
    items: [
      {
        ...newDraftItem(),
        name: "Shirt",
        mediaUri: "ipfs://media",
        mediaType: "video/mp4",
        price: "20",
        supply: "100",
        category: "1",
        perChainSupply: { 8453: "unlimited" },
        splits: [{ percent: "50", beneficiary: A }],
      },
    ],
  },
});

/** What a draft says, without the keys the form only uses for display. */
const said = (values: RevnetFormData) => toJbDraft(values);

describe("the shared .jb file on revnet.money", () => {
  it("writes plain units: a 0 to 1 tax, days, real chain ids", () => {
    const file = toJbDraft(form());
    expect(file).toMatchObject({
      v: 2,
      kind: "revnet",
      ticker: "REV",
      accepts: ["usdc"],
      chains: [1, 8453],
      owner: "",
      ownerPerChain: { 1: A, 8453: B },
    });
    expect(file.stages[0]).toMatchObject({
      baseCurrency: "usd",
      issuance: "100",
      cutPercent: "10",
      cutDays: "30",
      cashOutTax: "0.2",
    });
    expect(file.stages[0].reserved[0]).toMatchObject({ share: "30", addressPerChain: { 8453: B } });
    expect(file.stages[1]).toMatchObject({
      startAfterDays: "90",
      issuance: "",
      cutPercent: "",
      cutDays: "",
      cashOutTax: "0.1234",
    });
    expect(file.shop.items[0]).toMatchObject({
      mediaType: "video/mp4",
      supplyPerChain: { 8453: "unlimited" },
    });
  });

  it("reads back what it wrote", () => {
    const values = form();
    const back = readJbDraftFile(writeJbDraftFile(values));
    expect(said(back)).toEqual(said(values));
    expect(back.stages[1].pickUpFromPrevious).toBe(true);
    expect(back.store.items[0]).toMatchObject({ mediaUri: "ipfs://media", mediaType: "video/mp4" });
    expect(createSchema.safeParse(back).success).toBe(true);
  });

  it("writes one operator for every chain as the owner, and reads it back", () => {
    const values = {
      ...form(),
      operator: [
        { chainId: "1", address: A },
        { chainId: "8453", address: A },
      ],
    };
    const file = toJbDraft(values);
    expect(file).toMatchObject({ owner: A, ownerPerChain: {} });
    const back = fromJbDraft(file);
    expect(back.stages[0].initialOperator).toBe(A);
    expect(createSchema.safeParse(back).success).toBe(true);
  });

  it("counts fractional days as exact seconds, and names the collection as launched", () => {
    const values = form();
    values.stages[0] = { ...values.stages[0], priceCeilingIncreaseFrequency: "1.005" };
    expect(getStageCutFrequencySeconds(values.stages[0])).toBe(86_832);
    values.store = { ...values.store, collectionName: "", collectionSymbol: "" };
    expect(toJbDraft(values).shop).toMatchObject({
      collectionName: `${values.name} Store`,
      collectionSymbol: `${values.tokenSymbol}STORE`,
    });
  });

  it("keeps an operator switched off by a chain's own entry switched off", () => {
    const file = toJbDraft(form());
    const dead = "0xdead000000000000000000000000000000000000";
    const back = fromJbDraft({ ...file, owner: A, ownerPerChain: { 1: dead, 8453: dead } });
    expect(back.stages[0].initialOperator).toBe(dead);
    expect(back.operator.map((entry) => entry.address)).toEqual([dead, dead]);
  });

  it("will not write a draft whose item media has not reached IPFS", () => {
    const values = form();
    values.store.items[0] = {
      ...values.store.items[0],
      mediaUri: "",
      mediaFile: new File(["x"], "shirt.png"),
    };
    expect(() => toJbDraft(values)).toThrow("An item's media is still uploading.");
  });

  it("writes 'after N cuts' as days of the stage before", () => {
    const values = form();
    values.stages[1] = { ...values.stages[1], stageStartCuts: "3" };
    expect(toJbDraft(values).stages[1].startAfterDays).toBe("90");
  });

  it("refuses a project file, and a revnet file holding what this form cannot", () => {
    const revnet = (): JbDraft => toJbDraft(form());
    expect(() => fromJbDraft(emptyJbDraft("project", ["eth"]))).toThrow(
      "This file is a project. revnet.money launches revnets.",
    );
    const refused = (patch: Partial<JbDraft>) => {
      try {
        fromJbDraft({ ...revnet(), ...patch });
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    };
    const cant = (what: string) => `revnet.money can't launch this file: it has ${what}.`;
    expect(
      refused({
        chains: [1, 8453],
        ownerPerChain: { 8453: "0xdead000000000000000000000000000000000000" },
      }),
    ).toBe(cant("an operator switched off on some chains only"));
    expect(refused({ tagline: "hi" })).toBe(cant("a tagline"));
    expect(refused({ tags: ["art"] })).toBe(cant("tags"));
    expect(refused({ coverUri: "ipfs://x" })).toBe(cant("a cover image"));
    expect(refused({ linkChains: false })).toBe(cant("chains that are not linked"));
    expect(refused({ name: "x".repeat(101) })).toBe(cant("a value longer than this form holds"));
    const hook = revnet();
    hook.stages[0].reserved[0] = { ...hook.stages[0].reserved[0], lockedUntil: 2_000_000_000 };
    expect(refused({ stages: hook.stages })).toBe(cant("a locked split"));
    expect(() =>
      readJbDraftFile(JSON.stringify({ v: 1, app: "revnet.money", data: form() })),
    ).toThrow("This .jb file was saved in a format this site no longer reads.");
  });

  it("moves a decimal point without a float", () => {
    expect(shiftDecimal("20", -2)).toBe("0.2");
    expect(shiftDecimal("12.34", -2)).toBe("0.1234");
    expect(shiftDecimal("0.1234", 2)).toBe("12.34");
    expect(shiftDecimal("0.5", 2)).toBe("50");
    expect(shiftDecimal("100", -2)).toBe("1");
    expect(shiftDecimal("0", 2)).toBe("0");
    expect(shiftDecimal("", 2)).toBe("");
  });
});

describe("the published example draft", () => {
  // /skill.md and /llms.txt send agents to this file, so it has to keep importing.
  const source = readFileSync("public/examples/revnet.jb", "utf8");

  it("imports every value it states and needs only an operator and a split recipient", () => {
    const file = JSON.parse(source);
    const parsed = readJbDraftFile(source);
    const written = toJbDraft(parsed);
    const { stages, ...top } = file;
    expect(written).toMatchObject(top);
    stages.forEach((stage: object, index: number) =>
      expect(written.stages[index]).toMatchObject(stage),
    );
    const result = createSchema.safeParse(parsed);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "stages.0.splits.0.defaultBeneficiary",
      "stages.1.splits.0.defaultBeneficiary",
      "operator",
    ]);
  });
});
