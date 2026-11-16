import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SourceExpectation = { file: string; contains: string[] };

const actionExpectations: Array<{
  action: string;
  sources: SourceExpectation[];
}> = [
  {
    action: "repay",
    sources: [
      {
        file: "src/app/[slug]/components/Value/RepayDialog.tsx",
        contains: ['functionName: "approve"', 'functionName: "repayLoan"', "reviewedCall"],
      },
    ],
  },
  {
    action: "split-hook",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/market/SplitHookCard.tsx",
        contains: ['"deployPool"', '"collectAndRouteLPFees"', "reviewedCall", "useReviewedAction"],
      },
    ],
  },
  {
    action: "auto-issuance",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/V6AutoIssuanceSubtab.tsx",
        contains: ["prepareAutoIssuance", "OwnerDistributionBatchButton"],
      },
    ],
  },
  {
    action: "token-admin",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/V6TokenPanel.tsx",
        contains: ['functionName: "setTokenMetadataOf"', 'functionName: "deployERC20For"'],
      },
    ],
  },
  {
    action: "reserved-distribution",
    sources: [
      {
        file: "src/app/[slug]/owners/components/DistributeReservedTokensButton.tsx",
        contains: ["prepareReservedDistribution", "OwnerDistributionBatchButton"],
      },
    ],
  },
  {
    action: "split-groups",
    sources: [
      {
        file: "src/app/[slug]/owners/components/hooks/useSetSplitGroups.ts",
        contains: ['functionName: "setSplitGroupsOf"', "getRelayrTxQuote", "runSequentialWrites"],
      },
    ],
  },
  {
    action: "metadata",
    sources: [
      {
        file: "src/app/[slug]/about/components/EditMetadataDialog.tsx",
        contains: ['functionName: "setUriOf"', "getRelayrTxQuote", "runSequentialWrites"],
      },
    ],
  },
  {
    action: "project-payer",
    sources: [
      {
        file: "src/app/[slug]/components/v6/extras/PayerDeployForm.tsx",
        contains: ["buildDeployProjectPayerTx", "runBatch", 'relayrMode: "raw"'],
      },
    ],
  },
  {
    action: "project-handle",
    sources: [
      {
        file: "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx",
        contains: [
          'functionName: "setText"',
          'functionName: "setEnsNamePartsFor"',
          'functionName: "createProxyWithNonce"',
          "isLiveRevnetOperator",
          "prepareSafeSameAddressDeployment",
          "requireDone",
        ],
      },
    ],
  },
  {
    action: "operator-writes",
    sources: [
      {
        file: "src/app/[slug]/components/v6/operator/BuybackRouterCard.tsx",
        contains: ['functionName: "setHookFor"', 'functionName: "setTerminalFor"'],
      },
      {
        file: "src/app/[slug]/components/v6/operator/OperatorAccountCard.tsx",
        contains: ['functionName: "setOperatorOf"'],
      },
      {
        // Sucker extension must verify the target chain's config hash before
        // building the deploySuckersFor writes — pairing depends on it.
        file: "src/app/[slug]/components/v6/operator/SuckerExtensionCard.tsx",
        contains: ['"hashedEncodedConfigurationOf"', "buildSuckerExtensionWrites", "runWrites"],
      },
      {
        file: "src/app/[slug]/components/v6/operator/operatorLib.ts",
        contains: ["reviewedCall", "requireDone", "operatorWriteRoute"],
      },
      {
        // A signer of an operator Safe proposes the exact call to that chain's
        // Safe queue (simulated FROM the Safe first) instead of sending it.
        file: "src/app/[slug]/components/v6/operator/useOperatorWrites.ts",
        contains: [
          "operatorWriteRoute",
          "account: route.safe",
          "signSafeTransactionAsync",
          "proposeSafeTransaction",
          "submitSafeConfirmation",
        ],
      },
    ],
  },
  {
    action: "settlement-sync",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/settlement/GossipCard.tsx",
        contains: ["buildSyncAccountingDataTx", "reviewedCall", "useReviewedAction"],
      },
    ],
  },
  {
    action: "queued-movements",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/settlement/QueuedMovementsCard.tsx",
        contains: ["buildV6ClaimTxFromRow", 'functionName: "toRemote"', "reviewedCall"],
      },
    ],
  },
  {
    action: "shop-items",
    sources: [
      {
        file: "src/app/[slug]/components/v6/shop/AddItemsModal.tsx",
        contains: ['functionName: "adjustTiers"', "runBatch", "preconditions"],
      },
    ],
  },
];

for (const { action, sources } of actionExpectations) {
  describe(action, () => {
    for (const { file, contains } of sources) {
      it(`${file} retains its reviewed contract operation and simulation boundary`, () => {
        const source = readFileSync(resolve(process.cwd(), file), "utf8");
        for (const fragment of contains) expect(source).toContain(fragment);
      });
    }
  });
}

