import { isRecord, issue, schema, ValidationIssue } from "@/lib/formValidation";
import { isAddress } from "viem";

export type ChangeSplitsValues = {
  chains: Array<{
    chainId: number;
    selected: boolean;
    splits: Array<{ beneficiary: string; percentage: string }>;
  }>;
};

export const changeSplitsSchema = schema<ChangeSplitsValues>((input) => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input) || !Array.isArray(input.chains)) {
    issue(issues, ["chains"], "Invalid chains");
    return issues;
  }

  input.chains.forEach((chain, chainIndex) => {
    const chainPath = ["chains", chainIndex] as Array<string | number>;
    if (!isRecord(chain)) {
      issue(issues, chainPath, "Invalid chain");
      return;
    }
    if (typeof chain.chainId !== "number" || !Number.isFinite(chain.chainId)) {
      issue(issues, [...chainPath, "chainId"], "Invalid chain");
    }
    if (typeof chain.selected !== "boolean") {
      issue(issues, [...chainPath, "selected"], "Invalid selection");
    }
    if (!Array.isArray(chain.splits)) {
      issue(issues, [...chainPath, "splits"], "Invalid splits");
      return;
    }

    let total = 0;
    chain.splits.forEach((split, splitIndex) => {
      const splitPath = [...chainPath, "splits", splitIndex];
      if (!isRecord(split)) {
        issue(issues, splitPath, "Invalid split");
        return;
      }

      const percentage = String(split.percentage ?? "");
      const numericPercentage = Number(percentage);
      if (!percentage) {
        issue(issues, [...splitPath, "percentage"], "Percentage is required");
      } else if (!Number.isFinite(numericPercentage) || numericPercentage <= 0) {
        issue(issues, [...splitPath, "percentage"], "Percentage must be greater than 0");
      }
      total += numericPercentage || 0;

      const beneficiary = String(split.beneficiary ?? "");
      if (!beneficiary) {
        issue(issues, [...splitPath, "beneficiary"], "Address is required");
      } else if (!isAddress(beneficiary, { strict: false })) {
        issue(issues, [...splitPath, "beneficiary"], "Invalid Ethereum address");
      }
    });

    if (chain.selected && chain.splits.length > 0 && Math.abs(total - 100) >= 0.01) {
      issue(issues, [...chainPath, "splits"], "Splits must sum to 100%");
    }
  });

  if (!input.chains.some((chain) => isRecord(chain) && chain.selected === true)) {
    issue(issues, ["chains"], "Select at least one chain");
  }

  return issues;
});
