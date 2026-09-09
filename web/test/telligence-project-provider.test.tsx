import { ProjectProviders } from "@/app/[slug]/ProjectProviders";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

const props = {
  projectId: 42n,
  chainId: 8453 as const,
  project: { name: "Compute", logoUri: null },
  projects: [
    { chainId: 1, projectId: 99 },
    { chainId: 8453, projectId: 42 },
    { chainId: 8453, projectId: 0 },
    { chainId: 8453, projectId: Number.MAX_SAFE_INTEGER + 1 },
  ],
};

describe("Telligence project provider boundary", () => {
  it("sets an explicit Base scope and seeds only valid Base deployments", () => {
    const provider = ProjectProviders(props) as ReactElement<{
      allowedChainIds: readonly number[];
      initialSuckers: unknown;
    }>;
    expect(provider.props.allowedChainIds).toEqual([8453]);
    expect(provider.props.initialSuckers).toEqual([{ peerChainId: 8453, projectId: 42n }]);
  });

  it("rejects a mismatched route chain before mounting financial providers", () => {
    expect(() => ProjectProviders({ ...props, chainId: 1 })).toThrow("Telligence uses Base only.");
  });
});