describe("project handle ENS authorization", () => {
  it("presents the normalized draft or current handle as an absolute project URL", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("You’ll be able to find your project at");
    expect(source).toContain("parsed.handle?.handle ??");
    expect(source).toContain("inputWasEdited ? null : currentHandle?.handle");
    // The shown URL is the project's public address: always the canonical
    // origin, never the deployment-platform host the operator happens to be on.
    expect(source).toContain("NEXT_PUBLIC_SITE_URL");
    expect(source).not.toContain("window.location.origin");
    expect(source).toContain('routeHandle ?? "<handle>"');
    expect(source).toContain("{projectRoute}");
    expect(source).not.toContain("Project route");
    expect(source).not.toContain("Use any .eth name you control or are authorized to update.");
    expect(source).toContain("Publishing is blocked until the");
    expect(source).toContain("The current revnet operator could not be verified.");
    expect(source).toContain('placeholder="banny.eth"');
    expect(source).toContain('title="Set the ENS text record"');
    expect(source).toContain('title="Publish the handle"');
    expect(source).toContain("total={2}");
    expect(readFileSync(resolve(process.cwd(), "src/components/ui/TxSteps.tsx"), "utf8")).toContain(
      "Step {number} of {total}",
    );
    expect(source).toContain('handleProgress.nextAction === "publish" ? publish : setEnsRecord');
    expect(source).toContain("`Set ${parsed.handle.ensName} record`");
    expect(source).toContain("`Publish /@${parsed.handle.handle}`");
  });

  it("hosts the resumable two-step flow in a scroll-safe native dialog", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("<Dialog");
    expect(source).toContain("<DialogContent");
    expect(source).toContain(
      'className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto p-4 sm:p-6"',
    );
    expect(source).toContain("if (!next && busyAction) return");
    expect(source).toContain("showCloseButton={!busyAction}");
    expect(source).toContain("if (busyAction) event.preventDefault()");
    // The future URL is announced, not linked: the handle is not live until
    // the second transaction lands.
    expect(source).not.toContain("href={projectRoute}");
    expect(source).toContain('<span className="break-all">');
    expect(source).toContain("void setupQuery.refetch()");
  });

  it("pins the exact resolver while leaving owner and delegate authorization to simulation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("The exact resolver stays pinned");
    expect(source).toContain("ENS owners can approve delegates");
    expect(source).not.toContain("connectedIsEnsController");
    expect(source).not.toContain("fresh.ensController.toLowerCase()");
  });

  it("reviews the gas limit its ENS record write simulates and sends", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("gas: PROJECT_HANDLE_TEXT_WRITE_SIMULATION_GAS }");
  });

  it("live-checks the server fallback across every Operator authority surface", () => {
    for (const file of [
      "src/app/[slug]/components/v6/operator/OperatorAccountCard.tsx",
      "src/app/[slug]/components/v6/operator/SafeQueueCard.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain("useLiveRevnetOperators");
      expect(source).toContain("fallbackOperator");
      expect(source).not.toContain("pickRevnetOperator");
    }
    const edits = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/OperatorEditsCard.tsx"),
      "utf8",
    );
    expect(edits).toContain("fallbackOperator={fallbackOperator}");
  });

  it("registers the Safe App connector needed by an Ethereum operator Safe", async () => {
    // Asserted through the built config rather than the import line: the Safe
    // connector now loads lazily, so where it is imported from is an
    // implementation detail. What must hold is that Wagmi knows about it.
    const { createConfig, http } = await import("wagmi");
    const { mainnet } = await import("wagmi/chains");
    const { externalWalletConnectors } = await import("@/providers/wallet-connectors");

    const config = createConfig({
      chains: [mainnet],
      connectors: externalWalletConnectors(),
      transports: { [mainnet.id]: http() },
      multiInjectedProviderDiscovery: false,
      storage: null,
    });

    expect(config.connectors.map((connector) => connector.id)).toContain("safe");
  });

  it("rechecks the active ENS resolver and live cross-chain operator after receipts", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("confirmedResolver.toLowerCase() !== fresh.resolver.toLowerCase()");
    expect(source).toContain("const confirmedRecord = await readExactEnsText");
    expect(source).toContain("const confirmedAuthority = await readHandleAuthority");
    expect(source).toContain("const confirmed = await readHandleSetup");
    expect(source.match(/readHandleAuthority\(/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("mines every Safe execution and confirms it, and a handle's result, from the receipt", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/SafeQueueCard.tsx"),
      "utf8",
    );
    expect(source).toContain("const handleBinding = await verifyLiveQueuedTransaction(row, tx)");
    expect(source).toContain("await executeReviewedSafeTransaction(");
    expect(source).toContain("verifyQueuedProjectHandlePostcondition");
    expect(source).toContain("executionBlockNumber: receipt.blockNumber");
    expect(source).toContain("if (safeTransactionHasRefund(tx)) throw new Error(REFUND_REFUSAL)");
    // Connected as a Safe (the Safe app, or Safe{Wallet} over WalletConnect),
    // the Safe cannot sign or execute its own queue; every action button
    // defers to Safe{Wallet}, and renders again once the peer is known.
    expect(source).toContain("const viaSafeApp = useSafeConnection(config)");
    expect(source).toContain("canBatch && !viaSafeApp");
    expect(source).toContain("!viaSafeApp && !handleError && !refund && !signed && !ready");
    expect(source).toContain("!viaSafeApp && !handleError && !refund && ready");
    expect(source).toContain("Executed Safe transaction #${tx.nonce}");
  });

  it("binds project-handle publish inputs and the exact ENS record after review", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain(
      "args: [BigInt(project.chainId), BigInt(project.projectId), handle.parts]",
    );
    expect(source).toContain("() => reverifyPublish(handle, address)");
    expect(source).toContain("const record = await readExactEnsText");
    expect(source).toContain("record !== expectedRecord");
  });

  it("rechecks classified handle writes at every Safe queue wallet boundary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/SafeQueueCard.tsx"),
      "utf8",
    );
    expect(source.match(/verifyLiveQueuedTransaction/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(source).toContain("target.handleOnly");
    expect(source).toContain("bindingMatchesProject(binding, target.handleSource)");
    expect(source).toContain("verifyQueuedProjectHandleBinding");
  });
});
