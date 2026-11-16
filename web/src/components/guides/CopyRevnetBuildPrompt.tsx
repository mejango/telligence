"use client";

import { REVNET_ONE_LINER } from "@/lib/one-liner";
import { useState } from "react";

const REVNET_BUILD_PROMPT = `I want to build this on a revnet (Juicebox V6): ${REVNET_ONE_LINER} Start at https://revnet.money/skill.md; read https://revnet.money/learn#stages and https://revnet.money/build for the sections the brief needs.

My product: [describe the users, the value they exchange, and the experience I want].

Help me design and build the smallest product that achieves this outcome. Start with a short brief: users, success criteria, money and token flows, required networks, operator cash needs, and unresolved decisions. Preserve explicit constraints such as Base-only. Ask only questions that change the design; label unknowns instead of inventing defaults.

Start at https://github.com/mejango/juicebox-skills/blob/main/README.md and load only the skills the brief needs; for commerce or offchain revenue, start with revnet-commerce. If the Juicebox MCP (https://juicebox.center/mcp) is connected, list its capabilities and use its reads and transaction plans; otherwise use the documented source and SDK. Use current V6 sources, check deployments, and keep documented, implemented, and live behavior apart.

Treat the split as the operating model: contributors and customers hold the same token, backed by revenue in a shared balance sheet under its cash out rules. Explain how contributors turn tokens into money (selling, cashing out, borrowing) and what each costs, including liquidity, dilution, collateral, and the effect on backing. A split sets a share of new tokens, not a cash amount. Compare a Juicebox project if the business needs regular payouts to cover expenses.

Explain the stages, issuance cuts, split, auto issuance, accepted tokens, cash out tax, and the operator's remaining powers in plain words. Do not assume a staking adapter or a cross-chain bridge exists.

Propose the smallest end-to-end flow, identifying existing support, custom integration and blocking decisions. Map each chosen user action to V6 reads and transactions. For every write, identify contract, function, arguments, units, chain, permissions, approvals, slippage or minimum-output protection, and state to re-read immediately before signing. Use current V6 SDK builders where supported; encode then decode each request and review the exact transaction before requesting explicit authorization and a wallet signature.

Verify receipts and expected state after execution. Reconcile uncertain submissions before retrying. Keep a concise handoff with decisions, evidence and freshness, unresolved questions, transaction identifiers and the next safe step so another agent can continue without repeating discovery.`;

export function CopyRevnetBuildPrompt() {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  const copy = async () => {
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(REVNET_BUILD_PROMPT);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={copy}
        disabled={status === "copying"}
        className="min-h-11 border border-melon-700 bg-white px-4 py-2 text-left font-semibold text-melon-900 hover:bg-melon-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800"
      >
        {status === "copying" ? "Copying…" : "Copy the Revnet build prompt"}
      </button>
      <p role="status" aria-atomic="true" className="mt-2 text-sm leading-relaxed text-zinc-700">
        {status === "copied"
          ? "Prompt copied. Paste it into your assistant and describe your product."
          : status === "failed"
            ? "Copy was blocked by your browser. Select and copy the prompt below."
            : ""}
      </p>
      <details className="mt-2" open={status === "failed" ? true : undefined}>
        <summary className="min-h-11 cursor-pointer py-3 text-melon-900 underline underline-offset-4">
          Read or manually copy the prompt
        </summary>
        <label htmlFor="revnet-build-prompt" className="mb-2 block font-semibold text-zinc-900">
          Revnet build prompt
        </label>
        <textarea
          id="revnet-build-prompt"
          readOnly
          value={REVNET_BUILD_PROMPT}
          rows={10}
          spellCheck={false}
          className="block w-full border border-melon-700 bg-white p-3 text-sm leading-relaxed text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800"
        />
      </details>
    </div>
  );
}
