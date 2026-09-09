import {
  BENDYSTRAW_TIMEOUT_MS,
  BendystrawRequestError as BendystrawError,
  assertBendystrawData,
  assertBendystrawVariables,
  resolveBendystrawNetwork,
} from "@bananapus/nana-sdk-core";
import type { BendystrawOperation } from "./operations";

export function bendystrawNetworkFor(
  variables: Record<string, unknown>,
  chainId?: number,
): "mainnet" | "testnet" {
  return resolveBendystrawNetwork({ chainId, variables });
}

export async function queryBendystrawFromBrowser<
  TResult,
  TVariables extends Record<string, unknown>,
>(
  operation: BendystrawOperation<TResult, TVariables>,
  variables: TVariables,
  chainId?: number,
): Promise<TResult> {
  assertBendystrawVariables(variables, operation.validateVariables, operation.id);

  const network = bendystrawNetworkFor(variables, chainId);
  const response = await fetch(`/api/bendystraw/${network}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: operation.id, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(BENDYSTRAW_TIMEOUT_MS),
  });

  let envelope: { data?: unknown; error?: unknown };
  try {
    envelope = (await response.json()) as { data?: unknown; error?: unknown };
  } catch {
    throw new BendystrawError("Bendystraw proxy returned invalid JSON", 502);
  }
  if (!response.ok) {
    throw new BendystrawError(
      typeof envelope.error === "string" ? envelope.error : "Bendystraw request failed",
      response.status,
    );
  }
  return assertBendystrawData(envelope.data, operation.validateData, operation.id);
}
