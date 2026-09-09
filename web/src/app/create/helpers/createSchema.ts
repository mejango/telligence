import { buildTierConfigs, type DraftItem } from "@/components/shop/itemDraft";
import { isRecord, issue, schema, ValidationIssue } from "@/lib/formValidation";
import { isAddress } from "viem";
import type { RevnetFormData } from "../types";
import { customReserveCoversChains } from "./customReserveAsset";
import { validateStage } from "./stageSchema";

function requiredTrimmedString(
  value: unknown,
  path: string,
  message: string,
  issues: ValidationIssue[],
  maxLength?: number,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issue(issues, [path], message);
  } else if (maxLength !== undefined && value.trim().length > maxLength) {
    issue(issues, [path], `${path === "name" ? "Name" : "Value"} is too long`);
  }
}

function optionalString(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && typeof value !== "string") {
    issue(issues, [path], "Invalid value");
  }
}

export const createSchema = schema<RevnetFormData>((input) => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    issue(issues, [], "Invalid form");
    return issues;
  }

  requiredTrimmedString(input.name, "name", "Name is required", issues, 50);
  requiredTrimmedString(input.description, "description", "Description is required", issues);

  if (typeof input.tokenSymbol !== "string" || input.tokenSymbol.length < 2) {
    issue(issues, ["tokenSymbol"], "Token symbol must be at least 2 characters");
  } else if (input.tokenSymbol.length > 10) {
    issue(issues, ["tokenSymbol"], "Token symbol is too long");
  }

  optionalString(input.logoUri, "logoUri", issues);
  optionalString(input.twitter, "twitter", issues);
  optionalString(input.telegram, "telegram", issues);
  optionalString(input.discord, "discord", issues);
  optionalString(input.infoUri, "infoUri", issues);

  if (
    input.reserveAsset !== "ETH" &&
    input.reserveAsset !== "USDC" &&
    input.reserveAsset !== "ETH_USDC" &&
    input.reserveAsset !== "CUSTOM"
  ) {
    issue(issues, ["reserveAsset"], "Invalid reserve asset");
  }
  if (input.issuanceBaseCurrency !== "ETH" && input.issuanceBaseCurrency !== "USD") {
    issue(issues, ["issuanceBaseCurrency"], "Invalid issuance base currency");
  }

  if (!Array.isArray(input.stages) || input.stages.length === 0) {
    issue(issues, ["stages"], "At least one stage is required");
  } else {
    input.stages.forEach((stage, index) =>
      issues.push(...validateStage(stage, ["stages", index], { requireAutoIssuanceChain: true })),
    );
  }

  const selectedChainIds: Array<string | number> = [];
  if (!Array.isArray(input.chainIds) || input.chainIds.length === 0) {
    issue(issues, ["chainIds"], "At least one chain must be selected");
  } else {
    input.chainIds.forEach((chainId, index) => {
      if (!(
        (typeof chainId === "string" && chainId.length > 0) ||
        (typeof chainId === "number" && Number.isFinite(chainId))
      )) {
        issue(issues, ["chainIds", index], "Invalid chain");
      } else {
        selectedChainIds.push(chainId);
      }
    });
  }

  if (!Array.isArray(input.operator)) {
    issue(issues, ["operator"], "Invalid revnet operators");
  } else {
    input.operator.forEach((operator, index) => {
      if (!isRecord(operator)) {
        issue(issues, ["operator", index], "Invalid revnet operator");
        return;
      }
      const chainId = operator.chainId;
      if (!(
        (typeof chainId === "string" && chainId.length > 0) ||
        (typeof chainId === "number" && Number.isFinite(chainId))
      )) {
        issue(issues, ["operator", index, "chainId"], "Invalid chain");
      }
      const address = String(operator.address ?? "");
      if (!address) {
        issue(issues, ["operator", index, "address"], "Address is required");
      } else if (!isAddress(address, { strict: false })) {
        issue(issues, ["operator", index, "address"], "Invalid address");
      }
    });
  }

  // Store items go through the same encoder the launch uses, so a price, split, or reserve the
  // deployment would reject is reported here rather than at the wallet.
  const store = isRecord(input.store) ? input.store : undefined;
  const storeItems = store && Array.isArray(store.items) ? (store.items as DraftItem[]) : [];
  if (storeItems.length > 0) {
    // The same decimals the launch will encode with, so a price that survives validation
    // cannot be rejected by the encoder later.
    const customDecimals = isRecord(input.customReserveAsset)
      ? Number(input.customReserveAsset.decimals)
      : NaN;
    const decimals =
      store?.pricing === "USD"
        ? 6
        : input.reserveAsset === "CUSTOM"
          ? Number.isFinite(customDecimals)
            ? customDecimals
            : 18
          : input.issuanceBaseCurrency === "USD"
            ? 6
            : 18;
    const encoded = buildTierConfigs(storeItems, decimals);
    if (typeof encoded === "string") issue(issues, ["store", "items"], encoded);
    storeItems.forEach((item, index) => {
      const composes = item.name?.trim() || item.description?.trim() || item.mediaFile;
      if (composes && !item.name?.trim()) {
        issue(issues, ["store", "items", index, "name"], "Item name is required");
      }
      for (const [chainId, value] of Object.entries(item.perChainSupply ?? {})) {
        const trimmed = String(value).trim();
        if (trimmed === "" || trimmed === "unlimited") continue;
        if (!/^\d+$/.test(trimmed)) {
          issue(
            issues,
            ["store", "items", index, "perChainSupply", chainId],
            'Quantity must be a whole number, empty, or "unlimited"',
          );
        }
      }
    });
  }

  if (selectedChainIds.length > 0) {
    const chainIsSelected = (chainId: unknown) =>
      selectedChainIds.some((selected) => Number(selected) === Number(chainId));

    // Per-chain overrides referencing a chain the revnet is not deployed to
    // would silently never apply, so reject them like the auto-issuance guard.
    if (Array.isArray(input.operator)) {
      input.operator.forEach((operator, index) => {
        if (isRecord(operator) && !chainIsSelected(operator.chainId)) {
          issue(
            issues,
            ["operator", index, "chainId"],
            "Operator chain must be selected for deployment",
          );
        }
      });
    }

    if (input.reserveAsset === "CUSTOM") {
      if (
        !isRecord(input.customReserveAsset) ||
        !customReserveCoversChains(
          input.customReserveAsset as RevnetFormData["customReserveAsset"],
          selectedChainIds.map(Number) as RevnetFormData["chainIds"],
        )
      ) {
        issue(
          issues,
          ["customReserveAsset"],
          "Verify the custom reserve token on every selected chain",
        );
      }
    }

    const operators = Array.isArray(input.operator) ? input.operator : [];
    const firstStage =
      Array.isArray(input.stages) && isRecord(input.stages[0]) ? input.stages[0] : {};

    for (const chainId of selectedChainIds) {
      const perChainOperator = operators.find(
        (operator) => isRecord(operator) && Number(operator.chainId) === Number(chainId),
      );
      const effectiveOperator = isRecord(perChainOperator)
        ? perChainOperator.address
        : firstStage.initialOperator;
      if (
        typeof effectiveOperator !== "string" ||
        !isAddress(effectiveOperator, { strict: false })
      ) {
        if (!isRecord(perChainOperator)) {
          issue(issues, ["operator"], `Set a valid revnet operator for chain ${chainId}`);
        }
      }
    }

    if (Array.isArray(input.stages)) {
      input.stages.forEach((stage, stageIndex) => {
        if (!isRecord(stage)) return;
        if (Array.isArray(stage.autoIssuance)) {
          stage.autoIssuance.forEach((entry, entryIndex) => {
            if (isRecord(entry) && !chainIsSelected(entry.chainId)) {
              issue(
                issues,
                ["stages", stageIndex, "autoIssuance", entryIndex, "chainId"],
                "Auto issuance chain must be selected for deployment",
              );
            }
          });
        }
        if (Array.isArray(stage.splits)) {
          stage.splits.forEach((split, splitIndex) => {
            if (!isRecord(split) || !Array.isArray(split.beneficiary)) return;
            split.beneficiary.forEach((entry, entryIndex) => {
              if (isRecord(entry) && !chainIsSelected(entry.chainId)) {
                issue(
                  issues,
                  [
                    "stages",
                    stageIndex,
                    "splits",
                    splitIndex,
                    "beneficiary",
                    entryIndex,
                    "chainId",
                  ],
                  "Split beneficiary chain must be selected for deployment",
                );
              }
            });
          });
        }
      });
    }
  }

  return issues;
});
