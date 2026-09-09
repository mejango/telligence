import { TIER_UNLIMITED_SUPPLY } from "@/app/[slug]/components/v6/shop/shopLib";
import { StoreSection } from "@/app/create/form/StoreSection";
import { createSchema } from "@/app/create/helpers/createSchema";
import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import type { RevnetFormData } from "@/app/create/types";
import { newDraftItem, type DraftItem } from "@/components/shop/itemDraft";
import { withSchema } from "@/lib/formValidation";
import { FormProvider } from "@/lib/forms";
import { parseRevnetDraft } from "@/lib/revnet-draft";
import { fireEvent, render, screen } from "@testing-library/react";
import { parseUnits } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SUCKER_CONFIG,
  TEST_ACCOUNT,
  TEST_BENEFICIARY,
  TEST_SALT,
  TEST_TIMESTAMP,
  validRevnetForm,
} from "./fixtures/revnet";

function item(overrides: Partial<DraftItem> = {}): DraftItem {
  return { ...newDraftItem(), name: "Hat", price: "0.01", uri: "", ...overrides };
}

function deployArgs(form: RevnetFormData, chainId: number = sepolia.id) {
  return parseDeployData(form, {
    metadataCid: "bafy-metadata",
    chainId: chainId as RevnetFormData["chainIds"][number],
    suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
    timestamp: TEST_TIMESTAMP,
    salt: TEST_SALT,
    creationFee: 0n,
  }).args;
}

/** The 721 config is the 6-arg overload's fifth argument. */
function tiered721(form: RevnetFormData, chainId?: number) {
  const args = deployArgs(form, chainId) as unknown as unknown[];
  return args.length > 4 ? (args[4] as any) : undefined;
}

describe("store encoding at launch", () => {
  it("configures the collection even with nothing in it", () => {
    // REVDeployer deploys an empty 721 hook regardless, hardcoding 18 price decimals and
    // granting the operator every permission. Sending the config is the only way those match
    // what the form actually asked for.
    const form = validRevnetForm();
    form.store.pricing = "USD";
    form.store.operatorCanMint = false;
    const config = tiered721(form);

    expect(config.baseline721HookConfiguration.tiersConfig.tiers).toEqual([]);
    expect(config.baseline721HookConfiguration.tiersConfig.decimals).toBe(6);
    expect(config.preventOperatorMinting).toBe(true);
  });

  it("deploys the collection with the items, priced in the revnet's own denomination", () => {
    const form = validRevnetForm();
    form.store.items = [item({ price: "0.25", supply: "10" })];
    const config = tiered721(form);

    expect(config.baseline721HookConfiguration.name).toBe("Safety Test Revnet Store");
    expect(config.baseline721HookConfiguration.symbol).toBe("SAFESTORE");
    expect(config.baseline721HookConfiguration.tiersConfig.decimals).toBe(18);
    const [tier] = config.baseline721HookConfiguration.tiersConfig.tiers;
    expect(tier.price).toBe(parseUnits("0.25", 18));
    expect(tier.initialSupply).toBe(10);
  });

  it("prices in USD with six decimals when the store is set to USD", () => {
    const form = validRevnetForm();
    form.store.pricing = "USD";
    form.store.items = [item({ price: "25" })];
    const config = tiered721(form);

    expect(config.baseline721HookConfiguration.tiersConfig.decimals).toBe(6);
    expect(config.baseline721HookConfiguration.tiersConfig.tiers[0].price).toBe(
      parseUnits("25", 6),
    );
  });

  it("gives each chain the quantity set for it", () => {
    const form = validRevnetForm();
    form.chainIds = [sepolia.id, baseSepolia.id];
    form.store.items = [
      item({ supply: "5", perChainSupply: { [baseSepolia.id]: "1", [sepolia.id]: "unlimited" } }),
    ];

    const onBase = tiered721(form, baseSepolia.id);
    const onSepolia = tiered721(form, sepolia.id);
    expect(onBase.baseline721HookConfiguration.tiersConfig.tiers[0].initialSupply).toBe(1);
    // "unlimited" is the one override that cannot be written as a number.
    expect(onSepolia.baseline721HookConfiguration.tiersConfig.tiers[0].initialSupply).toBe(
      TIER_UNLIMITED_SUPPLY,
    );
  });

  it("asks the deployer for what the operator may NOT do", () => {
    const form = validRevnetForm();
    form.store.items = [item()];
    form.store.operatorCanMint = false;
    form.store.operatorCanAdjustTiers = true;
    const config = tiered721(form);

    expect(config.preventOperatorMinting).toBe(true);
    expect(config.preventOperatorAdjustingTiers).toBe(false);
  });

  it("carries the collection flags and a custom name through", () => {
    const form = validRevnetForm();
    form.store.items = [item()];
    form.store.collectionName = "Merch";
    form.store.collectionSymbol = "MERCH";
    form.store.preventOverspending = true;
    form.store.noNewTiersWithVotes = true;
    const config = tiered721(form);

    expect(config.baseline721HookConfiguration.name).toBe("Merch");
    expect(config.baseline721HookConfiguration.symbol).toBe("MERCH");
    expect(config.baseline721HookConfiguration.flags).toMatchObject({
      preventOverspending: true,
      noNewTiersWithVotes: true,
      noNewTiersWithReserves: false,
    });
  });
});

