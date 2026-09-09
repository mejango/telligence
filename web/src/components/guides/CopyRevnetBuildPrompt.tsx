"use client";

import { useState } from "react";

const REVNET_BUILD_PROMPT = `My product: [describe the users, the value they exchange, and the experience I want].

Act as my protocol engineer and product architect. If you are running in Claude Code, first install the Juicebox V6 skills library (https://github.com/mejango/juicebox-skills — run /plugin marketplace add mejango/juicebox-skills, then /plugin install juicebox-v6@juicebox) and use the current skills index to find its revnet deployment, economics, loans, bridging, and transaction guidance for addresses, ABIs, economics, and transaction safety. Then read https://revnet.money/learn and https://revnet.money/build, and inspect the current Revnet V6 implementation at https://github.com/rev-net/revnet-core-v6 and the Juicebox V6 contracts at https://github.com/Bananapus/version-6. Do not substitute an older protocol version.

Design the smallest safe product architecture that uses a revnet as its open financial backend. Explain the economics committed at launch: stages and start times, issuance and issuance cuts, cash-out tax, reserved-token percentages, and auto-issuance. Separately explain accepted accounting tokens, chain topology, shop item transfer policy, and which settings and recipients the operator can still change.

Map each user action to exact V6 reads and transactions, including payments, token issuance, cash outs, loans, buyback routing, shops, and multichain settlement where relevant. For every write, identify the contract, function, arguments, units, chain, permissions, approvals, slippage or minimum-output protection, and state that must be re-read immediately before signing. Use current V6 SDK builders where available, verify them against the deployed contracts, and ABI round-trip pure transaction builders. Keep signing explicit and wallet-bound.`;

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
