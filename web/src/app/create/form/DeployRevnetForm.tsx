import { formatShortDateTime } from "@/lib/date";
import { useFormContext } from "@/lib/forms";
import type { JBChainId, RelayrPostBundleResponse } from "@/lib/nana/types";
import { revnetDraftFileName } from "@/lib/revnet-draft";
import Image from "next/image";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { GoToProjectButton } from "../buttons/GoToProjectButton";
import {
  clearBrowserDraft,
  readBrowserDraft,
  saveBrowserDraft,
  type BrowserDraft,
} from "../helpers/browserDraft";
import type { QuotedStageStart } from "../helpers/staleQuote";
import { useTestData } from "../helpers/useTestData";
import type { RevnetFormData } from "../types";
import { DeploySection } from "./DeploySection";
import { Divider } from "./Divider";
import { OperatorSection } from "./OperatorSection";
import { ProjectDetails } from "./ProjectDetails";
import { QuoteResponse } from "./QuoteResponse";
import { SettlementSection } from "./SettlementSection";
import { Stages } from "./Stages";
import { StoreSection } from "./StoreSection";

export type DirectDeployment = { chainId: JBChainId; hash: string };

export function DeployRevnetForm({
  relayrResponse,
  resetRelayrResponse,
  preferredPaymentChainId,
  directDeployment,
  quotedStageStart,
  rebuildStaleQuote,
}: {
  relayrResponse?: RelayrPostBundleResponse;
  resetRelayrResponse: () => void;
  /** The chain the wallet was on when the launch started, before signing switched it. */
  preferredPaymentChainId?: number;
  /** The submitted transaction when a single-chain deploy went straight to the wallet. */
  directDeployment?: DirectDeployment | null;
  /** The stage 1 start time encoded in the current quote. */
  quotedStageStart?: QuotedStageStart;
  /** Rebuilds the deploy request and quote with a fresh shared timestamp. */
  rebuildStaleQuote?: (stale: RelayrPostBundleResponse) => Promise<RelayrPostBundleResponse>;
}) {
  // Sections hold answers derived from the values they open with, so replacing the whole form
  // reopens them rather than leaving them to catch up.
  const [loadedForm, setLoadedForm] = useState(0);
  const reopenSections = useCallback(() => setLoadedForm((count) => count + 1), []);

  // Type `testdata` into the console to fill the form (development builds only).
  useTestData(reopenSections);

  const validBundle = !!relayrResponse?.bundle_uuid;
  const disabled = validBundle;

  return (
    <div className="mx-auto my-20 max-w-6xl gap-x-6 gap-y-6 px-4 sm:px-8 md:grid md:grid-cols-3 xl:gap-y-0 xl:px-0">
      {/* <div className="col-span-full flex justify-center mb-6">
        <div className="bg-red-100 px-4 py-2.5 rounded-xl max-w-screen-md text-red-950 text-sm">
          <strong className="font-semibold">Important</strong>
          <span className="font-normal"> &bull; </span> Revnet creation is temporarily paused and
          will resume soon.
        </div>
      </div> */}
      <Image
        src="/assets/img/create-cutout.webp"
        width={1120}
        height={747}
        sizes="(min-width: 640px) 560px, calc(100vw - 2rem)"
        className="mx-auto mb-10 h-auto w-full max-w-[560px] md:col-span-3"
        alt="A figure holding a lightning bolt above the clouds"
      />
      <div className="mb-16 flex flex-col items-start gap-3 md:col-span-3">
        <h1 className="text-2xl font-semibold">Create a revnet</h1>
        <DraftControls
          disabled={disabled}
          launchSubmitted={!!directDeployment}
          onLoaded={reopenSections}
        />
      </div>
      <Fragment key={loadedForm}>
        {/* "Look" carries no chain-dependent field, so it leads. Settlement
          (chains + reserve asset) comes next: every chain-dependent input
          below specializes per selected chain at the point of input. */}
        <ProjectDetails disabled={disabled} />
        <Divider />
        <SettlementSection disabled={disabled} />
        <Divider />
        <Stages disabled={disabled} />
        <Divider />
        <StoreSection disabled={disabled} />
        <Divider />
        <OperatorSection disabled={disabled} />
        <Divider />
        <DeploySection validBundle={validBundle} disabled={disabled} />
      </Fragment>
      {relayrResponse && (
        <QuoteResponse
          relayrResponse={relayrResponse}
          reset={resetRelayrResponse}
          preferredPaymentChainId={preferredPaymentChainId}
          quotedStageStart={quotedStageStart}
          rebuildStaleQuote={rebuildStaleQuote}
        />
      )}
      {directDeployment && (
        <div className="flex flex-col items-start md:col-span-2 md:col-start-2">
          <p className="mt-4 text-sm text-zinc-600">
            Launch submitted. You can open your revnet once the chain confirms the transaction.
          </p>
          <GoToProjectButton txHash={directDeployment.hash} chainId={directDeployment.chainId} />
        </div>
      )}
    </div>
  );
}

