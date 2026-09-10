"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseReviewedLaunchConfig, reviewedConfigKey } from "@/lib/telligence/policy-review";
import { validateComputeDraft } from "@/lib/telligence/presentation";
import { DEFAULT_COMPUTE_DRAFT, type ComputeProjectDraft } from "@/lib/telligence/types";
import { useGatewayResource } from "@/lib/telligence/useGatewayResource";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LaunchComputeProjectButton } from "./LaunchComputeProjectButton";
import { LaunchPolicyReview } from "./LaunchPolicyReview";
import { PendingLaunchNotice } from "./PendingLaunchNotice";

function TokenAllocation({ draft }: { draft: ComputeProjectDraft }) {
  const valid =
    Number.isInteger(draft.operatorSplitBps) &&
    draft.operatorSplitBps >= 0 &&
    draft.productionSplitBps + draft.operatorSplitBps < 10_000;
  return (
    <dl aria-label="New token allocation" className="mt-5 space-y-3 text-sm tabular-nums">
      <div className="flex justify-between gap-4">
        <dt>Compute</dt>
        <dd>{draft.productionSplitBps / 100}%</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>Operator</dt>
        <dd>{valid ? `${draft.operatorSplitBps / 100}%` : "—"}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>Funders</dt>
        <dd>
          {valid ? `${(10_000 - draft.productionSplitBps - draft.operatorSplitBps) / 100}%` : "—"}
        </dd>
      </div>
    </dl>
  );
}

