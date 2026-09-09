"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import { etherscanLink, formatWalletError } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { buildDeployProjectPayerTx, projectPayerFromDeployLogs } from "@bananapus/nana-sdk-core/v6";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Address,
  encodeFunctionData,
  encodeFunctionResult,
  isAddress,
  parseAbi,
  PublicClient,
  zeroAddress,
} from "viem";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { ChainProjectRow, PayerRow } from "./projectPayers";

type DeployedPayer = { chainId: JBChainId; payer: Address | null; txHash: `0x${string}` };
const FACTORY_DIRECTORY_ABI = parseAbi(["function DIRECTORY() view returns (address)"]);

type ReviewedDeploy = {
  /** One frozen call per selected chain — what's reviewed is what's sent. */
  calls: {
    chainId: JBChainId;
    projectId: number;
    request: ReturnType<typeof buildDeployProjectPayerTx>;
    directory: Address;
  }[];
  addToBalance: boolean;
  memo: string;
  /** The account the review was made for. */
  account: Address;
};

function resolveAddressInput(raw: string): Address | null {
  const trimmed = raw.trim();
  return isAddress(trimmed) ? (trimmed as Address) : null;
}

/**
 * website/-parity renderExtrasSection: deploy a JBProjectPayer so plain ETH
 * transfers to a dedicated address pay the project. Permissionless; defaults
 * match the website — Pay behavior, zero beneficiary (the original payer gets
 * the tokens), zero admin (immutable settings), 0x metadata. Multi-chain
 * deploys share one reviewed batch with durable destination progress.
 */
