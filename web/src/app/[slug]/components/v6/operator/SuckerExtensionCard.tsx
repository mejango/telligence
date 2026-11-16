"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { ProjectIdInput } from "@/components/ProjectIdInput";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorNote } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { isSafeProposalPendingError, reviewClosed } from "@/lib/reviewed-call";
import {
  clearExtensionSalt,
  discardUnreadableSalts,
  saltForExtension,
} from "@/lib/suckerExtensionSalt";
import { formatWalletError } from "@/lib/utils";
import {
  JBChainId,
  JBCoreContracts,
  jbMultiTerminalAbi,
  revDeployerAbi,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import {
  SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL,
  SAVED_ATTEMPT_UNREADABLE_LINE,
} from "@bananapus/nana-sdk-core/review";
import { useState } from "react";
import { useAccount } from "wagmi";
import { chainName, ChainProjectRow, publicClientFor, v6ContractAddress } from "./operatorLib";
import { OperatorSection } from "./OperatorSection";
import {
  assetsFromAccountingContexts,
  buildSuckerExtensionWrites,
  extensionCandidateChains,
} from "./suckerExtensionLib";
import { useLiveRevnetOperators } from "./useLiveRevnetOperators";
import { useOperatorWrites } from "./useOperatorWrites";

const ZERO_HASH = `0x${"0".repeat(64)}`;

/**
 * Extend a revnet's sucker group to another chain, the way REVDeployer
 * dictates it: the OPERATOR calls `deploySuckersFor` on the new chain (one
 * sucker per existing peer) and on every existing chain (one sucker toward
 * the new chain), all with the same user salt. The contract requires a revnet
 * already deployed on the target chain whose `hashedEncodedConfigurationOf`
 * matches — the salt each sucker deploys under folds in that hash, the user
 * salt, and the caller, and cross-chain suckers only pair when both ends land
 * at the same address. This client verifies the hash match before sending;
 * the operator and allow-deploy-suckers ruleset gates are enforced on-chain
 * and caught by the simulate-first pipeline.
 */
export function SuckerExtensionCard({ rows }: { rows: ChainProjectRow[] }) {
  const { address } = useAccount();
  const { runWrites } = useOperatorWrites();
  const { operatorByChain } = useLiveRevnetOperators(rows);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [targetChainId, setTargetChainId] = useState<string>("");
  const [targetProjectId, setTargetProjectId] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  // Existing group rows come from the server list: each one gets a sucker, so
  // only chain-verified pairs are written. The target is entered by the operator.
  const gate = useGroupWriteGate(rows);
  const [review, setReview] = useState(false);
  // A send that went to the Safe as a proposal: nothing more to send from here.
  const [proposed, setProposed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = extensionCandidateChains(rows);
  const extendLabel = targetChainId ? `Extend to ${chainName(Number(targetChainId))}` : "Extend";
  const existingChains = rows.map((row) => chainName(row.chainId)).join(", ");
  const context = [
    {
      label: "Extends to",
      value: `Project #${targetProjectId.trim()} on ${chainName(Number(targetChainId))}`,
      strong: true,
    },
    { label: "Pairs with", value: existingChains },
    { label: "Transactions", value: String(rows.length + 1) },
  ];

  const beginReview = () => {
    if (busy || !ack) return;
    const projectId = Number(targetProjectId.trim());
    if (!targetChainId) {
      setError("Pick the chain to extend to.");
      return;
    }
    if (!Number.isInteger(projectId) || projectId <= 0) {
      setError("Enter this revnet's project ID on the target chain.");
      return;
    }
    setError(null);
    setStatus(null);
    setProposed(false);
    setReview(true);
  };

  const submit = async () => {
    if (busy || !address) return;
    const target = Number(targetChainId) as JBChainId;
    const projectId = Number(targetProjectId.trim());
    if (!target) {
      setError("Pick the chain to extend to.");
      return;
    }
    if (!Number.isInteger(projectId) || projectId <= 0) {
      setError("Enter this revnet's project ID on the target chain.");
      return;
    }
    if (!ack) return;
    try {
      gate.assertVerified(rows);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1. The contract pairs suckers by CREATE2 address, and the address
      // folds in hashedEncodedConfigurationOf — verify the target chain holds
      // a revnet with the byte-identical configuration before anything sends.
      setStatus("Verifying the revnet's configuration on both chains…");
      const home = rows[0];
      const deployer = v6ContractAddress(RevnetCoreContracts.REVDeployer, home.chainId);
      const targetDeployer = v6ContractAddress(RevnetCoreContracts.REVDeployer, target);
      if (!deployer || !targetDeployer) {
        throw new Error("REVDeployer isn't deployed on one of the chains.");
      }
      const [homeHash, targetHash] = await Promise.all([
        publicClientFor(home.chainId).readContract({
          address: deployer,
          abi: revDeployerAbi,
          functionName: "hashedEncodedConfigurationOf",
          args: [BigInt(home.projectId)],
        }),
        publicClientFor(target).readContract({
          address: targetDeployer,
          abi: revDeployerAbi,
          functionName: "hashedEncodedConfigurationOf",
          args: [BigInt(projectId)],
        }),
      ]);
      if (targetHash === ZERO_HASH) {
        throw new Error(
          `No revnet configuration found for project #${projectId} on ${chainName(target)}. ` +
            "Deploy the revnet there first, with its original configuration.",
        );
      }
      if (homeHash !== targetHash) {
        throw new Error(
          `Project #${projectId} on ${chainName(target)} was deployed with a DIFFERENT ` +
            "configuration, so it can never bridge with this revnet. Deploy the " +
            "revnet there with the byte-identical original configuration first.",
        );
      }

      // 2. Bridge mappings come from the revnet's own accounting contexts.
      const terminal = v6ContractAddress(JBCoreContracts.JBMultiTerminal, home.chainId);
      if (!terminal) throw new Error("JBMultiTerminal isn't deployed on the home chain.");
      const contexts = await publicClientFor(home.chainId).readContract({
        address: terminal,
        abi: jbMultiTerminalAbi,
        functionName: "accountingContextsOf",
        args: [BigInt(home.projectId)],
      });
      const assets = assetsFromAccountingContexts(contexts, home.chainId);

      // 3. One shared salt: the peer suckers of each edge only pair when the same operator
      // sends the same salt on both chains (JBSuckerRegistry.sol:1043 derives the address
      // from keccak256(sender, salt)). This writes to several chains in sequence and stops
      // at the first failure — always, on the Safe path — so the salt is persisted and
      // reused on retry. A fresh one would strand the already-deployed peers.
      const salt = saltForExtension(address, projectId, target);
      const writes = buildSuckerExtensionWrites({
        groupRows: rows,
        targetChainId: target,
        targetProjectId: projectId,
        assets,
        salt,
      }).map((write) => ({ ...write, authority: operatorByChain.get(write.chainId) }));

      const result = await runWrites({
        writes,
        account: address,
        label: extendLabel,
        context,
        onProgress: setStatus,
      });
      if (result.safeQueued || result.safeConfirmed) {
        // The proposals carry this salt; a retry must find them, not mint a new one.
        const queued = result.safeQueued + result.safeConfirmed;
        const message =
          `Extension proposed to the operator Safe on ${queued} chain${queued === 1 ? "" : "s"}. ` +
          "Every chain's proposal must execute for the peers to pair; the Safe queue card above lists them.";
        setStatus(message);
        toast({ title: "Proposed to the operator Safe", description: message });
        setReview(false);
        return;
      }
      // Every chain landed, so the next extension should start from a new salt.
      clearExtensionSalt(address, projectId, target);
      setStatus(`Extended to ${chainName(target)}.`);
      toast({ title: `Extended to ${chainName(target)}` });
      setReview(false);
      setOpen(false);
    } catch (e) {
      const message = formatWalletError(e) || "Could not extend the revnet.";
      if (reviewClosed(e)) setReview(false);
      else if (isSafeProposalPendingError(e)) {
        setStatus(message);
        setProposed(true);
        toast({ title: "Safe proposal submitted", description: message });
      } else {
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <OperatorSection title="Chains">
      <div>
        <p className="text-sm text-zinc-500">
          This revnet runs on {rows.length} chain{rows.length === 1 ? "" : "s"}
          {rows.length > 0 ? ": " : ""}
          {rows.map((row) => chainName(row.chainId)).join(", ")}.
          {rows.length > 1 ? " Its token can bridge between them." : null}
        </p>
        {candidates.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            It's already connected on every supported chain.
          </p>
        ) : !open ? (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              setOpen(true);
              setStatus(null);
              setError(null);
            }}
          >
            Extend to another chain
          </Button>
        ) : (
          <div className="mt-3 border-t border-melon-200 pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Extend to another chain</p>
              <button
                type="button"
                className="text-xs text-zinc-500 hover:text-zinc-800"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Only the revnet's operator can extend it, and its rules must allow it. Deploy the
              revnet on the target chain with its original configuration first.
            </p>
            <div className="mt-3 grid gap-3">
              <Select value={targetChainId} onValueChange={(v) => setTargetChainId(v)}>
                <SelectTrigger aria-label="Target chain" className="w-fit gap-2">
                  <SelectValue placeholder="Target chain" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((chainId) => (
                    <SelectItem value={String(chainId)} key={chainId}>
                      <div className="flex items-center gap-2">
                        <ChainLogo chainId={chainId} />
                        {chainName(chainId)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="block text-xs text-zinc-600">
                Project ID on that chain
                <ProjectIdInput
                  value={targetProjectId}
                  onChange={(value) => {
                    setTargetProjectId(value);
                    setError(null);
                  }}
                  chainId={Number(targetChainId) || undefined}
                  disabled={busy}
                  ariaLabel="Project ID on the target chain"
                  className="mt-1"
                />
              </label>
            </div>
            <label className="mt-3 flex items-start gap-2 border border-amber-300 p-3">
              <input
                type="checkbox"
                checked={ack}
                disabled={busy}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-amber-800">
                I am the revnet's operator on every chain, and I verified the target project ID
                belongs to this revnet. Every transaction is simulated before it sends.
              </span>
            </label>
            {gate.line ? <p className="text-xs text-zinc-600 mt-3">{gate.line}</p> : null}
            <div className="mt-3 flex justify-end">
              <ButtonWithWallet
                targetChainId={(Number(targetChainId) || rows[0]?.chainId) as JBChainId}
                connectWalletText="Connect wallet to extend"
                loading={busy || gate.pending}
                disabled={busy || gate.blocked || !ack || !targetChainId || !targetProjectId.trim()}
                onClick={beginReview}
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                {extendLabel}
              </ButtonWithWallet>
            </div>
            {status && !review ? <p className="text-xs text-zinc-500 mt-2">{status}</p> : null}
            {error && !review ? <ErrorNote message={error} /> : null}
            {review ? (
              <TxProgress
                open
                onClose={() => {
                  setReview(false);
                  setProposed(false);
                }}
                title="Confirm the extension"
                steps={[
                  {
                    title: extendLabel,
                    detail: `One transaction on ${chainName(Number(targetChainId))} and one on each existing chain, bundled together when the networks are all supported mainnets or all supported testnets. Safe and other networks need each chain deployed and confirmed separately.`,
                  },
                ]}
                activeIndex={busy ? 0 : -1}
                start={() => void submit()}
                busy={busy}
                status={status}
                complete={proposed}
                error={error}
                rows={context}
              >
                {error === SAVED_ATTEMPT_UNREADABLE_LINE ? (
                  <button
                    type="button"
                    className="w-fit text-sm text-zinc-700 underline"
                    onClick={() => {
                      discardUnreadableSalts();
                      setError(null);
                      void submit();
                    }}
                  >
                    {SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL}
                  </button>
                ) : null}
              </TxProgress>
            ) : null}
          </div>
        )}
      </div>
    </OperatorSection>
  );
}