export function ComputeCreateForm() {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [draft, setDraft] = useState<ComputeProjectDraft>(DEFAULT_COMPUTE_DRAFT);
  const [operatorShare, setOperatorShare] = useState(
    String(DEFAULT_COMPUTE_DRAFT.operatorSplitBps / 100),
  );
  const [errors, setErrors] = useState<ReturnType<typeof validateComputeDraft>>({});
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [acknowledgedPolicy, setAcknowledgedPolicy] = useState<string | null>(null);
  const policy = useGatewayResource("/v1/config", parseReviewedLaunchConfig);
  const policyKey = policy.data ? reviewedConfigKey(policy.data) : null;
  const accepted = acknowledged && !!policyKey && policyKey === acknowledgedPolicy;
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  function update<K extends keyof ComputeProjectDraft>(key: K, value: ComputeProjectDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setAcknowledged(false);
  }
  function review(event: React.FormEvent) {
    event.preventDefault();
    const next = validateComputeDraft(draft);
    setErrors(next);
    if (Object.keys(next).length) {
      const first = Object.keys(next)[0];
      document.getElementById(`compute-${first}`)?.focus();
      return;
    }
    setDraft((current) => ({
      ...current,
      name: current.name.trim(),
      purpose: current.purpose.trim(),
      workload: current.workload.trim(),
      targetDailyCreditUsd: current.targetDailyCreditUsd.trim(),
    }));
    setOperatorShare(String(draft.operatorSplitBps / 100));
    setReviewing(true);
    setAcknowledged(false);
    window.setTimeout(() => reviewHeading.current?.focus(), 0);
  }
  const errorFor = (field: keyof ComputeProjectDraft) =>
    errors[field] ? (
      <p id={`compute-${field}-error`} className="mt-2 text-xs leading-5 text-red-700">
        {errors[field]}
      </p>
    ) : null;
  const fieldProps = (field: keyof ComputeProjectDraft) => ({
    id: `compute-${field}`,
    disabled: !interactive,
    "aria-invalid": !!errors[field],
    "aria-describedby": errors[field] ? `compute-${field}-error` : undefined,
  });
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-20">
      <div className="min-w-0">
        <p className="compute-eyebrow">A reason to keep going</p>
        <h1 className="mt-5 text-4xl leading-[1.1] tracking-[-0.06em] sm:text-5xl">
          What would you build
          <br className="hidden sm:block" /> with a budget to think?
        </h1>
        <p className="mt-6 max-w-[60ch] text-sm leading-7 text-melon-800">
          Tell people why your work needs compute. Those who believe can help fund recurring
          inference. You get an API key to put it to work.
        </p>
        {!reviewing && (
          <PendingLaunchNotice
            onResume={(savedDraft) => {
              setDraft(savedDraft);
              setOperatorShare(String(savedDraft.operatorSplitBps / 100));
              setErrors({});
              setReviewing(true);
              setAcknowledged(false);
              window.setTimeout(() => reviewHeading.current?.focus(), 0);
            }}
          />
        )}
        {reviewing ? (
          <section
            aria-labelledby="review-heading"
            className="mt-12 border-t border-melon-300 pt-8"
          >
            <div className="flex items-center justify-between gap-5">
              <h2
                ref={reviewHeading}
                tabIndex={-1}
                id="review-heading"
                className="text-xl tracking-[-0.03em] focus:outline-none"
              >
                Review your project
              </h2>
              <Button
                variant="outline"
                onClick={() => {
                  setReviewing(false);
                  setAcknowledged(false);
                }}
              >
                Edit project
              </Button>
            </div>
            <dl className="mt-8 space-y-6 text-sm">
              <div>
                <dt className="compute-eyebrow">Name</dt>
                <dd className="mt-2 break-words text-lg">{draft.name}</dd>
              </div>
              <div>
                <dt className="compute-eyebrow">Purpose</dt>
                <dd className="mt-2 whitespace-pre-wrap break-words leading-7">{draft.purpose}</dd>
              </div>
              <div>
                <dt className="compute-eyebrow">Workload</dt>
                <dd className="mt-2 break-words leading-7">{draft.workload}</dd>
              </div>
            </dl>
            <div className="mt-8 border-t border-melon-300 pt-6">
              <h3 className="compute-eyebrow">New token allocation</h3>
              <TokenAllocation draft={draft} />
              <p className="mt-4 text-xs leading-6 text-melon-700">
                These shares are fixed at launch. Operator tokens go to your creator wallet and have
                the same transfer and cash-out rights as funder tokens.
              </p>
            </div>
            <div className="mt-8 border border-melon-300 bg-melon-50 p-5 text-xs leading-6">
              <p>
                This launches a Base revnet with a {draft.productionSplitBps / 100}% compute
                production split and a {draft.cashOutTaxBps / 100}% cash-out tax. The production
                split is a share of project tokens, not a fixed share of your supporters&apos;
                money.
              </p>
              <p className="mt-3">
                The creator controls API access. The vault holds compute backing, with recovery
                following the published policy. Credit requires successful activation and remains
                subject to Venice availability.
              </p>
            </div>
            <LaunchPolicyReview
              recoveryAddress={draft.recoveryAddress}
              config={policy.data}
              loading={policy.loading}
              error={policy.error}
              retry={policy.retry}
            />
            <label className="mt-7 flex cursor-pointer items-start gap-3 text-xs leading-6">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0"
                checked={accepted}
                disabled={!policy.data}
                onChange={(event) => {
                  setAcknowledged(event.target.checked);
                  setAcknowledgedPolicy(policyKey);
                }}
              />
              <span>
                I understand the fixed Revnet terms, variable funding-to-compute conversion, and
                provider dependencies.
              </span>
            </label>
            <div className="mt-8">
              <LaunchComputeProjectButton
                draft={draft}
                disabled={!accepted}
                reviewedConfig={policy.data}
              />
            </div>
          </section>
        ) : (
          <form onSubmit={review} noValidate className="mt-12 space-y-10">
            <section aria-labelledby="purpose-step" className="border-t border-melon-300 pt-7">
              <h2 id="purpose-step" className="compute-eyebrow">
                <span className="mr-5 text-melon-700">01</span>Give it a purpose
              </h2>
              <div className="mt-7">
                <label htmlFor="compute-name" className="block text-sm">
                  Project name
                </label>
                <Input
                  {...fieldProps("name")}
                  value={draft.name}
                  onChange={(event) => update("name", event.target.value)}
                  maxLength={80}
                  autoComplete="off"
                  placeholder="Something worth working on"
                  className="mt-3 h-12"
                />
                {errorFor("name")}
              </div>
              <div className="mt-7">
                <label htmlFor="compute-purpose" className="block text-sm">
                  Why do you need compute?
                </label>
                <textarea
                  {...fieldProps("purpose")}
                  value={draft.purpose}
                  onChange={(event) => update("purpose", event.target.value)}
                  rows={6}
                  maxLength={4000}
                  placeholder="What are you working toward? Who benefits? Why does it matter?"
                  className="compute-textarea mt-3"
                />
                {errorFor("purpose")}
                <p className="mt-2 text-xs leading-5 text-melon-700">
                  This is your invitation to the people who might believe in it.
                </p>
              </div>
              <div className="mt-7">
                <label htmlFor="compute-workload" className="block text-sm">
                  What will it do?
                </label>
                <Input
                  {...fieldProps("workload")}
                  value={draft.workload}
                  onChange={(event) => update("workload", event.target.value)}
                  maxLength={160}
                  placeholder="For example: make a public archive searchable"
                  className="mt-3 h-12"
                />
                {errorFor("workload")}
              </div>
            </section>
            <section aria-labelledby="terms-step" className="border-t border-melon-300 pt-7">
              <h2 id="terms-step" className="compute-eyebrow">
                <span className="mr-5 text-melon-700">02</span>A clear agreement
              </h2>
              <p className="mt-6 text-sm leading-7 text-melon-800">
                Your project runs on a revnet with terms fixed at launch. Supporters participate in
                its economics. The compute vault keeps backing separate from everyday API access.
              </p>
              <fieldset className="mt-7 border border-melon-300 p-5">
                <legend className="px-2 text-sm">New token allocation</legend>
                <label htmlFor="compute-operatorSplitBps" className="block text-sm">
                  Operator token share
                </label>
                <div className="mt-3 flex max-w-xs items-center border-2 border-melon-300 focus-within:border-melon-600">
                  <Input
                    {...fieldProps("operatorSplitBps")}
                    inputMode="decimal"
                    value={operatorShare}
                    maxLength={6}
                    aria-describedby={
                      errors.operatorSplitBps
                        ? "compute-operator-help compute-operatorSplitBps-error"
                        : "compute-operator-help"
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      setOperatorShare(value);
                      const match = /^(0|[1-9]\d{0,2})(?:\.(\d{0,2}))?$/.exec(value);
                      update(
                        "operatorSplitBps",
                        value === ""
                          ? 0
                          : match
                            ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
                            : Number.NaN,
                      );
                    }}
                    className="h-12 border-0 text-lg tabular-nums"
                  />
                  <span className="shrink-0 pr-4 text-sm text-melon-700">%</span>
                </div>
                {errorFor("operatorSplitBps")}
                <p id="compute-operator-help" className="mt-3 text-xs leading-6 text-melon-700">
                  Your creator wallet receives this share whenever new tokens are issued. Compute
                  keeps its allocation; funders receive the rest.
                </p>
                <TokenAllocation draft={draft} />
                <p className="mt-4 text-xs leading-6 text-melon-700">
                  Operator tokens can be transferred or cashed out under the same terms as funder
                  tokens. Buybacks can fill payments with existing tokens instead of issuing new
                  ones.
                </p>
              </fieldset>
              <div className="mt-7">
                <label htmlFor="compute-recoveryAddress" className="block text-sm">
                  Recovery wallet
                </label>
                <Input
                  {...fieldProps("recoveryAddress")}
                  value={draft.recoveryAddress ?? ""}
                  onChange={(event) =>
                    update(
                      "recoveryAddress",
                      event.target.value.trim()
                        ? (event.target.value.trim() as `0x${string}`)
                        : undefined,
                    )
                  }
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0x… · a wallet separate from your creator wallet"
                  className="mt-3 h-12"
                />
                {errorFor("recoveryAddress")}
                <p className="mt-3 text-xs leading-6 text-melon-700">
                  Choose a separate recovery wallet. If the creator wallet is lost, this address is
                  the only way to start recovery: it can pause allocation and begin the published
                  wind-down. Recovered backing returns to the revnet. This authority is fixed at
                  launch.
                </p>
              </div>
              <details className="mt-5 border-y border-melon-300 py-5">
                <summary className="text-sm">Inspect the starting terms</summary>
                <dl className="mt-6 space-y-4 text-xs">
                  <div className="flex justify-between gap-4">
                    <dt>Network</dt>
                    <dd>Base</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Accounting asset</dt>
                    <dd>VVV</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Cash-out tax</dt>
                    <dd>{draft.cashOutTaxBps / 100}%</dd>
                  </div>
                </dl>
                <p className="mt-5 text-xs leading-6 text-melon-700">
                  Normal issuance and buybacks apply. A 40% production split does not mean 40% of
                  money raised becomes compute. Cash-out economics and execution affect the actual
                  amount. Recovered backing returns to the revnet for current holders under its
                  rules.
                </p>
                <Link
                  href="/how-it-works#economics"
                  className="compute-text-link mt-4 inline-flex min-h-11 items-center text-xs"
                >
                  Read the funding mechanics ↗
                </Link>
              </details>
              <Button
                type="submit"
                disabled={!interactive}
                size="lg"
                className="mt-8 w-full sm:w-auto"
              >
                Review
              </Button>
              <p className="mt-3 text-xs leading-6 text-melon-700">
                You&apos;ll review the exact transaction before anything is submitted.
              </p>
            </section>
          </form>
        )}
      </div>
      <aside className="border-t border-melon-300 pt-8 lg:sticky lg:top-10 lg:self-start">
        <p className="compute-eyebrow">A small endowment for an idea</p>
        <ol className="mt-8 space-y-8 text-sm">
          <li>
            <span className="block text-melon-700">01 / Tell your story</span>
            <p className="mt-2 leading-6">Give people something to believe in.</p>
          </li>
          <li>
            <span className="block text-melon-700">02 / Grow recurring capacity</span>
            <p className="mt-2 leading-6">
              Contributions help build backing for inference that renews each day.
            </p>
          </li>
          <li>
            <span className="block text-melon-700">03 / Put your key to work</span>
            <p className="mt-2 leading-6">Use the API in your app, agent, or research workflow.</p>
          </li>
        </ol>
        <p className="mt-10 border-t border-melon-300 pt-6 text-xs leading-6 text-melon-700">
          An API key works while verified credit is available and the service is running. Daily
          allowances reset at 00:00 UTC. Access can pause during outages, exhaustion, or recovery.
        </p>
      </aside>
    </div>
  );
}
