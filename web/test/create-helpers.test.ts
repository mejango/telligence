import {
  calculatePickupIssuance,
  getCurrentStageDuration,
  getResolvedIssuance,
} from "@/app/create/helpers/calculatePickupIssuance";
import { createSchema } from "@/app/create/helpers/createSchema";
import {
  pruneDeselectedChain,
  pruneHiddenEnvironmentChains,
} from "@/app/create/helpers/pruneDeselectedChain";
import { calculateFinalStageStarts } from "@/app/create/helpers/recalculateStageStarts";
import { addressSchema, stageSchema } from "@/app/create/helpers/stageSchema";
import type { StageData } from "@/app/create/types";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { TEST_ACCOUNT, TEST_BENEFICIARY, validRevnetForm } from "./fixtures/revnet";

function stage(overrides: Partial<StageData> = {}): StageData {
  return {
    initialIssuance: "1000",
    priceCeilingIncreasePercentage: "10",
    priceCeilingIncreaseFrequency: "30",
    priceFloorTaxIntensity: "20",
    autoIssuance: [],
    splits: [],
    stageStart: "30",
    ...overrides,
  };
}

describe("create form schema baseline", () => {
  it("accepts a complete deployment fixture", () => {
    expect(createSchema.safeParse(validRevnetForm()).success).toBe(true);
  });

  it("rejects malformed addresses at every address boundary", () => {
    expect(addressSchema.safeParse("not-an-address").success).toBe(false);

    const invalidOperator = validRevnetForm();
    invalidOperator.operator[0].address = "not-an-address";
    expect(createSchema.safeParse(invalidOperator).success).toBe(false);

    const invalidBeneficiary = validRevnetForm();
    invalidBeneficiary.stages[0].splits[0].defaultBeneficiary = "not-an-address";
    expect(createSchema.safeParse(invalidBeneficiary).success).toBe(false);
  });

  it("requires identity, at least one chain, and at least one stage", () => {
    const form = validRevnetForm();
    form.name = " ";
    form.chainIds = [];
    form.stages = [];
    const result = createSchema.safeParse(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toEqual(expect.arrayContaining(["name", "chainIds", "stages"]));
    }
  });

  it("requires a custom reserve to be verified on every deployment chain", () => {
    const form = validRevnetForm();
    form.reserveAsset = "CUSTOM";
    form.customReserveAsset = {
      address: "0x000000000000000000000000000000000000d00d",
      symbol: "DAI",
      decimals: 18,
      verifiedChainIds: [],
    };

    expect(createSchema.safeParse(form).success).toBe(false);
    form.customReserveAsset.verifiedChainIds = [...form.chainIds];
    expect(createSchema.safeParse(form).success).toBe(true);
  });

  // REVDeployer only mints auto-issuance rows whose chainId matches the chain
  // it runs on. A row pointing at a chain the revnet is not deployed to would
  // silently never mint, so the schema must reject it before submission.
  it("rejects auto issuance rows whose chain is not selected for deployment", () => {
    const form = validRevnetForm();
    form.stages[0].autoIssuance.push({
      chainId: baseSepolia.id,
      amount: "10",
      beneficiary: TEST_BENEFICIARY,
    });

    const result = createSchema.safeParse(form);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "stages.0.autoIssuance.1.chainId",
      );
    }

    form.chainIds = [sepolia.id, baseSepolia.id];
    expect(createSchema.safeParse(form).success).toBe(true);
  });

  it("requires every auto issuance row to name a chain", () => {
    const form = validRevnetForm();
    form.stages[0].autoIssuance[0] = {
      amount: "25",
      beneficiary: TEST_BENEFICIARY,
    } as StageData["autoIssuance"][number];

    const result = createSchema.safeParse(form);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "stages.0.autoIssuance.0.chainId",
      );
    }
  });

  // parseDeployData falls back to the split's single default beneficiary for any
  // chain without an override, so an override pointing at an unselected chain
  // would silently never apply. Reject it, mirroring the auto-issuance guard.
  it("rejects per-chain split beneficiaries whose chain is not selected for deployment", () => {
    const form = validRevnetForm();
    form.stages[0].splits[0].beneficiary = [
      { chainId: sepolia.id, address: TEST_BENEFICIARY },
      { chainId: baseSepolia.id, address: TEST_BENEFICIARY },
    ];

    const result = createSchema.safeParse(form);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "stages.0.splits.0.beneficiary.1.chainId",
      );
    }

    form.chainIds = [sepolia.id, baseSepolia.id];
    expect(createSchema.safeParse(form).success).toBe(true);
  });

  it("rejects operator overrides whose chain is not selected for deployment", () => {
    const form = validRevnetForm();
    form.operator.push({ chainId: String(baseSepolia.id), address: TEST_ACCOUNT });

    const result = createSchema.safeParse(form);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "operator.1.chainId",
      );
    }

    form.chainIds = [sepolia.id, baseSepolia.id];
    expect(createSchema.safeParse(form).success).toBe(true);
  });

  // Deselecting a chain removes its per-chain values instead of leaving them
  // orphaned; fields fall back to their single default value.
  it("prunes a deselected chain's operator and split beneficiary overrides", () => {
    const form = validRevnetForm();
    form.chainIds = [sepolia.id, baseSepolia.id];
    form.operator = [
      { chainId: String(sepolia.id), address: TEST_ACCOUNT },
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
    ];
    form.stages[0].splits[0].beneficiary = [
      { chainId: sepolia.id, address: TEST_BENEFICIARY },
      { chainId: baseSepolia.id, address: TEST_ACCOUNT },
    ];
    form.stages[0].splits.push({
      percentage: "10",
      defaultBeneficiary: TEST_ACCOUNT,
      beneficiary: [{ chainId: baseSepolia.id, address: TEST_ACCOUNT }],
    });

    const pruned = pruneDeselectedChain(form, baseSepolia.id);

    expect(pruned.operator).toEqual([{ chainId: String(sepolia.id), address: TEST_ACCOUNT }]);
    expect(pruned.stages[0].splits[0].beneficiary).toEqual([
      { chainId: sepolia.id, address: TEST_BENEFICIARY },
    ]);
    // A fully pruned override list returns the split to single-value mode.
    expect(pruned.stages[0].splits[1].beneficiary).toBeUndefined();
    // Auto-issuance rows keep their chain assignment: the schema guard reports
    // them so the user re-homes the row explicitly.
    expect(pruned.stages[0].autoIssuance).toEqual(form.stages[0].autoIssuance);
    // The input form is not mutated.
    expect(form.operator).toHaveLength(2);
    expect(form.stages[0].splits[0].beneficiary).toHaveLength(2);
  });

  // Flipping the environment select hides the other environment's checkboxes;
  // its selections (and their per-chain rows) must not stay silently deployed.
  it("prunes every hidden-environment chain when the environment flips", () => {
    const form = validRevnetForm();
    form.chainIds = [sepolia.id, baseSepolia.id];
    form.operator = [
      { chainId: String(sepolia.id), address: TEST_ACCOUNT },
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
    ];
    form.stages[0].splits[0].beneficiary = [
      { chainId: sepolia.id, address: TEST_BENEFICIARY },
      { chainId: baseSepolia.id, address: TEST_ACCOUNT },
    ];

    // Flipping to production hides every testnet: everything is pruned.
    const pruned = pruneHiddenEnvironmentChains(form, [mainnet.id, base.id]);

    expect(pruned.chainIds).toEqual([]);
    expect(pruned.operator).toEqual([]);
    expect(pruned.stages[0].splits[0].beneficiary).toBeUndefined();

    // Chains in the visible environment survive with their overrides.
    const kept = pruneHiddenEnvironmentChains(form, [sepolia.id, baseSepolia.id]);
    expect(kept.chainIds).toEqual([sepolia.id, baseSepolia.id]);
    expect(kept.operator).toHaveLength(2);
  });

  it("requires all stage fields which feed contract encoding", () => {
    const result = stageSchema.safeParse({
      ...stage(),
      initialIssuance: "",
      priceCeilingIncreasePercentage: "",
      priceCeilingIncreaseFrequency: "",
      priceFloorTaxIntensity: "",
      stageStart: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(5);
  });
});

