import { useFormContext } from "@/lib/forms";
import type { JBChainId, RelayrPostBundleResponse } from "@/lib/nana/types";
import { parseRevnetDraft } from "@/lib/revnet-draft";
import Image from "next/image";
import { useRef, useState } from "react";
import { GoToProjectButton } from "../buttons/GoToProjectButton";
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
  directDeployment,
  quotedStageStart,
  rebuildStaleQuote,
}: {
  relayrResponse?: RelayrPostBundleResponse;
  resetRelayrResponse: () => void;
  /** The submitted transaction when a single-chain deploy went straight to the wallet. */
  directDeployment?: DirectDeployment | null;
  /** The stage 1 start time encoded in the current quote. */
  quotedStageStart?: QuotedStageStart;
  /** Rebuilds the deploy request and quote with a fresh shared timestamp. */
  rebuildStaleQuote?: () => Promise<RelayrPostBundleResponse>;
}) {
  // Type `testdata` into the console to fill the form (development builds only).
  useTestData();

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
      <div className="mb-16 flex flex-wrap items-center justify-between gap-3 md:col-span-3">
        <h1 className="text-2xl font-semibold">Create a revnet</h1>
        <DraftImport disabled={disabled} />
      </div>
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
      {relayrResponse && (
        <QuoteResponse
          relayrResponse={relayrResponse}
          reset={resetRelayrResponse}
          quotedStageStart={quotedStageStart}
          rebuildStaleQuote={rebuildStaleQuote}
        />
      )}
      {directDeployment && (
        <div className="flex flex-col items-start md:col-span-2 md:col-start-2">
          <p className="mt-4 text-sm text-zinc-600">
            Deployment submitted. The button unlocks once the transaction is confirmed onchain.
          </p>
          <GoToProjectButton txHash={directDeployment.hash} chainId={directDeployment.chainId} />
        </div>
      )}
    </div>
  );
}

function DraftImport({ disabled }: { disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { setValues } = useFormContext<RevnetFormData>();
  const [status, setStatus] = useState("");

  return (
    <div className="flex flex-col items-end gap-1">
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
            setValues(parseRevnetDraft(await file.text()));
            setStatus("Draft imported. Review every section before deploying.");
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Could not import that draft.");
          }
        }}
      />
      <button
        type="button"
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Import .jb
      </button>
      {status ? <p className="max-w-sm text-right text-xs text-zinc-600">{status}</p> : null}
    </div>
  );
}
