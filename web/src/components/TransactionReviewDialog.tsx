"use client";

import { LoadingText } from "@/components/ui/LoadingText";

import { chainDisplayName, isSupportedChainId } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { RelayrPaymentSelect } from "@/components/RelayrPaymentSelect";
import { ModalCloseButton, ModalDialog } from "@/components/ui/ModalShell";
import { feeBuybackContext } from "@/lib/fee-buyback-client";
import { safeNonceLabel } from "@/lib/safe-nonce-choice";
import { buildTransactionReviewPrompt } from "@/lib/transaction-review";
import {
  type ReviewArgument,
  type ReviewCallModel,
  type ReviewSignatureModel,
  type ReviewValue,
} from "@bananapus/nana-sdk-core/review";
import {
  addressLabel,
  currencyLabel,
  type PrettyStep,
  type V4PlanStep,
} from "@bananapus/nana-sdk-core/review/decode";
import { useFeeBuybackReview } from "@bananapus/nana-sdk-core/review/react";
import { Fragment, useMemo, useState, type ReactNode } from "react";

import { FeeBuybackNotice } from "./FeeBuybackNotice";

import type {
  PendingFundingChainSelection,
  PendingReview,
  PendingSafeNonceSelection,
  TransactionReviewDialogProps,
} from "./TransactionReviewProvider";

const ARRAY_TYPE = /\[\d*\]$/;

