"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { useWaitForTransactionReceipt, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { ProjectPolicyAbi as policyAbi } from "@/lib/telligence/generated/ProjectPolicy";
import { TelligenceComputeVaultAbi as vaultAbi } from "@/lib/telligence/generated/TelligenceComputeVault";
import { VVV_ADDRESS } from "@/lib/telligence/transactions";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { isAddress, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { useAccount } from "wagmi";

export type ProjectRecoveryControlsProps = {
  revnetId: bigint;
  policyAddress: Address;
  vaultAddress: Address;
};

const providerAbi = parseAbi([
  "function stakedInfos(address account) view returns (uint256 amountStaked, uint256 coolDownEnd, uint256 coolDownAmount)",
  "function stakes(address account) view returns (uint256 rewardDebt, uint256 cooldownEnd, uint256 cooldownAmount)",
]);

type RecoverySnapshot = {
  creator: Address;
  recovery: Address;
  paused: boolean;
  windingDown: boolean;
  authenticationEnabled: boolean;
  signerGeneration: bigint;
  state: number;
  timestamp: bigint;
  noticeEndsAt: bigint;
  notice: bigint;
  diemStake: readonly [bigint, bigint, bigint];
  vvvStake: readonly [bigint, bigint, bigint];
};
type WithdrawalFunction = "beginDiemUnstake" | "claimDiemAndBeginVVVUnstake" | "claimVVVAndReturn";
type RecoveryAction = {
  functionName: WithdrawalFunction;
  label: string;
  ready: boolean;
  readyAt: bigint;
  detail: string;
};

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** Recovery reads the pinned contracts directly and continues to work without the hosted gateway. */
async function readRecovery(props: ProjectRecoveryControlsProps): Promise<RecoverySnapshot> {
  if (
    props.revnetId <= 0n ||
    !isAddress(props.policyAddress) ||
    !isAddress(props.vaultAddress) ||
    sameAddress(props.policyAddress, zeroAddress) ||
    sameAddress(props.vaultAddress, zeroAddress)
  ) {
    throw new Error("The project binding is incomplete.");
  }
  const client = getViemPublicClient(8453);
  const block = await client.getBlock();
  const age = BigInt(Math.floor(Date.now() / 1000)) - block.timestamp;
  if (age > 120n || age < -60n)
    throw new Error("Base RPC data is stale. Refresh before continuing.");
  const policyRead = {
    address: props.policyAddress,
    abi: policyAbi,
    blockNumber: block.number,
  } as const;
  const vaultRead = {
    address: props.vaultAddress,
    abi: vaultAbi,
    blockNumber: block.number,
  } as const;
  const [
    creator,
    recovery,
    revnetId,
    boundVault,
    policyToken,
    paused,
    windingDown,
    boundPolicy,
    vaultToken,
    staking,
    diem,
    state,
    noticeEndsAt,
    notice,
    authenticationEnabled,
    signerGeneration,
  ] = await Promise.all([
    client.readContract({ ...policyRead, functionName: "CREATOR" }),
    client.readContract({ ...policyRead, functionName: "RECOVERY" }),
    client.readContract({ ...policyRead, functionName: "revnetId" }),
    client.readContract({ ...policyRead, functionName: "vault" }),
    client.readContract({ ...policyRead, functionName: "VVV" }),
    client.readContract({ ...policyRead, functionName: "allocationPaused" }),
    client.readContract({ ...policyRead, functionName: "windingDown" }),
    client.readContract({ ...vaultRead, functionName: "POLICY" }),
    client.readContract({ ...vaultRead, functionName: "VVV" }),
    client.readContract({ ...vaultRead, functionName: "STAKING" }),
    client.readContract({ ...vaultRead, functionName: "DIEM" }),
    client.readContract({ ...vaultRead, functionName: "state" }),
    client.readContract({ ...vaultRead, functionName: "noticeEndsAt" }),
    client.readContract({ ...vaultRead, functionName: "WINDDOWN_NOTICE" }),
    client.readContract({ ...vaultRead, functionName: "authenticationEnabled" }),
    client.readContract({ ...vaultRead, functionName: "signerGeneration" }),
  ]);
  if (
    revnetId !== props.revnetId ||
    !sameAddress(boundVault, props.vaultAddress) ||
    !sameAddress(boundPolicy, props.policyAddress) ||
    !sameAddress(policyToken, VVV_ADDRESS) ||
    !sameAddress(vaultToken, VVV_ADDRESS) ||
    state < 0 ||
    state > 4 ||
    notice < 604800n ||
    notice > 2592000n
  ) {
    throw new Error("The onchain project binding does not match this recovery page.");
  }
  const [diemStake, vvvStake] = await Promise.all([
    client.readContract({
      address: diem,
      abi: providerAbi,
      functionName: "stakedInfos",
      args: [props.vaultAddress],
      blockNumber: block.number,
    }),
    client.readContract({
      address: staking,
      abi: providerAbi,
      functionName: "stakes",
      args: [props.vaultAddress],
      blockNumber: block.number,
    }),
  ]);
  return {
    creator,
    recovery,
    paused,
    windingDown,
    authenticationEnabled,
    signerGeneration,
    state,
    timestamp: block.timestamp,
    noticeEndsAt,
    notice,
    diemStake,
    vvvStake,
  };
}

function withdrawalAction(snapshot: RecoverySnapshot): RecoveryAction | null {
  if (snapshot.state === 1)
    return {
      functionName: "beginDiemUnstake",
      label: "Start compute withdrawal",
      ready: snapshot.timestamp >= snapshot.noticeEndsAt,
      readyAt: snapshot.noticeEndsAt,
      detail:
        "The notice period protects ongoing work. Starting withdrawal ends this project's API authentication and begins the provider's first cooldown.",
    };
  if (snapshot.state === 2)
    return {
      functionName: "claimDiemAndBeginVVVUnstake",
      label: "Release backing",
      ready:
        snapshot.diemStake[0] === 0n &&
        (snapshot.diemStake[2] === 0n || snapshot.timestamp >= snapshot.diemStake[1]),
      readyAt: snapshot.diemStake[2] === 0n ? 0n : snapshot.diemStake[1],
      detail:
        "After the compute position's cooldown, release its backing and begin the final provider withdrawal.",
    };
  if (snapshot.state === 3)
    return {
      functionName: "claimVVVAndReturn",
      label: "Return backing to revnet",
      ready: snapshot.vvvStake[2] === 0n || snapshot.timestamp >= snapshot.vvvStake[1],
      readyAt: snapshot.vvvStake[2] === 0n ? 0n : snapshot.vvvStake[1],
      detail:
        "Once this withdrawal matures, all recovered backing returns to this project's revnet. The destination cannot be changed.",
    };
  return null;
}

function hasAuthority(snapshot: RecoverySnapshot, account?: Address) {
  return (
    !!account && (sameAddress(account, snapshot.creator) || sameAddress(account, snapshot.recovery))
  );
}

export function ProjectRecoveryControls(props: ProjectRecoveryControlsProps) {
  const { address } = useAccount();
  const headingId = useId();
  const scope = `${props.revnetId}:${props.policyAddress.toLowerCase()}:${props.vaultAddress.toLowerCase()}`;
  const activeScope = useRef(scope);
  useEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = "";
    };
  }, [scope]);
  const query = useQuery({
    queryKey: ["telligence-recovery", 8453, scope],
    queryFn: () => readRecovery(props),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
  });
  const [pending, setPending] = useState<{ scope: string; hash: Hex } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const ownHash = pending?.scope === scope ? pending.hash : undefined;
  const receipt = useWaitForTransactionReceipt({ hash: ownHash, chainId: 8453 });
  const { writeContractAsync } = useWriteContract({
    transactionReview: {
      title: `Review recovery for revnet ${props.revnetId}`,
      description:
        "Disabling API authentication revokes the vault's onchain authentication without moving backing. Closure starts an irreversible winddown, returning backing only to this project's revnet under its rules.",
    },
    reverify: async (variables, account) => {
      if (activeScope.current !== scope)
        throw new Error("The project changed. Review its recovery again.");
      const fresh = await readRecovery(props);
      const name = variables.functionName;
      if (
        name === "announceWinddown" ||
        name === "setAllocationPaused" ||
        name === "setAuthenticationEnabled"
      ) {
        if (!hasAuthority(fresh, account))
          throw new Error(
            "Only the project's creator or recovery wallet has authority for this action.",
          );
        if (name === "setAuthenticationEnabled") {
          if (variables.args?.length !== 1 || variables.args[0] !== false)
            throw new Error("This emergency control can only disable API authentication.");
          if (!fresh.authenticationEnabled)
            throw new Error("API authentication is already disabled. Refresh its onchain state.");
        } else if (fresh.state !== 0 || fresh.windingDown)
          throw new Error("Closure has already started. Refresh the recovery state.");
        if (name === "setAllocationPaused" && variables.args?.[0] === fresh.paused)
          throw new Error("Allocation state changed. Review this action again.");
      } else {
        const action = withdrawalAction(fresh);
        if (!action || name !== action.functionName || !action.ready)
          throw new Error("This recovery step is not ready on Base. Refresh its cooldown.");
      }
      if (activeScope.current !== scope)
        throw new Error("The project changed. Review its recovery again.");
    },
  });
  const refetch = query.refetch;
  useEffect(() => {
    if (ownHash && receipt.isSuccess) void refetch();
  }, [ownHash, receipt.isSuccess, refetch]);
  const snapshot = query.data;
  const action = snapshot ? withdrawalAction(snapshot) : null;
  const readyDate =
    action && action.readyAt <= 8_640_000_000_000n ? new Date(Number(action.readyAt) * 1000) : null;
  const waiting = !!ownHash && !receipt.isSuccess && !receipt.isError;
  const busy = submitting || waiting;

  async function submit(
    functionName:
      "announceWinddown" | "setAllocationPaused" | "setAuthenticationEnabled" | WithdrawalFunction,
  ) {
    if (busy || !snapshot || query.isError) return;
    setSubmitting(true);
    setFailure(null);
    try {
      let hash: Hex;
      if (functionName === "setAuthenticationEnabled") {
        hash = await writeContractAsync({
          chainId: 8453,
          address: props.policyAddress,
          abi: policyAbi,
          functionName,
          args: [false],
        });
      } else if (functionName === "setAllocationPaused") {
        hash = await writeContractAsync({
          chainId: 8453,
          address: props.policyAddress,
          abi: policyAbi,
          functionName,
          args: [!snapshot.paused],
        });
      } else if (functionName === "announceWinddown") {
        hash = await writeContractAsync({
          chainId: 8453,
          address: props.policyAddress,
          abi: policyAbi,
          functionName,
          args: [],
        });
      } else {
        hash = await writeContractAsync({
          chainId: 8453,
          address: props.vaultAddress,
          abi: vaultAbi,
          functionName,
          args: [],
        });
      }
      setPending({ scope, hash });
    } catch (error) {
      setFailure({
        scope,
        message:
          error instanceof Error
            ? error.message
            : "Recovery could not be submitted. Refresh and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-10 border-t border-melon-300 pt-7">
      <h2 id={headingId} className="compute-eyebrow">
        Project recovery
      </h2>
      <p className="mt-4 text-sm leading-7 text-melon-800">
        Backing returns to this project&apos;s revnet under its cashout rules. Original contributors
        are not individually refunded.
      </p>
      {query.isPending && (
        <p role="status" className="mt-4 text-sm text-melon-700">
          Reading recovery state from Base…
        </p>
      )}
      {query.isError && (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-red-700">
            {query.error instanceof Error ? query.error.message : "Recovery state is unavailable."}
          </p>
          <button
            type="button"
            className="compute-text-link min-h-11 text-sm"
            onClick={() => void query.refetch()}
          >
            Refresh recovery state
          </button>
        </div>
      )}
      {snapshot && !query.isError && (
        <div className="mt-5 space-y-5 text-sm leading-7">
          <div className="space-y-3 rounded-lg border border-melon-300 p-4">
            <p className="font-medium">
              API authentication: {snapshot.authenticationEnabled ? "Enabled" : "Disabled"}
            </p>
            <p className="text-xs text-melon-700">
              Credential generation: {snapshot.signerGeneration.toString()}
            </p>
            <p>
              Disabling authentication makes the vault reject API signatures onchain and invalidates
              its current credential generation. It does not move the project&apos;s backing or
              begin closure. Provider enforcement must be separately verified; this does not confirm
              that an existing provider session or request has ended.
            </p>
            {snapshot.authenticationEnabled && hasAuthority(snapshot, address) && (
              <ButtonWithWallet
                targetChainId={8453}
                variant="outline"
                disabled={busy}
                onClick={() => void submit("setAuthenticationEnabled")}
              >
                Disable API authentication
              </ButtonWithWallet>
            )}
            {!snapshot.authenticationEnabled && (
              <p className="text-melon-700">
                {snapshot.state >= 2
                  ? "API authentication is permanently disabled once compute withdrawal begins."
                  : "Restoring access requires a separate creator review and a new provider verification."}
              </p>
            )}
          </div>
          {snapshot.state === 0 && (
            <>
              <p>
                Closure is irreversible and gives {Number(snapshot.notice / 86400n)} days&apos;
                notice before compute withdrawal can begin. Provider cooldowns follow the notice.
              </p>
              {hasAuthority(snapshot, address) ? (
                <div className="flex flex-wrap gap-3">
                  <ButtonWithWallet
                    targetChainId={8453}
                    variant="outline"
                    disabled={busy}
                    onClick={() => void submit("setAllocationPaused")}
                  >
                    {snapshot.paused ? "Resume new allocations" : "Pause new allocations"}
                  </ButtonWithWallet>
                  <ButtonWithWallet
                    targetChainId={8453}
                    variant="outline"
                    disabled={busy}
                    onClick={() => void submit("announceWinddown")}
                  >
                    Announce closure
                  </ButtonWithWallet>
                </div>
              ) : (
                <p className="text-melon-700">
                  Only this project&apos;s creator or recovery wallet can pause new allocations or
                  announce closure.
                </p>
              )}
              {snapshot.paused && (
                <p className="text-melon-700">
                  New allocations are paused. Existing compute and prescribed recovery remain
                  available.
                </p>
              )}
            </>
          )}
          {action && (
            <>
              <p>{action.detail}</p>
              {action.readyAt > 0n &&
                !action.ready &&
                (readyDate ? (
                  <p className="text-melon-700">
                    Available after{" "}
                    <time dateTime={readyDate.toISOString()}>{readyDate.toUTCString()}</time>, once
                    confirmed on Base.
                  </p>
                ) : (
                  <p className="text-melon-700">
                    The provider deadline is beyond the supported calendar range. This step remains
                    blocked by its onchain cooldown.
                  </p>
                ))}
              <ButtonWithWallet
                targetChainId={8453}
                disabled={busy || !action.ready}
                onClick={() => void submit(action.functionName)}
              >
                {action.label}
              </ButtonWithWallet>
              <p className="text-xs text-melon-700">
                Any wallet can continue a ready recovery step. All deadlines come from the current
                onchain position.
              </p>
            </>
          )}
          {snapshot.state === 4 && (
            <p>
              The ordinary recovery sequence is complete. Recovered backing has returned to the
              revnet.
            </p>
          )}
        </div>
      )}
      {ownHash && (
        <p
          role={receipt.isError ? "alert" : "status"}
          className={`mt-4 text-sm leading-7 ${receipt.isError ? "text-red-700" : "text-melon-700"}`}
        >
          {receipt.isSuccess
            ? "Confirmed on Base."
            : (receipt.statusMessage ??
              (receipt.isError
                ? "The transaction failed. Refresh recovery state before trying again."
                : "Submitted. Waiting for onchain confirmation."))}
        </p>
      )}
      {failure?.scope === scope && (
        <p role="alert" className="mt-4 break-words text-sm leading-7 text-red-700">
          {failure.message}
        </p>
      )}
    </section>
  );
}
