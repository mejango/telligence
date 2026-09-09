import { Button } from "@/components/ui/button";
import { formatPolicyInterval, type ReviewedLaunchConfig } from "@/lib/telligence/policy-review";
import { shortAddress } from "@/lib/telligence/presentation";
import { formatUnits } from "viem";

export function LaunchPolicyReview({
  config,
  recoveryAddress,
  loading,
  error,
  retry,
}: {
  config: ReviewedLaunchConfig | null;
  recoveryAddress?: `0x${string}`;
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  if (loading)
    return (
      <p
        role="status"
        className="mt-7 border-y border-melon-300 py-5 text-xs leading-6 text-melon-700"
      >
        Loading the published compute policy…
      </p>
    );
  if (error || !config)
    return (
      <div role="alert" className="mt-7 border border-melon-300 p-5 text-xs leading-6">
        <p>The launch policy could not be verified. Review is paused.</p>
        <p className="mt-2 text-melon-700">{error}</p>
        <Button variant="outline" onClick={retry} className="mt-4">
          Reload launch policy
        </Button>
      </div>
    );
  const policy = config.launchPolicy;
  const amount = (value: string) => formatUnits(BigInt(value), 18);
  return (
    <section
      aria-labelledby="policy-review-heading"
      className="mt-8 border-y border-melon-300 py-6"
    >
      <h3 id="policy-review-heading" className="compute-eyebrow">
        The vault&apos;s fixed boundaries
      </h3>
      <dl className="mt-5 space-y-4 text-xs leading-6">
        <div className="flex flex-wrap justify-between gap-x-5">
          <dt className="text-melon-700">Maximum compute backing</dt>
          <dd className="break-all">{amount(policy.maxPrincipal)} VVV</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-5">
          <dt className="text-melon-700">Time between conversions</dt>
          <dd>At least {formatPolicyInterval(policy.conversionCadence)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-5">
          <dt className="text-melon-700">Recovery authority</dt>
          <dd className="break-all">{recoveryAddress ?? "Connected creator wallet"}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-5">
          <dt className="text-melon-700">Factory on Base</dt>
          <dd>
            <a
              href={`https://basescan.org/address/${config.factoryAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="compute-text-link"
            >
              {shortAddress(config.factoryAddress)} ↗
            </a>
          </dd>
        </div>
      </dl>
      <details className="mt-5 border-t border-melon-300 pt-4">
        <summary className="text-xs">Exact production &amp; execution limits</summary>
        <dl className="mt-5 space-y-4 text-xs leading-6">
          <div>
            <dt className="text-melon-700">Conversion batch</dt>
            <dd className="mt-1 break-all">
              {amount(policy.minBatchTokens)}–{amount(policy.maxBatchTokens)} project tokens
            </dd>
          </div>
          <div>
            <dt className="text-melon-700">Minimum VVV received per project token</dt>
            <dd className="mt-1 break-all">{amount(policy.minVVVPerProjectToken)} VVV</dd>
          </div>
          <div>
            <dt className="text-melon-700">Minimum DIEM minted per VVV committed</dt>
            <dd className="mt-1 break-all">{amount(policy.minDiemPerVVV)} DIEM</dd>
          </div>
          <div>
            <dt className="text-melon-700">Initial issuance</dt>
            <dd className="mt-1 break-all">
              {amount(policy.initialIssuance)} project tokens / VVV
            </dd>
          </div>
        </dl>
      </details>
      <p className="mt-5 text-xs leading-6 text-melon-700">
        These limits stay fixed after launch. Minimum conversion rates protect execution against
        underdelivery; they can also pause activation when the market no longer meets them.
      </p>
    </section>
  );
}
