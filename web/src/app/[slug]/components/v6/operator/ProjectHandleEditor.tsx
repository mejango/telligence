"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ExternalLink } from "@/components/ExternalLink";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SkeletonLines } from "@/components/ui/skeleton";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { TxStep, stepStatus } from "@/components/ui/TxSteps";
import { useToast } from "@/components/ui/use-toast";
import { useCompleteProjectPermissions } from "@/hooks/useCompleteBendystrawLists";
import {
  isSafeProposalPendingError,
  requireOnchainExecution,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import {
  readCrossChainHandleAuthority,
  type CrossChainHandleAuthorityStatus,
} from "@/lib/cross-chain-authority";
import { getEnsPublicClient } from "@/lib/ensPublicClient";
import {
  ENS_NAME_WRAPPER_ADDRESS,
  ENS_REGISTRY_ADDRESS,
  JB_PROJECT_HANDLES_ADDRESS,
  PROJECT_HANDLE_CHAIN_ID,
  PROJECT_HANDLE_TEXT_KEY,
  canonicalProjectHandle,
  canonicalProjectHandleParts,
  ensNameWrapperAbi,
  ensRegistryAbi,
  ensTextResolverAbi,
  jbProjectHandlesAbi,
  parseProjectHandleInput,
  projectHandleProgress,
  projectHandleRecord,
  readExactEnsText,
  readExactProjectHandle,
  simulateExactEnsTextWrite,
  type ProjectHandle,
} from "@/lib/projectHandles";
import {
  findCurrentRevnetOperator,
  findRevnetOperatorFromPermissionHistory,
  revnetOperatorCandidates,
} from "@/lib/revnetOperator";
import {
  fetchSafeCreation,
  safeProxyFactoryAbi,
  simulateSafeProxyDeployment,
  validateSafeCreationForCurrentPolicy,
  verifySafeDeploymentAfterReceipt,
} from "@/lib/safeDeployment";
import { formatWalletError } from "@/lib/utils";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import {
  JBCoreContracts,
  RevnetCoreContracts,
  getJBContractAddress,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  isAddress,
  isAddressEqual,
  namehash,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { useAccount } from "wagmi";
import {
  chainName,
  isLiveRevnetOperator,
  permissionHoldersWhere,
  publicClientFor,
  type ChainProjectRow,
} from "./operatorLib";

type HandleSetup = {
  resolver: Address | null;
  ensController: Address | null;
  textRecord: string | null;
  verifiedHandle: string;
};

// The canonical origin, not the browser's: the shown URL is the project's
// public address, which shouldn't change when the operator browses via a
// deployment-platform domain.
const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002").replace(
  /\/+$/u,
  "",
);

function authorityStatusMessage(status: CrossChainHandleAuthorityStatus): string {
  switch (status) {
    case "missing-mainnet-safe":
      return "This operator Safe is not deployed at the same address on Ethereum yet.";
    case "source-contract":
    case "mainnet-contract":
      return "The operator is a contract which is not a recognized Safe on both chains.";
    case "authority-mismatch":
      return "The operator Safe has different control on Ethereum and the project chain.";
    case "unsafe-safe-policy":
      return "The operator Safe uses a guard or module policy which cannot publish a verified project handle.";
    case "contract-owner":
      return "Every operator Safe owner must be the same EOA (plain or exactly EIP-7702 delegated) on both chains.";
    default:
      return "The operator's Ethereum control could not be verified.";
  }
}

async function readEnsController(
  client: PublicClient,
  node: `0x${string}`,
  blockNumber: bigint,
): Promise<Address | null> {
  const registryOwner = await client.readContract({
    address: ENS_REGISTRY_ADDRESS,
    abi: ensRegistryAbi,
    functionName: "owner",
    args: [node],
    blockNumber,
  });
  if (registryOwner === zeroAddress) return null;
  if (registryOwner.toLowerCase() !== ENS_NAME_WRAPPER_ADDRESS.toLowerCase()) return registryOwner;

  const wrappedOwner = await client
    .readContract({
      address: ENS_NAME_WRAPPER_ADDRESS,
      abi: ensNameWrapperAbi,
      functionName: "ownerOf",
      args: [BigInt(node)],
      blockNumber,
    })
    .catch(() => zeroAddress);
  return wrappedOwner === zeroAddress ? null : wrappedOwner;
}

async function readHandleSetup(
  client: PublicClient,
  handle: ProjectHandle,
  project: ChainProjectRow,
  operator?: Address,
): Promise<HandleSetup> {
  const node = namehash(handle.ensName);
  const blockNumber = await client.getBlockNumber();
  const [resolver, ensController] = await Promise.all([
    client.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName: "resolver",
      args: [node],
      blockNumber,
    }),
    readEnsController(client, node, blockNumber),
  ]);
  const textRecord =
    resolver === zeroAddress
      ? null
      : await readExactEnsText(client, resolver, node, blockNumber).catch(() => null);

  if (!operator) {
    return {
      resolver: resolver === zeroAddress ? null : resolver,
      ensController,
      textRecord,
      verifiedHandle: "",
    };
  }

  const verifiedHandle =
    (await readExactProjectHandle(
      client,
      project.chainId,
      project.projectId,
      operator,
      blockNumber,
    )) ?? "";

  return {
    resolver: resolver === zeroAddress ? null : resolver,
    ensController,
    textRecord,
    verifiedHandle,
  };
}

