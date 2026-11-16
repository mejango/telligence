"use client";

import { SummaryRow, TxProgress } from "@/components/ui/TxProgress";
import { useState } from "react";

/** A standalone progress taller than a phone screen, its error offering Try again, for the browser layout check. */
export default function ConfirmProofPage() {
  const [pressed, setPressed] = useState("");

  return (
    <div data-confirm-proof-pressed={pressed}>
      <TxProgress
        open
        onClose={() => setPressed("cancel")}
        title="Confirm a long plan"
        steps={[{ title: "Send the plan" }]}
        activeIndex={-1}
        error="The plan was not sent. Try again."
        start={() => setPressed("send")}
      >
        {Array.from({ length: 40 }, (_, index) => (
          <SummaryRow key={index} label={`Row ${index + 1}`}>
            Value {index + 1}
          </SummaryRow>
        ))}
      </TxProgress>
    </div>
  );
}
