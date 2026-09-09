"use client";
import { Button } from "@/components/ui/button";
import { formatClockWithSeconds } from "@/lib/date";
import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import { PayAndDeploy } from "../buttons/PayAndDeploy";
import type { QuotedStageStart } from "../helpers/staleQuote";
import { useCreateForm } from "./useCreateForm";

interface Props {
  relayrResponse: RelayrPostBundleResponse;
  reset: () => void;
  quotedStageStart?: QuotedStageStart;
  rebuildStaleQuote?: () => Promise<RelayrPostBundleResponse>;
}

export function QuoteResponse(props: Props) {
  const { relayrResponse, reset, quotedStageStart, rebuildStaleQuote } = props;
  const { revnetTokenSymbol, isSubmitting } = useCreateForm();

  return (
    <div className="flex flex-col items-start md:col-span-2 md:col-start-2">
      <div className="mt-2 text-xs italic">
        Quote valid until {formatClockWithSeconds(relayrResponse.payment_info[0].payment_deadline)}.
        <Button
          variant="link"
          size="sm"
          className="px-1 text-xs italic"
          disabled={isSubmitting}
          onClick={() => reset()}
        >
          clear quote
        </Button>
      </div>
      <div className="mt-4">
        <PayAndDeploy
          relayrResponse={relayrResponse}
          revnetTokenSymbol={revnetTokenSymbol}
          quotedStageStart={quotedStageStart}
          rebuildStaleQuote={rebuildStaleQuote}
        />
      </div>
    </div>
  );
}
