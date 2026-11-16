import {
  TransactionReviewCancelledError,
  type ReviewModel,
  type TransactionReviewRequest,
} from "@bananapus/nana-sdk-core/review";
import { promptReviewForTests } from "@bananapus/nana-sdk-core/testing";

type Core = Pick<typeof import("@bananapus/nana-sdk-core/review"), "registerReviewHandler">;

/**
 * Answers core's review prompts as a person would: `answer` sees the model shown and confirms it
 * (core's own confirmation goes back) or closes it. Returns the unregister.
 */
export function answerReviews(
  answer: (model: ReviewModel) => boolean | Promise<boolean>,
  core?: Core,
): () => void {
  const register = (core ?? requireCore()).registerReviewHandler;
  const stop = register(async (prompt) =>
    (await answer(prompt.model)) ? prompt.confirmation : null,
  );
  answering.add(stop);
  return () => {
    answering.delete(stop);
    stop();
  };
}

// Core is an external module that vi.resetModules keeps: its handlers outlive a test.
const answering = new Set<() => void>();

/** Unregister every answer still registered, so a test without one sees no review handler. */
export function stopAnswering(): void {
  for (const stop of answering) stop();
  answering.clear();
}

let loaded: Core | undefined;
function requireCore(): Core {
  if (!loaded) throw new Error("Load core with loadCoreReview() first.");
  return loaded;
}

/** The core review module the code under test uses (after any vi.resetModules). */
export async function loadCoreReview(): Promise<Core> {
  loaded = await import("@bananapus/nana-sdk-core/review");
  return loaded;
}

/**
 * Opens `request` in the page's registered review dialog exactly as a send does; resolves on
 * confirm and rejects with core's cancellation on close.
 */
export async function requireReview(
  request: TransactionReviewRequest,
  options?: Parameters<typeof promptReviewForTests>[1],
): Promise<void> {
  const { outcome } = promptReviewForTests(request, options);
  if ((await outcome) === "cancelled") throw new TransactionReviewCancelledError();
}
