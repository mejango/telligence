"use client";

import { chainDisplayName } from "@/app/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SummaryRow } from "@/components/ui/TxProgress";
import { loadProjectDiagnostics } from "@/lib/projectDiagnostics";
import { projectIndexMessage, type ProjectIndexStatus } from "@/lib/projectIndexStatus";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import {
  describeProjectDataStatus,
  type ProjectDeploymentCheck,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useTransition, type PropsWithChildren } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { refreshProjectDisplay } from "../invalidateProjectDisplay";
import { CheckDeploymentButton, DiagnosticsContext } from "./CheckDeploymentButton";

const statusLabels = {
  passed: "Verified",
  mismatch: "Needs attention",
  unsupported: "Custom or unsupported",
  unavailable: "Unavailable",
  info: "Information",
} satisfies Record<ProjectDeploymentCheck["status"], string>;

function checksummed(value: string): string {
  return isAddress(value, { strict: false }) ? getAddress(value) : value;
}

export function ProjectDiagnosticsProvider({
  children,
  chainId,
  projectId,
}: PropsWithChildren<{
  chainId: JBChainId;
  projectId: bigint;
}>) {
  const [open, setOpen] = useState(false);
  const [operatorOn, setOperatorOn] = useState(false);
  const [operatorInput, setOperatorInput] = useState("");
  const [operator, setOperator] = useState<Address>();
  const [operatorError, setOperatorError] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const query = useQuery({
    queryKey: ["project-deployment-diagnostics", chainId, projectId.toString(), operator ?? null],
    queryFn: () => loadProjectDiagnostics(chainId, projectId, operator),
    enabled: open,
    retry: false,
    staleTime: ({ state }) => {
      const report = state.data;
      // Reuse complete read-only evidence briefly; failed checks stay retryable on reopen.
      return state.status === "success" &&
        report?.deployment &&
        !report.deployment.checks.some((check) => check.status === "unavailable") &&
        report.indexer.project === "available" &&
        (report.indexer.group === "available" || report.indexer.group === "not-checked")
        ? 10_000
        : 0;
    },
  });
  const report = query.isError ? undefined : query.data;

  async function copyDiagnostics() {
    try {
      // Drop the query and hash: a shared report needs project identity, not browser state.
      const projectUrl = new URL(window.location.pathname, window.location.origin).href;
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            projectUrl,
            chainId,
            projectId: projectId.toString(),
            operator: operator ?? null,
            ...report,
          },
          null,
          2,
        ),
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <DiagnosticsContext.Provider
      value={() => {
        setCopyState("idle");
        setOpen(true);
      }}
    >
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Check deployment</DialogTitle>
          <DialogDescription>
            Read-only checks for project #{projectId.toString()} on {chainDisplayName(chainId)}.
          </DialogDescription>
          <form
            className="space-y-2 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              const value = operatorInput.trim();
              if (value && !isAddress(value)) {
                setOperatorError(true);
                return;
              }
              setOperatorError(false);
              setCopyState("idle");
              const next = value ? (value as Address) : undefined;
              if (next === operator) void query.refetch();
              else setOperator(next);
            }}
          >
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={operatorOn}
                onChange={() => {
                  if (operatorOn) {
                    setOperatorInput("");
                    setOperatorError(false);
                    setCopyState("idle");
                    setOperator(undefined);
                  }
                  setOperatorOn(!operatorOn);
                }}
                className="h-4 w-4"
              />
              Check an operator&apos;s shop permissions
            </label>
            {operatorOn ? (
              <>
                <label htmlFor="diagnostic-operator" className="block text-xs text-zinc-500">
                  Operator address
                </label>
                <Input
                  id="diagnostic-operator"
                  value={operatorInput}
                  onChange={(event) => {
                    setOperatorInput(event.target.value);
                    setOperatorError(false);
                  }}
                  placeholder="0x…"
                  className="h-11 font-mono text-xs"
                  aria-invalid={operatorError}
                  aria-describedby={operatorError ? "diagnostic-operator-error" : undefined}
                />
                {operatorError ? (
                  <p id="diagnostic-operator-error" role="alert">
                    Enter a valid operator address.
                  </p>
                ) : null}
                <Button type="submit" variant="outline" disabled={query.isFetching}>
                  Check operator
                </Button>
              </>
            ) : null}
          </form>
          {query.isFetching ? <p role="status">Checking deployment…</p> : null}
          {!query.isFetching && (query.isError || !report?.deployment) ? (
            <p role="alert">Deployment checks are unavailable. Try again shortly.</p>
          ) : null}
          {report && !query.isFetching ? (
            <div className="space-y-5 text-sm">
              <section aria-label="Project data service">
                <h3 className="font-semibold">Project data service</h3>
                <p>{projectIndexMessage(report.indexer)}</p>
                <p className="text-zinc-500">
                  Project record: {describeProjectDataStatus(report.indexer.project)} Related
                  project records: {describeProjectDataStatus(report.indexer.group)}
                </p>
              </section>
              {report.deployment ? (
                <section aria-label="Onchain deployment">
                  <h3 className="font-semibold">Onchain deployment</h3>
                  <p className="mb-3 text-zinc-500">
                    {report.deployment.checkedBlock
                      ? `Block ${report.deployment.checkedBlock}. `
                      : ""}
                    Checked {report.deployment.checkedAt}
                  </p>
                  {operator ? (
                    <p className="mb-3 break-all text-zinc-500">Operator checked: {operator}</p>
                  ) : null}
                  <ul className="space-y-4">
                    {report.deployment.checks.map((check) => (
                      <li key={check.id} className="border-t border-zinc-200 pt-3">
                        <p className="font-medium">
                          {check.label}{" "}
                          <span className="font-normal text-zinc-500">
                            ({statusLabels[check.status]})
                          </span>
                        </p>
                        <p>{check.message}</p>
                        {check.actual !== undefined || check.expected !== undefined ? (
                          <div className="mt-2 space-y-2">
                            {check.actual !== undefined ? (
                              <SummaryRow label="Actual">{checksummed(check.actual)}</SummaryRow>
                            ) : null}
                            {check.expected !== undefined ? (
                              <SummaryRow label="Expected">
                                {checksummed(check.expected)}
                              </SummaryRow>
                            ) : null}
                          </div>
                        ) : null}
                        {check.action ? <p className="mt-1">{check.action}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <button
              type="button"
              disabled={query.isFetching}
              className="min-h-11 underline disabled:opacity-50"
              onClick={() => {
                setCopyState("idle");
                void query.refetch();
              }}
            >
              Retry checks
            </button>
            <button
              type="button"
              disabled={!report || query.isFetching}
              className="min-h-11 underline disabled:opacity-50"
              onClick={() => void copyDiagnostics()}
            >
              Copy diagnostics
            </button>
            {copyState !== "idle" ? (
              <span role="status">
                {copyState === "copied"
                  ? "Diagnostics copied."
                  : "Could not copy diagnostics. Try again."}
              </span>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </DiagnosticsContext.Provider>
  );
}

export function ProjectDataNotice({
  status,
  project,
}: {
  status: ProjectIndexStatus;
  project: { chainId: number; projectId: number; groupId?: string };
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [refreshFailed, setRefreshFailed] = useState(false);
  return (
    <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p>{projectIndexMessage(status)}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="min-h-11 underline disabled:opacity-50"
          disabled={pending}
          onClick={() => {
            void Promise.all(
              [
                "bendystraw",
                "complete-participants",
                "complete-activity-events",
                "pending-routing-payments",
              ].map((family) => queryClient.invalidateQueries({ queryKey: [family] })),
            );
            setRefreshFailed(false);
            startTransition(async () => {
              try {
                await refreshProjectDisplay([project]);
                router.refresh();
              } catch {
                setRefreshFailed(true);
              }
            });
          }}
        >
          {pending ? "Retrying…" : "Retry"}
        </button>
        <CheckDeploymentButton />
      </div>
      {refreshFailed ? <p role="alert">Could not refresh project data. Try again.</p> : null}
    </div>
  );
}
