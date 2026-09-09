import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SourceExpectation = { file: string; contains: string[] };

const actionExpectations: Array<{
  marker: string;
  sources: SourceExpectation[];
}> = [
  {
    marker: "wallet-action:repay",
    sources: [
      {
        file: "src/app/[slug]/components/Value/RepayDialog.tsx",
        contains: [
          'functionName: "approve"',
          'functionName: "repayLoan"',
          "requireOnchainExecution",
        ],
      },
    ],
  },
  {
    marker: "wallet-action:claim-credits",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/accounts/V6ClaimCreditsDialog.tsx",
        contains: ["prepareCreditClaim", "OwnerDistributionBatchButton"],
      },
    ],
  },
  {
    marker: "wallet-action:split-hook",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/market/SplitHookCard.tsx",
        contains: ['"deployPool"', '"collectAndRouteLPFees"', "simulateContract"],
      },
    ],
  },
  {
    marker: "wallet-action:auto-issuance",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/V6AutoIssuanceSubtab.tsx",
        contains: ["prepareAutoIssuance", "OwnerDistributionBatchButton"],
      },
    ],
  },
  {
    marker: "wallet-action:token-admin",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/V6TokenPanel.tsx",
        contains: ['functionName: "setTokenMetadataOf"', 'functionName: "deployERC20For"'],
      },
    ],
  },
  {
    marker: "wallet-action:reserved-distribution",
    sources: [
      {
        file: "src/app/[slug]/owners/components/DistributeReservedTokensButton.tsx",
        contains: ["prepareReservedDistribution", "OwnerDistributionBatchButton"],
      },
    ],
  },
  {
    marker: "wallet-action:split-groups",
    sources: [
      {
        file: "src/app/[slug]/owners/components/hooks/useSetSplitGroups.ts",
        contains: ['functionName: "setSplitGroupsOf"', "getRelayrTxQuote", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:metadata",
    sources: [
      {
        file: "src/app/[slug]/about/components/EditMetadataDialog.tsx",
        contains: ['functionName: "setUriOf"', "getRelayrTxQuote", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:project-payer",
    sources: [
      {
        file: "src/app/[slug]/components/v6/extras/PayerDeployForm.tsx",
        contains: ["buildDeployProjectPayerTx", "runBatch", 'relayrMode: "raw"'],
      },
    ],
  },
  {
    marker: "wallet-action:project-handle",
    sources: [
      {
        file: "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx",
        contains: [
          'functionName: "setText"',
          'functionName: "setEnsNamePartsFor"',
          'functionName: "createProxyWithNonce"',
          "isLiveRevnetOperator",
          "simulateSafeProxyDeployment",
          "requireOnchainExecution",
        ],
      },
    ],
  },
  {
    marker: "wallet-action:operator-writes",
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
        contains: ["simulateContract", "writeContractAsync", "operatorWriteRoute"],
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
    marker: "wallet-action:settlement-sync",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/settlement/GossipCard.tsx",
        contains: ["buildSyncAccountingDataTx", "simulateContract", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:queued-movements",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/settlement/QueuedMovementsCard.tsx",
        contains: ["buildV6ClaimTxFromRow", 'functionName: "toRemote"', "simulateContract"],
      },
    ],
  },
  {
    marker: "wallet-action:shop-items",
    sources: [
      {
        file: "src/app/[slug]/components/v6/shop/AddItemsModal.tsx",
        contains: ['functionName: "adjustTiers"', "runBatch", "preconditions"],
      },
    ],
  },
];

for (const { marker, sources } of actionExpectations) {
  describe(marker, () => {
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
    expect(source).toContain('title="ENS juicebox text record"');
    expect(source).toContain('title="JBProjectHandles reverse claim"');
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
    expect(source).toContain("The exact resolver itself remains pinned");
    expect(source).toContain("approved delegates can also submit");
    expect(source).not.toContain("connectedIsEnsController");
    expect(source).not.toContain("fresh.ensController.toLowerCase()");
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
    expect(source).toContain("const confirmedAuthority = await readCrossChainHandleAuthority");
    expect(source).toContain("const confirmed = await readHandleSetup");
    expect(source.match(/readCrossChainHandleAuthority/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("mines and semantically confirms handle-scoped Safe executions only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/SafeQueueCard.tsx"),
      "utf8",
    );
    expect(source).toContain("const handleBinding = await verifyLiveQueuedTransaction(row, tx)");
    expect(source).toContain("manualReceiptVerification:");
    expect(source).toContain("if (handleBinding) {");
    expect(source).toContain("waitForReceiptWithRetry(publicClientFor(row.chainId), hash)");
    expect(source).toContain("requireSafeExecutionSuccess(receipt, row.safe, expectedSafeTxHash)");
    expect(source).toContain("verifyQueuedProjectHandlePostcondition");
    expect(source).toContain("executionBlockNumber: receipt.blockNumber");
    expect(source).toContain("releaseTransactionActivityVerification");
    expect(source).toContain("failTransactionActivityVerification");
    expect(source).toContain("handleExecutionHash = undefined");
    expect(source).toContain('handleBinding ? "Executed" : "Submitted"');
  });

  it("binds project-handle publish inputs and the exact ENS record after review", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain('variables.functionName !== "setEnsNamePartsFor"');
    expect(source).toContain("encodedChainId !== BigInt(project.chainId)");
    expect(source).toContain("encodedProjectId !== BigInt(project.projectId)");
    expect(source).toContain("canonicalProjectHandleParts");
    expect(source).toContain("const record = await readExactEnsText");
    expect(source).toContain("record !== expectedRecord");
  });

  it("rechecks classified handle writes at every Safe queue wallet boundary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/SafeQueueCard.tsx"),
      "utf8",
    );
    expect(source.match(/verifyLiveQueuedTransaction/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
    expect(source).toContain("target.handleOnly");
    expect(source).toContain("bindingMatchesProject(binding, target.handleSource)");
    expect(source).toContain("verifyQueuedProjectHandleBinding");
  });
});
