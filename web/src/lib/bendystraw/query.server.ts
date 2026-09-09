import "server-only";

import { getBendystrawUrl } from "@/graphql/constants";
import {
  BendystrawRequestError as BendystrawError,
  normalizeBendystrawEndpoint,
  requestBendystraw,
} from "@bananapus/nana-sdk-core";
import { compileBendystrawOperation } from "./operationContract";
import type { BendystrawOperation } from "./operations";
import { getRegisteredQuery } from "./registry.server";

function configuredGraphqlUrl(chainId: number): string {
  const configured = getBendystrawUrl(chainId);
  if (!configured || configured === "undefined") {
    throw new BendystrawError("Bendystraw is not configured", 503);
  }

  try {
    return normalizeBendystrawEndpoint(configured);
  } catch {
    throw new BendystrawError("Bendystraw is not configured", 503);
  }
}

export async function queryBendystraw<TResult, TVariables extends Record<string, unknown>>(
  chainId: number,
  operation: BendystrawOperation<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  const registered = getRegisteredQuery(operation.id);
  if (!registered) {
    throw new BendystrawError("Unknown Bendystraw operation", 400);
  }
  const documentContract = compileBendystrawOperation(registered.query);

  return requestBendystraw<TResult, TVariables>(
    configuredGraphqlUrl(chainId),
    registered.query,
    variables,
    {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      operationName: documentContract.operationName ?? registered.operationName,
      validateData: (value) =>
        documentContract.validateData(value) && operation.validateData(value),
      validateVariables: (value) =>
        documentContract.validateVariables(value) && operation.validateVariables(value),
    },
  );
}
