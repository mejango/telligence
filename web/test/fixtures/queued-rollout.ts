import { rolloutTargets } from "@/lib/protocol-rollout";
import { buildStep } from "@/lib/safe-batch";

export function queuedRolloutSteps(chainId = 8453) {
  const targets = rolloutTargets(chainId)!;
  return [
    buildStep({ kind: "setHookFor", chainId, projectId: 2, values: { hook: targets.hook } }),
    buildStep({
      kind: "setPoolFor",
      chainId,
      projectId: 2,
      values: {
        fee: 3000n,
        tickSpacing: 60n,
        twapWindow: 1800n,
        terminalToken: "0x0000000000000000000000000000000000000000",
      },
    }),
    buildStep({
      kind: "setTerminalFor",
      chainId,
      projectId: 2,
      values: { terminal: targets.terminal },
    }),
  ];
}