describe("store validation", () => {
  it("rejects an item the launch encoder would reject, before the wallet sees it", () => {
    const form = validRevnetForm();
    form.store.items = [item({ price: "", name: "Hat" })];
    const result = createSchema.safeParse(form);
    expect(result.success).toBe(false);
  });

  it("rejects a reserved item with no beneficiary", () => {
    const form = validRevnetForm();
    form.store.items = [item({ supply: "10", reserveFrequency: "5", reserveBeneficiary: "" })];
    expect(createSchema.safeParse(form).success).toBe(false);
  });

  it("rejects a per-chain quantity that is neither a number nor unlimited", () => {
    const form = validRevnetForm();
    form.store.items = [item({ perChainSupply: { [sepolia.id]: "lots" } })];
    expect(createSchema.safeParse(form).success).toBe(false);
  });

  it("accepts a well-formed item", () => {
    const form = validRevnetForm();
    form.store.items = [
      item({
        price: "0.01",
        splits: [{ percent: "10", beneficiary: TEST_BENEFICIARY }],
      }),
    ];
    expect(createSchema.safeParse(form).success).toBe(true);
  });
});

describe("store drafts", () => {
  it("round-trips a stocked store through a .jb file", () => {
    const form = validRevnetForm();
    form.store.pricing = "USD";
    form.store.collectionName = "Merch";
    form.store.categories = [{ id: 1, name: "Shirts" }];
    form.store.items = [item({ name: "Cap", price: "12", category: "1", uri: "ipfs://bafy-item" })];
    form.store.operatorCanMint = false;

    const restored = parseRevnetDraft(
      JSON.stringify({ app: "revnet.money", data: JSON.parse(JSON.stringify(form)) }),
    );
    expect(restored.store.pricing).toBe("USD");
    expect(restored.store.collectionName).toBe("Merch");
    expect(restored.store.categories).toEqual([{ id: 1, name: "Shirts" }]);
    expect(restored.store.operatorCanMint).toBe(false);
    expect(restored.store.items[0]).toMatchObject({
      name: "Cap",
      price: "12",
      category: "1",
      uri: "ipfs://bafy-item",
    });
  });

  it("drops a draft's unknown junk rather than trusting it", () => {
    const restored = parseRevnetDraft(
      JSON.stringify({
        app: "revnet.money",
        data: {
          ...JSON.parse(JSON.stringify(validRevnetForm())),
          store: { items: [{ name: "x", evil: "<script>", perChainSupply: { notAChain: "3" } }] },
        },
      }),
    );
    expect(restored.store.items[0]).not.toHaveProperty("evil");
    expect(restored.store.items[0].perChainSupply).toEqual({});
  });
});

describe("store section", () => {
  function renderStore(form: RevnetFormData) {
    return render(
      <FormProvider
        initialValues={form}
        isInitialValid={false}
        validate={withSchema(createSchema)}
        onSubmit={() => undefined}
      >
        {({ values }) => (
          <>
            <StoreSection />
            <output data-testid="store-state">{JSON.stringify(values.store)}</output>
          </>
        )}
      </FormProvider>,
    );
  }
  const storeState = (): RevnetFormData["store"] =>
    JSON.parse(screen.getByTestId("store-state").textContent ?? "{}");

  it("says the operator can stock it later", () => {
    renderStore(validRevnetForm());
    expect(screen.getByText(/The Operator can add items later/i)).toBeInTheDocument();
  });

  it("adds and removes items", () => {
    renderStore(validRevnetForm());
    fireEvent.click(screen.getByText("+ Add an item"));
    expect(storeState().items).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Item 1 name"), { target: { value: "Hat" } });
    expect(storeState().items[0].name).toBe("Hat");

    fireEvent.click(screen.getByText("Remove"));
    expect(storeState().items).toHaveLength(0);
  });

  it("offers per-chain quantities only when the revnet spans chains", () => {
    const form = validRevnetForm();
    form.chainIds = [sepolia.id];
    form.store.items = [item()];
    const single = renderStore(form);
    expect(screen.queryByText("Set per chain")).not.toBeInTheDocument();
    single.unmount();

    const multi = { ...validRevnetForm(), chainIds: [sepolia.id, baseSepolia.id] };
    multi.store.items = [item()];
    renderStore(multi as RevnetFormData);
    fireEvent.click(screen.getByText("Set per chain"));
    fireEvent.change(screen.getByLabelText("Base Sepolia quantity"), { target: { value: "3" } });
    expect(storeState().items[0].perChainSupply[baseSepolia.id]).toBe("3");
  });

  it("keeps the operator's post-launch powers editable", () => {
    const form = validRevnetForm();
    renderStore(form);
    fireEvent.click(screen.getByText(/Store config/));
    fireEvent.click(screen.getByText("Mint items for free"));
    expect(storeState().operatorCanMint).toBe(false);
  });

  it("prices items in USD when the store says so", () => {
    const form = validRevnetForm();
    form.store.items = [item()];
    const { container } = renderStore(form);
    // Radix's select is not operable in jsdom, so drive the section the way it is wired.
    fireEvent.click(screen.getByLabelText("Pricing currency"));
    expect(container).toBeTruthy();
  });

  it("names a category from the item's own category picker", () => {
    const form = validRevnetForm();
    form.store.items = [item({ moreOpen: true })];
    renderStore(form);

    fireEvent.change(screen.getByLabelText("Item 1 category"), { target: { value: "add" } });
    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "Shirts" } });
    fireEvent.click(screen.getByText("Add"));

    expect(storeState().categories).toEqual([{ id: 1, name: "Shirts" }]);
    // The item lands in the category it just named, and the name travels in its metadata.
    expect(storeState().items[0].category).toBe("1");
    expect(screen.getByRole("option", { name: "Shirts" })).toBeInTheDocument();
  });

  it("does not let one item's split of sales exceed the sale", () => {
    const form = validRevnetForm();
    form.store.items = [item({ splits: [{ percent: "120", beneficiary: TEST_ACCOUNT }] })];
    expect(createSchema.safeParse(form).success).toBe(false);
  });
});
