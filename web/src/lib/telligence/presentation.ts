import type { ComputeProjectDraft, ProjectSnapshot } from "./types";

const CAPACITY_MAX_AGE_MS = 5 * 60_000;
const decimal = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/;
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** These are provider credit observations, not a pledge-to-credit conversion. */
export function capacityPresentation(project: ProjectSnapshot, now = Date.now()) {
  const capacity = project.capacity;
  const observed = capacity.observedAt ? Date.parse(capacity.observedAt) : NaN;
  const toMicro = (value: string) => {
    if (!decimal.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  };
  const dailyMicro = toMicro(capacity.dailyCreditUsd);
  const remainingMicro = toMicro(capacity.remainingCreditUsd);
  const daily = Number(capacity.dailyCreditUsd);
  const remaining = Number(capacity.remainingCreditUsd);
  const valid =
    dailyMicro !== null &&
    remainingMicro !== null &&
    dailyMicro <= 1_000_000_000_000_000_000n &&
    remainingMicro <= dailyMicro &&
    Number.isFinite(observed) &&
    observed <= now + 30_000;
  const fresh =
    valid &&
    now - observed <= CAPACITY_MAX_AGE_MS &&
    new Date(observed).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
  const observedAmounts =
    fresh &&
    ["active", "accumulating"].includes(project.status) &&
    ["ready", "exhausted"].includes(capacity.status);
  const amounts = {
    daily: observedAmounts ? money.format(daily) : "—",
    remaining: observedAmounts ? money.format(remaining) : "—",
    observedAt: valid ? capacity.observedAt : null,
  };
  if (project.status === "closed")
    return {
      ...amounts,
      label: "Closed",
      detail: "This project has completed its compute wind-down.",
      usable: false,
      tone: "quiet" as const,
    };
  if (project.status === "winddown")
    return {
      ...amounts,
      label: "Winding down",
      detail: "Compute backing is being recovered through the published policy.",
      usable: false,
      tone: "quiet" as const,
    };
  if (project.status === "suspended" || capacity.status === "suspended")
    return {
      ...amounts,
      label: "Paused",
      detail: "Inference is paused. Check back for an updated capacity observation.",
      usable: false,
      tone: "warning" as const,
    };
  if (!valid)
    return {
      ...amounts,
      label: "Awaiting verification",
      detail: "Live compute capacity has not been verified yet.",
      usable: false,
      tone: "quiet" as const,
    };
  if (!fresh || capacity.status === "stale")
    return {
      ...amounts,
      label: "Checking capacity",
      detail:
        "The last provider observation is out of date. Capacity will appear when it is verified again.",
      usable: false,
      tone: "warning" as const,
    };
  if (capacity.status === "provisioning")
    return {
      ...amounts,
      label: "Building capacity",
      detail:
        "Backing is being activated for inference. An API key becomes useful after activation.",
      usable: false,
      tone: "quiet" as const,
    };
  if (capacity.status === "exhausted" || remaining === 0)
    return {
      ...amounts,
      label: "Back at 00:00 UTC",
      detail:
        "Today's credit is used up. The daily allowance resets at 00:00 UTC; unused credit does not carry over.",
      usable: false,
      tone: "quiet" as const,
    };
  if (project.status !== "active" || daily < 0.1)
    return {
      ...amounts,
      label: "Building capacity",
      detail: "The project is accumulating backing for usable daily compute.",
      usable: false,
      tone: "quiet" as const,
    };
  return {
    ...amounts,
    label: "Humming",
    detail:
      "Verified daily Venice inference credit. Service availability and model limits still apply.",
    usable: true,
    tone: "active" as const,
  };
}

export function inspectProjectHref(revnetId: string) {
  if (!/^[1-9]\d*$/.test(revnetId)) throw new Error("Invalid Base project identifier.");
  return `/base:${revnetId}`;
}

export function validateComputeDraft(draft: ComputeProjectDraft) {
  const errors: Partial<Record<keyof ComputeProjectDraft, string>> = {};
  if (draft.name.trim().length < 2 || draft.name.trim().length > 80)
    errors.name = "Give your project a name between 2 and 80 characters.";
  else if (new TextEncoder().encode(draft.name.trim()).length > 128)
    errors.name = "Use a shorter project name (at most 128 UTF-8 bytes).";
  if (draft.purpose.trim().length < 20 || draft.purpose.trim().length > 4000)
    errors.purpose = "Explain your purpose in 20 to 4,000 characters.";
  if (draft.workload.trim().length < 3 || draft.workload.trim().length > 160)
    errors.workload = "Describe the work in 3 to 160 characters.";
  if (
    typeof draft.targetDailyCreditUsd !== "string" ||
    (draft.targetDailyCreditUsd.trim() !== "" &&
      (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(draft.targetDailyCreditUsd) ||
        Number(draft.targetDailyCreditUsd) < 0.1 ||
        Number(draft.targetDailyCreditUsd) > 1_000_000))
  )
    errors.targetDailyCreditUsd =
      "Leave this blank, or choose a daily credit target from $0.10 to $1,000,000, with up to two decimals.";
  if (
    !Number.isInteger(draft.productionSplitBps) ||
    draft.productionSplitBps < 1 ||
    draft.productionSplitBps >= 10_000
  )
    errors.productionSplitBps =
      "The compute production split must be greater than 0% and below 100%.";
  if (
    !Number.isInteger(draft.operatorSplitBps) ||
    draft.operatorSplitBps < 0 ||
    draft.operatorSplitBps >= 10_000 ||
    draft.productionSplitBps + draft.operatorSplitBps >= 10_000
  )
    errors.operatorSplitBps =
      "The operator share must be 0% or more, with up to two decimals, and leave tokens for funders.";
  if (
    !Number.isInteger(draft.cashOutTaxBps) ||
    draft.cashOutTaxBps < 0 ||
    draft.cashOutTaxBps >= 10_000
  )
    errors.cashOutTaxBps = "The cash-out tax must be at least 0% and below 100%.";
  if (
    draft.recoveryAddress &&
    (!/^0x[0-9a-fA-F]{40}$/.test(draft.recoveryAddress) || /^0x0{40}$/.test(draft.recoveryAddress))
  )
    errors.recoveryAddress = "Use a nonzero Base wallet address for recovery.";
  return errors;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
