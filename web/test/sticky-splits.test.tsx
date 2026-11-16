import { combinedDescription } from "@/app/[slug]/components/ActivityFeed/ActivityItem";
import {
  groupSameTxEvents,
  mapActivityEvents,
  type ActivityEventItem,
} from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import type { SplitFormData } from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import { splitRouting } from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import { changeSplitsSchema } from "@/app/[slug]/owners/components/changeSplitsSchema";
import { prepareArgs } from "@/app/[slug]/owners/components/hooks/useSetSplitGroups";
import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import { stageSchema } from "@/app/create/helpers/stageSchema";
import type { SplitDraft, StageData } from "@/app/create/types";
import { StickyRecipient } from "@/components/sticky/StickyRecipient";
import { parseRevnetDraft } from "@/lib/revnet-draft";
import { checkStickyToken, stickySplitsProblem } from "@/lib/sticky";
import { jbContractAddress, type JBChainId } from "@bananapus/nana-sdk-core";
import { describeSplitGroups } from "@bananapus/nana-sdk-core/review/decode";
import { stickyDistributorAddress } from "@bananapus/nana-sdk-core/v6";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SUCKER_CONFIG, TEST_SALT, TEST_TIMESTAMP, validRevnetForm } from "./fixtures/revnet";

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  usePublicClient: () => ({}),
}));

const CHAIN = 84532 as JBChainId;
const OTHER_CHAIN = 11155111 as JBChainId;
const TOKEN = "0x5ca1ab1e00000000000000000000000000005ca1" as Address;
const STICKY_HOOK = jbContractAddress["6"].StickyHook[CHAIN] as Address;

const stickyRow = (patch: Partial<SplitDraft> = {}): SplitDraft => ({
  percentage: "25",
  defaultBeneficiary: TOKEN,
  kind: "hook",
  hookKind: "sticky",
  stickyGroup: "tenure",
  stickyMinWeeks: "4",
  stickyMaxWeeks: "52",
  ...patch,
});

