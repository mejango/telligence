"use client";

import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { CopyButton } from "@/components/CopyButton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TxError } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { reviewClosed } from "@/lib/review-refusal";
import { etherscanLink, formatWalletError } from "@/lib/utils";
import { MEMO_MAX_LENGTH } from "@/lib/v6/pay";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JBChainId } from "@bananapus/nana-sdk-core";
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
import { MemoCount } from "../pay/MemoCount";
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
  const [memoOn, setMemoOn] = useState(false);
  const [editable, setEditable] = useState(false);
  const [admin, setAdmin] = useState("");
  const [adminByChain, setAdminByChain] = useState<Record<number, string>>({});
  const [metadata, setMetadata] = useState("0x");
  const [metadataOn, setMetadataOn] = useState(false);
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
  // Rows come from the indexer, and a payer forwards to its project id forever, so
  // each destination must be a pair the on-chain sucker registry lists. A saved
  // batch is checked too: while any of its calls not yet confirmed sent targets an
  // unlisted pair, it does not resume, since resuming can authorize new work.
  const gate = useGroupWriteGate(selectedRows);
  const { unverifiedOf, lineFor: unverifiedLine } = gate;
  const pairPending = gate.pending;
  const unverifiedRows = unverifiedOf(selectedRows);
  const unverifiedResume = unverifiedOf(
    (pendingBatch?.calls ?? [])
      .filter((call) => call.state === "ready" && call.expectedDeployment)
      .map((call) => ({
        chainId: call.chainId,
        projectId: BigInt(call.expectedDeployment!.projectId),
      })),
  );

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
    if (unverifiedRows.length) {
      setError(unverifiedLine(unverifiedRows));
      return;
    }
    const trimmedMetadata = metadata.trim() || "0x";
    const calls: Omit<ReviewedDeploy["calls"][number], "directory">[] = [];
    for (const row of selectedRows) {
      const chainName = chainDisplayName(row.chainId);
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
          setError(`Editable payer addresses need a nonzero admin address on ${chainName}.`);
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
              `Could not verify the payer factory on ${chainDisplayName(call.chainId)}.`,
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

  const context = review
    ? [
        {
          label: "Every ETH transfer",
          value: review.addToBalance
            ? "Adds to the project balance without minting tokens"
            : "Pays the project and mints its tokens",
        },
        ...review.calls.map((call) => ({
          label: String(chainDisplayName(call.chainId)),
          value: `Project #${call.projectId}`,
          lines: [
            ...(review.addToBalance
              ? []
              : [
                  `Tokens to ${call.request.args[1] === zeroAddress ? "the sender" : call.request.args[1]}`,
                ]),
            `Admin ${call.request.args[5] === zeroAddress ? "none (immutable)" : call.request.args[5]}`,
          ],
        })),
        ...(review.memo ? [{ label: "Memo", value: review.memo }] : []),
      ]
    : [];

  const submitDeploys = async (resume = false) => {
    if ((!review && !resume) || busy || !address) return;
    if (!resume && review && address.toLowerCase() !== review.account.toLowerCase()) {
      setReview(null);
      setError("Your connected account changed. Review the deploy again.");
      return;
    }
    const unverified = resume
      ? unverifiedResume
      : unverifiedOf(
          (review?.calls ?? []).map((call) => ({
            chainId: call.chainId,
            projectId: BigInt(call.projectId),
          })),
        );
    if (unverified.length) {
      setError(unverifiedLine(unverified));
      return;
    }
    setBusy(true);
    setError(null);
    setDeployed([]);
    const results: DeployedPayer[] = [];
    try {
      const outcome = await runBatch({
        label: "Deploy payer addresses",
        context: resume ? undefined : context,
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
      if (reviewClosed(e) && !results.length) {
        setReview(null);
        return;
      }
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
        Payer addresses aren&apos;t available on this project&apos;s chains.
      </div>
    );
  }

  return (
    <div className="w-full">
      {pendingBatch ? (
        <div className="border border-amber-300 p-3 text-sm">
          <p>
            A payer deployment has saved progress ({pendingBatch.completed}/{pendingBatch.total}{" "}
            complete).
          </p>
          <ButtonWithWallet
            className="mt-2"
            disabled={busy || unverifiedResume.length > 0}
            loading={busy || (unverifiedResume.length > 0 && gate.checking)}
            onClick={() => void submitDeploys(true)}
          >
            Resume saved deployment
          </ButtonWithWallet>
          {unverifiedLine(unverifiedResume) ? (
            <p className="mt-2 text-sm text-zinc-600">{unverifiedLine(unverifiedResume)}</p>
          ) : null}
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
              <SelectTrigger className="w-44 border-melon-300 bg-melon-25">
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
                  className="h-4 w-4"
                />
                Original payer
              </label>
              {!originalPayer ? (
                <div className="mt-2">
                  <label htmlFor="payer-beneficiary" className="mb-1 block text-xs text-zinc-500">
                    Beneficiary address
                  </label>
                  <Input
                    id="payer-beneficiary"
                    className="border-melon-300 bg-melon-25"
                    value={beneficiary}
                    onChange={(e) => {
                      setBeneficiary(e.target.value);
                      invalidate();
                    }}
                    disabled={busy}
                    placeholder="0x…"
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
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={memoOn}
                disabled={busy}
                onChange={(e) => {
                  setMemoOn(e.target.checked);
                  setMemo("");
                  invalidate();
                }}
                className="h-4 w-4"
              />
              Add a memo to payments
            </label>
            {memoOn ? (
              <>
                <Input
                  className="mt-2 border-melon-300 bg-melon-25"
                  value={memo}
                  onChange={(e) => {
                    setMemo(e.target.value.slice(0, MEMO_MAX_LENGTH));
                    invalidate();
                  }}
                  disabled={busy}
                  aria-label="Default memo"
                  maxLength={MEMO_MAX_LENGTH}
                />
                <MemoCount length={memo.length} className="mt-1 block text-right" />
              </>
            ) : null}
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
                className="h-4 w-4"
              />
              Editable
            </label>
            {editable ? (
              <div className="mt-2">
                <label htmlFor="payer-admin" className="mb-1 block text-xs text-zinc-500">
                  Admin address
                </label>
                <Input
                  id="payer-admin"
                  className="border-melon-300 bg-melon-25"
                  value={admin}
                  onChange={(e) => {
                    setAdmin(e.target.value);
                    invalidate();
                  }}
                  disabled={busy}
                  placeholder="0x…"
                />
                <PerChainOverrides
                  label="admin"
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
                  The admin can later change which project this address pays and every setting here,
                  or hand off or give up the role. It does not receive payments or control the
                  project.
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 mt-1">
                Without an admin, the settings above are permanent once deployed.
              </p>
            )}
          </div>

          <div className="mt-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={metadataOn}
                disabled={busy}
                onChange={(e) => {
                  setMetadataOn(e.target.checked);
                  setMetadata("0x");
                  invalidate();
                }}
                className="h-4 w-4"
              />
              Custom metadata
            </label>
            {metadataOn ? (
              <Input
                className="mt-2 border-melon-300 bg-melon-25 font-mono"
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
            ) : null}
          </div>
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
                    className="h-4 w-4"
                  />
                  <ChainLogo chainId={row.chainId} width={16} height={16} />
                  {chainDisplayName(row.chainId)}
                </label>
              ))}
            </div>
          </div>

          {duplicates.length > 0 ? (
            <div className="mt-4 border border-amber-300 p-3 text-xs text-amber-800">
              This project already has a payer address with these settings:{" "}
              {duplicates
                .map(
                  (row) =>
                    `${chainDisplayName(row.chainId)} ${row.address.slice(0, 6)}…${row.address.slice(-4)}`,
                )
                .join(", ")}
              . Anyone can pay it directly. Deploying again makes another address that works the
              same.
            </div>
          ) : null}

          {unverifiedLine(unverifiedRows) ? (
            <p className="mt-4 text-sm text-zinc-600">{unverifiedLine(unverifiedRows)}</p>
          ) : null}

          <div className="mt-4 flex justify-end">
            <ButtonWithWallet
              connectWalletText="Connect wallet to deploy"
              loading={busy || (unverifiedRows.length > 0 && pairPending)}
              disabled={
                busy ||
                Boolean(pendingBatch) ||
                selectedRows.length === 0 ||
                unverifiedRows.length > 0
              }
              onClick={buildReview}
              className="bg-teal-500 text-melon-950 hover:bg-teal-600"
            >
              Deploy payer address{selectedRows.length > 1 ? "es" : ""}
            </ButtonWithWallet>
          </div>

          {review ? (
            <TxProgress
              open
              onClose={() => setReview(null)}
              title="Confirm payer address"
              steps={review.calls.map((call) => ({
                key: String(call.chainId),
                title: `Deploy on ${chainDisplayName(call.chainId)}`,
              }))}
              activeIndex={busy ? deployed.length : -1}
              stepsIntro={
                review.calls.length > 1
                  ? "Review the destinations together, then choose a funding chain. Safe and testnet wallets continue in stages with saved progress."
                  : undefined
              }
              start={() => void submitDeploys()}
              busy={busy}
              status={status}
              error={error}
              rows={context}
            />
          ) : null}

          {status && !review ? (
            <p className="mt-2 wrap-anywhere text-xs text-zinc-500">{status}</p>
          ) : null}
          <TxError error={review ? null : error} />

          {deployed.length > 0 ? (
            <div className="mt-4 border border-zinc-200 p-3">
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
  const [open, setOpen] = useState(() => Object.values(values).some((value) => value?.trim()));
  if (rows.length <= 1) return null;
  return (
    <div className="mt-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={open}
          disabled={disabled}
          onChange={() => {
            if (open) onChange({});
            setOpen(!open);
          }}
          className="h-4 w-4"
        />
        Set the {label} per chain
      </label>
      {open ? (
        <div className="mt-2 space-y-3">
          {rows.map((row) => (
            <label key={row.chainId} className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs text-zinc-500">
                <ChainLogo chainId={row.chainId} width={14} height={14} />
                {chainDisplayName(row.chainId)}
              </span>
              <Input
                className="border-melon-300 bg-melon-25"
                aria-label={`${label} on ${chainDisplayName(row.chainId)}`}
                value={values[row.chainId] ?? ""}
                onChange={(e) => onChange({ ...values, [row.chainId]: e.target.value })}
                disabled={disabled}
                placeholder={fallback || "0x…"}
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