function ArgumentValue({ value, depth = 0 }: { value: ReviewValue; depth?: number }) {
  if (value.children && ARRAY_TYPE.test(value.type)) {
    return (
      <div className="mt-2 space-y-2 border-l border-melon-200 pl-3">
        {value.children.length ? (
          value.children.map((item, index) => (
            <div key={index}>
              <p className="font-mono text-[11px] font-medium text-zinc-600">{item.name}</p>
              <ArgumentValue value={item} depth={depth + 1} />
            </div>
          ))
        ) : (
          <span className="font-mono text-xs text-zinc-600">[]</span>
        )}
      </div>
    );
  }

  if (value.children) {
    return (
      <div className="mt-2 space-y-2 border-l border-melon-200 pl-3">
        {value.children.map((component, index) => (
          <ArgumentRow
            key={`${component.name || "field"}-${index}`}
            value={component}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  return <p className="break-all font-mono text-xs leading-relaxed text-zinc-900">{value.text}</p>;
}

/** The pay-confirm row grammar: `Label: value`, addresses resolved to known names. */
function V4PlanRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1">
      <dt className="shrink-0 text-zinc-500">{label}:</dt>
      <dd className="min-w-0 break-all font-mono text-zinc-700">{children}</dd>
    </div>
  );
}

function v4Amounts(pair: { currency0: bigint; currency1: bigint }): string {
  return `${pair.currency0} (currency0) + ${pair.currency1} (currency1)`;
}

/** A decoded unlockData plan in the same row grammar the pay confirm uses. */
function V4PlanView({ steps, chainId }: { steps: readonly V4PlanStep[]; chainId: number }) {
  return (
    <div className="mt-1 space-y-3 text-xs">
      {steps.map((step, index) => {
        const title = (text: string) => (
          <p className="font-medium text-zinc-900">
            {index + 1}. {text}
          </p>
        );
        switch (step.action) {
          case "INCREASE_LIQUIDITY":
            return (
              <dl key={index} className="space-y-0.5">
                {title(`Increase position ${step.position}`)}
                <V4PlanRow label="Liquidity added">{String(step.liquidity)}</V4PlanRow>
                <V4PlanRow label="Maximum in">
                  {v4Amounts(step.maximumIn)} — reverts above this
                </V4PlanRow>
              </dl>
            );
          case "BURN_POSITION":
            return (
              <dl key={index} className="space-y-0.5">
                {title(`Burn position ${step.position}`)}
                <V4PlanRow label="Minimum out">
                  {v4Amounts(step.minimumOut)} — reverts below this
                </V4PlanRow>
              </dl>
            );
          case "DECREASE_LIQUIDITY":
            return (
              <dl key={index} className="space-y-0.5">
                {title(
                  step.liquidity === 0n
                    ? `Collect fees on position ${step.position} (liquidity untouched)`
                    : `Decrease position ${step.position}`,
                )}
                {step.liquidity !== 0n ? (
                  <>
                    <V4PlanRow label="Liquidity">{String(step.liquidity)}</V4PlanRow>
                    <V4PlanRow label="Minimum out">
                      {v4Amounts(step.minimumOut)} — reverts below this
                    </V4PlanRow>
                  </>
                ) : null}
              </dl>
            );
          case "MINT_POSITION":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Mint a new position")}
                <V4PlanRow label="Owner">{addressLabel(chainId, step.owner)}</V4PlanRow>
                <V4PlanRow label="Currency0">
                  {currencyLabel(chainId, step.pool.currency0)}
                </V4PlanRow>
                <V4PlanRow label="Currency1">
                  {currencyLabel(chainId, step.pool.currency1)}
                </V4PlanRow>
                <V4PlanRow label="Fee">
                  {step.pool.fee} ({step.pool.fee / 10_000}%) | tick spacing {step.pool.tickSpacing}
                </V4PlanRow>
                <V4PlanRow label="Hook">{addressLabel(chainId, step.pool.hook)}</V4PlanRow>
                <V4PlanRow label="Ticks">
                  {step.ticks.lower} → {step.ticks.upper}
                </V4PlanRow>
                <V4PlanRow label="Liquidity">{String(step.liquidity)}</V4PlanRow>
                <V4PlanRow label="Maximum in">{v4Amounts(step.maximumIn)}</V4PlanRow>
              </dl>
            );
          case "TAKE_PAIR":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Take both currencies")}
                <V4PlanRow label="Currency0">{currencyLabel(chainId, step.currency0)}</V4PlanRow>
                <V4PlanRow label="Currency1">{currencyLabel(chainId, step.currency1)}</V4PlanRow>
                <V4PlanRow label="Recipient">{addressLabel(chainId, step.recipient)}</V4PlanRow>
              </dl>
            );
          case "SETTLE":
            return (
              <dl key={index} className="space-y-0.5">
                {title(
                  step.payerIsCaller
                    ? "Pay in: exactly this much from the caller, the rest is taken back below"
                    : "Pay in: exactly this much from the position manager",
                )}
                <V4PlanRow label="Currency">{currencyLabel(chainId, step.currency)}</V4PlanRow>
                <V4PlanRow label="Amount">{String(step.amount)}</V4PlanRow>
              </dl>
            );
          case "CLOSE_CURRENCY":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Close currency — settle the net; leftovers return to the caller")}
                <V4PlanRow label="Currency">{currencyLabel(chainId, step.currency)}</V4PlanRow>
              </dl>
            );
          case "SWEEP":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Sweep — refund unused balance")}
                <V4PlanRow label="Currency">{currencyLabel(chainId, step.currency)}</V4PlanRow>
                <V4PlanRow label="Recipient">{addressLabel(chainId, step.recipient)}</V4PlanRow>
              </dl>
            );
        }
      })}
      <p className="text-zinc-500">The exact bytes are in the raw payload below.</p>
    </div>
  );
}

function ArgumentRow({ value, depth = 0 }: { value: ReviewValue; depth?: number }) {
  return (
    <div className={depth ? "" : "bg-melon-25 px-3 py-2.5"}>
      <p className="text-xs font-medium text-zinc-700">
        {value.name || "argument"}{" "}
        <span className="font-mono font-normal text-zinc-500">{value.type}</span>
      </p>
      <ArgumentValue value={value} depth={depth} />
    </div>
  );
}

/** A decoded Universal Router plan in the same row grammar as everything else. */
function UrPlanView({ steps, deadline }: { steps: readonly PrettyStep[]; deadline?: string }) {
  return (
    <div className="mt-3 space-y-3 text-xs">
      {steps.map((step, index) => (
        <dl key={index} className="space-y-0.5">
          <p className="font-medium text-zinc-900">
            {index + 1}. {step.title}
          </p>
          {step.rows.map(([label, value]) => (
            <V4PlanRow key={label} label={label}>
              {value}
            </V4PlanRow>
          ))}
        </dl>
      ))}
      {deadline !== undefined ? (
        <dl className="space-y-0.5">
          <V4PlanRow label="Deadline">{deadline}</V4PlanRow>
        </dl>
      ) : null}
      <p className="text-zinc-500">The exact bytes are in the raw payload below.</p>
    </div>
  );
}

