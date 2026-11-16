import { describe, expect, it } from "vitest";
import { APP_HOLD_LOGIC } from "../scripts/app-hold-logic.mjs";

const caught = (source: string) =>
  (APP_HOLD_LOGIC as [RegExp, string][]).filter(([pattern]) => pattern.test(source));

describe("the gate on app-local hold and recovery logic", () => {
  it.each([
    "export async function sendUnderHold() {}",
    "const view = createHeldWriteView(handle, { client });",
    "await takeHeldExit(hold, client, state);",
    'export const WENT_THROUGH = "Your earlier transaction went through.";',
    "function hidesShownExit(shown, next) {}",
    "const settledLine = (settled) => settled.result;",
    "export async function recoverFromHold() {}",
    "releaseLaunch(key, { salt });",
    "useWriteHoldWatch(hold, client, onState);",
    "await adoptIntoHold(hold, client, hash);",
    "throw new Error(JOURNAL_UNREADABLE_LINE);",
    'window.localStorage.getItem("nana-sdk:reviewed-write:v1:namespace:1");',
    '<button>{"I checked my wallet"}</button>',
    'message: "Confirming your transaction.",',
  ])("refuses %s", (source) => {
    expect(caught(source)).not.toEqual([]);
  });

  it("lets the SDK's own owners through", () => {
    expect(
      caught(
        'import { settledLine, HELD_EXIT_LABEL, createSavedAttemptRecovery } from "@bananapus/nana-sdk-core/review";\nthrow new Error(settledLine(view.settled));',
      ),
    ).toEqual([]);
  });
});
