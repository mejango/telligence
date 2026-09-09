"use client";

import { jbCenterIpfs } from "@/lib/jbcenter-ipfs";
import { useEffect, useState } from "react";

export default function IpfsProofPage() {
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState("idle");

  useEffect(() => setReady(true), []);

  return (
    <main data-ipfs-proof-ready={ready ? "true" : "false"}>
      <button
        type="button"
        onClick={async () => {
          try {
            const pin = await jbCenterIpfs.pinJson({ name: "Revnet browser proof" });
            setResult(pin.uri);
          } catch (error) {
            setResult(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        Save metadata
      </button>
      <output data-testid="pin-result">{result}</output>
    </main>
  );
}