/** An argument's decoded view, or null for its plain text. */
function specialArgumentView(call: ReviewCallModel, argument: ReviewArgument): ReactNode | null {
  if (argument.v4Plan) return <V4PlanView steps={argument.v4Plan} chainId={call.chainId} />;
  if (argument.steps) return <UrPlanView steps={argument.steps} />;
  if (call.functionName === "execTransaction" && argument.name === "operation") {
    return (
      <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-zinc-700">
        {argument.text}
      </pre>
    );
  }
  if (argument.nested) return <NestedCalls calls={argument.nested} />;
  return null;
}

function NestedCalls({ calls }: { calls: readonly ReviewCallModel[] }) {
  return (
    <div className="mt-2 space-y-3">
      {calls.map((inner, index) => (
        <PrettyCall key={index} call={inner} index={index} total={calls.length} nested />
      ))}
    </div>
  );
}

function PrettyCall({
  call,
  index,
  total,
  nested = false,
  headerAction,
}: {
  call: ReviewCallModel;
  index: number;
  total: number;
  /** One call inside a batch: numbered as a call, no chain chip of its own. */
  nested?: boolean;
  headerAction?: ReactNode;
}) {
  const { args, byteLength, contractName } = call;
  const batched = call.calls;
  const safeGasWarning = call.warnings.find((warning) => warning.code === "safe-gas-nonzero");
  const routerPlan = call.functionName === "execute" ? args?.[0]?.steps : null;
  return (
    <section className="border border-melon-200 bg-melon-50 p-4 sm:p-5">
      {total > 1 ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          {nested ? "Call" : "Transaction"} {index + 1} of {total}
        </p>
      ) : null}
      {nested ? null : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 border border-melon-300 bg-melon-100 px-2.5 py-1 text-xs font-medium leading-none text-melon-800">
              {isSupportedChainId(call.chainId) ? (
                <ChainLogo chainId={call.chainId} width={16} height={16} />
              ) : null}
              {chainDisplayName(call.chainId)}
            </span>
            <span className="font-mono text-[11px] text-zinc-500">chain {call.chainId}</span>
          </div>
          {headerAction}
        </div>
      )}

      {call.label ? (
        <h3 className="mt-3 text-base font-medium text-zinc-900">{call.label}</h3>
      ) : null}

      <dl className="mt-4 space-y-3 text-sm">
        {call.from ? (
          <div>
            <dt className="text-xs font-medium text-zinc-600">From</dt>
            <dd className="mt-1 break-all font-mono text-xs text-zinc-900">{call.from}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs font-medium text-zinc-600">
            Destination{contractName ? ` | ${contractName}` : ""}
          </dt>
          <dd className="mt-1 break-all font-mono text-xs text-zinc-900">{call.to}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-600">Native value</dt>
          <dd className="mt-1 font-mono text-xs text-zinc-900">{call.valueText}</dd>
        </div>
        {call.safeTxGas !== null ? (
          <div>
            <dt className="text-xs font-medium text-zinc-600">Safe gas</dt>
            <dd className="mt-1 font-mono text-xs text-zinc-900">
              {call.safeTxGas.toLocaleString("en-US")}
            </dd>
            {safeGasWarning ? (
              <dd className="mt-1 text-xs text-peel-800">{safeGasWarning.text}</dd>
            ) : null}
          </div>
        ) : null}
        {call.gas !== null ? (
          <div>
            <dt className="text-xs font-medium text-zinc-600">Gas limit</dt>
            <dd className="mt-1 font-mono text-xs text-zinc-900">
              {call.gas.toLocaleString("en-US")}
            </dd>
          </div>
        ) : null}
      </dl>

      {batched ? (
        <div className="mt-5 border-t border-melon-200 pt-4">
          <p className="text-xs font-medium text-zinc-600">Calls it makes, in order</p>
          <NestedCalls calls={batched} />
        </div>
      ) : null}

      {args ? (
        <div className="mt-5 border-t border-melon-200 pt-4">
          <p className="text-xs font-medium text-zinc-600">Contract function</p>
          <p className="mt-1 break-all font-mono text-sm font-medium text-zinc-900">
            {call.functionName}({args.map((argument) => argument.type).join(", ")})
          </p>
          {routerPlan ? (
            <UrPlanView steps={routerPlan} deadline={args[2]?.text} />
          ) : args.length ? (
            <div className="mt-3 space-y-2">
              {args.map((argument, argumentIndex) => {
                const special = specialArgumentView(call, argument);
                if (special) {
                  return (
                    <div
                      key={`${argument.name || "argument"}-${argumentIndex}`}
                      className="bg-melon-25 px-3 py-2.5"
                    >
                      <p className="text-xs font-medium text-zinc-700">
                        {argument.name}{" "}
                        <span className="font-mono font-normal text-zinc-500">
                          {argument.type}, decoded
                        </span>
                      </p>
                      {special}
                    </div>
                  );
                }
                return (
                  <ArgumentRow
                    key={`${argument.name || "argument"}-${argumentIndex}`}
                    value={argument}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5 border border-peel-200 bg-peel-25 p-3 text-xs leading-relaxed text-peel-800">
          <p className="font-medium">
            {call.warnings.find((warning) => warning.code === "abi-unavailable")?.text}
          </p>
          <p className="mt-1 font-mono">
            {byteLength === 0 ? "No calldata" : `Selector ${call.selector}`}
          </p>
        </div>
      )}

      <p className="mt-3 text-[11px] text-zinc-500">
        Calldata: {byteLength.toLocaleString("en-US")} byte{byteLength === 1 ? "" : "s"}
      </p>
    </section>
  );
}

const SIGNATURE_KINDS: Record<ReviewSignatureModel["kind"], string> = {
  "safe-tx": "Safe transaction",
  "forward-request": "Relayed request",
  permit2: "Permit2 approval",
  message: "Message",
};

/** One signature the action asks for: what it authorizes, then the calls it lets someone run. */
function SignatureView({
  signature,
  index,
  total,
  headerAction,
}: {
  signature: ReviewSignatureModel;
  index: number;
  total: number;
  headerAction?: ReactNode;
}) {
  return (
    <section className="border border-melon-200 bg-melon-50 p-4 sm:p-5">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {total > 1 ? `Signature ${index + 1} of ${total}` : "Signature"}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 border border-melon-300 bg-melon-100 px-2.5 py-1 text-xs font-medium leading-none text-melon-800">
            {isSupportedChainId(signature.chainId) ? (
              <ChainLogo chainId={signature.chainId} width={16} height={16} />
            ) : null}
            {chainDisplayName(signature.chainId)}
          </span>
          <span className="font-mono text-[11px] text-zinc-500">chain {signature.chainId}</span>
        </div>
        {headerAction}
      </div>
      <h3 className="mt-3 text-base font-medium text-zinc-900">
        {SIGNATURE_KINDS[signature.kind]}
      </h3>
      {signature.message !== null ? (
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words bg-melon-25 px-3 py-2.5 font-mono text-xs text-zinc-900">
          {signature.message}
        </pre>
      ) : null}
      {signature.steps.length ? <UrPlanView steps={signature.steps} /> : null}
      {signature.calls.length ? (
        <div className="mt-5 border-t border-melon-200 pt-4">
          <p className="text-xs font-medium text-zinc-600">Calls it lets someone run, in order</p>
          <NestedCalls calls={signature.calls} />
        </div>
      ) : null}
    </section>
  );
}

/** What the review says about the signed data, by whether it holds a message, typed data or both. */
const COMMITMENT_TEXT = {
  message: {
    banner: "The Raw view also includes the exact message your signature commits to.",
    raw: "The exact message your signature commits to, plus the resulting app-controlled call. Hex value is the native token amount; data is the complete calldata.",
    agree: ", plus the exact message your signature commits to",
  },
  typed: {
    banner:
      "The Raw view also includes the exact typed-data domain and message your signature commits to.",
    raw: "Exact typed data plus the resulting app-controlled call. Hex value is the native token amount; data is the complete calldata.",
    agree: ", plus the exact typed data",
  },
  both: {
    banner:
      "The Raw view also includes the exact message and typed data your signatures commit to.",
    raw: "The exact message and typed data your signatures commit to, plus the resulting app-controlled call. Hex value is the native token amount; data is the complete calldata.",
    agree: ", plus the exact message and typed data your signatures commit to",
  },
} as const;

/** The request could not be described, so it cannot be approved. */
function UnreadableReview({
  titleId,
  onFinish,
}: {
  titleId: string;
  onFinish: (approved: boolean) => void;
}) {
  return (
    <ModalDialog
      onClose={() => onFinish(false)}
      labelledBy={titleId}
      className="items-start justify-center px-3 py-4 sm:px-6 sm:py-8"
    >
      <div className="w-full max-w-md border border-melon-700 bg-melon-25 p-5 shadow-2xl">
        <h2 id={titleId} className="text-xl font-medium text-zinc-900">
          {"Can't review this request"}
        </h2>
        <p className="mt-2 text-sm text-zinc-700">
          {"It holds values the review can't show, so nothing was sent or signed."}
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => onFinish(false)}
            className="min-h-[44px] border border-melon-600 px-5 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}

function ReviewModal({
  pending,
  onFinish,
  projectCheckPending,
}: {
  projectCheckPending?: boolean;
  pending: PendingReview;
  onFinish: (approved: boolean) => void;
}) {
  const { model } = pending;
  const feeCalls = useMemo(
    () =>
      model.calls.map((call) => ({
        chainId: call.chainId,
        to: call.to,
        data: call.data,
        value: call.value,
        functionName: call.functionName ?? undefined,
      })),
    [model],
  );
  const feeReview = useFeeBuybackReview(feeCalls, feeBuybackContext);
  const [agreed, setAgreed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildTransactionReviewPrompt(model));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2200);
  };

  // One audit prompt per review, on its first signature or, with none, its first call.
  const copyButton = (
    <button
      type="button"
      onClick={copyPrompt}
      className="min-h-[36px] border border-melon-600 bg-melon-100 px-4 text-xs font-bold hover:bg-melon-200"
    >
      {copyState === "copied"
        ? "Prompt copied — paste into your LLM"
        : copyState === "failed"
          ? "Could not copy prompt"
          : "[copy tx audit prompt]"}
    </button>
  );

  const titleId = `transaction-review-title-${pending.id}`;
  const descriptionId = `transaction-review-description-${pending.id}`;
  if (model.warnings.some((warning) => warning.code === "unreadable")) {
    return <UnreadableReview titleId={titleId} onFinish={onFinish} />;
  }

  const isAuthorization = model.kind !== "transaction";
  /** Some authorizations are signed as a plain message rather than typed data. */
  const authorizationIsMessage = model.kind === "message";
  const authorizes = isAuthorization;
  const kinds = model.signatures.map((signature) => signature.kind);
  const signsMessage = (authorizes && authorizationIsMessage) || kinds.includes("message");
  const signsTypedData =
    (authorizes && !authorizationIsMessage) || kinds.some((kind) => kind !== "message");
  const commitment = signsMessage
    ? signsTypedData
      ? "both"
      : "message"
    : signsTypedData
      ? "typed"
      : null;

  return (
    <ModalDialog
      onClose={() => onFinish(false)}
      labelledBy={titleId}
      describedBy={descriptionId}
      className="items-start justify-center px-3 py-4 sm:px-6 sm:py-8"
    >
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden border border-melon-700 bg-melon-25 shadow-2xl sm:max-h-[calc(100vh-4rem)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-melon-300 bg-melon-50 px-4 py-4 sm:px-6">
          <div>
            <h2 id={titleId} className="text-xl font-medium text-zinc-900">
              {model.title ?? (isAuthorization ? "Review authorization" : "Review transaction")}
            </h2>
          </div>
          <ModalCloseButton
            onClick={() => onFinish(false)}
            aria-label="Cancel transaction review"
            className="-mr-2 -mt-2"
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="border border-amber-300 bg-amber-50 px-4 py-3">
            <p
              id={descriptionId}
              className="whitespace-pre-line text-sm leading-relaxed text-amber-900"
            >
              {model.description}
            </p>
          </div>
          {model.context.length ? (
            <dl className="mt-4 grid text-sm">
              {model.context.map((row, index) => (
                <Fragment key={index}>
                  <dt className="text-xs text-zinc-500 not-first:mt-3">{row.label}</dt>
                  <dd
                    className={`min-w-0 text-zinc-900 ${
                      row.mono ? "break-all font-mono text-xs" : "wrap-anywhere"
                    } ${row.strong ? "font-medium" : ""}`}
                  >
                    {row.value}
                    {row.lines?.map((line, at) => (
                      <span key={at} className="block">
                        {line}
                      </span>
                    ))}
                    {row.note ? (
                      <span className="block text-xs text-zinc-500">{row.note}</span>
                    ) : null}
                  </dd>
                </Fragment>
              ))}
            </dl>
          ) : null}

          <div className="mt-4 space-y-4">
            {model.signatures.map((signature, index) => (
              <SignatureView
                key={`signature-${index}`}
                signature={signature}
                index={index}
                total={model.signatures.length}
                headerAction={index === 0 ? copyButton : null}
              />
            ))}
            {model.calls.map((call, index) => (
              <PrettyCall
                key={`${call.chainId}-${call.to}-${index}`}
                call={call}
                index={index}
                total={model.calls.length}
                headerAction={index === 0 && !model.signatures.length ? copyButton : null}
              />
            ))}
          </div>

          {commitment ? (
            <div className="mt-4 border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              {COMMITMENT_TEXT[commitment].banner}
            </div>
          ) : null}
          <details className="mt-4 overflow-hidden border border-melon-300 bg-melon-50">
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-zinc-700 hover:bg-melon-100">
              Raw transaction payload
            </summary>
            <div className="border-t border-melon-300 p-4">
              <p className="mb-2 text-xs leading-relaxed text-zinc-600">
                {commitment
                  ? COMMITMENT_TEXT[commitment].raw
                  : "Exact app-controlled JSON-RPC call fields. Hex value is the native token amount; data is the complete calldata."}
              </p>
              <pre className="max-h-[28rem] overflow-auto border border-melon-300 bg-melon-950 p-4 font-mono text-[11px] leading-relaxed text-melon-25">
                {model.rawJson}
              </pre>
            </div>
          </details>
        </div>

        <footer className="shrink-0 border-t border-melon-300 bg-melon-50 px-4 py-4 sm:px-6">
          <FeeBuybackNotice review={feeReview} />
          {projectCheckPending ? (
            <p role="status">
              <LoadingText text="Checking project identity…" />
            </p>
          ) : null}
          <label className="flex cursor-pointer items-start gap-3 border border-melon-300 bg-melon-25 p-3 text-sm leading-relaxed text-zinc-900">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              I reviewed the chain, destination, native value, and calldata
              {commitment ? COMMITMENT_TEXT[commitment].agree : ""}. I agree to{" "}
              {isAuthorization ? "authorize" : "send"} this exact call.
            </span>
          </label>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onFinish(false)}
              className="min-h-[44px] border border-melon-600 px-5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!(await feeReview.confirm())) return;
                // Core binds its own model to the confirmation it minted for it.
                onFinish(true);
              }}
              disabled={!agreed || feeReview.busy || projectCheckPending}
              className="min-h-[44px] border border-melon-700 bg-melon-500 px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {feeReview.confirmLabel ??
                model.confirmLabel ??
                (isAuthorization ? "Agree & authorize" : "Agree & continue")}
            </button>
          </div>
        </footer>
      </div>
    </ModalDialog>
  );
}

function FundingChainSelectionModal({
  pending,
  onFinish,
  projectCheckPending,
}: {
  projectCheckPending?: boolean;
  pending: PendingFundingChainSelection;
  onFinish: (chainId: number | null) => void;
}) {
  const [selected, setSelected] = useState(String(pending.initialChainId ?? ""));
  const selectedOption = pending.options.find((option) => String(option.chainId) === selected);
  const titleId = `funding-chain-title-${pending.id}`;
  const descriptionId = `funding-chain-description-${pending.id}`;

  return (
    <ModalDialog
      onClose={() => onFinish(null)}
      labelledBy={titleId}
      describedBy={descriptionId}
      className="items-start justify-center px-3 py-5 sm:px-6 sm:py-10"
    >
      <div className="w-full max-w-lg overflow-hidden border border-melon-700 bg-melon-25 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-melon-300 px-5 py-4 sm:px-6">
          <h2 id={titleId} className="text-xl font-medium text-zinc-900">
            Choose where to pay
          </h2>
          <ModalCloseButton
            onClick={() => onFinish(null)}
            aria-label="Cancel funding chain selection"
            className="-mr-2 -mt-2"
          />
        </header>
        <div className="px-5 py-5 sm:px-6">
          <p id={descriptionId} className="text-sm leading-relaxed text-zinc-700">
            One payment covers every chain. You’ll review it before your wallet sends it.
          </p>
          <div className="mt-5">
            <RelayrPaymentSelect
              label="Pay on"
              placeholder="Choose a chain"
              options={pending.options}
              value={selectedOption?.chainId ?? null}
              onValueChange={(chainId) => setSelected(String(chainId))}
            />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-melon-300 bg-melon-50 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => onFinish(null)}
            className="min-h-[44px] border border-melon-600 px-5 text-sm"
          >
            Cancel
          </button>
          {projectCheckPending ? (
            <p role="status">
              <LoadingText text="Checking project identity…" />
            </p>
          ) : null}
          <button
            type="button"
            disabled={!selectedOption || projectCheckPending}
            onClick={() => {
              if (selectedOption) onFinish(selectedOption.chainId);
            }}
            className="min-h-[44px] border border-melon-700 bg-melon-500 px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue to payment review
          </button>
        </footer>
      </div>
    </ModalDialog>
  );
}

function SafeNonceSelectionModal({
  pending,
  onFinish,
}: {
  pending: PendingSafeNonceSelection;
  onFinish: (nonce: number | null) => void;
}) {
  const { choices, chainName } = pending.request;
  const next = choices[choices.length - 1]!;
  const [selected, setSelected] = useState(next);
  const titleId = `safe-nonce-title-${pending.id}`;
  const descriptionId = `safe-nonce-description-${pending.id}`;
  const selectId = `safe-nonce-select-${pending.id}`;

  return (
    <ModalDialog
      onClose={() => onFinish(null)}
      labelledBy={titleId}
      describedBy={descriptionId}
      className="items-start justify-center px-3 py-5 sm:px-6 sm:py-10"
    >
      <div className="w-full max-w-lg overflow-hidden border border-melon-700 bg-melon-25 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-melon-300 px-5 py-4 sm:px-6">
          <h2 id={titleId} className="text-xl font-medium text-zinc-900">
            Choose the Safe nonce
          </h2>
          <ModalCloseButton
            onClick={() => onFinish(null)}
            aria-label="Cancel Safe nonce selection"
            className="-mr-2 -mt-2"
          />
        </header>
        <div className="px-5 py-5 sm:px-6">
          <p id={descriptionId} className="text-sm leading-relaxed text-zinc-700">
            The Safe on {chainName} has queued proposals. You’ll review the proposal before your
            wallet signs it.
          </p>
          <label htmlFor={selectId} className="mt-5 block text-sm font-medium text-zinc-900">
            Safe nonce
          </label>
          <select
            id={selectId}
            value={selected}
            onChange={(event) => setSelected(Number(event.target.value))}
            className="mt-2 min-h-[44px] w-full border border-melon-600 bg-white px-3 py-2 text-sm"
          >
            {choices.map((nonce) => (
              <option key={nonce} value={nonce}>
                {safeNonceLabel(nonce, next)}
              </option>
            ))}
          </select>
        </div>
        <footer className="flex justify-end gap-2 border-t border-melon-300 bg-melon-50 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => onFinish(null)}
            className="min-h-[44px] border border-melon-600 px-5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onFinish(selected)}
            className="min-h-[44px] border border-melon-700 bg-melon-500 px-5 text-sm font-bold"
          >
            Continue to review
          </button>
        </footer>
      </div>
    </ModalDialog>
  );
}

export function TransactionReviewDialog({
  pending,
  onFinish,
  projectCheckPending,
}: TransactionReviewDialogProps) {
  return pending.kind === "review" ? (
    <ReviewModal
      key={pending.id}
      pending={pending}
      onFinish={onFinish}
      projectCheckPending={projectCheckPending}
    />
  ) : pending.kind === "nonce" ? (
    <SafeNonceSelectionModal key={pending.id} pending={pending} onFinish={onFinish} />
  ) : (
    <FundingChainSelectionModal
      key={pending.id}
      pending={pending}
      onFinish={onFinish}
      projectCheckPending={projectCheckPending}
    />
  );
}
