/**
 * A refusal a site raises from its own checks (`reverify`, `assertWriteState`, `beforeWallet`):
 * its line is shown as it is. Core shows its own lines and hides any other error's text, so a
 * site's line says what happened and what to do next.
 */
export class ReviewRefusal extends Error {
  readonly name = "ReviewRefusal";
}

/**
 * The person closed the write's review: nothing was sent, and its progress closes with it. Matched
 * by name so pages that only need this test do not load core's review module.
 */
export function reviewClosed(cause: unknown): boolean {
  return (cause as { name?: string } | null)?.name === "TransactionReviewCancelledError";
}
