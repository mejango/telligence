import {
  HELD_AWAY_SUCCESS_LINE,
  HELD_SEND_AGAIN_LABEL,
  HELD_SUCCESS_LINE,
  WRITE_HOLD_STALE_REVIEW_LINE,
  WriteHeldError,
  WriteHoldStaleReviewError,
} from "@bananapus/nana-sdk-core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  handle: {
    peek: vi.fn(),
    state: vi.fn(),
    exit: vi.fn(),
    unacknowledgedSuccess: vi.fn(),
    acknowledge: vi.fn(),
  },
}));

vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>()),
  // The SDK's hold is tested in the SDK; here, only how the app's flow dialogs use it.
  createWriteHold: () => ({ open: () => sdk.handle, reviewLine: () => null }),
}));

const HASH = `0x${"12".repeat(32)}` as const;
const INPUT = {
  chainId: 1,
  account: "0x0000000000000000000000000000000000000001",
  call: { to: "0x0000000000000000000000000000000000000002", data: "0x", value: 0n },
} as const;
const EXIT = {
  status: "held-no-hash",
  exit: true,
  line: "Your earlier transaction hasn't confirmed yet. Check your wallet.",
  record: { call: { to: "0x1", data: "0x", value: "0" } },
} as never;

async function load(sends: (() => unknown)[]) {
  vi.resetModules();
  const [holds, choice] = await Promise.all([
    import("@/lib/write-hold"),
    import("@/lib/flow-choice"),
  ]);
  const prompt = vi.fn().mockResolvedValue(false);
  choice.registerFlowChoiceHandler(prompt);
  // The SDK's held send (useHeldSend): each call does what's next, then sends.
  const send = vi.fn(async (..._args: unknown[]) => {
    sends.shift()?.();
    return HASH;
  });
  const run = vi.fn();
  return {
    prompt,
    send,
    // A held send answered the way every reviewed write answers its refusals.
    sendHeld: async () => {
      for (;;) {
        try {
          return await send(INPUT as never, run as never);
        } catch (error) {
          await holds.answerHeldRefusal(error, holds.holdOf(INPUT as never), {} as never);
        }
      }
    },
  };
}

beforeEach(() => {
  for (const fn of Object.values(sdk.handle)) fn.mockReset();
  sdk.handle.peek.mockReturnValue({ status: "clear" });
});

describe("answerHeldRefusal: the flow's dialogs over the SDK's held send", () => {
  it("sends straight through a clear hold", async () => {
    const { sendHeld, send, prompt } = await load([]);
    await expect(sendHeld()).resolves.toBe(HASH);
    expect(send).toHaveBeenCalledOnce();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("ends with the hold's line, never prompting, when it offers no exit", async () => {
    const pending = { ...(EXIT as object), exit: false, line: "Still pending." };
    const { sendHeld, prompt } = await load([
      () => {
        throw new WriteHeldError(pending as never);
      },
    ]);
    await expect(sendHeld()).rejects.toThrow("Still pending.");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("releases on the user's exit and reopens the review once", async () => {
    const { sendHeld, send, prompt } = await load([
      () => {
        throw new WriteHeldError(EXIT);
      },
    ]);
    prompt.mockResolvedValue(true);
    sdk.handle.exit.mockResolvedValue({ released: true, state: { status: "clear" } });
    await expect(sendHeld()).resolves.toBe(HASH);
    expect(sdk.handle.exit).toHaveBeenCalledWith(EXIT, { checkedWallet: true }, {});
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps the hold when the user declines, and never resends what settled meanwhile", async () => {
    const declined = await load([
      () => {
        throw new WriteHeldError(EXIT);
      },
    ]);
    await expect(declined.sendHeld()).rejects.toThrow(/hasn't confirmed yet/);
    expect(sdk.handle.exit).not.toHaveBeenCalled();

    const settled = await load([
      () => {
        throw new WriteHeldError(EXIT);
      },
    ]);
    settled.prompt.mockResolvedValue(true);
    sdk.handle.exit.mockResolvedValue({
      released: false,
      state: { status: "clear", settled: { result: "success", hash: HASH } },
    });
    await expect(settled.sendHeld()).rejects.toThrow(HELD_SUCCESS_LINE);
    expect(settled.send).toHaveBeenCalledOnce();
  });

  it("asks before sending again what went through while the user was away", async () => {
    const away = () => {
      throw new Error(HELD_AWAY_SUCCESS_LINE);
    };
    const success = { result: "success", hash: HASH };
    sdk.handle.unacknowledgedSuccess.mockReturnValue(success);
    const declined = await load([away]);
    await expect(declined.sendHeld()).rejects.toThrow(HELD_AWAY_SUCCESS_LINE);
    expect(declined.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: HELD_SEND_AGAIN_LABEL }),
    );
    expect(sdk.handle.acknowledge).not.toHaveBeenCalled();

    const accepted = await load([away]);
    accepted.prompt.mockResolvedValue(true);
    await expect(accepted.sendHeld()).resolves.toBe(HASH);
    expect(sdk.handle.acknowledge).toHaveBeenCalledWith(success);
    expect(accepted.send).toHaveBeenCalledTimes(2);
  });

  it("asks for a fresh review when another window sent it, saying how that ended", async () => {
    const stale = await load([
      () => {
        throw new WriteHoldStaleReviewError();
      },
    ]);
    await expect(stale.sendHeld()).rejects.toThrow(WRITE_HOLD_STALE_REVIEW_LINE);
    const settled = await load([
      () => {
        throw new WriteHoldStaleReviewError({ result: "success", hash: HASH });
      },
    ]);
    await expect(settled.sendHeld()).rejects.toThrow(HELD_SUCCESS_LINE);
  });
});