describe("stage timing and inherited issuance helpers", () => {
  it("resolves cut-count timing without mutating the form stages", () => {
    const stages = [
      stage({ priceCeilingIncreaseFrequency: "14", stageStart: "0" }),
      stage({ stageStart: "999", stageStartCuts: "3" }),
    ];
    const original = structuredClone(stages);

    const resolved = calculateFinalStageStarts(stages);

    expect(resolved[0]).toEqual(stages[0]);
    expect(resolved[1]).toMatchObject({ stageStart: "42", stageStartCuts: undefined });
    expect(stages).toEqual(original);
  });

  it("preserves direct timing when there is no valid cuts-based duration", () => {
    const stages = [
      stage({ priceCeilingIncreaseFrequency: "0" }),
      stage({ stageStart: "45", stageStartCuts: "3" }),
    ];
    expect(calculateFinalStageStarts(stages)[1]).toEqual(stages[1]);
  });

  it("applies the previous stage's issuance cuts at exact cycle boundaries", () => {
    const previous = stage({
      initialIssuance: "1000",
      priceCeilingIncreasePercentage: "10",
      priceCeilingIncreaseFrequency: "30",
    });

    expect(calculatePickupIssuance(previous, 0)).toBeNull();
    expect(calculatePickupIssuance(previous, "0")).toBe("1000.000");
    expect(calculatePickupIssuance(previous, "29")).toBe("1000.000");
    expect(calculatePickupIssuance(previous, "30")).toBe("900.000");
    expect(calculatePickupIssuance(previous, "90")).toBe("729.000");
  });

  it("resolves chained pickup stages recursively", () => {
    const stages = [
      stage({ initialIssuance: "1000", stageStart: "0" }),
      stage({ pickUpFromPrevious: true, stageStart: "30" }),
      stage({ pickUpFromPrevious: true, stageStart: "30" }),
    ];

    expect(getCurrentStageDuration(stages[1], stages[0])).toBe("30");
    expect(getResolvedIssuance(stages[1], 1, stages)).toBe("900.000");
    expect(getResolvedIssuance(stages[2], 2, stages)).toBe("810.000");
  });
});
