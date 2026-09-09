"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { useCreatorSession } from "@/hooks/useCreatorSession";
import { requireOnchainExecution, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { jbCenterIpfs } from "@/lib/jbcenter-ipfs";
import { gatewayRequest } from "@/lib/telligence/api";
import { computeFactoryAbi, computeReadAbi } from "@/lib/telligence/factory";
import {
  buildComputeLaunch,
  decodeComputeDeployment,
  type LaunchPolicy,
} from "@/lib/telligence/launch";
import {
  parsePendingLaunch,
  pendingLaunchKey,
  type PendingLaunch,
} from "@/lib/telligence/pending-launch";
import {
  parseReviewedLaunchConfig,
  reviewedConfigKey,
  type ReviewedLaunchConfig,
} from "@/lib/telligence/policy-review";
import {
  assertDeploymentConfig,
  VVV_STAKING_ADDRESS,
  type ComputeDeploymentConfig,
} from "@/lib/telligence/transactions";
import type { ComputeProjectDraft, ProjectSnapshot } from "@/lib/telligence/types";
import { transactionActivityForHash } from "@/lib/transaction-activity";
import { requireNoViewAs } from "@/lib/view-as";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { bytesToHex, isAddress, zeroAddress } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";

export function LaunchComputeProjectButton({
  draft,
  disabled = false,
  reviewedConfig = null,
}: {
  draft: ComputeProjectDraft;
  disabled?: boolean;
  reviewedConfig?: ReviewedLaunchConfig | null;
}) {
  const { address } = useAccount();
  const wallet = useConfig();
  const router = useRouter();
  const auth = useCreatorSession();
  const submissionBoundary = useRef<(() => void) | null>(null);
  const { writeContractAsync } = useWriteContract({
    beforeSubmission: async () => {
      submissionBoundary.current?.();
    },
  });
  const [pending, setPending] = useState<PendingLaunch | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const lifecycle = useRef(0);
  const draftKey = JSON.stringify(draft);
  useEffect(() => {
    lifecycle.current += 1;
    return () => {
      lifecycle.current += 1;
    };
  }, [address, draftKey]);
  const ownPending =
    address && pending?.creator.toLowerCase() === address.toLowerCase() ? pending : null;

  useEffect(() => {
    try {
      setPending(
        address
          ? parsePendingLaunch(localStorage.getItem(pendingLaunchKey(address)), address)
          : null,
      );
    } catch {
      setPending(null);
    }
    setError(null);
    setMessage("");
  }, [address]);

  async function launch() {
    if (working.current) return;
    if (!auth.session) {
      await auth.authenticate();
      return;
    }
    working.current = true;
    setBusy(true);
    setError(null);
    const creator = getAccount(wallet).address;
    const generation = lifecycle.current;
    const csrfToken = auth.session.csrfToken;
    const assertCreator = () => {
      requireNoViewAs();
      if (generation !== lifecycle.current)
        throw new Error(
          "The launch form changed or closed. Resume with the original creator before continuing.",
        );
      if (
        !creator ||
        getAccount(wallet).address?.toLowerCase() !== creator.toLowerCase() ||
        auth.session?.address.toLowerCase() !== creator.toLowerCase()
      )
        throw new Error("Connected wallet changed. Resume with the project creator.");
    };
    submissionBoundary.current = assertCreator;
    try {
      assertCreator();
      if (!creator) throw new Error("Connect a wallet first.");
      const prepare = async () => {
        assertCreator();
        // Reread at action time: another tab may have submitted since this component rendered.
        const rawPending = localStorage.getItem(pendingLaunchKey(creator));
        const savedPending = parsePendingLaunch(rawPending, creator);
        if (rawPending !== null && !savedPending)
          throw new Error(
            "The saved launch recovery record is unreadable. Recover its transaction before launching again; the record has been preserved.",
          );
        let intent = savedPending ?? ownPending;
        if (intent) setPending(intent);
        setMessage("Verifying the Base deployment…");
        const deployment = await gatewayRequest<
          ComputeDeploymentConfig & { launchPolicy: LaunchPolicy }
        >("/v1/config");
        assertDeploymentConfig(deployment);
        assertCreator();
        if (
          !intent &&
          (!reviewedConfig ||
            reviewedConfigKey(parseReviewedLaunchConfig(deployment)) !==
              reviewedConfigKey(reviewedConfig))
        ) {
          throw new Error(
            "The launch policy has changed or has not been reviewed. Review the current terms before launching.",
          );
        }
        const client = getViemPublicClient(8453);
        const revnet = await client.readContract({
          address: deployment.factoryAddress,
          abi: computeFactoryAbi,
          functionName: "REV_DEPLOYER",
        });
        const [terminal, projects] = await Promise.all([
          client.readContract({
            address: revnet,
            abi: computeReadAbi,
            functionName: "MULTI_TERMINAL",
          }),
          client.readContract({ address: revnet, abi: computeReadAbi, functionName: "PROJECTS" }),
        ]);
        if (terminal.toLowerCase() !== deployment.canonicalTerminal.toLowerCase())
          throw new Error("The configured terminal does not match the deployed Revnet contracts.");
        if (!intent) {
          // Verify persistence before submitting so a reload cannot silently offer a second deployment.
          localStorage.setItem(pendingLaunchKey(creator) + ":check", "1");
          localStorage.removeItem(pendingLaunchKey(creator) + ":check");
          setMessage("Preparing your project’s isolated API signer…");
          const preparation = await gatewayRequest<{
            preparationId: string;
            inferenceSigner: `0x${string}`;
            expiresAt: string;
          }>("/v1/projects/prepare", { method: "POST", csrfToken });
          assertCreator();
          if (
            typeof preparation.preparationId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              preparation.preparationId,
            ) ||
            !isAddress(preparation.inferenceSigner) ||
            preparation.inferenceSigner.toLowerCase() === zeroAddress ||
            !Number.isFinite(Date.parse(preparation.expiresAt)) ||
            Date.parse(preparation.expiresAt) <= Date.now()
          )
            throw new Error("Signer preparation is invalid or has expired. Try again.");
          setMessage("Saving your project’s purpose…");
          const pinned = await jbCenterIpfs.pinJson({
            name: draft.name.trim(),
            description: draft.purpose.trim(),
            telligence: {
              version: 1,
              ...draft,
              targetDailyCreditUsd: draft.targetDailyCreditUsd.trim() || null,
            },
          });
          assertCreator();
          const [block, creationFee, diemQuote] = await Promise.all([
            client.getBlock(),
            client.readContract({
              address: projects,
              abi: computeReadAbi,
              functionName: "creationFee",
            }),
            client.readContract({
              address: VVV_STAKING_ADDRESS,
              abi: computeReadAbi,
              functionName: "getDiemAmountOut",
              args: [10n ** 18n],
            }),
          ]);
          const transaction = buildComputeLaunch({
            config: deployment,
            draft,
            metadataUri: `ipfs://${pinned.cid}`,
            salt: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
            creator,
            inferenceSigner: preparation.inferenceSigner,
            timestamp: Number(block.timestamp),
            creationFee,
          });
          if (diemQuote < transaction.args[2].minDiemPerVVV)
            throw new Error(
              "The current compute quote is below this deployment’s minimum. Launch is paused until the policy can execute.",
            );
          assertCreator();
          // A concurrent tab can finish preparation while this one pins metadata or reads the chain.
          const latestPending = localStorage.getItem(pendingLaunchKey(creator));
          if (latestPending !== null) {
            const latestIntent = parsePendingLaunch(latestPending, creator);
            if (latestIntent) setPending(latestIntent);
            throw new Error(
              "Another saved launch needs recovery. Resume its registration before launching again.",
            );
          }
          setMessage("Review the exact project terms in your wallet…");
          const hash = await writeContractAsync(transaction);
          intent = {
            version: 1,
            creator,
            factory: deployment.factoryAddress,
            hash,
            preparationId: preparation.preparationId,
            draft: { ...draft },
          };
          setPending(intent);
          try {
            localStorage.setItem(pendingLaunchKey(creator), JSON.stringify(intent));
          } catch {
            throw new Error(
              `Launch submitted as ${hash}. Browser storage failed; keep this hash to recover registration. Do not launch again.`,
            );
          }
        }
        return { intent, deployment, client };
      };
      // Different drafts/salts still represent one unresolved launch for this creator. Release only after its hash is durable,
      // before waiting for a receipt, so the next tab resumes that saved intent instead of opening a second wallet request.
      const locks = navigator.locks;
      const { intent, deployment, client } = locks
        ? await locks.request(`telligence:launch:8453:${creator.toLowerCase()}`, prepare)
        : await prepare();
      // A wallet may resolve after navigation; the submitted hash above remains recoverable, but no dependent action proceeds.
      assertCreator();
      if (intent.factory.toLowerCase() !== deployment.factoryAddress.toLowerCase())
        throw new Error(
          "The saved launch belongs to a different factory. Recover its registration before launching again.",
        );
      requireOnchainExecution(intent.hash, "Project launch");
      setMessage("Waiting for the launch transaction. You can safely resume this step…");
      const executionHash = transactionActivityForHash(intent.hash)?.executionHash ?? intent.hash;
      const receipt = await waitForReceiptWithRetry(client, executionHash);
      if (receipt.status === "reverted") {
        localStorage.removeItem(pendingLaunchKey(creator));
        setPending(null);
        throw new Error("The launch reverted. No project was created; review and try again.");
      }
      const result = decodeComputeDeployment(receipt, intent.factory, creator);
      assertCreator();
      setMessage("Registering the confirmed project. No additional transaction is needed…");
      const { project } = await gatewayRequest<{ project: ProjectSnapshot }>("/v1/projects", {
        method: "POST",
        csrfToken,
        body: {
          ...intent.draft,
          targetDailyCreditUsd: intent.draft.targetDailyCreditUsd.trim() || null,
          ...result,
          preparationId: intent.preparationId,
        },
      });
      assertCreator();
      localStorage.removeItem(pendingLaunchKey(creator));
      setPending(null);
      router.push(`/compute/${project.id}/keys`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The project could not be launched. Try again.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ButtonWithWallet
        targetChainId={8453}
        size="lg"
        className="w-full sm:w-auto"
        disabled={busy || ((disabled || !reviewedConfig) && !ownPending)}
        loading={busy || auth.loading}
        onClick={() => void launch()}
      >
        {!auth.session
          ? "Sign in to launch"
          : ownPending
            ? "Resume project registration"
            : "Launch compute project"}
      </ButtonWithWallet>
      {ownPending && (
        <p className="break-all text-xs leading-6">
          A launch is saved.{" "}
          <a
            className="compute-text-link"
            href={`https://basescan.org/tx/${transactionActivityForHash(ownPending.hash)?.executionHash ?? ownPending.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            Inspect the transaction ↗
          </a>{" "}
          Resume to confirm and register it.
        </p>
      )}
      {busy && (
        <p role="status" className="text-xs leading-6 text-melon-700">
          {message}
        </p>
      )}
      {(error || auth.error) && (
        <p role="alert" className="break-words text-xs leading-6 text-red-700">
          {error || auth.error}
        </p>
      )}
    </div>
  );
}
