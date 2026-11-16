import { rolloutContractName } from "@/lib/protocol-rollout";
import { routerGatewayAbi } from "@/lib/router-gateway-abi";
import {
  jbBuybackHookAbi,
  jbBuybackHookRegistryAbi,
  jbRouterTerminalAbi,
  jbRouterTerminalRegistryAbi,
} from "@bananapus/nana-sdk-core";
import { decodeFunctionData, encodeFunctionData, type Abi, type Address, type Hex } from "viem";

/** Name only canonical protocol destinations, preserving previous generations in the queue. */
export function decodeProtocolQueueCall(
  chainId: number,
  tx: { to: Address; data: Hex | null; operation: number },
) {
  if (Number(tx.operation) !== 0 || !tx.data) return null;
  const contract = rolloutContractName(chainId, tx.to);
  if (!contract) return null;
  const abis: Record<string, Abi> = {
    JBBuybackHook: jbBuybackHookAbi,
    JBBuybackHookRegistry: jbBuybackHookRegistryAbi,
    JBRouterTerminalRegistry: jbRouterTerminalRegistryAbi,
    JBRouterTerminal: jbRouterTerminalAbi,
    JBRouterTerminalGateway: routerGatewayAbi,
  };
  const abi = abis[contract.split(" ")[0]!];
  if (!abi) return null;
  try {
    const decoded = decodeFunctionData({ abi, data: tx.data });
    // Never summarize malformed trailing bytes as a valid protocol call.
    if (encodeFunctionData({ abi, ...decoded }).toLowerCase() !== tx.data.toLowerCase())
      return null;
    const target = decoded.args?.[1];
    const selection =
      (decoded.functionName === "setHookFor" || decoded.functionName === "setTerminalFor") &&
      typeof target === "string"
        ? ` → ${rolloutContractName(chainId, target as Address) ?? target}`
        : "";
    return {
      abi,
      functionName: decoded.functionName,
      args: decoded.args,
      contractName: contract,
      label: `${contract}.${decoded.functionName}${selection}`,
    };
  } catch {
    return null;
  }
}

export function protocolQueueLabel(
  chainId: number,
  tx: { to: Address; data: Hex | null; operation: number },
): string | null {
  return decodeProtocolQueueCall(chainId, tx)?.label ?? null;
}
