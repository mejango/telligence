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
import { ErrorNote } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { TxStep, stepStatus } from "@/components/ui/TxSteps";
import { useToast } from "@/components/ui/use-toast";
import { useCompleteProjectPermissions } from "@/hooks/useCompleteBendystrawLists";
import {
  ReviewRefusal,
  isSafeProposalPendingError,
  requireDone,
  reviewClosed,
  reviewedCall,
  useReviewedAction,
  type WriteRequest,
} from "@/hooks/useReviewedAction";
import { readHandleAuthority, unprovenSafeMessage } from "@/lib/handle-authority";
import {
  ENS_NAME_WRAPPER_ADDRESS,
  ENS_REGISTRY_ADDRESS,
  JB_PROJECT_HANDLES_ADDRESS,
  PROJECT_HANDLE_CHAIN_ID,
  PROJECT_HANDLE_TEXT_KEY,
  PROJECT_HANDLE_TEXT_WRITE_SIMULATION_GAS,
  canonicalProjectHandle,
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
import type { ReviewedCallOptions } from "@/lib/reviewed-call";
import {
  findCurrentRevnetOperator,
  findRevnetOperatorFromPermissionHistory,
  revnetOperatorCandidates,
} from "@/lib/revnetOperator";
import { formatWalletError } from "@/lib/utils";
import {
  JBCoreContracts,
  RevnetCoreContracts,
  getJBContractAddress,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import {
  prepareSafeSameAddressDeployment,
  validateSafeCreationForCurrentPolicy,
  type CrossChainHandleAuthorityStatus,
} from "@bananapus/nana-sdk-core/safe";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  isAddress,
  isAddressEqual,
  namehash,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { useAccount } from "wagmi";
import { invalidateProjectRouteProofs } from "../../../projectRouteQuery";
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
    case "unproven-creation":
      return unprovenSafeMessage(PROJECT_HANDLE_CHAIN_ID);
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
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [inputWasEdited, setInputWasEdited] = useState(false);
  const [busyAction, setBusyAction] = useState<"ens" | "deploy-safe" | "publish" | null>(null);
  const [review, setReview] = useState<"step" | "deploy-safe" | null>(null);
  // A send that went to the Safe as a proposal: nothing more to send from here.
  const [proposed, setProposed] = useState(false);
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
      readHandleAuthority({
        sourceChainId: project.chainId,
        sourceClient: publicClientFor(project.chainId),
        mainnetClient: publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId),
        authority: operator!,
      }),
  });
  const authorityAllowed = authorityQuery.data?.allowed === true;
  const sourceSafe =
    authorityQuery.data?.source?.kind === "safe" ? authorityQuery.data.source : undefined;
  const mainnetSafeMissing = authorityQuery.data?.status === "missing-mainnet-safe";
  const safeCreation = authorityQuery.data?.creation ?? null;
  const safeCreationValidation = useMemo(
    () =>
      sourceSafe && safeCreation
        ? validateSafeCreationForCurrentPolicy(safeCreation, sourceSafe)
        : null,
    [safeCreation, sourceSafe],
  );
  const connectedIsSafeOwner = Boolean(
    address && sourceSafe?.owners.some((owner) => isAddressEqual(owner, address)),
  );

  const currentHandleQuery = useQuery({
    queryKey: ["v6-project-handle-current", project.chainId, project.projectId, operator],
    enabled: Boolean(operator && authorityAllowed),
    staleTime: 15_000,
    queryFn: () =>
      readExactProjectHandle(
        publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId),
        project.chainId,
        project.projectId,
        operator!,
      ),
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
    queryFn: () =>
      readHandleSetup(
        publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId),
        parsed.handle!,
        project,
        operator,
      ),
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
  const { run } = useReviewedAction();
  /** One reviewed Ethereum step, sent exactly as reviewed; its receipt once it executed. */
  const sendStep = async (
    account: Address,
    review: { title: string; description: string },
    request: WriteRequest,
    options: ReviewedCallOptions,
    reverify: () => Promise<void>,
  ) => {
    const { receipts } = requireDone(
      await run({
        account,
        ...review,
        context: handleContext,
        reverify,
        calls: [reviewedCall(request, options)],
      }),
    );
    return receipts.at(-1)!;
  };
  /** The ENS name's resolver is still exactly the one the record is written to. */
  const reverifyEnsText = async (resolver: Address, node: Hex, account: Address) => {
    const client = publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId);
    const liveResolver = await client.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName: "resolver",
      args: [node],
    });
    if (liveResolver.toLowerCase() !== resolver.toLowerCase()) {
      throw new ReviewRefusal("The ENS resolver changed. Check the name and review again.");
    }
    // Resolver authorization is left to the bounded simulation: ENS owners can approve delegates
    // and custom resolvers can define their own policy. The exact resolver stays pinned.
    await simulateExactEnsTextWrite(client, resolver, node, expectedRecord, account);
  };
  /** The connected account still holds the operator slot, and ENS still has the exact record. */
  const reverifyPublish = async (handle: NonNullable<typeof parsed.handle>, account: Address) => {
    const isCurrent = await isLiveRevnetOperator(
      publicClientFor(project.chainId),
      project,
      account,
    );
    if (!isCurrent)
      throw new ReviewRefusal("The connected account is no longer this revnet's operator.");
    const authority = await readHandleAuthority({
      sourceChainId: project.chainId,
      sourceClient: publicClientFor(project.chainId),
      mainnetClient: publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId),
      authority: account,
    });
    if (!authority.allowed) throw new ReviewRefusal(authorityStatusMessage(authority.status));

    const mainnetClient = publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId);
    const blockNumber = await mainnetClient.getBlockNumber();
    const node = namehash(handle.ensName);
    const resolver = await mainnetClient.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName: "resolver",
      args: [node],
      blockNumber,
    });
    if (isAddressEqual(resolver, zeroAddress)) {
      throw new ReviewRefusal("The reviewed ENS name no longer has a resolver.");
    }
    const record = await readExactEnsText(mainnetClient, resolver, node, blockNumber);
    if (record !== expectedRecord) {
      throw new ReviewRefusal(`The exact ENS juicebox record must still equal ${expectedRecord}.`);
    }
  };
  /** The operator Safe still needs exactly this same-address Ethereum deployment. */
  const reverifySafeDeployment = async (
    call: { target: Address; args: readonly unknown[] },
    account: Address,
  ) => {
    const sourceClient = publicClientFor(project.chainId);
    const mainnetClient = publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId);
    if (!operator || !(await isLiveRevnetOperator(sourceClient, project, operator))) {
      throw new ReviewRefusal("The operator changed before the Safe deployment was submitted.");
    }
    const authority = await readHandleAuthority({
      sourceChainId: project.chainId,
      sourceClient,
      mainnetClient,
      authority: operator,
    });
    if (authority.status !== "missing-mainnet-safe" || authority.source?.kind !== "safe") {
      throw new ReviewRefusal("The operator Safe no longer needs this Ethereum deployment.");
    }
    if (!authority.source.owners.some((owner) => isAddressEqual(owner, account))) {
      throw new ReviewRefusal("Connect a current EOA owner of the operator Safe to deploy it.");
    }
    if (!authority.creation) {
      throw new ReviewRefusal("The Safe creation transaction could not be recovered.");
    }
    const deployment = await prepareSafeSameAddressDeployment({
      sourceClient,
      destinationClient: mainnetClient,
      creation: authority.creation,
      safe: operator,
      from: account,
    });
    if (!deployment.valid) {
      throw new ReviewRefusal(
        `The same-address Safe deployment is unavailable (${deployment.reason}).`,
      );
    }
    if (
      !isAddressEqual(call.target, deployment.call.target) ||
      call.args[0] !== deployment.call.args[0] ||
      call.args[1] !== deployment.call.args[1] ||
      call.args[2] !== deployment.call.args[2]
    ) {
      throw new ReviewRefusal("The reviewed Safe deployment inputs changed before submission.");
    }
  };

  const deploySafeOnMainnet = async () => {
    if (
      !address ||
      !operator ||
      !sourceSafe ||
      !safeCreation ||
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
      const mainnetClient = publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId);
      if (!(await isLiveRevnetOperator(sourceClient, project, operator))) {
        throw new Error("The revnet operator changed before Safe deployment.");
      }
      const liveAuthority = await readHandleAuthority({
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
      if (!liveAuthority.creation) {
        throw new Error("The Safe creation transaction could not be recovered.");
      }
      const deployment = await prepareSafeSameAddressDeployment({
        sourceClient,
        destinationClient: mainnetClient,
        creation: liveAuthority.creation,
        safe: operator,
        from: address,
      });
      if (!deployment.valid) {
        throw new Error(`The same-address Safe deployment is unavailable (${deployment.reason}).`);
      }

      setStatus("Confirm the Ethereum Safe deployment in its owner's wallet…");
      // wallet-action:project-handle
      const receipt = await sendStep(
        address,
        {
          title: "Review Ethereum Safe deployment",
          description:
            "Reproduce the operator Safe at its same address on Ethereum so that its exact policy can publish this project's handle.",
        },
        {
          chainId: PROJECT_HANDLE_CHAIN_ID,
          address: deployment.call.target,
          abi: deployment.call.abi,
          functionName: "createProxyWithNonce",
          args: deployment.call.args,
        },
        { label: "Deploy operator Safe" },
        () => reverifySafeDeployment(deployment.call, address),
      );
      if (receipt.status !== "success")
        throw new Error("The Safe deployment transaction reverted.");
      const confirmed = await readHandleAuthority({
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
      if (reviewClosed(cause)) setReview(null);
      else if (isSafeProposalPendingError(cause)) {
        setStatus(message);
        setProposed(true);
        toast({ title: "Safe proposal submitted", description: message });
      } else {
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      }
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
      const client = publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId);
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
      const resolver = fresh.resolver;
      const node = namehash(parsed.handle.ensName);
      const receipt = await sendStep(
        address,
        {
          title: "Review ENS project record",
          description: `Set the ENS ${PROJECT_HANDLE_TEXT_KEY} text record to ${expectedRecord}.`,
        },
        {
          chainId: PROJECT_HANDLE_CHAIN_ID,
          address: resolver,
          abi: ensTextResolverAbi,
          functionName: "setText",
          args: [node, PROJECT_HANDLE_TEXT_KEY, expectedRecord],
        },
        // The bounded simulation's gas, sent exactly: a resolver can't make the write cost more.
        { label: "Set ENS juicebox record", gas: PROJECT_HANDLE_TEXT_WRITE_SIMULATION_GAS },
        () => reverifyEnsText(resolver, node, address),
      );
      if (receipt.status !== "success")
        throw new Error("The ENS text-record transaction reverted.");
      await invalidateProjectRouteProofs(queryClient);
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
          ? "Both steps are complete. The handle was already published and is unchanged."
          : "Step 1 of 2 complete: ENS points to this project. Continue by publishing the handle.",
      );
    } catch (cause) {
      const message = formatWalletError(cause, "Could not set the ENS project record.");
      if (reviewClosed(cause)) setReview(null);
      else if (isSafeProposalPendingError(cause)) {
        setStatus(message);
        setProposed(true);
        toast({ title: "Safe proposal submitted", description: message });
      } else {
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      }
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

      const liveAuthority = await readHandleAuthority({
        sourceChainId: project.chainId,
        sourceClient: liveProjectClient,
        mainnetClient: publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId),
        authority: liveCandidate,
      });
      if (!liveAuthority.allowed) throw new Error(authorityStatusMessage(liveAuthority.status));

      const client = publicClientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId);
      const fresh = await readHandleSetup(client, parsed.handle, project, liveCandidate);
      if (fresh.textRecord !== expectedRecord) {
        throw new Error(`Set the ENS juicebox record to ${expectedRecord} before publishing.`);
      }
      if (fresh.verifiedHandle === parsed.handle.handle) {
        setStatus("Step 2 of 2 is already complete: the handle is published.");
        setReview(null);
        await setupQuery.refetch();
        return;
      }

      setStatus("Step 2 of 2: confirm the handle transaction in your wallet…");
      // wallet-action:project-handle
      const handle = parsed.handle;
      const receipt = await sendStep(
        address,
        {
          title: "Review project handle",
          description: `Publish this handle for ${expectedRecord} under the current revnet operator's authoritative slot.`,
        },
        {
          chainId: PROJECT_HANDLE_CHAIN_ID,
          address: JB_PROJECT_HANDLES_ADDRESS,
          abi: jbProjectHandlesAbi,
          functionName: "setEnsNamePartsFor",
          args: [BigInt(project.chainId), BigInt(project.projectId), handle.parts],
        },
        { label: "Publish project handle" },
        () => reverifyPublish(handle, address),
      );
      if (receipt.status !== "success") throw new Error("The project-handle transaction reverted.");

      await invalidateProjectRouteProofs(queryClient);
      const operatorStillCurrent = await isLiveRevnetOperator(
        liveProjectClient,
        project,
        liveCandidate,
      );
      if (!operatorStillCurrent) {
        throw new Error("The project handle confirmed after the revnet operator changed.");
      }
      const confirmedAuthority = await readHandleAuthority({
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
      if (reviewClosed(cause)) setReview(null);
      else if (isSafeProposalPendingError(cause)) {
        setStatus(message);
        setProposed(true);
        toast({ title: "Safe proposal submitted", description: message });
      } else {
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleContext = [
    ...(review === "deploy-safe"
      ? [
          { label: "Safe", value: operator ?? "", mono: true },
          ...(sourceSafe
            ? [
                {
                  label: "Policy",
                  value: `${sourceSafe.threshold} of ${sourceSafe.owners.length} signatures`,
                },
              ]
            : []),
        ]
      : handleProgress.nextAction === "publish"
        ? [
            { label: "Handle", value: `/@${parsed.handle?.handle ?? ""}`, strong: true },
            { label: "Project", value: `${chainName(project.chainId)} #${project.projectId}` },
          ]
        : [
            { label: "ENS name", value: parsed.handle?.ensName ?? "", strong: true },
            {
              label: "Record",
              value: `${PROJECT_HANDLE_TEXT_KEY}=${expectedRecord}`,
              mono: true,
            },
          ]),
    { label: "On", value: "Ethereum" },
  ];

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
        Link a .eth name to this revnet in two steps on Ethereum.
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
              First set a text record on your .eth name, then publish the handle from the revnet
              operator.
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
                {authorityQuery.data.status === "unproven-creation"
                  ? authorityStatusMessage(authorityQuery.data.status)
                  : `${authorityStatusMessage(authorityQuery.data.status)} Publishing is blocked until the current operator can originate the Ethereum claim.`}
              </p>
            ) : operator && authorityQuery.isError ? (
              <p className="mt-3 text-xs text-amber-700">
                The operator's cross-chain authority could not be checked. Publishing remains
                disabled.
              </p>
            ) : null}

            {operator && sourceSafe && mainnetSafeMissing ? (
              <div className="mt-3 border border-amber-200 p-3 text-xs text-zinc-700">
                <p className="font-medium">Prepare the operator Safe on Ethereum</p>
                <p className="mt-1">
                  Deploys the operator Safe at the same address on Ethereum. Available only when its
                  owners, threshold and settings still match its original setup.
                </p>
                {!safeCreation ? (
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
                        setProposed(false);
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
                  <dd className="break-all font-mono">
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
                    <ol className="space-y-3 border border-melon-200 p-3">
                      <TxStep
                        number={1}
                        total={2}
                        title="Set the ENS text record"
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
                            Connect an account or Safe that can edit this name. It can differ from
                            the revnet operator.
                          </p>
                        ) : null}
                      </TxStep>
                      <TxStep
                        number={2}
                        total={2}
                        title="Publish the handle"
                        status={stepStatus(
                          handleProgress.reverseClaimComplete,
                          handleProgress.nextAction === "publish",
                        )}
                      >
                        <p className="mt-1 text-zinc-500">
                          {handleProgress.reverseClaimComplete
                            ? "The current operator has published the handle."
                            : "Publish the handle from the current revnet operator."}
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
                          setProposed(false);
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
            {error && !review ? <ErrorNote message={error} /> : null}
          </div>
        </DialogContent>
      </Dialog>
      {review === "deploy-safe" || (review === "step" && handleProgress.nextAction) ? (
        <TxProgress
          open
          onClose={() => {
            setReview(null);
            setProposed(false);
          }}
          title={
            review === "deploy-safe"
              ? "Confirm Safe deployment"
              : handleProgress.nextAction === "publish"
                ? "Confirm handle"
                : "Confirm ENS record"
          }
          steps={[
            review === "deploy-safe"
              ? {
                  title: "Deploy operator Safe on Ethereum",
                  detail: "Replays the Safe's original deployment at the same address.",
                }
              : handleProgress.nextAction === "publish"
                ? {
                    title: `Publish /@${parsed.handle?.handle ?? ""}`,
                    detail: "Publishes the handle from the operator.",
                  }
                : {
                    title: `Set ${parsed.handle?.ensName ?? "ENS"} record`,
                    detail: "Sets the text record on your .eth name.",
                  },
          ]}
          activeIndex={busyAction ? 0 : -1}
          start={() =>
            void (review === "deploy-safe"
              ? deploySafeOnMainnet()
              : (handleProgress.nextAction === "publish" ? publish : setEnsRecord)())
          }
          busy={Boolean(busyAction)}
          status={status}
          complete={proposed}
          error={error}
          rows={handleContext}
        />
      ) : null}
    </div>
  );
}
