import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Address,
  type PublicClient,
} from "viem";

export type IsolatedRead = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};

export type IsolatedResult =
  { status: "success"; result: unknown } | { status: "failure"; error: unknown };

/**
 * Each read's result, kept apart from every other, for contracts someone else
 * controls (a token a project names). Multicall3's allowFailure isolates a
 * revert but not a callee that burns all its gas, which fails the whole batch.
 * So: one explicit multicall, which never joins viem's implicit batch, so a
 * hostile contract cannot fail another component's reads. When that whole
 * batch is lost and a fresh block number shows the node is up, each read runs
 * alone, unbatched, in turn, so only the bad one fails. A node that is down
 * rethrows the batch's error.
 */
export async function readEach(
  client: PublicClient,
  reads: readonly IsolatedRead[],
): Promise<IsolatedResult[]> {
  try {
    return (await client.multicall({
      contracts: reads as never,
      allowFailure: true,
    })) as IsolatedResult[];
  } catch (error) {
    await client.getBlockNumber({ cacheTime: 0 }).catch(() => {
      throw error;
    });
    const results: IsolatedResult[] = [];
    for (const read of reads) {
      try {
        const { data } = await client.call({
          to: read.address,
          data: encodeFunctionData({
            abi: read.abi,
            functionName: read.functionName,
            args: read.args,
          } as never),
          batch: false,
        });
        results.push({
          status: "success",
          result: decodeFunctionResult({
            abi: read.abi,
            functionName: read.functionName,
            data: data ?? "0x",
          } as never),
        });
      } catch (cause) {
        results.push({ status: "failure", error: cause });
      }
    }
    return results;
  }
}
