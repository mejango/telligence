/** Run independent checks together; RPC transport paces egress. Drain before retrying. */
export async function mapConcurrentChecks<T, R>(
  values: readonly T[],
  check: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = await Promise.allSettled(values.map(async (value, index) => check(value, index)));
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}
