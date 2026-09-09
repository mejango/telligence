"use client";

import { Nav } from "@/components/layout/Nav";
import { pinDraftItems } from "@/components/shop/itemDraft";
import { useToast } from "@/components/ui/use-toast";
import {
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
} from "@/hooks/useReviewedRelayr";
import {
  isSafeConnector,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { FormProvider } from "@/lib/forms";
import { withSchema } from "@/lib/formValidation";
import { gasWithHeadroom } from "@/lib/gas";
import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { createSalt, parseSuckerDeployerConfig } from "@bananapus/nana-sdk-core";
import { getProjectCreationFee } from "@bananapus/nana-sdk-core/v6";
import { useRef, useState } from "react";
import { encodeFunctionData, PublicClient } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { DEFAULT_FORM_DATA } from "./constants";
import { DeployRevnetForm, type DirectDeployment } from "./form/DeployRevnetForm";
import { createSchema } from "./helpers/createSchema";
import { bridgeableReserveAssets, verifyCustomReserveAsset } from "./helpers/customReserveAsset";
import { assertLaunchFeedsReachable } from "./helpers/feedReachability";
import { parseDeployData } from "./helpers/parseDeployData";
import { pinProjectMetadata } from "./helpers/pinProjectMetaData";
import { calculateFinalStageStarts } from "./helpers/recalculateStageStarts";
import { quotedStageStartOf, type QuotedStageStart } from "./helpers/staleQuote";
import { RevnetFormData } from "./types";

export default function Page() {
  const { toast } = useToast();
  const { address, chainId: connectedChainId, isConnected, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const { getRelayrTxQuote, data, reset } = useGetRelayrTxQuote();
  const [directDeployment, setDirectDeployment] = useState<DirectDeployment | null>(null);
  const [quotedStageStart, setQuotedStageStart] = useState<QuotedStageStart>();
  const quotedFormData = useRef<RevnetFormData | null>(null);

  async function deployProject(
    formData: RevnetFormData,
  ): Promise<RelayrPostBundleResponse | undefined> {
    if (!isConnected || !address) {
      throw new Error("Please connect your wallet to deploy");
    }
    if (formData.chainIds.length > 1 && isSafeConnector(connector)) {
      throw new Error("For a Safe deployment, select one chain.");
    }
    if (formData.chainIds.length > 1 && !areRelayrChainsCompatible(formData.chainIds)) {
      throw new Error(
        "Select supported chains from one network family: all mainnets or all testnets.",
      );
    }
    requireRelayrRecoveryScopeAvailable(address, "revnet-launch");
    setDirectDeployment(null);

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

    const salt = createSalt();
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
        throw new Error("Public client not available");
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

    if (directRequest) {
      const chainId = deploymentFormData.chainIds[0];
      if (connectedChainId !== chainId) await switchChainAsync({ chainId });
      const hash = await writeContractAsync({
        chainId,
        address: directRequest.address,
        abi: directRequest.abi,
        functionName: directRequest.functionName,
        args: directRequest.args,
        value: directRequest.value,
      } as unknown as Parameters<typeof writeContractAsync>[0]);
      if (submittedViaSafe(hash)) {
        toast({
          title: "Safe proposal submitted",
          description:
            "The deployment was proposed to your Safe. Approve and execute it there — your revnet exists once that transaction confirms.",
        });
        return;
      }
      setDirectDeployment({ chainId, hash });
      toast({
        title: "Revnet deployment submitted",
        description:
          "Once the transaction confirms, use the button at the bottom of this page to open your revnet.",
      });
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
  // chains so suckers still pair.
  async function rebuildStaleQuote(): Promise<RelayrPostBundleResponse> {
    const formData = quotedFormData.current;
    if (!formData) {
      throw new Error(
        "The original deploy request is unavailable. Clear the quote and get a new one.",
      );
    }
    const quote = await deployProject(formData);
    if (!quote) {
      throw new Error("Rebuilding the deploy request did not produce a new quote.");
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
            await deployProject({
              ...formData,
              stages: calculateFinalStageStarts(formData.stages),
            });
          } catch (e: any) {
            toast({
              variant: "destructive",
              title: "Error",
              description: e.message || "Error encoding transaction",
            });
            console.error(e);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <DeployRevnetForm
          relayrResponse={data}
          resetRelayrResponse={reset}
          directDeployment={directDeployment}
          quotedStageStart={quotedStageStart}
          rebuildStaleQuote={rebuildStaleQuote}
        />
      </FormProvider>
    </>
  );
}