/** A chain whose Sticky hook tracks `registered` for the token's project 9. */
function chainClient({
  registered = TOKEN as Address | null,
  projectIdRead = "ok" as "ok" | "revert" | "down",
} = {}): PublicClient {
  return {
    readContract: vi.fn(
      async ({ address, functionName }: { address: Address; functionName: string }) => {
        if (functionName === "PROJECT_ID") {
          if (projectIdRead === "revert") {
            throw new ContractFunctionExecutionError(
              new ContractFunctionRevertedError({ abi: [], functionName: "PROJECT_ID" }),
              { abi: [], functionName: "PROJECT_ID" },
            );
          }
          if (projectIdRead === "down") throw new HttpRequestError({ url: "https://rpc.test" });
          return 9n;
        }
        if (functionName === "tokenOf" && address.toLowerCase() === STICKY_HOOK.toLowerCase()) {
          return registered ?? zeroAddress;
        }
        if (functionName === "symbol") return "STICKY";
        throw new Error(`unexpected read ${functionName}`);
      },
    ),
  } as unknown as PublicClient;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("Sticky splits in revnet create", () => {
  it("encodes the distributor, the token, and the tenure group on each chain", () => {
    const form = validRevnetForm();
    form.stages[0].splits = [stickyRow()];
    const request = parseDeployData(form, {
      metadataCid: "bafy-metadata",
      chainId: sepolia.id,
      suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
      timestamp: TEST_TIMESTAMP,
      salt: TEST_SALT,
      creationFee: 1n,
    });
    const [, config] = request.args;
    expect(config.stageConfigurations[0].splits[0]).toMatchObject({
      projectId: 4052n,
      beneficiary: TOKEN,
      hook: stickyDistributorAddress(sepolia.id),
      preferAddToBalance: false,
      lockedUntil: 0,
    });
  });

  it("validates the group before submit", () => {
    const stage = (splits: SplitDraft[]): StageData => ({
      initialIssuance: "1000",
      priceCeilingIncreasePercentage: "10",
      priceCeilingIncreaseFrequency: "30",
      priceFloorTaxIntensity: "20",
      autoIssuance: [],
      splits,
      stageStart: "30",
    });
    expect(stageSchema.safeParse(stage([stickyRow()])).success).toBe(true);
    expect(stageSchema.safeParse(stage([stickyRow({ stickyGroup: "all" })])).success).toBe(true);
    for (const bad of [
      { stickyMinWeeks: "0" },
      { stickyMaxWeeks: "3" },
      { stickyMaxWeeks: "600" },
      { stickyMinWeeks: "" },
    ]) {
      expect(stageSchema.safeParse(stage([stickyRow(bad)])).success).toBe(false);
    }
    expect(stageSchema.safeParse(stage([stickyRow({ defaultBeneficiary: "" })])).success).toBe(
      false,
    );
  });

  it("keeps a Sticky row through a .jb draft instead of dropping it to an address", () => {
    const parsed = parseRevnetDraft(
      JSON.stringify({
        v: 1,
        app: "revnet.money",
        data: {
          name: "A revnet",
          tokenSymbol: "REV",
          chainIds: [CHAIN],
          stages: [{ splits: [stickyRow()], autoIssuance: [], stageStart: "0" }],
        },
      }),
    );
    expect(parsed.stages[0].splits[0]).toMatchObject({
      kind: "hook",
      hookKind: "sticky",
      defaultBeneficiary: TOKEN,
      stickyGroup: "tenure",
      stickyMinWeeks: "4",
      stickyMaxWeeks: "52",
    });
  });
});

it("loads a draft saved with the old sticky kind as a Sticky hook row", () => {
  const { kind: _kind, hookKind: _hookKind, ...legacy } = stickyRow();
  const parsed = parseRevnetDraft(
    JSON.stringify({
      v: 1,
      app: "revnet.money",
      data: {
        name: "A revnet",
        tokenSymbol: "REV",
        chainIds: [CHAIN],
        stages: [{ splits: [{ ...legacy, kind: "sticky" }], autoIssuance: [], stageStart: "0" }],
      },
    }),
  );
  expect(parsed.stages[0].splits[0]).toMatchObject({
    kind: "hook",
    hookKind: "sticky",
    defaultBeneficiary: TOKEN,
    stickyMinWeeks: "4",
  });
});

describe("Sticky splits in the owners editor", () => {
  const chain = (splits: SplitFormData[]) => ({
    chainId: CHAIN,
    projectId: 3n,
    rulesetId: 1n,
    selected: true,
    splits,
  });

  it("encodes a new Sticky row and re-sends a stored group verbatim", () => {
    const [, , groups] = prepareArgs(
      chain([
        {
          percentage: "50",
          beneficiary: TOKEN,
          kind: "hook",
          hookKind: "sticky",
          stickyGroup: "all",
        },
        {
          percentage: "50",
          beneficiary: TOKEN,
          kind: "hook",
          hookKind: "sticky",
          // Stored as 3, which the distributor reads as group 0; untouched, it stays 3.
          projectId: 3n,
          hook: stickyDistributorAddress(CHAIN),
          lockedUntil: 2_000_000_000,
          stickyGroup: "all",
          stickyMinWeeks: "",
          stickyMaxWeeks: "",
        },
      ]),
    );
    expect(groups[0].splits[0]).toMatchObject({
      projectId: 0n,
      beneficiary: TOKEN,
      hook: stickyDistributorAddress(CHAIN),
    });
    expect(groups[0].splits[1]).toMatchObject({ projectId: 3n, lockedUntil: 2_000_000_000 });
  });

  it("treats a Sticky row as editable, not as project or hook routing", () => {
    expect(
      splitRouting({
        percentage: "1",
        beneficiary: TOKEN,
        kind: "hook",
        hookKind: "sticky",
        projectId: 4052n,
        hook: stickyDistributorAddress(CHAIN),
      }),
    ).toBeNull();
  });

  it("rejects an invalid group", () => {
    const values = (patch: Partial<SplitFormData>) => ({
      chains: [
        {
          chainId: CHAIN,
          selected: true,
          splits: [
            { percentage: "100", beneficiary: TOKEN, kind: "hook", hookKind: "sticky", ...patch },
          ],
        },
      ],
    });
    expect(
      changeSplitsSchema.safeParse(values({ stickyGroup: "tenure", stickyMinWeeks: "4" })).success,
    ).toBe(true);
    expect(
      changeSplitsSchema.safeParse(
        values({ stickyGroup: "tenure", stickyMinWeeks: "9", stickyMaxWeeks: "2" }),
      ).success,
    ).toBe(false);
  });
});

describe("Sticky token checks", () => {
  it("accepts a registered token and reads its symbol", async () => {
    expect(await checkStickyToken(chainClient(), CHAIN, TOKEN)).toEqual({
      ok: true,
      symbol: "STICKY",
    });
  });

  it("rejects an untracked token, a non-Sticky contract, and says when a read failed", async () => {
    const other = "0x0000000000000000000000000000000000000abc" as Address;
    expect(await checkStickyToken(chainClient({ registered: other }), CHAIN, TOKEN)).toMatchObject({
      reason: "0x5ca1…5ca1 is not a Sticky token on Base Sepolia.",
    });
    expect(
      await checkStickyToken(chainClient({ projectIdRead: "revert" }), CHAIN, TOKEN),
    ).toMatchObject({ reason: "0x5ca1…5ca1 is not a Sticky token on Base Sepolia." });
    expect(
      await checkStickyToken(chainClient({ projectIdRead: "down" }), CHAIN, TOKEN),
    ).toMatchObject({ reason: "Could not check the Sticky token on Base Sepolia." });
  });

  it("checks every target chain and names the one that fails", async () => {
    const clients: Record<number, PublicClient> = {
      [CHAIN]: chainClient(),
      [OTHER_CHAIN]: chainClient({ registered: null }),
    };
    expect(
      await stickySplitsProblem(
        [{ beneficiary: TOKEN, projectId: 4052n }],
        [CHAIN, OTHER_CHAIN],
        (chainId) => clients[chainId],
      ),
    ).toBe("0x5ca1…5ca1 is not a Sticky token on Sepolia.");
  });
});

describe("Sticky split display", () => {
  const split = {
    percent: 250_000_000,
    projectId: 4052n,
    beneficiary: TOKEN,
    preferAddToBalance: false,
    lockedUntil: 0,
    hook: stickyDistributorAddress(CHAIN),
  };

  it("decodes setSplitGroupsOf calldata as Sticky holders, never a project", () => {
    const steps = describeSplitGroups(CHAIN, [{ groupId: 1n, splits: [split] }])!;
    const text = steps.flatMap((step) => step.rows.map((row) => row.join("="))).join("\n");
    expect(text).toContain(`Sticky holders stuck 4 to 52 weeks → Sticky token ${TOKEN}`);
    expect(text).toContain(`via StickyDistributor ${split.hook}`);
    expect(text).not.toContain("project #4052");
  });

  it("names the token symbol", () => {
    const client = new QueryClient();
    client.setQueryData(
      ["sticky-recipient-symbol", CHAIN, split.beneficiary.toLowerCase()],
      "STICKY",
    );
    expect(
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <StickyRecipient split={split} chainId={CHAIN} />
        </QueryClientProvider>,
      ),
    ).toContain("Sticky holders stuck 4 to 52 weeks → STICKY");
  });

  it("names Sticky holders in a reserved distribution row", () => {
    const base = {
      chainId: CHAIN,
      timestamp: 1_700_000_000,
      txHash: "0xreserved",
      payEvent: null,
      cashOutTokensEvent: null,
      addToBalanceEvent: null,
      mintTokensEvent: null,
      manualMintTokensEvent: null,
      autoIssueEvent: null,
      deployErc20Event: null,
      projectCreateEvent: null,
      projectTransferEvent: null,
      operatorPermissionsSetEvent: null,
      rulesetQueuedEvent: null,
      swapEvent: null,
      buybackPoolEvent: null,
    };
    const from = "0x2222222222222222222222222222222222222222";
    const events = [
      {
        ...base,
        id: "distribution",
        sendReservedTokensToSplitsEvent: {
          txHash: "0xreserved",
          timestamp: 1_700_000_000,
          from,
          tokenCount: "1000000000000000000000",
        },
      },
      {
        ...base,
        id: "receipt",
        sendReservedTokensToSplitEvent: {
          id: "receipt-event",
          txHash: "0xreserved",
          timestamp: 1_700_000_000,
          from,
          tokenCount: "1000000000000000000000",
          beneficiary: TOKEN,
          splitProjectId: 4052,
          hook: split.hook,
        },
      },
    ] as unknown as ActivityEventItem[];
    const [row] = groupSameTxEvents(
      mapActivityEvents(events, () => ({ tokenSymbol: "ETH", decimals: 18 })),
    );
    const text = combinedDescription(row, "ART");
    expect(text).toContain("to Sticky holders stuck 4 to 52 weeks → 0x5ca1…5ca1");
    expect(text).not.toContain("project #4052");
  });
});
