import { ProjectLink } from "@/components/ProjectLink";
import { Button } from "@/components/ui/button";
import { FastForward } from "@/components/ui/icons";
import { useFormContext } from "@/lib/forms";
import type { JBChainId } from "@/lib/nana/types";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { useTransactionReceipt } from "wagmi";
import { projectIdFromDeployLogs } from "../helpers/projectIdFromReceipt";
import type { RevnetFormData } from "../types";

export function GoToProjectButton({ txHash, chainId }: { txHash?: string; chainId: JBChainId }) {
  const [isLoading, setIsLoading] = useState(false);
  const { values } = useFormContext<RevnetFormData>();

  const { data } = useTransactionReceipt({
    chainId,
    hash: txHash as `0x${string}`,
  });

  const projectId = data ? projectIdFromDeployLogs(data.logs, chainId) : undefined;
  const chain = JB_CHAINS[chainId].slug;
  const projectUrl = `/${chain}:${projectId}`;
  return (
    <div className="max-w-fit">
      <ProjectLink
        href={projectUrl}
        projectHint={{
          name: values.name || `Project #${projectId ?? ""}`,
          logoUri: values.logoUri ?? null,
          ticker: values.tokenSymbol,
        }}
        className={!projectId ? "pointer-events-none" : ""}
      >
        <Button
          type="submit"
          size="lg"
          disabled={!projectId}
          loading={isLoading}
          className="transition-all duration-200 mt-2"
          onClick={() => setIsLoading(true)}
        >
          Go to your revnet
          <FastForward className={"h-4 w-4 fill-white ml-2 animate-pulse"} />
        </Button>
      </ProjectLink>
    </div>
  );
}
