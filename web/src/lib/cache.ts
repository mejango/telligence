"use server";

import { revalidateTag } from "next/cache";

// A public Server Action: the only work it can do is refresh the bridge feed on a
// fixed schedule. Callers choose neither the tag nor how long the server sleeps.
const ALLOWED_TAG = "suckerTransactions";
const SETTLE_MS = 8000;
const PROPAGATE_MS = 3000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function revalidateCacheTag(tag: string) {
  if (tag !== ALLOWED_TAG) return false;
  await sleep(SETTLE_MS);
  revalidateTag(ALLOWED_TAG, "max");
  await sleep(PROPAGATE_MS);
  return true;
}
