import { isRecord, issue, schema, ValidationIssue } from "@/lib/formValidation";
import {
  isStickyRow,
  stickyGroupDraftError,
  stickyGroupOf,
  type StickyGroupDraft,
} from "@/lib/sticky";
import { isAddress } from "viem";
import type { StageData } from "../types";

function isChainId(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validateAddress(
  value: unknown,
  path: Array<string | number>,
  issues: ValidationIssue[],
): void {
  const address = String(value ?? "");
  if (!address) {
    issue(issues, path, "Address is required");
  } else if (!isAddress(address, { strict: false })) {
    issue(issues, path, "Invalid address");
  }
}

function validateRequiredDecimal(
  value: unknown,
  path: Array<string | number>,
  requiredMessage: string,
  issues: ValidationIssue[],
  options: { max?: number; min?: number; minMessage?: string } = {},
): void {
  const input = String(value ?? "");
  if (!input) {
    issue(issues, path, requiredMessage);
    return;
  }

  // Contract payloads are encoded from decimal strings. Reject exponent notation,
  // signs, infinities, and other strings which parseUnits or the SDK numeric wrappers
  // cannot encode deterministically.
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) {
    issue(issues, path, "Enter a valid non-negative number");
    return;
  }

  const parsed = Number(input);
  if (!Number.isFinite(parsed) || (options.min !== undefined && parsed < options.min)) {
    issue(
      issues,
      path,
      options.minMessage ??
        (options.min && options.min > 0
          ? `Must be at least ${options.min}`
          : "Must not be negative"),
    );
  } else if (options.max !== undefined && parsed > options.max) {
    issue(issues, path, `Must not exceed ${options.max}`);
  }
}

export const addressSchema = schema<string>((input) => {
  const issues: ValidationIssue[] = [];
  validateAddress(input, [], issues);
  return issues;
});

export function validateStage(
  input: unknown,
  prefix: Array<string | number> = [],
  options: { requireAutoIssuanceChain?: boolean } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    issue(issues, prefix, "Invalid stage");
    return issues;
  }

  if (input.initialOperator !== undefined && input.initialOperator !== "") {
    validateAddress(input.initialOperator, [...prefix, "initialOperator"], issues);
  }
  if (input.pickUpFromPrevious !== undefined && typeof input.pickUpFromPrevious !== "boolean") {
    issue(issues, [...prefix, "pickUpFromPrevious"], "Invalid pickup setting");
  }

  validateRequiredDecimal(
    input.initialIssuance,
    [...prefix, "initialIssuance"],
    "Enter the number of tokens created per payment",
    issues,
  );
  validateRequiredDecimal(
    input.priceCeilingIncreasePercentage,
    [...prefix, "priceCeilingIncreasePercentage"],
    "Enter the percentage cut to the token rate",
    issues,
    { max: 100 },
  );
  validateRequiredDecimal(
    input.priceCeilingIncreaseFrequency,
    [...prefix, "priceCeilingIncreaseFrequency"],
    "Enter the days between token rate cuts",
    issues,
  );
  validateRequiredDecimal(
    input.priceFloorTaxIntensity,
    [...prefix, "priceFloorTaxIntensity"],
    "Choose a cash-out tax",
    issues,
    { max: 100 },
  );
  validateRequiredDecimal(
    input.stageStart,
    [...prefix, "stageStart"],
    "Stage start is required",
    issues,
  );

  if (input.stageStartCuts !== undefined && input.stageStartCuts !== "") {
    validateRequiredDecimal(
      input.stageStartCuts,
      [...prefix, "stageStartCuts"],
      "Stage start cuts are required",
      issues,
      { min: 1 },
    );
  }

  if (input.futureStartTimestamp === null) {
    issue(issues, [...prefix, "futureStartTimestamp"], "Choose a start date and time");
  } else if (
    input.futureStartTimestamp !== undefined &&
    (!Number.isSafeInteger(input.futureStartTimestamp) || Number(input.futureStartTimestamp) <= 0)
  ) {
    issue(issues, [...prefix, "futureStartTimestamp"], "Invalid future start time");
  }

  if (!Array.isArray(input.autoIssuance)) {
    issue(issues, [...prefix, "autoIssuance"], "Invalid entry for tokens created at stage start");
  } else {
    input.autoIssuance.forEach((entry, index) => {
      const path = [...prefix, "autoIssuance", index];
      if (!isRecord(entry)) {
        issue(issues, path, "Invalid entry for tokens created at stage start");
        return;
      }
      validateRequiredDecimal(entry.amount, [...path, "amount"], "Amount is required", issues);
      validateAddress(entry.beneficiary, [...path, "beneficiary"], issues);
      if (options.requireAutoIssuanceChain && !isChainId(entry.chainId)) {
        issue(issues, [...path, "chainId"], "Choose a chain for the tokens created at stage start");
      }
    });
  }

  if (!Array.isArray(input.splits)) {
    issue(issues, [...prefix, "splits"], "Invalid splits");
  } else {
    let splitTotal = 0;
    input.splits.forEach((entry, index) => {
      const path = [...prefix, "splits", index];
      if (!isRecord(entry)) {
        issue(issues, path, "Invalid split");
        return;
      }
      validateRequiredDecimal(
        entry.percentage,
        [...path, "percentage"],
        "Percentage is required",
        issues,
        { max: 100, min: Number.EPSILON, minMessage: "Percentage must be greater than 0" },
      );
      splitTotal += Number(entry.percentage) || 0;
      validateAddress(entry.defaultBeneficiary, [...path, "defaultBeneficiary"], issues);
      if (isStickyRow(entry)) {
        // The token is the beneficiary on every chain; the group must be one the distributor honors.
        const groupError = stickyGroupDraftError(stickyGroupOf(entry as Partial<StickyGroupDraft>));
        if (groupError) issue(issues, [...path, "stickyMinWeeks"], groupError);
        return;
      }

      if (entry.beneficiary !== undefined) {
        if (!Array.isArray(entry.beneficiary)) {
          issue(issues, [...path, "beneficiary"], "Invalid recipients");
        } else {
          entry.beneficiary.forEach((beneficiary, beneficiaryIndex) => {
            const beneficiaryPath = [...path, "beneficiary", beneficiaryIndex];
            if (!isRecord(beneficiary)) {
              issue(issues, beneficiaryPath, "Invalid recipient");
              return;
            }
            if (!isChainId(beneficiary.chainId)) {
              issue(issues, [...beneficiaryPath, "chainId"], "Invalid chain");
            }
            validateAddress(beneficiary.address, [...beneficiaryPath, "address"], issues);
          });
        }
      }
    });

    if (splitTotal > 100) {
      issue(issues, [...prefix, "splits"], "Split percentage must not exceed 100%");
    }
  }

  return issues;
}

export const stageSchema = schema<StageData>((input) => validateStage(input));
