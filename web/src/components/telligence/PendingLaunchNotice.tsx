"use client";

import { Button } from "@/components/ui/button";
import {
  parsePendingLaunch,
  pendingLaunchKey,
  type PendingLaunch,
} from "@/lib/telligence/pending-launch";
import type { ComputeProjectDraft } from "@/lib/telligence/types";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

type Notice = {
  address: string;
  raw: string | null;
  intent: PendingLaunch | null;
  error: string | null;
};

function readNotice(address: string): Notice {
  try {
    const raw = localStorage.getItem(pendingLaunchKey(address));
    const intent = parsePendingLaunch(raw, address);
    return {
      address,
      raw,
      intent,
      error:
        raw !== null && !intent
          ? "A saved launch could not be read. Check its transaction in your wallet before launching again. The saved record has been kept."
          : null,
    };
  } catch {
    return {
      address,
      raw: null,
      intent: null,
      error:
        "Saved launch recovery is unavailable because browser storage could not be read. Check your wallet history before launching again.",
    };
  }
}

/** Restores only public draft data. Confirmation and registration remain in the launch flow. */
export function PendingLaunchNotice({
  onResume,
}: {
  onResume: (draft: ComputeProjectDraft) => void;
}) {
  const { address } = useAccount();
  const identity = address?.toLowerCase();
  const [stored, setStored] = useState<Notice | null>(null);
  // Do not render a previous wallet's notice while the new effect is pending.
  const notice = identity && stored?.address === identity ? stored : null;

  useEffect(() => {
    if (!identity) return;
    const refresh = () => setStored(readNotice(identity));
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (
        (event.storageArea === localStorage || event.storageArea === null) &&
        (event.key === null || event.key === pendingLaunchKey(identity))
      )
        refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [identity]);

  function resume() {
    if (!identity || !notice?.intent) return;
    const latest = readNotice(identity);
    if (!latest.intent) {
      setStored({
        ...latest,
        error:
          latest.error ??
          "The saved launch is no longer present. Check your projects before starting another launch.",
      });
      return;
    }
    if (latest.raw !== notice.raw) {
      setStored({
        ...latest,
        error:
          "The saved launch changed in another tab. Review the updated project before resuming.",
      });
      return;
    }
    onResume(latest.intent.draft);
  }

  if (!notice || (!notice.intent && !notice.error)) return null;
  return (
    <section
      aria-label="Saved project launch"
      className="mb-8 space-y-4 border border-melon-300 bg-melon-50 p-5 sm:p-6"
    >
      {notice.intent ? (
        <>
          <div className="space-y-2">
            <p className="compute-eyebrow">A launch to pick up</p>
            <h2 className="break-words text-lg tracking-[-0.03em]">{notice.intent.draft.name}</h2>
            <p className="text-xs leading-6 text-melon-800">
              A launch transaction is saved for this wallet. Resume to confirm it and finish
              registering your project.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="outline" onClick={resume}>
              Resume project registration
            </Button>
            <a
              className="compute-text-link inline-flex min-h-11 items-center text-xs"
              href={`https://basescan.org/tx/${notice.intent.hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Inspect the saved transaction
            </a>
          </div>
        </>
      ) : null}
      {notice.error ? (
        <p role="alert" className="text-xs leading-6 text-red-700">
          {notice.error}
        </p>
      ) : null}
    </section>
  );
}
