"use client";

import { REVNET_AUDIT_PROMPT } from "@/lib/audit-prompt";
import { useEffect, useRef, useState } from "react";

const TRANSACTION_AUDIT_PROMPT = `Audit this exact transaction built by Revnet Money against the current Revnet V6 and Juicebox V6 contracts.

User intent:
[describe what the user expects this transaction to do]

Chain, connected account, and current block:
[paste them here]

Exact transaction request:
[paste the complete target, value, calldata, approvals, and any displayed quote here]

Decode the calldata with the current deployed ABI. Verify the chain, target, function, overload, project ID, token, beneficiary, amounts, units, operator permission, stage, issuance, cash-out, loan, shop, route, approvals, slippage or minimum output, deadlines, hooks, and native value. Re-read every execution-sensitive value at the current block and compare the decoded call with the stated user intent and the confirmation UI. Trace all external calls and identify any stale-stage, rounding, permission, reentrancy, malicious-token, market-route, hook, loan, or cross-chain risk.

Use only current Revnet V6 and Juicebox V6 sources. Return: decoded call; expected state changes; discrepancies; exploitable risks; exact source links; and a final verdict of safe to sign, unsafe to sign, or insufficient information. Do not infer missing fields.`;

const PROMPTS = [
  { id: "system", label: "Full app + protocol audit prompt", prompt: REVNET_AUDIT_PROMPT },
  { id: "transaction", label: "Single transaction audit prompt", prompt: TRANSACTION_AUDIT_PROMPT },
] as const;

export function AuditPromptActions() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="divide-y divide-teal-100 border-y border-teal-200">
      {PROMPTS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(item.prompt);
              setCopied(item.id);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(null), 2000);
            } catch {
              setCopied(null);
            }
          }}
          className="flex min-h-14 w-full items-center justify-between gap-5 py-3 text-left text-sm hover:text-teal-700"
        >
          <span>{item.label}</span>
          <span className="shrink-0 text-xs text-zinc-500">
            {copied === item.id ? "Copied" : "Copy"}
          </span>
        </button>
      ))}
    </div>
  );
}
