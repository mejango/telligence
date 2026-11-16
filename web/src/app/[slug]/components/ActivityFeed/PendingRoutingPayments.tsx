"use client";

import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { LoadingText } from "@/components/ui/LoadingText";
import { TxError } from "@/components/ui/TxError";
import { SummaryRow, TxProgress } from "@/components/ui/TxProgress";
import { useHydrated } from "@/hooks/useHydrated";
import {
  useMultichainBatch,
  type BatchCallProgress,
  type BatchResult,
} from "@/hooks/useMultichainBatch";
import { queryBendystrawFromBrowser } from "@/lib/bendystraw/client";
import { ProjectOperation } from "@/lib/bendystraw/operations";
import { mapConcurrentChecks } from "@/lib/concurrent-checks";
import {
  describeSavedRoutingCall,
  preparePendingRouterPayment,
  readIndexedPendingRouterCalls,
  readPendingRouterPayment,
  type PendingProject,
  type PendingRouterPayment,
} from "@/lib/pending-router-calls";
import { safeQueueUrl } from "@/lib/safe-service-config";
import { formatTransactionMessage, formatWalletError } from "@/lib/utils";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { type JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

type Prepared = Awaited<ReturnType<typeof preparePendingRouterPayment>>;

const routingCallSteps = {
  pending: { status: "Waiting", state: "pending" },
  submitted: { status: "Checking result", state: "active" },
  confirmed: { status: "Confirmed", state: "complete" },
  reverted: { status: "Reverted", state: "failed" },
  skipped: { status: "Already handled", state: "complete" },
} as const;

const PENDING_LINE = "Some payments are still pending. Try again to check them and continue.";

export function PendingRoutingPayments({ projects }: { projects: PendingProject[] }) {
  const hydrated = useHydrated();
  const { address, chainId } = useAccount();
  const queryClient = useQueryClient();
  const { runBatch, getPendingBatch, recheckPendingRoutingBatch } = useMultichainBatch();
  const identities = projects.filter((project) => project.version === 6);
  const projectKey = identities
    .map((project) => `${project.chainId}:${project.projectId}`)
    .sort()
    .join(",");
  const scope = `pending-routing:destination:${projectKey}`;
  const saved = hydrated ? getPendingBatch(scope, identities) : undefined;
  const resume = saved && !saved.replaceableDraft && !saved.refreshable ? saved : undefined;
  /**
   * What the confirm reviews: the saved batch it resumes, or payments prepared for an account,
   * replacing an unfunded draft or refreshing a stale quote when one was saved.
   */
  const [source, setSource] = useState<
    | { kind: "saved"; batch: NonNullable<ReturnType<typeof getPendingBatch>> }
    | {
        kind: "fresh";
        prepared: Prepared[];
        account: string;
        replaceDraftId?: string;
        refreshBatchId?: string;
      }
    | null
  >(null);
  const savedSelection = source?.kind === "saved" ? source.batch : null;
  const reviewed = source?.kind === "fresh" ? source.prepared : null;
  const [needsReview, setNeedsReview] = useState(false);
  const [checkingSaved, setCheckingSaved] = useState(false);
  const [savedCheck, setSavedCheck] = useState<{ id: string; reason: string } | null>(null);
  const lastChecked = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const activeSubmission = useRef<{ controller: AbortController; cancellable: boolean } | null>(
    null,
  );
  useEffect(
    () => () => {
      const submission = activeSubmission.current;
      if (submission?.cancellable) submission.controller.abort();
      activeSubmission.current = null;
    },
    [],
  );
  // The routing round ended. The confirm keeps listing what it routed and ends on Done.
  const [routed, setRouted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [callProgress, setCallProgress] = useState<readonly BatchCallProgress[] | null>(null);
  const [obsoleteProposals, setObsoleteProposals] = useState<
    NonNullable<BatchResult["obsoleteSafeProposals"]>
  >([]);
  const queryKey = ["pending-routing-payments", "destination", projectKey];
  const inventory = useQuery({
    queryKey: [...queryKey, "inventory"],
    enabled: hydrated && identities.length > 0,
    queryFn: async () =>
      (await mapConcurrentChecks(identities, readIndexedPendingRouterCalls)).flat(),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
  const query = useQuery({
    queryKey: [...queryKey, "verification", inventory.data],
    enabled: hydrated && Boolean(inventory.data),
    queryFn: async () =>
      mapConcurrentChecks(inventory.data ?? [], async (indexed) => {
        try {
          return {
            indexed,
            payment: await readPendingRouterPayment(
              getViemPublicClient(indexed.chainId as JBChainId),
              indexed,
            ),
            error: null,
          };
        } catch (cause) {
          return { indexed, payment: null, error: formatWalletError(cause) };
        }
      }),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
  const rows = (inventory.data ?? []).flatMap((indexed, index) => {
    const result = query.data?.[index];
    // A cleared on-chain commitment means this indexed payment already resolved.
    return result && !result.payment && !result.error ? [] : [{ indexed, result }];
  });
  const payments = (query.data ?? []).flatMap(({ payment }) => (payment ? [payment] : []));
  const ready = payments.filter((payment) => payment.ready);
  const checking = inventory.isPending || (!inventory.isError && query.isPending);
  const unavailable =
    inventory.isError || query.isError || rows.some(({ result }) => result?.error);
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey });
  }

  async function checkSaved() {
    if (!saved || checkingSaved) return;
    setCheckingSaved(true);
    try {
      const checked = await recheckPendingRoutingBatch(scope, identities);
      setSavedCheck({
        id: saved.id,
        reason: checked?.recoveryReason ?? "The saved batch no longer needs recovery.",
      });
      if (open && savedSelection?.id === saved.id) {
        if (checked?.id === savedSelection.id) setSource({ kind: "saved", batch: checked });
        else {
          setNeedsReview(true);
          setError("The saved batch changed. Review the current payments again.");
        }
      }
    } catch (cause) {
      setSavedCheck({ id: saved.id, reason: formatWalletError(cause) });
    } finally {
      setCheckingSaved(false);
    }
  }
  // A read-only check resolves stale quote reservations before presenting a recovery-only action.
  useEffect(() => {
    if (busy || !resume || !recheckPendingRoutingBatch) return;
    const key = `${address}:${resume.id}`;
    if (lastChecked.current === key) return;
    lastChecked.current = key;
    void checkSaved();
  });
  const savedReason = savedCheck?.id === saved?.id ? savedCheck?.reason : saved?.recoveryReason;
  const savedDetails = (savedSelection?.calls ?? []).map((call) => {
    try {
      const detail = describeSavedRoutingCall(call);
      return {
        ...detail,
        amountLabel:
          payments.find((payment) => payment.id === detail.id)?.amountLabel ?? detail.amountLabel,
      };
    } catch {
      return {
        id: `${call.chainId}:${call.data}`,
        chainId: call.chainId,
        projectId: "unknown",
        sourceProjectId: "unknown",
        amountLabel: "Saved payment details could not be verified",
        beneficiary: call.address,
        pendingCallId: "unknown",
        hash: call.hash,
        state: call.state,
      };
    }
  });
  const nameRefs = [
    ...new Map(
      [
        ...(inventory.data ?? []).flatMap((payment) => [
          [payment.chainId, Number(payment.projectId)],
          [payment.chainId, Number(payment.sourceProjectId)],
        ]),
        ...savedDetails.flatMap((payment) => [
          [payment.chainId, Number(payment.projectId)],
          [payment.chainId, Number(payment.sourceProjectId)],
        ]),
      ]
        .filter(([, id]) => Number.isSafeInteger(id) && id > 0)
        .map(([chain, id]) => [`${chain}:${id}`, { chainId: chain, projectId: id }]),
    ).values(),
  ];
  const names = useQuery({
    queryKey: ["pending-routing-project-names", nameRefs],
    enabled: hydrated && nameRefs.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      Object.fromEntries(
        await mapConcurrentChecks(nameRefs, async (ref) => {
          const result = await queryBendystrawFromBrowser(
            ProjectOperation,
            { ...ref, version: 6 },
            ref.chainId,
          ).catch(() => null);
          const project = result?.project;
          let name =
            project?.projectId === ref.projectId && project.version === 6 ? project.name : null;
          if (project && !name) {
            // The existing server owner also fills names missed by indexed metadata.
            const response = await fetch(
              `/api/project-name?chainId=${ref.chainId}&projectId=${ref.projectId}&kind=project`,
              { signal: AbortSignal.timeout(10_000) },
            ).catch(() => null);
            const resolved = response?.ok ? await response.json().catch(() => null) : null;
            if (resolved?.found && typeof resolved.name === "string") name = resolved.name;
          }
          return [`${ref.chainId}:${ref.projectId}`, name];
        }),
      ),
  });
  const projectName = (chain: number, id: string | number) =>
    names.data?.[`${chain}:${id}`] || `Project ${id}`;

  async function review(selected: PendingRouterPayment[]) {
    setError(null);
    setCallProgress(null);
    if (resume) {
      setNeedsReview(false);
      setSource({ kind: "saved", batch: resume });
      setOpen(true);
      return;
    }
    if (!address) return;
    setSource(null);
    setBusy(true);
    setProgress("Preparing routing…");
    try {
      const prepared = await mapConcurrentChecks(selected, (payment) =>
        preparePendingRouterPayment(
          getViemPublicClient(payment.indexed.chainId as JBChainId),
          payment.indexed,
          address,
        ),
      );
      if (!prepared.length) throw new Error("No pending payments are ready to route.");
      setNeedsReview(false);
      setSource({
        kind: "fresh",
        prepared,
        account: address.toLowerCase(),
        replaceDraftId: saved?.replaceableDraft ? saved.id : undefined,
        refreshBatchId: saved?.refreshable ? saved.id : undefined,
      });
      setProgress(null);
      setRouted(false);
      setOpen(true);
    } catch (cause) {
      setProgress(null);
      setError(formatWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!source) return;
    const fresh = source.kind === "fresh" ? source : null;
    const recoverSavedSubmission = () => {
      const pending = getPendingBatch(savedSelection?.scope ?? scope, identities);
      if (
        !pending ||
        pending.replaceableDraft ||
        pending.refreshable ||
        pending.scope !== (savedSelection?.scope ?? scope) ||
        (savedSelection && pending.id !== savedSelection.id)
      )
        return false;
      setSource({ kind: "saved", batch: pending });
      setNeedsReview(false);
      return true;
    };
    const submission = { controller: new AbortController(), cancellable: true };
    activeSubmission.current = submission;
    const current = () =>
      activeSubmission.current === submission && !submission.controller.signal.aborted;
    setBusy(true);
    setCancellable(true);
    setError(null);
    setProgress("Preparing routing…");
    try {
      if (fresh && address?.toLowerCase() !== fresh.account) {
        throw new Error(
          "The connected account changed. Reconnect the wallet used for this review.",
        );
      }
      const result = await runBatch({
        label: "Retry payments",
        scope: savedSelection?.scope ?? scope,
        expectedBatchId: savedSelection?.id,
        replaceDraftId: fresh?.replaceDraftId,
        refreshBatchId: fresh?.refreshBatchId,
        calls: (fresh?.prepared ?? []).map((row) => row.call),
        signal: submission.controller.signal,
        onBeforePayment: () => {
          if (!current()) return;
          submission.cancellable = false;
          setCancellable(false);
        },
        onProgress: (message) => {
          if (current()) setProgress(message);
        },
        onCallProgress: (calls) => {
          if (current()) setCallProgress(calls);
        },
      });
      if (!current()) return;
      setObsoleteProposals(result.obsoleteSafeProposals ?? []);
      if (result.status === "pending") {
        recoverSavedSubmission();
        setError(PENDING_LINE);
        return;
      }
      setProgress(
        result.revertedHashes?.length
          ? `${result.revertedHashes.length} routing attempt(s) reverted. Review the refreshed pending payments before trying again.`
          : "Routing review complete. Payments still retained by the gateway remain listed after refresh.",
      );
      setRouted(true);
      await refresh();
    } catch (cause) {
      if (!current()) return;
      setProgress(null);
      setError(formatWalletError(cause));
      if (!recoverSavedSubmission() && (fresh?.replaceDraftId || fresh?.refreshBatchId))
        setNeedsReview(true);
    } finally {
      if (activeSubmission.current === submission) {
        activeSubmission.current = null;
        setBusy(false);
        setCancellable(false);
      }
    }
  }

  function closeReview() {
    if (busy) {
      if (!activeSubmission.current?.cancellable) return;
      activeSubmission.current.controller.abort();
    }
    setProgress(null);
    setOpen(false);
    if (!routed) return;
    setRouted(false);
    setSource((now) => (now?.kind === "fresh" ? null : now));
  }

  if (!hydrated || !identities.length) return null;
  if (!rows.length && !resume && !open && !checking) {
    return unavailable ? (
      <p role="status" className="mb-4 text-sm text-zinc-500">
        Pending routing payments are temporarily unavailable.{" "}
        <button className="underline" onClick={() => void refresh()}>
          Retry
        </button>
      </p>
    ) : null;
  }

  return (
    <section className="mb-6">
      <details className="border border-teal-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {rows.length
            ? `${rows.length} ${rows.length === 1 ? "payment needs" : "payments need"} processing.`
            : resume
              ? "Saved payment batch"
              : "Checking pending payments…"}
        </summary>
        <p className="mt-1 text-sm text-zinc-600">
          These payments did not have sufficient gas to process automatically.
        </p>
        {unavailable ? (
          <p role="status" className="mt-2 text-sm text-red-600">
            Pending payments could not be refreshed. Review is paused until the current state is
            available.{" "}
            <button className="underline" onClick={() => void refresh()}>
              Retry
            </button>
          </p>
        ) : null}
        {checking ? (
          <p role="status" className="mt-2 text-sm text-zinc-600">
            <LoadingText
              text={inventory.isPending ? "Checking pending payments…" : "Checking payment status…"}
            />
          </p>
        ) : !unavailable ? (
          <p role="status" className="mt-2 text-sm text-zinc-600">
            {ready.length === payments.length
              ? `${ready.length} ${ready.length === 1 ? "payment" : "payments"} ready to retry.`
              : `${ready.length} of ${payments.length} ${payments.length === 1 ? "payment" : "payments"} ready to retry.`}
          </p>
        ) : null}
        {rows.length > 1 || resume ? (
          <div className="mt-3">
            <ButtonWithWallet
              targetChainId={chainId as JBChainId | undefined}
              variant="outline"
              aria-label={
                resume
                  ? "Resume saved batch"
                  : checking
                    ? "Checking pending payments"
                    : "Retry all payments"
              }
              loading={busy}
              disabled={!resume && (!ready.length || checking || unavailable)}
              onClick={() => void review(ready)}
            >
              {resume
                ? "Resume saved batch"
                : checking
                  ? "Checking pending payments…"
                  : "Retry all"}
            </ButtonWithWallet>
            {resume ? (
              <p className="mt-1 text-xs text-zinc-500">
                Saved batch: {resume.completed} of {resume.total} attempts handled.{" "}
                {savedReason && formatTransactionMessage(savedReason)}
              </p>
            ) : null}
            {resume ? (
              <button
                type="button"
                className="mt-2 text-sm underline"
                disabled={checkingSaved || busy}
                onClick={() => void checkSaved()}
              >
                {checkingSaved ? "Checking saved status…" : "Re-check saved status"}
              </button>
            ) : null}
            {ready.length < payments.length && !resume ? (
              <p className="mt-1 text-xs text-zinc-500">Payments in cooldown must wait.</p>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 space-y-3">
          {rows.map(({ indexed, result }) => {
            const payment = result?.payment;
            return (
              <div
                key={`${indexed.chainId}:${indexed.gateway}:${indexed.pendingCallId}`}
                className="border-t border-teal-100 pt-3"
              >
                <p className="break-all text-sm font-medium">
                  {payment?.amountLabel ??
                    (result?.error ? (
                      "Amount unavailable"
                    ) : (
                      <LoadingText text="Checking payment amount…" />
                    ))}
                </p>
                <p className="text-xs text-zinc-600">
                  To {projectName(indexed.chainId, indexed.projectId)} on{" "}
                  {chainDisplayName(indexed.chainId)}
                </p>
                {!result ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    <LoadingText text="Checking payment status…" />
                  </p>
                ) : result.error ? (
                  <p className="mt-1 text-xs text-red-600">
                    Could not verify payment: {result.error}
                  </p>
                ) : payment && !payment.ready ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Available after{" "}
                    {new Date(Number(payment.nextAttemptAt) * 1000).toLocaleString()}.
                  </p>
                ) : null}
                <div className="mt-2">
                  <ButtonWithWallet
                    targetChainId={indexed.chainId as JBChainId}
                    variant="link"
                    size="sm"
                    className="h-8 px-0 text-xs text-teal-700 underline underline-offset-2"
                    aria-label={!result ? "Checking payment" : "Retry payment"}
                    loading={busy}
                    disabled={!payment?.ready || Boolean(resume) || checking || unavailable}
                    onClick={() => payment && void review([payment])}
                  >
                    {!result
                      ? "Checking payment…"
                      : payment?.action === "finalizePendingCall"
                        ? "Retry"
                        : "Retry"}
                  </ButtonWithWallet>
                </div>
              </div>
            );
          })}
        </div>
      </details>
      <TxError error={open ? null : error} />
      <TxProgress
        open={open}
        onClose={closeReview}
        title="Retry payments"
        steps={(savedSelection
          ? savedDetails.map((payment) => ({
              key: payment.id,
              title: `${payment.amountLabel} to ${projectName(payment.chainId, payment.projectId)}`,
            }))
          : (reviewed ?? []).map(({ payment }) => ({
              key: payment.id,
              title: `${payment.amountLabel} to ${projectName(payment.indexed.chainId, payment.indexed.projectId)}`,
            }))
        ).map((step, index) => ({
          ...step,
          ...(callProgress?.[index] ? routingCallSteps[callProgress[index].status] : {}),
        }))}
        activeIndex={busy ? 0 : -1}
        stepsIntro="Pay network fees only. Each payment has its own result."
        start={needsReview ? undefined : () => void submit()}
        preparing={!savedSelection && !reviewed}
        busy={busy && !cancellable}
        footerContent={
          busy && cancellable ? (
            <button
              type="button"
              className="ml-auto block min-h-[44px] border border-melon-600 px-5 text-sm"
              onClick={closeReview}
            >
              Cancel
            </button>
          ) : needsReview && !busy ? (
            <button
              type="button"
              className="ml-auto block min-h-[44px] border border-melon-600 px-5 text-sm"
              disabled={!resume && (checking || unavailable || !ready.length)}
              onClick={() => void review(ready)}
            >
              Review again
            </button>
          ) : undefined
        }
        error={error}
        status={progress}
        complete={routed}
      >
        <div className="max-h-80 space-y-4 overflow-y-auto">
          {obsoleteProposals.map((proposal) => (
            <p
              key={`${proposal.chainId}:${proposal.hash}`}
              className="break-all text-sm text-zinc-600"
            >
              Payment already resolved. The obsolete Safe proposal was removed from this routing
              batch. Cancel or replace nonce {proposal.nonce} in Safe before executing later
              proposals.{" "}
              <a
                className="underline"
                href={safeQueueUrl(proposal.chainId, proposal.safe) ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                Safe proposal {proposal.hash}
              </a>
            </p>
          ))}
          <p className="text-sm text-zinc-600">
            Retry the original payment. If it fails again, it may stay pending or return to its
            source project.
          </p>
          {savedSelection ? (
            <SummaryRow label="Saved selection">
              {savedSelection.completed} of {savedSelection.total} attempts handled
            </SummaryRow>
          ) : null}
          {savedSelection ? (
            <p className="text-sm text-zinc-600">
              {savedSelection.recoveryReason &&
                formatTransactionMessage(savedSelection.recoveryReason)}
            </p>
          ) : null}
          {savedDetails.map((payment) => (
            <div key={payment.id} className="space-y-2 border-t border-teal-100 pt-3 text-sm">
              <SummaryRow label="Amount">
                <span className="break-all">{payment.amountLabel}</span>
              </SummaryRow>
              <SummaryRow label="On">{chainDisplayName(payment.chainId)}</SummaryRow>
              <SummaryRow label="To">{projectName(payment.chainId, payment.projectId)}</SummaryRow>
              <SummaryRow label="Source">
                {projectName(payment.chainId, payment.sourceProjectId)}
              </SummaryRow>
              <SummaryRow label="Saved state">{payment.state}</SummaryRow>
              <SummaryRow label="Payment ID">
                <span className="break-all">{payment.pendingCallId}</span>
              </SummaryRow>
              <SummaryRow label="Beneficiary">
                <span className="break-all">{payment.beneficiary}</span>
              </SummaryRow>
              {payment.hash ? (
                <SummaryRow label="Transaction">
                  <span className="break-all">{payment.hash}</span>
                </SummaryRow>
              ) : null}
            </div>
          ))}
          {(reviewed ?? []).map(({ payment }) => (
            <div key={payment.id} className="space-y-2 border-t border-teal-100 pt-3 text-sm">
              <SummaryRow label="Amount">
                <span className="break-all">{payment.amountLabel}</span>
              </SummaryRow>
              <SummaryRow label="On">{chainDisplayName(payment.indexed.chainId)}</SummaryRow>
              <SummaryRow label="To">
                {projectName(payment.indexed.chainId, payment.indexed.projectId)}
              </SummaryRow>
              <SummaryRow label="Source">
                {projectName(payment.indexed.chainId, payment.indexed.sourceProjectId)}
              </SummaryRow>
              <SummaryRow label="Action">Retry payments</SummaryRow>
              <SummaryRow label="Beneficiary">
                <span className="break-all">{payment.indexed.beneficiary}</span>
              </SummaryRow>
              <SummaryRow label="Original payer">
                <span className="break-all">{payment.indexed.refundTo}</span>
              </SummaryRow>
            </div>
          ))}
        </div>
      </TxProgress>
    </section>
  );
}
