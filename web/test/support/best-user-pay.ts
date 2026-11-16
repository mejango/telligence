type Prepared = {
  preview: { beneficiaryTokenCount: bigint; reservedTokenCount: bigint };
  minReturnedTokens: bigint;
};
type Candidate = { terminal: string; type: "multi" | "router" };

/**
 * The SDK's `prepareBestUserPay`, over a test's own `prepareUserPay` mock. A mocked SDK entry
 * cannot reach the call the real one makes inside the package. The order is the SDK's, where
 * it is tested: most tokens, larger minimum, larger total, direct terminal.
 */
export function bestUserPayOver(
  prepare: (...args: never[]) => Promise<unknown>,
  // The SDK entry is being mocked when this loads, so its error class is handed in.
  isQuoteFailure: (error: unknown) => boolean,
) {
  return async (client: unknown, { candidates, ...args }: { candidates: Candidate[] }) => {
    let failure: unknown;
    const routes = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const prepared = (await (prepare as (...a: unknown[]) => Promise<unknown>)(client, {
            ...args,
            terminal: candidate.terminal,
          })) as Prepared;
          return { ...candidate, ...prepared };
        } catch (error) {
          if (isQuoteFailure(error)) failure = error;
          return null;
        }
      }),
    );
    const key = (route: Candidate & Prepared) => [
      route.preview.beneficiaryTokenCount,
      route.minReturnedTokens,
      route.preview.beneficiaryTokenCount + route.preview.reservedTokenCount,
      route.type === "multi" ? 1n : 0n,
    ];
    let best: (Candidate & Prepared) | null = null;
    for (const route of routes) {
      if (!route) continue;
      if (!best) best = route;
      else {
        const ours = key(route);
        const theirs = key(best);
        const at = ours.findIndex((value, index) => value !== theirs[index]);
        if (at >= 0 && ours[at] > theirs[at]) best = route;
      }
    }
    if (!best && failure) throw failure;
    return best;
  };
}
