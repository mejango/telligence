"use client";

import { OPEN_IPFS_GATEWAY_HOSTNAME } from "@/lib/ipfs";
import { ProjectProvider } from "@/lib/nana/project";
import type { InitialProjectData, SuckerPair } from "@/lib/nana/types";
import { COMPUTE_CHAIN_ID } from "@/lib/telligence/transactions";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { PropsWithChildren } from "react";

const COMPUTE_CHAIN_IDS = [COMPUTE_CHAIN_ID] as const;

export function ProjectProviders(
  props: PropsWithChildren<{
    projectId: bigint;
    chainId: JBChainId;
    project: {
      name: string | null;
      logoUri: string | null;
    };
    projects: readonly {
      chainId: number;
      projectId: number;
    }[];
  }>,
) {
  if (props.chainId !== COMPUTE_CHAIN_ID) throw new Error("Telligence uses Base only.");
  const initialProject: InitialProjectData = {
    metadata: {
      name: props.project.name ?? "",
      ...(props.project.logoUri ? { logoUri: props.project.logoUri } : {}),
    },
  };
  const initialSuckers = props.projects
    .filter(
      (project): project is { chainId: JBChainId; projectId: number } =>
        project.chainId === COMPUTE_CHAIN_ID &&
        Number.isSafeInteger(project.projectId) &&
        project.projectId > 0,
    )
    .map((project): SuckerPair => ({
      peerChainId: project.chainId,
      projectId: BigInt(project.projectId),
    }));

  return (
    <ProjectProvider
      projectId={props.projectId}
      chainId={props.chainId}
      initialProject={initialProject}
      initialSuckers={initialSuckers}
      allowedChainIds={COMPUTE_CHAIN_IDS}
      ipfsGatewayHostname={OPEN_IPFS_GATEWAY_HOSTNAME}
    >
      {props.children}
    </ProjectProvider>
  );
}