/**
 * Two-party, resumable handle setup. An ENS-authorized account writes the
 * forward text record; the live revnet operator publishes the reverse claim.
 * Neither role is inferred from the permissionless handles contract.
 */
export function ProjectHandleEditor({
  project,
  fallbackOperator,
}: {
  project: ChainProjectRow;
  fallbackOperator?: string;
}) {
  const { address } = useAccount();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [inputWasEdited, setInputWasEdited] = useState(false);
  const [busyAction, setBusyAction] = useState<"ens" | "deploy-safe" | "publish" | null>(null);
  const [review, setReview] = useState<"step" | "deploy-safe" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const siteOrigin = SITE_ORIGIN;

  const holdersQuery = useCompleteProjectPermissions(
    permissionHoldersWhere([project], {
      account: getJBContractAddress(RevnetCoreContracts.REVOwner, 6, project.chainId),
    }),
    true,
  );
  const operatorCandidates = useMemo(() => {
    const candidates = revnetOperatorCandidates(
      (holdersQuery.data ?? []).filter(
        (item) => item.chainId === project.chainId && item.projectId === project.projectId,
      ),
    );
    if (
      fallbackOperator &&
      isAddress(fallbackOperator) &&
      fallbackOperator.toLowerCase() !== zeroAddress &&
      !candidates.some((candidate) => candidate.toLowerCase() === fallbackOperator.toLowerCase())
    ) {
      candidates.push(fallbackOperator);
    }
    if (
      address &&
      !candidates.some((candidate) => candidate.toLowerCase() === address.toLowerCase())
    ) {
      candidates.push(address);
    }
    return candidates;
  }, [address, fallbackOperator, holdersQuery.data, project.chainId, project.projectId]);

  // Bendystraw only discovers the candidate. The target-chain REVOwner read is
  // the authority for whether it is still the current operator.
  const operatorQuery = useQuery({
    queryKey: [
      "v6-project-handle-operator",
      project.chainId,
      project.projectId,
      operatorCandidates,
    ],
    enabled: !holdersQuery.isLoading || operatorCandidates.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const client = publicClientFor(project.chainId);
      const indexed = await findCurrentRevnetOperator(operatorCandidates, (candidate) =>
        isLiveRevnetOperator(client, project, candidate),
      );
      if (indexed) return indexed;

      // If the indexer has not caught up, recover candidates from the exact
      // REVOwner permission history. Every candidate is still checked against
      // live JBProjects/REVOwner state before the editor trusts it.
      return findRevnetOperatorFromPermissionHistory({
        client,
        chainId: project.chainId,
        permissions: getJBContractAddress(JBCoreContracts.JBPermissions, 6, project.chainId),
        revOwner: getJBContractAddress(RevnetCoreContracts.REVOwner, 6, project.chainId),
        projectId: BigInt(project.projectId),
        throughBlock: await client.getBlockNumber(),
        accept: (candidate) => isLiveRevnetOperator(client, project, candidate),
      });
    },
  });
  const operator = operatorQuery.data ?? undefined;

  const authorityQuery = useQuery({
    queryKey: ["v6-project-handle-authority", project.chainId, project.projectId, operator],
    enabled: Boolean(operator),
    staleTime: 10_000,
    queryFn: () =>
      readCrossChainHandleAuthority({
        sourceChainId: project.chainId,
        sourceClient: publicClientFor(project.chainId),
        mainnetClient: getEnsPublicClient(),
        authority: operator!,
      }),
  });
  const authorityAllowed = authorityQuery.data?.allowed === true;
  const sourceSafe =
    authorityQuery.data?.source?.kind === "safe" ? authorityQuery.data.source : undefined;
  const mainnetSafeMissing = authorityQuery.data?.status === "missing-mainnet-safe";
  const safeCreationQuery = useQuery({
    queryKey: ["v6-project-handle-safe-creation", project.chainId, operator],
    enabled: Boolean(operator && mainnetSafeMissing),
    staleTime: 60_000,
    queryFn: () => fetchSafeCreation(operator!, [project.chainId]),
  });
  const safeCreationValidation = useMemo(
    () =>
      sourceSafe && safeCreationQuery.data
        ? validateSafeCreationForCurrentPolicy(safeCreationQuery.data, sourceSafe)
        : null,
    [safeCreationQuery.data, sourceSafe],
  );
  const connectedIsSafeOwner = Boolean(
    address && sourceSafe?.owners.some((owner) => isAddressEqual(owner, address)),
  );

  const currentHandleQuery = useQuery({
    queryKey: ["v6-project-handle-current", project.chainId, project.projectId, operator],
    enabled: Boolean(operator && authorityAllowed),
    staleTime: 15_000,
    queryFn: () =>
      readExactProjectHandle(getEnsPublicClient(), project.chainId, project.projectId, operator!),
  });
  const currentHandle = useMemo(
    () => (currentHandleQuery.data ? canonicalProjectHandle(currentHandleQuery.data) : null),
    [currentHandleQuery.data],
  );

  useEffect(() => {
    if (!inputWasEdited && currentHandle) {
      setInput(`@${currentHandle.handle}`);
    }
  }, [currentHandle, inputWasEdited]);

  const parsed = useMemo(() => {
    if (!input.trim()) return { handle: null, error: null };
    try {
      return { handle: parseProjectHandleInput(input), error: null };
    } catch (cause) {
      return {
        handle: null,
        error: cause instanceof Error ? cause.message : "Enter a valid ENS handle.",
      };
    }
  }, [input]);
  const routeHandle = parsed.handle?.handle ?? (inputWasEdited ? null : currentHandle?.handle);
  const projectRoute = `/@${routeHandle ?? "<handle>"}`;

  const setupQuery = useQuery({
    queryKey: [
      "v6-project-handle-setup",
      project.chainId,
      project.projectId,
      operator,
      parsed.handle?.ensName,
    ],
    enabled: Boolean(parsed.handle),
    staleTime: 10_000,
    queryFn: () => readHandleSetup(getEnsPublicClient(), parsed.handle!, project, operator),
  });

  const expectedRecord = projectHandleRecord(project.chainId, project.projectId);
  const textMatches = setupQuery.data?.textRecord === expectedRecord;
  const reverseClaimMatches = Boolean(
    parsed.handle && setupQuery.data?.verifiedHandle === parsed.handle.handle,
  );
  const handleProgress = projectHandleProgress(textMatches, reverseClaimMatches);
  const fullyVerified = authorityAllowed && handleProgress.complete;
  const connectedIsOperator = Boolean(
    address && operator && address.toLowerCase() === operator.toLowerCase(),
  );
  const { writeContractAsync: writeEnsText } = useWriteContract({
    transactionReview: {
      title: "Review ENS project record",
      label: "Set ENS juicebox record",
      description: `Set the ENS ${PROJECT_HANDLE_TEXT_KEY} text record to ${expectedRecord}.`,
    },
    reverify: async (variables) => {
      const node = variables.args?.[0];
      if (typeof node !== "string") throw new Error("The ENS node changed before submission.");
      const liveResolver = await getEnsPublicClient().readContract({
        address: ENS_REGISTRY_ADDRESS,
        abi: ensRegistryAbi,
        functionName: "resolver",
        args: [node as `0x${string}`],
      });
      if (liveResolver.toLowerCase() !== variables.address.toLowerCase()) {
        throw new Error("The ENS resolver changed. Check the name and review again.");
      }
      // Resolver authorization is intentionally left to reviewed simulation:
      // ENS owners can approve delegates and custom resolvers can define their
      // own authorization policy. The exact resolver itself remains pinned.
    },
    preflightSimulation: async (variables, account) => {
      const [node, key, value] = variables.args ?? [];
      if (
        typeof node !== "string" ||
        key !== PROJECT_HANDLE_TEXT_KEY ||
        typeof value !== "string"
      ) {
        throw new Error("The ENS record changed before simulation.");
      }
      const gas = await simulateExactEnsTextWrite(
        getEnsPublicClient(),
        variables.address,
        node as `0x${string}`,
        value,
        account,
      );
      return { gas };
    },
  });
  const { writeContractAsync: publishHandle } = useWriteContract({
    transactionReview: {
      title: "Review project handle",
      label: "Publish project handle",
      description: `Publish this handle for ${expectedRecord} under the current revnet operator's authoritative slot.`,
    },
    reverify: async (variables, account) => {
      const [encodedChainId, encodedProjectId, encodedParts] = variables.args ?? [];
      const callHandle = Array.isArray(encodedParts)
        ? canonicalProjectHandleParts(
            encodedParts.filter((part): part is string => typeof part === "string"),
          )
        : null;
      if (
        Number(variables.chainId) !== PROJECT_HANDLE_CHAIN_ID ||
        !isAddressEqual(variables.address, JB_PROJECT_HANDLES_ADDRESS) ||
        variables.functionName !== "setEnsNamePartsFor" ||
        (variables.value !== undefined && BigInt(variables.value) !== 0n) ||
        (variables.args?.length ?? 0) !== 3 ||
        typeof encodedChainId !== "bigint" ||
        encodedChainId !== BigInt(project.chainId) ||
        typeof encodedProjectId !== "bigint" ||
        encodedProjectId !== BigInt(project.projectId) ||
        !Array.isArray(encodedParts) ||
        !encodedParts.every((part) => typeof part === "string") ||
        !callHandle ||
        !parsed.handle ||
        callHandle.handle !== parsed.handle.handle
      ) {
        throw new Error("The reviewed project-handle inputs changed before submission.");
      }
      const isCurrent = await isLiveRevnetOperator(
        publicClientFor(project.chainId),
        project,
        account,
      );
      if (!isCurrent) throw new Error("The connected account is no longer this revnet's operator.");
      const authority = await readCrossChainHandleAuthority({
        sourceChainId: project.chainId,
        sourceClient: publicClientFor(project.chainId),
        mainnetClient: getEnsPublicClient(),
        authority: account,
      });
      if (!authority.allowed) throw new Error(authorityStatusMessage(authority.status));

      const mainnetClient = getEnsPublicClient();
      const blockNumber = await mainnetClient.getBlockNumber();
      const node = namehash(callHandle.ensName);
      const resolver = await mainnetClient.readContract({
        address: ENS_REGISTRY_ADDRESS,
        abi: ensRegistryAbi,
        functionName: "resolver",
        args: [node],
        blockNumber,
      });
      if (isAddressEqual(resolver, zeroAddress)) {
        throw new Error("The reviewed ENS name no longer has a resolver.");
      }
      const record = await readExactEnsText(mainnetClient, resolver, node, blockNumber);
      if (record !== expectedRecord) {
        throw new Error(`The exact ENS juicebox record must still equal ${expectedRecord}.`);
      }
    },
  });
  const { writeContractAsync: deployOperatorSafe } = useWriteContract({
    transactionReview: {
      title: "Review Ethereum Safe deployment",
      label: "Deploy operator Safe",
      description:
        "Reproduce the operator Safe at its same address on Ethereum so that its exact policy can publish this project's handle.",
    },
    reverify: async (variables, account) => {
      const sourceClient = publicClientFor(project.chainId);
      const mainnetClient = getEnsPublicClient();
      if (!operator || !(await isLiveRevnetOperator(sourceClient, project, operator))) {
        throw new Error("The operator changed before the Safe deployment was submitted.");
      }
      const authority = await readCrossChainHandleAuthority({
        sourceChainId: project.chainId,
        sourceClient,
        mainnetClient,
        authority: operator,
      });
      if (authority.status !== "missing-mainnet-safe" || authority.source?.kind !== "safe") {
        throw new Error("The operator Safe no longer needs this Ethereum deployment.");
      }
      if (!authority.source.owners.some((owner) => isAddressEqual(owner, account))) {
        throw new Error("Connect a current EOA owner of the operator Safe to deploy it.");
      }
      const creation = await fetchSafeCreation(operator, [project.chainId]);
      if (!creation) throw new Error("The Safe creation transaction could not be recovered.");
      const validation = validateSafeCreationForCurrentPolicy(creation, authority.source);
      if (!validation.valid) {
        throw new Error("The Safe's creation policy no longer matches its live operator policy.");
      }
      const simulation = await simulateSafeProxyDeployment({
        client: mainnetClient,
        creation,
        expectedSafe: operator,
        account,
        currentSafe: authority.source,
      });
      if (!simulation.valid) {
        throw new Error(`The same-address Safe deployment is unavailable (${simulation.reason}).`);
      }
      if (
        !isAddressEqual(variables.address, simulation.call.target) ||
        variables.functionName !== simulation.call.functionName ||
        !variables.args ||
        variables.args[0] !== simulation.call.args[0] ||
        variables.args[1] !== simulation.call.args[1] ||
        variables.args[2] !== simulation.call.args[2]
      ) {
        throw new Error("The reviewed Safe deployment inputs changed before submission.");
      }
    },
  });

  const deploySafeOnMainnet = async () => {
    if (
      !address ||
      !operator ||
      !sourceSafe ||
      !safeCreationQuery.data ||
      !safeCreationValidation?.valid ||
      busyAction
    ) {
      return;
    }
    setBusyAction("deploy-safe");
    setError(null);
    setStatus("Checking the same-address Ethereum Safe deployment…");
    try {
      if (!connectedIsSafeOwner) {
        throw new Error("Connect a current EOA owner of the operator Safe to deploy it.");
      }
      const sourceClient = publicClientFor(project.chainId);
      const mainnetClient = getEnsPublicClient();
      if (!(await isLiveRevnetOperator(sourceClient, project, operator))) {
        throw new Error("The revnet operator changed before Safe deployment.");
      }
      const liveAuthority = await readCrossChainHandleAuthority({
        sourceChainId: project.chainId,
        sourceClient,
        mainnetClient,
        authority: operator,
      });
      if (
        liveAuthority.status !== "missing-mainnet-safe" ||
        liveAuthority.source?.kind !== "safe"
      ) {
        throw new Error("The operator Safe no longer needs this Ethereum deployment.");
      }
      const creation = await fetchSafeCreation(operator, [project.chainId]);
      if (!creation) throw new Error("The Safe creation transaction could not be recovered.");
      const validation = validateSafeCreationForCurrentPolicy(creation, liveAuthority.source);
      if (!validation.valid) {
        throw new Error("The Safe's original creation policy no longer matches its live policy.");
      }
      const simulation = await simulateSafeProxyDeployment({
        client: mainnetClient,
        creation,
        expectedSafe: operator,
        account: address,
        currentSafe: liveAuthority.source,
      });
      if (!simulation.valid) {
        throw new Error(`The same-address Safe deployment is unavailable (${simulation.reason}).`);
      }

      setStatus("Confirm the Ethereum Safe deployment in its owner's wallet…");
      // wallet-action:project-handle
      const hash = await deployOperatorSafe({
        chainId: PROJECT_HANDLE_CHAIN_ID,
        address: simulation.call.target,
        abi: safeProxyFactoryAbi,
        functionName: "createProxyWithNonce",
        args: simulation.call.args,
      });
      requireOnchainExecution(hash, "Deploy operator Safe on Ethereum");
      setStatus("Waiting for the Ethereum Safe deployment to confirm…");
      const receipt = await waitForReceiptWithRetry(mainnetClient, hash);
      if (receipt.status !== "success")
        throw new Error("The Safe deployment transaction reverted.");
      const confirmed = await verifySafeDeploymentAfterReceipt({
        sourceChainId: project.chainId,
        sourceClient,
        mainnetClient,
        authority: operator,
      });
      if (!confirmed.allowed || confirmed.status !== "valid-safe") {
        throw new Error(
          `The Safe deployed, but its current Ethereum policy does not match (${confirmed.status}).`,
        );
      }
      setStatus(
        "The operator Safe is ready on Ethereum. Connect it through Safe and publish the handle.",
      );
      setReview(null);
      toast({ title: "Operator Safe deployed on Ethereum" });
      await authorityQuery.refetch();
    } catch (cause) {
      const message = formatWalletError(cause, "Could not deploy the operator Safe on Ethereum.");
      setError(message);
      toast(
        isSafeProposalPendingError(cause)
          ? { title: "Safe proposal submitted", description: message }
          : { variant: "destructive", title: "Error", description: message },
      );
    } finally {
      setBusyAction(null);
    }
  };

  const setEnsRecord = async () => {
    if (!address || !parsed.handle || busyAction) return;
    setBusyAction("ens");
    setError(null);
    setStatus("Step 1 of 2: checking the ENS resolver on Ethereum…");
    try {
      const client = getEnsPublicClient();
      const fresh = await readHandleSetup(client, parsed.handle, project, operator);
      if (!fresh.resolver) {
        throw new Error(
          `${parsed.handle.ensName} has no explicit resolver. Set one in ENS Manager before writing its project record.`,
        );
      }
      if (fresh.textRecord === expectedRecord) {
        setStatus(
          fresh.verifiedHandle === parsed.handle.handle
            ? "Both steps are already complete."
            : "Step 1 of 2 is already complete: ENS has the correct juicebox record.",
        );
        setReview(null);
        await setupQuery.refetch();
        return;
      }

      setStatus("Step 1 of 2: confirm the ENS juicebox text-record transaction in your wallet…");
      // wallet-action:project-handle
      const hash = await writeEnsText({
        chainId: PROJECT_HANDLE_CHAIN_ID,
        address: fresh.resolver,
        abi: ensTextResolverAbi,
        functionName: "setText",
        args: [namehash(parsed.handle.ensName), PROJECT_HANDLE_TEXT_KEY, expectedRecord],
      });
      requireOnchainExecution(hash, "Set ENS project record");
      setStatus("Step 1 of 2: waiting for the ENS juicebox text record to confirm…");
      const receipt = await waitForReceiptWithRetry(client, hash);
      if (receipt.status !== "success")
        throw new Error("The ENS text-record transaction reverted.");
      const confirmedBlock = await client.getBlockNumber();
      const confirmedResolver = await client.readContract({
        address: ENS_REGISTRY_ADDRESS,
        abi: ensRegistryAbi,
        functionName: "resolver",
        args: [namehash(parsed.handle.ensName)],
        blockNumber: confirmedBlock,
      });
      if (confirmedResolver.toLowerCase() !== fresh.resolver.toLowerCase()) {
        throw new Error("The ENS resolver changed before the record could be verified.");
      }
      const confirmedRecord = await readExactEnsText(
        client,
        confirmedResolver,
        namehash(parsed.handle.ensName),
        confirmedBlock,
      );
      if (confirmedRecord !== expectedRecord) {
        throw new Error(
          "The ENS transaction confirmed, but the exact resolver record is unchanged.",
        );
      }
      toast({ title: "ENS project record set" });
      setReview(null);
      const refreshed = await setupQuery.refetch();
      setStatus(
        refreshed.data?.verifiedHandle === parsed.handle.handle
          ? "Both steps are complete. The existing JBProjectHandles reverse claim was preserved."
          : "Step 1 of 2 complete: ENS points to this project. Continue with the JBProjectHandles reverse claim.",
      );
    } catch (cause) {
      const message = formatWalletError(cause, "Could not set the ENS project record.");
      setError(message);
      toast(
        isSafeProposalPendingError(cause)
          ? { title: "Safe proposal submitted", description: message }
          : { variant: "destructive", title: "Error", description: message },
      );
    } finally {
      setBusyAction(null);
    }
  };

  const publish = async () => {
    if (!address || !parsed.handle || busyAction) return;
    setBusyAction("publish");
    setError(null);
    setStatus("Step 2 of 2: confirming the current revnet operator…");
    try {
      const liveProjectClient = publicClientFor(project.chainId);
      const addressIsCurrent = await isLiveRevnetOperator(liveProjectClient, project, address);
      if (!addressIsCurrent) {
        throw new Error("Connect the current revnet operator to publish this handle.");
      }
      const liveCandidate = address;

      const liveAuthority = await readCrossChainHandleAuthority({
        sourceChainId: project.chainId,
        sourceClient: liveProjectClient,
        mainnetClient: getEnsPublicClient(),
        authority: liveCandidate,
      });
      if (!liveAuthority.allowed) throw new Error(authorityStatusMessage(liveAuthority.status));

      const client = getEnsPublicClient();
      const fresh = await readHandleSetup(client, parsed.handle, project, liveCandidate);
      if (fresh.textRecord !== expectedRecord) {
        throw new Error(`Set the ENS juicebox record to ${expectedRecord} before publishing.`);
      }
      if (fresh.verifiedHandle === parsed.handle.handle) {
        setStatus("Step 2 of 2 is already complete: the reverse claim is published.");
        setReview(null);
        await setupQuery.refetch();
        return;
      }

      setStatus("Step 2 of 2: confirm the JBProjectHandles transaction in your wallet…");
      // wallet-action:project-handle
      const hash = await publishHandle({
        chainId: PROJECT_HANDLE_CHAIN_ID,
        address: JB_PROJECT_HANDLES_ADDRESS,
        abi: jbProjectHandlesAbi,
        functionName: "setEnsNamePartsFor",
        args: [BigInt(project.chainId), BigInt(project.projectId), parsed.handle.parts],
      });
      requireOnchainExecution(hash, "Publish project handle");
      setStatus("Step 2 of 2: waiting for the JBProjectHandles reverse claim to confirm…");
      const receipt = await waitForReceiptWithRetry(client, hash);
      if (receipt.status !== "success") throw new Error("The project-handle transaction reverted.");

      const operatorStillCurrent = await isLiveRevnetOperator(
        liveProjectClient,
        project,
        liveCandidate,
      );
      if (!operatorStillCurrent) {
        throw new Error("The project handle confirmed after the revnet operator changed.");
      }
      const confirmedAuthority = await readCrossChainHandleAuthority({
        sourceChainId: project.chainId,
        sourceClient: liveProjectClient,
        mainnetClient: client,
        authority: liveCandidate,
      });
      if (!confirmedAuthority.allowed) {
        throw new Error(
          `The project handle confirmed after authority changed. ${authorityStatusMessage(confirmedAuthority.status)}`,
        );
      }
      const confirmed = await readHandleSetup(client, parsed.handle, project, liveCandidate);
      if (!confirmed.resolver || confirmed.textRecord !== expectedRecord) {
        throw new Error("The project handle confirmed after the ENS record changed.");
      }
      if (confirmed.verifiedHandle !== parsed.handle.handle) {
        throw new Error("The transactions confirmed, but the two-way handle check did not verify.");
      }
      setStatus(`Both steps are complete. @${confirmed.verifiedHandle} is published and verified.`);
      setReview(null);
      toast({ title: "Project handle published" });
      await Promise.all([setupQuery.refetch(), currentHandleQuery.refetch()]);
    } catch (cause) {
      const message = formatWalletError(cause, "Could not publish the project handle.");
      setError(message);
      toast(
        isSafeProposalPendingError(cause)
          ? { title: "Safe proposal submitted", description: message }
          : { variant: "destructive", title: "Error", description: message },
      );
    } finally {
      setBusyAction(null);
    }
  };

  const openEditor = () => {
    setOpen(true);
    // A dismissed Safe proposal may have executed since the last visit. Always
    // resume from fresh live records so reopening advances without submitting
    // either completed step again.
    void operatorQuery.refetch();
    if (operator) void authorityQuery.refetch();
    if (parsed.handle) void setupQuery.refetch();
    if (operator && authorityAllowed) void currentHandleQuery.refetch();
  };

  return (
    <div className="bg-melon-50 p-4">
      <p className="text-sm font-medium">Project handle</p>
      <p className="mt-1 text-xs text-zinc-500">
        Create or resume the verified ENS route in two explicit Ethereum steps.
      </p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={openEditor}>
        Set project handle
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && busyAction) return;
          setOpen(next);
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto p-4 sm:p-6"
          showCloseButton={!busyAction}
          onEscapeKeyDown={(event) => {
            if (busyAction) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Set project handle</DialogTitle>
            <DialogDescription>
              First confirm the ENS juicebox text record, then publish the matching JBProjectHandles
              reverse claim.
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0">
            {siteOrigin ? (
              <p className="min-w-0 break-words text-xs text-zinc-500">
                You’ll be able to find your project at{" "}
                <span className="break-all">
                  {siteOrigin}
                  {projectRoute}
                </span>
              </p>
            ) : null}

            {operatorQuery.isLoading || holdersQuery.isLoading ? (
              <SkeletonLines lines={2} className="mt-3" />
            ) : operatorQuery.isError || !operator ? (
              <p className="mt-3 text-xs text-amber-700">
                The current revnet operator could not be verified. ENS can be prepared, but the
                handle cannot be published until this live authority check succeeds.
              </p>
            ) : null}

            {operator && authorityQuery.isLoading ? (
              <SkeletonLines lines={1} className="mt-3" />
            ) : operator && authorityQuery.data && !authorityAllowed ? (
              <p className="mt-3 text-xs text-amber-700">
                {authorityStatusMessage(authorityQuery.data.status)} Publishing is blocked until the
                current operator can originate the Ethereum claim.
              </p>
            ) : operator && authorityQuery.isError ? (
              <p className="mt-3 text-xs text-amber-700">
                The operator's cross-chain authority could not be checked. Publishing remains
                disabled.
              </p>
            ) : null}

            {operator && sourceSafe && mainnetSafeMissing ? (
              <div className="mt-3 border border-amber-200 bg-amber-50 p-3 text-xs text-zinc-700">
                <p className="font-medium">Prepare the operator Safe on Ethereum</p>
                <p className="mt-1">
                  This replays the Safe's original deterministic deployment only when its
                  initializer, current owners, threshold, singleton, fallback handler, guard,
                  modules, and EOA-owner policy all remain safe and consistent.
                </p>
                {safeCreationQuery.isLoading ? (
                  <SkeletonLines lines={1} className="mt-2" />
                ) : !safeCreationQuery.data ? (
                  <p className="mt-2 text-amber-700">
                    The Safe creation record could not be recovered from its source-chain service.
                  </p>
                ) : safeCreationValidation && !safeCreationValidation.valid ? (
                  <p className="mt-2 text-amber-700">
                    The original Safe initializer does not reproduce its current hardened policy (
                    {safeCreationValidation.reason}).
                  </p>
                ) : (
                  <>
                    {address && !connectedIsSafeOwner ? (
                      <p className="mt-2 text-amber-700">
                        Connect a current EOA owner of the operator Safe to deploy it.
                      </p>
                    ) : null}
                    <ButtonWithWallet
                      targetChainId={PROJECT_HANDLE_CHAIN_ID as JBChainId}
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      loading={busyAction === "deploy-safe"}
                      disabled={
                        Boolean(busyAction) ||
                        !safeCreationValidation?.valid ||
                        Boolean(address && !connectedIsSafeOwner)
                      }
                      onClick={() => {
                        setError(null);
                        setStatus(null);
                        setReview("deploy-safe");
                      }}
                    >
                      Deploy operator Safe on Ethereum
                    </ButtonWithWallet>
                  </>
                )}
              </div>
            ) : null}

            <label
              className="mt-3 block text-xs font-medium text-zinc-700"
              htmlFor="project-handle"
            >
              Your .eth name
            </label>
            <Input
              id="project-handle"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setInputWasEdited(true);
                setStatus(null);
                setError(null);
              }}
              disabled={Boolean(busyAction)}
              placeholder="banny.eth"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1"
            />
            {parsed.error ? <p className="mt-1 text-xs text-red-600">{parsed.error}</p> : null}

            {parsed.handle ? (
              <div className="mt-3 space-y-3 text-xs">
                <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-zinc-500">ENS name</dt>
                  <dd>{parsed.handle.ensName}</dd>
                  <dt className="text-zinc-500">Required record</dt>
                  <dd className="font-mono">
                    {PROJECT_HANDLE_TEXT_KEY}={expectedRecord}
                  </dd>
                  <dt className="text-zinc-500">ENS controller</dt>
                  <dd className="break-all font-mono">
                    {setupQuery.data?.ensController ?? "Unknown"}
                  </dd>
                </dl>

                {setupQuery.isLoading ? (
                  <SkeletonLines lines={2} />
                ) : setupQuery.isError ? (
                  <p className="text-red-600">
                    The ENS and project-handle records could not be read.
                  </p>
                ) : (
                  <>
                    {!setupQuery.data?.resolver ? (
                      <p className="text-amber-700">
                        This name has no explicit ENS resolver. Set one in{" "}
                        <ExternalLink href={`https://app.ens.domains/${parsed.handle.ensName}`}>
                          ENS Manager
                        </ExternalLink>{" "}
                        first; this app will not install or replace one.
                      </p>
                    ) : null}
                    <ol className="space-y-3 rounded border border-melon-200 bg-melon-50 p-3">
                      <TxStep
                        number={1}
                        total={2}
                        title="ENS juicebox text record"
                        status={stepStatus(
                          handleProgress.ensRecordComplete,
                          handleProgress.nextAction === "ens",
                        )}
                      >
                        <p className="mt-1 text-zinc-500">
                          {handleProgress.ensRecordComplete
                            ? `${PROJECT_HANDLE_TEXT_KEY}=${expectedRecord} is confirmed on ${parsed.handle.ensName}.`
                            : `Set ${PROJECT_HANDLE_TEXT_KEY}=${expectedRecord} on ${parsed.handle.ensName}.`}
                        </p>
                        {!handleProgress.ensRecordComplete ? (
                          <p className="mt-1 text-zinc-500">
                            Connect an account or Safe authorized by this resolver; it can differ
                            from the revnet operator. The registered controller is
                            {setupQuery.data?.ensController
                              ? ` (${setupQuery.data.ensController})`
                              : " unknown"}
                            ; approved delegates can also submit.
                          </p>
                        ) : null}
                      </TxStep>
                      <TxStep
                        number={2}
                        total={2}
                        title="JBProjectHandles reverse claim"
                        status={stepStatus(
                          handleProgress.reverseClaimComplete,
                          handleProgress.nextAction === "publish",
                        )}
                      >
                        <p className="mt-1 text-zinc-500">
                          {handleProgress.reverseClaimComplete
                            ? "The current operator's reverse claim is confirmed."
                            : "Publish the matching reverse claim from the current revnet operator."}
                        </p>
                        {!handleProgress.reverseClaimComplete ? (
                          handleProgress.ensRecordComplete ? (
                            !connectedIsOperator && address ? (
                              <p className="mt-1 text-amber-700">
                                Connect the current operator{operator ? ` (${operator})` : ""} to
                                publish.
                              </p>
                            ) : null
                          ) : (
                            <p className="mt-1 text-zinc-500">
                              This step unlocks after the exact ENS record is confirmed.
                            </p>
                          )
                        ) : null}
                      </TxStep>
                    </ol>
                    {fullyVerified ? (
                      <p className="text-green-700">
                        Both steps are complete and the project route is verified.
                      </p>
                    ) : null}
                    {setupQuery.data?.resolver && handleProgress.nextAction ? (
                      <ButtonWithWallet
                        targetChainId={PROJECT_HANDLE_CHAIN_ID as JBChainId}
                        variant="secondary"
                        size="sm"
                        loading={busyAction === handleProgress.nextAction}
                        disabled={
                          Boolean(busyAction) ||
                          (handleProgress.nextAction === "publish" &&
                            (!operator ||
                              !authorityAllowed ||
                              Boolean(address && !connectedIsOperator)))
                        }
                        onClick={() => {
                          setError(null);
                          setStatus(null);
                          setReview("step");
                        }}
                      >
                        {handleProgress.nextAction === "publish"
                          ? `Publish /@${parsed.handle.handle}`
                          : `Set ${parsed.handle.ensName} record`}
                      </ButtonWithWallet>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {status && !review ? <p className="mt-3 text-xs text-green-700">{status}</p> : null}
            {error && !review ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
          </div>
        </DialogContent>
      </Dialog>
      {review === "deploy-safe" || (review === "step" && handleProgress.nextAction) ? (
        <TxConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setReview(null);
          }}
          title={
            review === "deploy-safe"
              ? "Confirm Safe deployment"
              : handleProgress.nextAction === "publish"
                ? "Confirm handle"
                : "Confirm ENS record"
          }
          chainId={PROJECT_HANDLE_CHAIN_ID as JBChainId}
          steps={[
            review === "deploy-safe"
              ? {
                  title: "Deploy operator Safe on Ethereum",
                  detail: "Replays the Safe's original deployment at the same address.",
                }
              : handleProgress.nextAction === "publish"
                ? {
                    title: `Publish /@${parsed.handle?.handle ?? ""}`,
                    detail: "Writes the reverse claim on JBProjectHandles from the operator.",
                  }
                : {
                    title: `Set ${parsed.handle?.ensName ?? "ENS"} record`,
                    detail: "Writes the juicebox text record on the name's ENS resolver.",
                  },
          ]}
          activeIndex={busyAction ? 0 : -1}
          action={
            review === "deploy-safe"
              ? "Deploy operator Safe on Ethereum"
              : handleProgress.nextAction === "publish"
                ? `Publish /@${parsed.handle?.handle ?? ""}`
                : `Set ${parsed.handle?.ensName ?? "ENS"} record`
          }
          onConfirm={() =>
            void (review === "deploy-safe"
              ? deploySafeOnMainnet()
              : (handleProgress.nextAction === "publish" ? publish : setEnsRecord)())
          }
          busy={Boolean(busyAction)}
          status={status}
          error={error}
        >
          {review === "deploy-safe" ? (
            <>
              <SummaryRow label="Safe">
                <span className="break-all font-mono text-xs">{operator}</span>
              </SummaryRow>
              {sourceSafe ? (
                <SummaryRow label="Policy">
                  {sourceSafe.threshold} of {sourceSafe.owners.length} signatures
                </SummaryRow>
              ) : null}
            </>
          ) : handleProgress.nextAction === "publish" ? (
            <>
              <SummaryRow label="Handle">/@{parsed.handle?.handle}</SummaryRow>
              <SummaryRow label="Project">
                {chainName(project.chainId)} #{project.projectId}
              </SummaryRow>
            </>
          ) : (
            <>
              <SummaryRow label="ENS name">{parsed.handle?.ensName}</SummaryRow>
              <SummaryRow label="Record">
                <span className="break-all font-mono text-xs">
                  {PROJECT_HANDLE_TEXT_KEY}={expectedRecord}
                </span>
              </SummaryRow>
            </>
          )}
          <SummaryRow label="On">Ethereum</SummaryRow>
        </TxConfirmDialog>
      ) : null}
    </div>
  );
}