const draftButtonClassName =
  "rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50";
/** The quiet pills that move a draft in and out of a file. */
const draftPillClassName =
  "inline-flex min-h-[28px] items-center gap-1 border border-zinc-300 px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50";

function DraftControls({
  disabled,
  launchSubmitted,
  onLoaded,
}: {
  disabled: boolean;
  launchSubmitted: boolean;
  onLoaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { values, setValues } = useFormContext<RevnetFormData>();
  const [status, setStatus] = useState("");
  // Read after mount, since the server has no browser storage. Nothing reaches the form until the
  // reader restores it, and an unanswered offer is not overwritten.
  const [storageRead, setStorageRead] = useState(false);
  const [offer, setOffer] = useState<BrowserDraft>();

  useEffect(() => {
    setOffer(readBrowserDraft());
    setStorageRead(true);
  }, []);

  useEffect(() => {
    if (launchSubmitted) clearBrowserDraft();
    else if (storageRead && !offer && !disabled) saveBrowserDraft(values);
  }, [disabled, launchSubmitted, offer, storageRead, values]);

  const load = (next: RevnetFormData, loaded: string, mediaMissing = false) => {
    setValues(next);
    onLoaded();
    setOffer(undefined);
    setStatus(
      [
        loaded,
        next.stages[0]?.futureStartTimestamp === null
          ? "The saved start time has passed, so choose a new one."
          : "",
        mediaMissing ? "Add item media again." : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  return (
    <div className="flex w-full flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        accept=".jb,application/json"
        aria-label="Import deployment draft"
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            // The file mapper loads only when a file is used.
            const { readJbDraftFile } = await import("@/lib/jb-draft");
            load(
              readJbDraftFile(await file.text()),
              "Draft imported. Review every section before launch.",
            );
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Could not import that draft.");
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={draftPillClassName}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <span aria-hidden>↑</span> Import .jb
        </button>
        <button
          type="button"
          className={draftPillClassName}
          disabled={disabled}
          onClick={async () => {
            // The shared file every Juicebox site reads.
            let text: string;
            try {
              text = (await import("@/lib/jb-draft")).writeJbDraftFile(values);
            } catch (error) {
              setStatus(error instanceof Error ? error.message : "Export failed.");
              return;
            }
            const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = revnetDraftFileName(values.name);
            anchor.click();
            URL.revokeObjectURL(url);
          }}
        >
          <span aria-hidden>↓</span> Export
        </button>
        <span className="text-xs text-zinc-500">Your draft saves as you go.</span>
      </div>
      {offer && !disabled ? (
        <div className="mt-2 flex flex-col items-start gap-2">
          <p className="max-w-sm text-xs text-zinc-600">
            Draft saved in this browser
            {offer.savedAt ? ` on ${formatShortDateTime(offer.savedAt)}` : ""}.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={draftButtonClassName}
              onClick={() => {
                // Read again: a start can pass while this offer sits open.
                const draft = readBrowserDraft() ?? offer;
                load(
                  draft.values,
                  "Draft restored. Review every section before launch.",
                  draft.mediaMissing,
                );
              }}
            >
              Restore draft
            </button>
            <button
              type="button"
              className={draftButtonClassName}
              onClick={() => {
                clearBrowserDraft();
                setOffer(undefined);
              }}
            >
              Discard draft
            </button>
          </div>
        </div>
      ) : null}
      {status ? <p className="max-w-sm text-xs text-zinc-600">{status}</p> : null}
    </div>
  );
}
