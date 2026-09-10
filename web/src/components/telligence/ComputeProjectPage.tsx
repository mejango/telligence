"use client";

import { Button } from "@/components/ui/button";
import {
  capacityPresentation,
  inspectProjectHref,
  shortAddress,
} from "@/lib/telligence/presentation";
import { parseProjectResponse } from "@/lib/telligence/project-data";
import type { ProjectSnapshot } from "@/lib/telligence/types";
import { useGatewayResource } from "@/lib/telligence/useGatewayResource";
import Link from "next/link";
import { useCallback, useState } from "react";
import { CapacityStatus } from "./CapacityStatus";
import { FundComputeProject } from "./FundComputeProject";
import { ComputeLoading, GatewayFeedback } from "./GatewayFeedback";
import { ProjectRecoveryControls } from "./ProjectRecoveryControls";

/** The server's last saved copy; shown without live capacity or funding when the gateway fails. */
export type SavedComputeProject = { project: ProjectSnapshot; at: string };

export function ComputeProjectPage({
  projectId,
  initialProject = null,
}: {
  projectId: string;
  initialProject?: SavedComputeProject | null;
}) {
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const parse = useCallback(
    (value: unknown) => parseProjectResponse(value, projectId),
    [projectId],
  );
  const live = useGatewayResource(`/v1/projects/${encodeURIComponent(projectId)}`, parse);
  const { loading, error, retry } = live;
  if (loading) return <ComputeLoading />;
  // A saved copy is only ever shown for the same project, and never with live numbers.
  const saved = initialProject?.project.id === projectId ? initialProject : null;
  if (error && !saved) return <GatewayFeedback error={error} retry={retry} />;
  const stale = !!error;
  const project = stale ? saved!.project : live.data;
  if (!project) return null;
  const capacity = capacityPresentation(project);
  const acceptsFunding = project.status === "active" || project.status === "accumulating";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-melon-300 pb-6 text-xs">
        <Link href="/discover" className="compute-text-link inline-flex min-h-11 items-center">
          ← All purposes
        </Link>
        <span className="text-melon-700">Base · Project {project.revnetId}</span>
      </div>
      <div className="grid gap-12 pt-10 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-16 lg:pt-16">
        <div className="min-w-0">
          {!stale && <CapacityStatus project={project} />}
          <h1 className="mt-6 break-words text-4xl leading-[1.1] tracking-[-0.06em] sm:text-5xl xl:text-6xl">
            {project.name}
          </h1>
          <p className="mt-6 text-sm text-melon-700">
            A purpose by{" "}
            <a
              href={`https://basescan.org/address/${project.creatorAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="compute-text-link"
            >
              {shortAddress(project.creatorAddress)}
            </a>
          </p>
          {!stale && (
            <a
              href="#compute-funding"
              className="compute-text-link mt-5 inline-flex min-h-11 items-center text-sm lg:hidden"
            >
              {acceptsFunding ? "Fund this project" : "View compute capacity"} ↓
            </a>
          )}
          <section
            aria-labelledby="purpose-heading"
            className="mt-14 border-t border-melon-300 pt-7"
          >
            <h2 id="purpose-heading" className="compute-eyebrow">
              Why this needs compute
            </h2>
            <p className="mt-5 whitespace-pre-wrap break-words text-lg leading-8 tracking-[-0.02em]">
              {project.purpose}
            </p>
          </section>
          <section
            aria-labelledby="workload-heading"
            className="mt-10 border-t border-melon-300 pt-7"
          >
            <h2 id="workload-heading" className="compute-eyebrow">
              The work ahead
            </h2>
            <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-melon-800">
              {project.workload}
            </p>
          </section>
          <section
            aria-labelledby="participation-heading"
            className="mt-10 border-t border-melon-300 pt-7"
          >
            <h2 id="participation-heading" className="compute-eyebrow">
              Before you contribute
            </h2>
            <div className="mt-5 space-y-4 text-sm leading-7 text-melon-800">
              <p>
                Your contribution participates in this project&apos;s revnet. Its fixed production
                allocation can be converted into compute backing. Credit is shown after the backing
                has been activated and verified.
              </p>
              <p>
                Backing committed to compute is separate from the revnet&apos;s liquid balance.
                Contributions are not guaranteed refunds, and a contribution does not buy API
                access. The creator manages access.
              </p>
              <p>
                Recovery returns backing to the revnet under its rules. Current holders benefit
                according to those rules; original contributors are not individually repaid.
                Provider availability and withdrawal cooldowns apply.
              </p>
            </div>
            <Link
              href={inspectProjectHref(project.revnetId)}
              prefetch={false}
              className="compute-text-link mt-5 inline-flex min-h-11 items-center"
            >
              Inspect the revnet
            </Link>
          </section>
          <details className="mt-8 border-y border-melon-300 py-5">
            <summary className="min-h-6 text-sm">Contracts &amp; published policy</summary>
            <dl className="mt-6 space-y-5 text-xs">
              <div>
                <dt className="text-melon-700">Compute vault</dt>
                <dd className="mt-2 break-all">
                  <a
                    className="compute-text-link"
                    href={`https://basescan.org/address/${project.vaultAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {project.vaultAddress}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-melon-700">Revnet policy wrapper</dt>
                <dd className="mt-2 break-all">
                  <a
                    className="compute-text-link"
                    href={`https://basescan.org/address/${project.wrapperAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {project.wrapperAddress}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-melon-700">Policy version</dt>
                <dd className="mt-2">{project.policyVersion}</dd>
              </div>
            </dl>
            <p className="mt-6 text-xs leading-6 text-melon-700">
              Normal Revnet issuance and market buybacks apply. The compute allocation is a share of
              production, not a fixed percentage of money contributed. Contributions sent through
              other interfaces can use different routing metadata.
            </p>
          </details>
          <details
            className="mt-8 border-y border-melon-300 py-5"
            onToggle={(event) => setRecoveryOpen(event.currentTarget.open)}
          >
            <summary className="min-h-6 text-sm">Recovery &amp; backing controls</summary>
            <p className="mt-5 text-xs leading-6 text-melon-700">
              Read the vault directly on Base. Only the roles recorded in its policy can pause new
              allocation or announce recovery.
            </p>
            {recoveryOpen && (
              <div className="mt-6">
                <ProjectRecoveryControls
                  revnetId={BigInt(project.revnetId)}
                  policyAddress={project.wrapperAddress}
                  vaultAddress={project.vaultAddress}
                />
              </div>
            )}
            <Link
              href={`/recover?project=${project.revnetId}`}
              className="compute-text-link mt-5 inline-flex min-h-11 items-center text-xs"
            >
              Open recovery without the compute gateway ↗
            </Link>
          </details>
        </div>
        <aside
          id="compute-funding"
          className="min-w-0 scroll-mt-6 lg:sticky lg:top-8 lg:self-start"
        >
          {stale ? (
            <section
              role="status"
              aria-labelledby="saved-copy-heading"
              className="border border-melon-300 bg-melon-50 p-6 sm:p-8"
            >
              <h2 id="saved-copy-heading" className="compute-eyebrow">
                Saved copy
              </h2>
              <p className="mt-5 text-sm leading-6">
                Showing the last saved copy from{" "}
                <time dateTime={saved!.at}>
                  {new Date(saved!.at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}
                </time>
                ; live capacity and funding are unavailable.
              </p>
              <p className="mt-3 text-xs leading-6 text-melon-700">{error}</p>
              <div className="mt-5 flex flex-wrap items-center gap-5">
                <Button variant="outline" onClick={retry}>
                  Try again
                </Button>
                <Link
                  href={`/recover?project=${project.revnetId}`}
                  className="compute-text-link inline-flex min-h-11 items-center text-xs"
                >
                  Recover backing directly on Base
                </Link>
              </div>
            </section>
          ) : (
            <section
              aria-labelledby="capacity-heading"
              className="border border-melon-300 bg-melon-50 p-6 sm:p-8"
            >
              <h2 id="capacity-heading" className="compute-eyebrow">
                Room to think
              </h2>
              <div className="mt-7">
                <p className="text-5xl tracking-[-0.07em] tabular-nums">{capacity.daily}</p>
                <p className="mt-2 text-xs text-melon-700">verified inference credit / day</p>
              </div>
              <dl className="mt-8 border-y border-melon-300 py-5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-melon-700">Remaining today</dt>
                  <dd className="tabular-nums">{capacity.remaining}</dd>
                </div>
                {project.targetDailyCreditUsd !== null && (
                  <div className="mt-4 flex justify-between gap-3">
                    <dt className="text-melon-700">Daily target</dt>
                    <dd className="tabular-nums">${project.targetDailyCreditUsd}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-5 text-xs leading-6 text-melon-800">{capacity.detail}</p>
              {capacity.observedAt && (
                <p className="mt-3 text-[11px] leading-5 text-melon-700">
                  Last observed{" "}
                  <time dateTime={capacity.observedAt}>
                    {new Date(capacity.observedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
                  </time>
                  .
                </p>
              )}
              <div className="mt-7 border-t border-melon-300 pt-6">
                {acceptsFunding ? (
                  <FundComputeProject project={project} />
                ) : (
                  <p className="text-sm leading-6">
                    {project.status === "closed"
                      ? "This project is closed to new funding."
                      : "New funding is paused while this project is winding down or suspended."}
                  </p>
                )}
              </div>
            </section>
          )}
          <div className="mt-6 flex items-center justify-between gap-4 border-b border-melon-300 pb-5 text-xs">
            <span className="text-melon-700">For the project creator</span>
            <Link
              href={`/compute/${encodeURIComponent(project.id)}/keys`}
              className="compute-text-link inline-flex min-h-11 items-center"
            >
              API keys
            </Link>
          </div>
          <p className="mt-5 text-xs leading-6 text-melon-700">
            Daily credit resets at 00:00 UTC and does not roll over. The target is an ambition, not
            a guaranteed conversion rate.
          </p>
        </aside>
      </div>
    </>
  );
}