export function PayerDeployForm({
  rows,
  existingRows,
  onDeployed,
  tokenSymbol,
}: {
  rows: ChainProjectRow[];
  existingRows: PayerRow[];
  onDeployed: () => void;
  /** The project's own token, so the field names what it actually pays out. */
  tokenSymbol?: string;
}) {
  const { address } = useAccount();
  const { runBatch, getPendingBatch } = useMultichainBatch();
  const { toast } = useToast();
  const scope = `project-payers:${rows
    .map((row) => `${row.chainId}:${row.projectId}`)
    .sort()
    .join(",")}`;
  const pendingBatch = getPendingBatch(scope);

  const deployableRows = rows;

  const [addToBalance, setAddToBalance] = useState(false);
  const [originalPayer, setOriginalPayer] = useState(true);
  const [beneficiary, setBeneficiary] = useState("");
  const [beneficiaryByChain, setBeneficiaryByChain] = useState<Record<number, string>>({});
  const [memo, setMemo] = useState("");
  const [editable, setEditable] = useState(false);
  const [admin, setAdmin] = useState("");
  const [adminByChain, setAdminByChain] = useState<Record<number, string>>({});
  const [metadata, setMetadata] = useState("0x");
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(deployableRows.map((row) => row.chainId)),
  );

  const [review, setReview] = useState<ReviewedDeploy | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<DeployedPayer[]>([]);

  // The delayed catch-up refetch must not fire after unmount.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const invalidate = () => {
    setReview(null);
    setError(null);
  };

  const selectedRows = deployableRows.filter((row) => selected.has(row.chainId));

  // Surface identical already-deployed payers so nobody redeploys one they
  // could just reuse — matching behavior + beneficiary on a selected chain.
  const duplicates = useMemo(() => {
    const formBeneficiary = originalPayer ? "" : beneficiary.trim().toLowerCase();
    if (!originalPayer && !isAddress(formBeneficiary)) return [];
    return existingRows.filter((row) => {
      if (!selected.has(Number(row.chainId))) return false;
      if (Boolean(row.defaultAddToBalance) !== addToBalance) return false;
      const rowBeneficiary =
        row.defaultBeneficiary && row.defaultBeneficiary.toLowerCase() !== zeroAddress
          ? row.defaultBeneficiary.toLowerCase()
          : "";
      return rowBeneficiary === formBeneficiary;
    });
  }, [existingRows, selected, addToBalance, originalPayer, beneficiary]);

  const buildReview = async () => {
    setError(null);
    if (!address) return;
    if (!selectedRows.length) {
      setError("Select at least one chain.");
      return;
    }
    const trimmedMetadata = metadata.trim() || "0x";
    const calls: Omit<ReviewedDeploy["calls"][number], "directory">[] = [];
    for (const row of selectedRows) {
      const chainName = JB_CHAINS[row.chainId]?.name ?? row.chainId;
      let beneficiaryAddress: Address = zeroAddress;
      if (!originalPayer) {
        const raw = beneficiaryByChain[row.chainId]?.trim() || beneficiary;
        const resolved = resolveAddressInput(raw);
        if (!resolved) {
          setError(`Enter a valid beneficiary address for ${chainName}.`);
          return;
        }
        beneficiaryAddress = resolved;
      }
      let owner: Address = zeroAddress;
      if (editable) {
        const raw = adminByChain[row.chainId]?.trim() || admin.trim() || address;
        const resolved = resolveAddressInput(raw);
        if (!resolved || resolved === zeroAddress) {
          setError(`Editable payer addresses need a nonzero address admin on ${chainName}.`);
          return;
        }
        owner = resolved;
      }
      try {
        calls.push({
          chainId: row.chainId,
          projectId: row.projectId,
          request: buildDeployProjectPayerTx({
            chainId: row.chainId,
            projectId: BigInt(row.projectId),
            beneficiary: beneficiaryAddress,
            memo: memo.trim(),
            metadata: trimmedMetadata,
            addToBalance,
            owner,
          }),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not build the payer deploy.");
        return;
      }
    }
    setBusy(true);
    try {
      const destinations = await Promise.all(
        calls.map(async (call) => {
          const client = getPublicClient(wagmiConfig, { chainId: call.chainId }) as PublicClient;
          const directory = await client.readContract({
            address: call.request.address,
            abi: FACTORY_DIRECTORY_ABI,
            functionName: "DIRECTORY",
          });
          if (!isAddress(directory) || directory === zeroAddress) {
            throw new Error(
              `Could not verify the payer factory on ${JB_CHAINS[call.chainId]?.name ?? call.chainId}.`,
            );
          }
          return { ...call, directory };
        }),
      );
      setReview({ calls: destinations, addToBalance, memo: memo.trim(), account: address });
    } catch (e) {
      setError(formatWalletError(e) || "Could not verify the payer factories.");
    } finally {
      setBusy(false);
    }
  };

  const submitDeploys = async (resume = false) => {
    if ((!review && !resume) || busy || !address) return;
    if (!resume && review && address.toLowerCase() !== review.account.toLowerCase()) {
      setReview(null);
      setError("Your connected account changed — review the deploy again.");
      return;
    }
    setBusy(true);
    setError(null);
    setDeployed([]);
    const results: DeployedPayer[] = [];
    try {
      const outcome = await runBatch({
        label: "Deploy payer addresses",
        scope,
        calls: resume
          ? []
          : (review?.calls ?? []).map((call) => ({
              ...call.request,
              chainId: call.chainId,
              contractName: "JBProjectPayerDeployer",
              relayrMode: "raw" as const,
              recoveryScope: `project-payer:${call.chainId}:${call.projectId}`,
              preconditions: [
                {
                  address: call.request.address,
                  data: encodeFunctionData({
                    abi: FACTORY_DIRECTORY_ABI,
                    functionName: "DIRECTORY",
                  }),
                  expected: encodeFunctionResult({
                    abi: FACTORY_DIRECTORY_ABI,
                    functionName: "DIRECTORY",
                    result: call.directory,
                  }),
                },
              ],
              expectedDeployment: {
                kind: "project-payer" as const,
                projectId: String(call.projectId),
                beneficiary: call.request.args[1],
                memo: call.request.args[2],
                metadata: call.request.args[3],
                addToBalance: call.request.args[4],
                owner: call.request.args[5],
                directory: call.directory,
              },
            })),
        onProgress: setStatus,
      });
      for (const completed of outcome.hashes ?? []) {
        const chainId = completed.chainId as JBChainId;
        const client = getPublicClient(wagmiConfig, { chainId }) as PublicClient;
        // The batch verifies the exact factory event and clone code before
        // reporting completion. Read that canonical receipt for its address.
        const receipt = await client
          .getTransactionReceipt({ hash: completed.hash })
          .catch(() => null);
        const payer = receipt ? projectPayerFromDeployLogs(receipt.logs) : null;
        results.push({ chainId, payer, txHash: completed.hash });
      }
      setDeployed(results);
      if (outcome.status !== "success") {
        setReview(null);
        setStatus(
          "Deployment is pending. Resume this batch to check completed chains before continuing.",
        );
        return;
      }
      setStatus(
        `Payer address deployment complete on ${results.length} chain${
          results.length === 1 ? "" : "s"
        }.`,
      );
      setReview(null);
      toast({
        title: "Payer address deployed",
        description: "Send ETH to it to pay this project.",
      });
      // Refresh the indexed list immediately, then once more after the
      // indexer has had time to catch up. The deployed addresses shown above
      // come from the receipts, so the UI never depends on this timer.
      onDeployed();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(onDeployed, 5000);
    } catch (e) {
      const message = formatWalletError(e) || "Could not deploy the payer address.";
      setStatus(
        results.length
          ? `Verified payer addresses on ${results.length} chains. Resume the saved batch to check the remaining destinations.`
          : null,
      );
      setError(message);
      toast({ variant: "destructive", title: "Error", description: message });
    } finally {
      setBusy(false);
    }
  };

  if (!deployableRows.length) {
    return (
      <div className="text-sm text-zinc-500">
        Payer addresses aren&apos;t available on this project&apos;s chains — the deployer contract
        isn&apos;t there.
      </div>
    );
  }

  return (
    <div className="w-full">
      {pendingBatch ? (
        <div className="border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>
            A payer deployment has saved progress ({pendingBatch.completed}/{pendingBatch.total}{" "}
            complete).
          </p>
          <ButtonWithWallet
            className="mt-2"
            disabled={busy}
            loading={busy}
            onClick={() => void submitDeploys(true)}
          >
            Resume saved deployment
          </ButtonWithWallet>
        </div>
      ) : null}
      <section className="pb-6">
        <div>
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Behavior</label>
            <Select
              value={addToBalance ? "balance" : "pay"}
              onValueChange={(value) => {
                setAddToBalance(value === "balance");
                invalidate();
              }}
              disabled={busy}
            >
              <SelectTrigger className="w-full border-melon-300 bg-melon-25 sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pay">Pay</SelectItem>
                <SelectItem value="balance">Add to balance</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-500 mt-1">
              {addToBalance
                ? "Adds funds to the project without minting tokens."
                : "Pays the project and mints its tokens to the beneficiary."}
            </p>
          </div>

          {!addToBalance ? (
            <div className="mt-4">
              <label className="block text-sm font-medium mb-1">
                {tokenSymbol || "Token"} beneficiary
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={originalPayer}
                  disabled={busy}
                  onChange={(e) => {
                    setOriginalPayer(e.target.checked);
                    invalidate();
                  }}
                />
                Original payer
              </label>
              {!originalPayer ? (
                <div className="mt-2">
                  <Input
                    className="border-melon-300 bg-melon-25"
                    value={beneficiary}
                    onChange={(e) => {
                      setBeneficiary(e.target.value);
                      invalidate();
                    }}
                    disabled={busy}
                    placeholder="0x… fixed beneficiary"
                    aria-label="Default beneficiary"
                  />
                  <PerChainOverrides
                    label="beneficiary"
                    rows={selectedRows}
                    values={beneficiaryByChain}
                    fallback={beneficiary}
                    disabled={busy}
                    onChange={(next) => {
                      setBeneficiaryByChain(next);
                      invalidate();
                    }}
                  />
                </div>
              ) : (
                <p className="text-xs text-zinc-500 mt-1">
                  Whoever sends the ETH receives the project&apos;s tokens.
                </p>
              )}
            </div>
          ) : null}

          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Default memo</label>
            <Input
              className="border-melon-300 bg-melon-25"
              value={memo}
              onChange={(e) => {
                setMemo(e.target.value.slice(0, 256));
                invalidate();
              }}
              disabled={busy}
              placeholder="optional memo attached to payments"
              aria-label="Default memo"
            />
          </div>
        </div>
      </section>

      <section className="pb-6">
        <div>
          <div className="mt-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={editable}
                disabled={busy}
                onChange={(e) => {
                  setEditable(e.target.checked);
                  if (e.target.checked && !admin && address) setAdmin(address);
                  invalidate();
                }}
              />
              Editable
            </label>
            {editable ? (
              <div className="mt-2">
                <Input
                  className="border-melon-300 bg-melon-25"
                  value={admin}
                  onChange={(e) => {
                    setAdmin(e.target.value);
                    invalidate();
                  }}
                  disabled={busy}
                  placeholder="0x… address admin"
                  aria-label="Address admin"
                />
                <PerChainOverrides
                  label="address admin"
                  rows={selectedRows}
                  values={adminByChain}
                  fallback={admin}
                  disabled={busy}
                  onChange={(next) => {
                    setAdminByChain(next);
                    invalidate();
                  }}
                />
                <p className="text-xs text-zinc-500 mt-1">
                  The address admin can later change this payer address&apos;s destination project,
                  Pay/Add to balance behavior, beneficiary, memo, and metadata, or transfer or
                  renounce the admin role. The role does not receive payments or control either
                  project.
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 mt-1">
                Off by default: no address admin. The settings above are permanent once deployed.
              </p>
            )}
          </div>

          <details className="mt-4">
            <summary className="text-sm text-zinc-500 cursor-pointer">Extra options</summary>
            <div className="mt-2">
              <label className="block text-sm font-medium mb-1">Default metadata</label>
              <Input
                className="border-melon-300 bg-melon-25"
                value={metadata}
                onChange={(e) => {
                  setMetadata(e.target.value);
                  invalidate();
                }}
                disabled={busy}
                placeholder="0x"
                spellCheck={false}
                aria-label="Default metadata"
              />
              <p className="text-xs text-zinc-500 mt-1">
                Hex bytes forwarded to pay/addToBalance. Leave 0x unless you need custom terminal
                metadata.
              </p>
            </div>
          </details>
        </div>
      </section>

      <section>
        <div>
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Deploy on</label>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {deployableRows.map((row) => (
                <label key={row.chainId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(row.chainId)}
                    disabled={busy}
                    onChange={(e) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (e.target.checked) next.add(row.chainId);
                        else next.delete(row.chainId);
                        return next;
                      });
                      invalidate();
                    }}
                  />
                  <ChainLogo chainId={row.chainId} width={16} height={16} />
                  {JB_CHAINS[row.chainId]?.name ?? row.chainId}
                </label>
              ))}
            </div>
          </div>

          {duplicates.length > 0 ? (
            <div className="mt-4 border border-amber-300 bg-amber-50 text-amber-800 text-xs p-3 rounded">
              This project already has a payer address with these settings:{" "}
              {duplicates
                .map(
                  (row) =>
                    `${JB_CHAINS[row.chainId as JBChainId]?.name ?? row.chainId} ${row.address.slice(0, 6)}…${row.address.slice(-4)}`,
                )
                .join(", ")}
              . Anyone can pay it directly — deploying again creates another address that behaves
              the same.
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <ButtonWithWallet
              connectWalletText="Connect wallet to deploy"
              loading={busy}
              disabled={busy || Boolean(pendingBatch) || selectedRows.length === 0}
              onClick={buildReview}
              className="bg-teal-500 text-melon-950 hover:bg-teal-600"
            >
              Deploy payer address{selectedRows.length > 1 ? "es" : ""}
            </ButtonWithWallet>
          </div>

          {review ? (
            <TxConfirmDialog
              open
              onOpenChange={(open) => {
                if (!open) setReview(null);
              }}
              title="Confirm payer address"
              chainId={review.calls[0]!.chainId}
              steps={review.calls.map((call) => ({
                key: String(call.chainId),
                title: `Deploy on ${JB_CHAINS[call.chainId]?.name ?? call.chainId}`,
              }))}
              activeIndex={busy ? deployed.length : -1}
              stepsIntro={
                review.calls.length > 1
                  ? "Review the destinations together, then choose a funding chain. Safe and testnet wallets continue in stages with saved progress."
                  : undefined
              }
              action={`Deploy payer address${review.calls.length > 1 ? "es" : ""}`}
              onConfirm={() => void submitDeploys()}
              busy={busy}
              status={status}
              error={error}
            >
              <SummaryRow label="Every ETH transfer">
                {review.addToBalance
                  ? "Adds to the project balance without minting tokens"
                  : "Pays the project and mints its tokens"}
              </SummaryRow>
              {review.calls.map((call) => (
                <SummaryRow
                  key={call.chainId}
                  label={String(JB_CHAINS[call.chainId]?.name ?? call.chainId)}
                >
                  Project #{call.projectId}
                  {!review.addToBalance ? (
                    <span className="block text-xs text-zinc-500 break-all">
                      Tokens to{" "}
                      {call.request.args[1] === zeroAddress ? "the sender" : call.request.args[1]}
                    </span>
                  ) : null}
                  <span className="block text-xs text-zinc-500 break-all">
                    Admin{" "}
                    {call.request.args[5] === zeroAddress
                      ? "none (immutable)"
                      : call.request.args[5]}
                  </span>
                </SummaryRow>
              ))}
              {review.memo ? <SummaryRow label="Memo">{review.memo}</SummaryRow> : null}
            </TxConfirmDialog>
          ) : null}

          {status && !review ? (
            <p className="mt-2 wrap-anywhere text-xs text-zinc-500">{status}</p>
          ) : null}
          {error && !review ? (
            <p className="mt-2 wrap-anywhere text-xs text-red-600">{error}</p>
          ) : null}

          {deployed.length > 0 ? (
            <div className="mt-4 border border-zinc-200 p-3 rounded">
              <p className="text-sm font-medium">
                Send ETH to {deployed.length === 1 ? "this address" : "these addresses"} to pay the
                project:
              </p>
              <div className="mt-2 space-y-1">
                {deployed.map((result) => (
                  <div key={result.chainId} className="flex items-center gap-2 text-sm">
                    <ChainLogo chainId={result.chainId} width={16} height={16} standalone />
                    {result.payer ? (
                      <>
                        <code className="font-mono text-xs break-all">{result.payer}</code>
                        <CopyButton value={result.payer} />
                      </>
                    ) : (
                      <a
                        className="text-zinc-500 text-xs underline"
                        href={etherscanLink(result.txHash, { type: "tx", chainId: result.chainId })}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Verified deployment transaction
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PerChainOverrides({
  label,
  rows,
  values,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  rows: ChainProjectRow[];
  values: Record<number, string>;
  fallback: string;
  disabled: boolean;
  onChange: (next: Record<number, string>) => void;
}) {
  if (rows.length <= 1) return null;
  return (
    <details className="mt-2">
      <summary className="text-xs text-zinc-500 cursor-pointer">Set the {label} per chain</summary>
      <div className="mt-2 space-y-2">
        {rows.map((row) => (
          <div key={row.chainId} className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs w-36 shrink-0">
              <ChainLogo chainId={row.chainId} width={14} height={14} />
              {JB_CHAINS[row.chainId]?.name ?? row.chainId}
            </span>
            <Input
              className="h-8 border-melon-300 bg-melon-25 text-xs"
              aria-label={`${label} on ${JB_CHAINS[row.chainId]?.name ?? row.chainId}`}
              value={values[row.chainId] ?? ""}
              onChange={(e) => onChange({ ...values, [row.chainId]: e.target.value })}
              disabled={disabled}
              placeholder={fallback || "0x…"}
            />
          </div>
        ))}
      </div>
    </details>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 px-2 text-[11px]"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
