"use client";

import { Nav } from "@/components/layout/Nav";
import { pinDraftItems } from "@/components/shop/itemDraft";
import { useToast } from "@/components/ui/use-toast";
import { useReviewedAction } from "@/hooks/useReviewedAction";
import {
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
} from "@/hooks/useReviewedRelayr";
import { FormProvider } from "@/lib/forms";
import { withSchema } from "@/lib/formValidation";
import type { JBChainId, RelayrPostBundleResponse } from "@/lib/nana/types";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { requireProposedOrDone, reviewedCall } from "@/lib/reviewed-call";
import { isSafeConnector } from "@/lib/safe-connector";
import { formatWalletError } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { savedAttempts } from "@/lib/write-hold";
import { createSalt, parseSuckerDeployerConfig } from "@bananapus/nana-sdk-core";
import {
  gasWithHeadroom,
  SAVED_ATTEMPT_TAB_ONLY_LINE,
  type WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";
import { useSavedAttempt } from "@bananapus/nana-sdk-core/review/react";
import { getProjectCreationFee } from "@bananapus/nana-sdk-core/v6";
import { useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, PublicClient, type Hex } from "viem";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { DEFAULT_FORM_DATA } from "./constants";
import { DeployRevnetForm, type DirectDeployment } from "./form/DeployRevnetForm";
import {
  LaunchCheckNotice,
  LaunchConfirmingNotice,
  LaunchedNotice,
  LaunchHeldNotice,
} from "./form/LaunchedNotice";
import { clearBrowserDraft } from "./helpers/browserDraft";
import { createSchema } from "./helpers/createSchema";
import { bridgeableReserveAssets, verifyCustomReserveAsset } from "./helpers/customReserveAsset";
import { assertLaunchFeedsReachable } from "./helpers/feedReachability";
import {
  discardLaunch,
  launchAttemptOf,
  launchHoldsOf,
  launchInputOf,
  launchKeyOf,
  launchNamespacesOf,
  retrySaltOf,
  savedLaunchKeys,
  saveLaunchAttempt,
  settlementsOf,
  type LaunchAttempt,
} from "./helpers/launchIntent";
import {
  followLaunch,
  launchJournaled,
  recoverLaunchAt,
  type LaunchShown,
} from "./helpers/launchRecovery";
import { parseDeployData } from "./helpers/parseDeployData";
import { pinProjectMetadata } from "./helpers/pinProjectMetaData";
import { calculateFinalStageStarts } from "./helpers/recalculateStageStarts";
import { quotedStageStartOf, type QuotedStageStart } from "./helpers/staleQuote";
import { RevnetFormData } from "./types";

/** The launch journaled at `key` as the SDK's saved attempt, read on its own chain. */
function attemptAt(
  key: string,
  account: Hex,
  namespaces: readonly string[] | undefined,
  forcing: () => boolean,
): LaunchAttempt {
  const client = getPublicClient(wagmiConfig, {
    chainId: Number(key.split(":").at(-2)) as JBChainId,
  });
  if (!client) throw new Error("Could not connect to the chain. Try again.");
  return launchAttemptOf(key, account, client as PublicClient, namespaces, forcing);
}

export default function Page() {
  const { toast } = useToast();
  const { address, chainId: connectedChainId, isConnected, connector } = useAccount();
  /** The launch the hold is about to hand the wallet: journaled only once it is reserved. */
  const reserving = useRef<{ key: string; salt: Hex; save: () => void; namespaces: string[] }>(
    undefined,
  );
  const { run } = useReviewedAction();
  const unreserve = () => {
    const current = reserving.current;
    if (!current || !address) return;
    const client = getPublicClient(wagmiConfig, {
      chainId: Number(current.key.split(":").at(-2)) as JBChainId,
    });
    if (client)
      discardLaunch(
        launchAttemptOf(current.key, address, client as PublicClient, current.namespaces),
      );
  };

  const { getRelayrTxQuote, data, reset } = useGetRelayrTxQuote();
  const [directDeployment, setDirectDeployment] = useState<DirectDeployment | null>(null);
  /** The journaled launch the SDK's recovery is showing, recovered before anything is sent. */
  const [attempt, setAttempt] = useState<LaunchAttempt>();
  /** A saved launch the chain shows already happened: shown, and never sent again. */
  const [launched, setLaunched] = useState<{ chainId: number; revnetId: bigint }>();
  /** The check was refused over a journal that won't read: the warned exit is offered. */
  const [journalUnreadable, setJournalUnreadable] = useState(false);
  /** Set only for the warned exit over a journal that won't read. */
  const forcing = useRef(false);
  /** Each recovered attempt's scan generation: a cleared one lets the next journal be found. */
  const [scanned, setScanned] = useState(0);
  // One client per attempt: a new one would start its recovery over.
  const attemptClient = useMemo(
    () =>
      attempt ? getPublicClient(wagmiConfig, { chainId: attempt.chainId as JBChainId }) : undefined,
    [attempt],
  );
  const saved = useSavedAttempt({
    recovery: savedAttempts,
    attempt,
    client: attemptClient as WriteHoldClient | undefined,
    checkNext: "Launch again",
  });
  const [shown, setShown] = useState<LaunchShown>();
  /** Keys whose attempt ended here: never found again by this visit's scan. */
  const ended = useRef(new Set<string>());
  /** Shows the journaled launch at `key`, with the namespaces the submitted form holds it by. */
  const showAttempt = (key: string, account: Hex, namespaces?: readonly string[]) => {
    setJournalUnreadable(false);
    setShown(undefined);
    setAttempt(attemptAt(key, account, namespaces, () => forcing.current));
  };
  // What recovery found decides what the page shows; a launch it ends lets the next be found.
  useEffect(() => {
    if (!attempt || !saved.outcome) return;
    let live = true;
    void followLaunch(attempt, saved.outcome, saved.retire).then((next) => {
      if (!live) return;
      if (next?.kind === "launched") {
        setLaunched(next);
        clearBrowserDraft();
      }
      setShown(next?.kind === "launched" ? undefined : next);
      if (!next || next.kind === "launched") {
        ended.current.add(attempt.key);
        setAttempt(undefined);
        setScanned((generation) => generation + 1);
      }
    });
    return () => {
      live = false;
    };
  }, [attempt, saved.outcome, saved.retire]);
  // Every launch this account journaled is recovered on load: found, or checked by the user.
  useEffect(() => {
    if (!address || attempt) return;
    const key = savedLaunchKeys(address).find(
      (saved) => !ended.current.has(saved) && launchJournaled(saved),
    );
    if (key) setAttempt(attemptAt(key, address, undefined, () => forcing.current));
  }, [address, attempt, scanned]);
  const [quotedStageStart, setQuotedStageStart] = useState<QuotedStageStart>();
  const [paymentChainId, setPaymentChainId] = useState<number>();
  const quotedFormData = useRef<RevnetFormData | null>(null);

  async function deployProject(
    formData: RevnetFormData,
  ): Promise<RelayrPostBundleResponse | undefined> {
    if (!isConnected || !address) {
      throw new Error("Connect your wallet to launch the revnet.");
    }
    if (formData.chainIds.length > 1 && isSafeConnector(connector)) {
      throw new Error("For a Safe deployment, select one chain.");
    }
    if (formData.chainIds.length > 1 && !areRelayrChainsCompatible(formData.chainIds)) {
      throw new Error("Choose either live chains or test chains, not a mix.");
    }
    setDirectDeployment(null);
    setLaunched(undefined);
    // The one copy of what the user submitted: the launch's intent, journal and settlement are all
    // built from it, never from refreshed metadata.
    const launchInput = launchInputOf(formData);
    const singleChainId = formData.chainIds.length === 1 ? formData.chainIds[0]! : undefined;
    const launchKey =
      singleChainId === undefined ? undefined : launchKeyOf(address, singleChainId, launchInput);
    // A journaled attempt of this launch is recovered first, before anything is prepared.
    if (launchKey && singleChainId !== undefined && launchJournaled(launchKey)) {
      showAttempt(launchKey, address, launchNamespacesOf(singleChainId, address, launchInput));
      return;
    }
    // A launch waits while an earlier one's signature can still run, saying until when.
    await requireRelayrRecoveryScopeAvailable(address, "revnet-launch");

    let deploymentFormData = formData;
    if (formData.reserveAsset === "CUSTOM") {
      const verified = await verifyCustomReserveAsset(
        formData.customReserveAsset.address,
        formData.chainIds,
        (chainId) => getPublicClient(wagmiConfig, { chainId }),
      );
      deploymentFormData = { ...formData, customReserveAsset: verified };
    }

    // Arbitrary ERC-20s have no canonical bridge mapping. Empty mappings still
    // link the revnet/project token while keeping each chain's reserves local.
    const reserveAssets = bridgeableReserveAssets(deploymentFormData.reserveAsset);

    // Upload metadata
    const metadataCid = await pinProjectMetadata({
      name: deploymentFormData.name,
      description: deploymentFormData.description,
      logoUri: deploymentFormData.logoUri,
      twitter: deploymentFormData.twitter,
      telegram: deploymentFormData.telegram,
      discord: deploymentFormData.discord,
      infoUri: deploymentFormData.infoUri,
    });

    // Item media and metadata pin once: CIDs are chain-independent, so every chain in a
    // multichain launch deploys the same digests.
    if (deploymentFormData.store.items.length > 0) {
      deploymentFormData = {
        ...deploymentFormData,
        store: {
          ...deploymentFormData.store,
          items: await pinDraftItems(
            deploymentFormData.store.items,
            deploymentFormData.store.categories,
          ),
        },
      };
    }

    // Every new attempt has a fresh salt; a retry after the user checked an earlier one keeps its
    // salt, so that one landing after all makes the retry revert. A single-chain launch is
    // journaled with it once the hold reserves the wallet, so a reload can find a launch whose
    // reply was lost (the DeployRevnet event carries the salt); the write hold, keyed by the
    // config, is what stops a second launch. A multichain launch has its own recovery through
    // Relayr.
    const salt = (launchKey && retrySaltOf(launchKey)) || createSalt();
    const timestamp = Math.floor(Date.now() / 1000);

    const relayrTransactions = [];
    let directRequest: ReturnType<typeof parseDeployData> | null = null;
    let firstRequest: ReturnType<typeof parseDeployData> | null = null;

    for (const chainId of deploymentFormData.chainIds) {
      const suckerDeployerConfig = parseSuckerDeployerConfig(
        chainId,
        deploymentFormData.chainIds,
        reserveAssets,
        { version: 6 },
      ) as Parameters<typeof parseDeployData>[1]["suckerDeployerConfig"];

      const publicClient = getPublicClient(wagmiConfig, {
        chainId: chainId,
      });

      if (!publicClient) {
        throw new Error("Could not connect to the chain. Try again.");
      }

      // Deploying a new revnet requires paying the exact project creation fee.
      const creationFee = await getProjectCreationFee(publicClient as PublicClient, chainId);

      const request = parseDeployData(deploymentFormData, {
        metadataCid,
        chainId,
        suckerDeployerConfig,
        timestamp,
        salt,
        creationFee,
      });

      // Fail-closed: block the launch when any JBPrices pair the terminal
      // will need at runtime (context <-> base for pays, context <-> context
      // for cash-outs) has no reachable feed on this chain. Probed on-chain,
      // so registering the missing default feed unblocks the combination
      // without a client release.
      await assertLaunchFeedsReachable({
        chainId,
        publicClient: publicClient as PublicClient,
        contexts: request.args[2],
        baseCurrency: request.args[1].baseCurrency,
      });

      if (deploymentFormData.chainIds.length === 1) directRequest = request;
      if (!firstRequest) firstRequest = request;

      const encodedData = encodeFunctionData({
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
      });

      // Estimate gas for the transaction if it were to be sent directly to the revDeployer.
      // The estimate can fail if the deployer wallet doesn't hold the creation fee on this
      // chain, so fall back to a generous limit (Relayr re-simulates server-side).
      const gasEstimate = await publicClient
        .estimateContractGas({
          account: address,
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          value: request.value,
        })
        .catch(() => 8_000_000n);

      relayrTransactions.push({
        recoveryScope: "revnet-launch",
        data: {
          from: address,
          to: request.address,
          value: request.value,
          gas: gasWithHeadroom(gasEstimate),
          data: encodedData,
        },
        chainId,
        version: 6 as const,
        review: {
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          label: `Deploy ${deploymentFormData.name} on ${chainId}`,
          contractName: "REVDeployer",
        },
      });
    }

    if (directRequest && address) {
      const chainId = deploymentFormData.chainIds[0];
      const client = getPublicClient(wagmiConfig, { chainId }) as PublicClient | undefined;
      const namespaces = launchNamespacesOf(chainId, address, launchInput);
      const key = launchKey!;
      // The first block its DeployRevnet event can be in; a read that fails only skips the note.
      const fromBlock = await Promise.resolve()
        .then(() => client?.getBlockNumber())
        .catch(() => undefined);
      const before = settlementsOf(launchHoldsOf(chainId, address, namespaces));
      reserving.current = {
        key,
        salt,
        namespaces,
        save: () => saveLaunchAttempt(key, { salt, fromBlock, namespaces, before }),
      };
      // Held by the user's launch config: the salt, stage start and pin are the page's own.
      let result;
      try {
        result = requireProposedOrDone(
          await run({
            account: address,
            calls: [
              reviewedCall(
                { ...directRequest, chainId, args: directRequest.args as readonly unknown[] },
                {
                  intent: namespaces[0]!,
                  legacyIntents: namespaces.slice(1),
                  label: `Deploy ${deploymentFormData.name}`,
                  contractName: "REVDeployer",
                },
              ),
            ],
            beforeWallet: () => reserving.current?.save(),
            // Nothing reached the wallet: the SDK drops its reservation, and the journal goes too.
            onUnsent: () => unreserve(),
            onSubmitted: (_call, _step, hash, sent) => {
              if (sent.safe) return;
              setDirectDeployment({ chainId, hash });
              toast({
                title: "Revnet deployment submitted",
                description:
                  "Once the transaction confirms, use the button at the bottom of this page to open your revnet.",
              });
            },
          }),
        );
      } catch (error) {
        // A launch that may have reached the wallet is the SDK's recovery to show.
        if (launchJournaled(key)) {
          showAttempt(key, address, namespaces);
          return;
        }
        throw error;
      } finally {
        reserving.current = undefined;
      }
      if (result.status === "proposed") {
        toast({
          title: "Safe proposal submitted",
          description:
            "Approve and carry out the launch proposal in your Safe. Your revnet exists once the chain confirms that transaction.",
        });
        return;
      }
      // Launched: the SDK's recovery follows it and retires the journal, so the next launch of
      // this config is a new revnet, with a new salt. Nothing is shown here for it.
      if (client) void recoverLaunchAt(key, address, client as PublicClient, namespaces);
      return;
    }
    if (firstRequest) {
      quotedFormData.current = deploymentFormData;
      setQuotedStageStart(quotedStageStartOf(firstRequest, deploymentFormData));
    }
    return await getRelayrTxQuote(relayrTransactions);
  }

  // REVDeployer locks cash-outs and loans for 7 days when the first stage's
  // start time is already past at execution, and the quote freezes stage
  // starts. Paying a stale quote therefore rebuilds the whole request from the
  // same form data: `deployProject` captures one fresh timestamp shared by
  // every chain, keeping the encoded configuration byte-identical across
  // chains so suckers still pair. A different launch is never signed while the
  // stale one's requests can still run, which would let the two launch on
  // different chains: the rebuild waits until every one of them is dead at a
  // finalized block, saying until when, and the stale quote is never paid.
  async function rebuildStaleQuote(): Promise<RelayrPostBundleResponse> {
    const formData = quotedFormData.current;
    if (!formData) {
      throw new Error(
        "The original launch request is unavailable. Clear the quote and get a new one.",
      );
    }
    const quote = await deployProject(formData);
    if (!quote) {
      throw new Error("Could not refresh the quote. Clear it and try again.");
    }
    return quote;
  }

  return (
    <>
      <Nav />
      <FormProvider
        initialValues={DEFAULT_FORM_DATA}
        isInitialValid={false}
        validate={withSchema(createSchema)}
        onSubmit={async (formData: RevnetFormData, { setSubmitting }) => {
          try {
            setSubmitting(true);
            setPaymentChainId(connectedChainId);
            await deployProject({
              ...formData,
              stages: calculateFinalStageStarts(formData.stages),
            });
          } catch (e: any) {
            toast({
              variant: "destructive",
              title: "Error",
              description: formatWalletError(e, "Could not prepare the transaction. Try again."),
            });
            console.error(e);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {launched ? (
          <LaunchedNotice chainId={launched.chainId} revnetId={launched.revnetId} />
        ) : attempt && shown?.kind === "check" && saved.checkAction ? (
          <LaunchCheckNotice
            outcome={shown.outcome}
            unreadable={!!saved.unreadableAction || journalUnreadable}
            onChecked={() =>
              void saved.checkAction?.run().then((retired) => {
                if (retired.retired && !retired.durable)
                  toast({ description: SAVED_ATTEMPT_TAB_ONLY_LINE });
                if (retired.retired || retired.reason === "unreadable") return;
                // A journal that won't read refuses the check: only the warned exit is left.
                if (!attempt.salt) setJournalUnreadable(true);
                // Anything else changed under it (another tab's success or newer attempt): read
                // the journal again.
                else showAttempt(attempt.key, attempt.account, attempt.namespaces);
              })
            }
            onContinueAnyway={() => {
              forcing.current = true;
              void (
                saved.unreadableAction?.run() ??
                saved.retire({ by: "check", outcome: shown.outcome, force: "unreadable" })
              ).finally(() => {
                forcing.current = false;
              });
            }}
          />
        ) : attempt && attemptClient && shown?.kind === "held" ? (
          <LaunchHeldNotice
            attempt={attempt}
            client={attemptClient as WriteHoldClient}
            state={shown.state}
            onReleased={() => void saved.retire({ by: "exit" })}
            onEnded={() => void saved.recover()}
          />
        ) : shown?.kind === "confirming" ? (
          <LaunchConfirmingNotice onCheckAgain={() => void saved.recover()} />
        ) : null}
        <DeployRevnetForm
          relayrResponse={data}
          resetRelayrResponse={reset}
          preferredPaymentChainId={paymentChainId}
          directDeployment={directDeployment}
          quotedStageStart={quotedStageStart}
          rebuildStaleQuote={rebuildStaleQuote}
        />
      </FormProvider>
    </>
  );
}
