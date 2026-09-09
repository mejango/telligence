import { formatWalletError } from "@/lib/utils";
import { describe, expect, test } from "vitest";

describe("formatWalletError", () => {
  test("prefers a wallet short message and makes rejection copy user-facing", () => {
    expect(
      formatWalletError({
        shortMessage: "User rejected the request",
        message: "fallback",
      }),
    ).toBe("You rejected the request");
  });

  test("falls back through message, string, and default cases", () => {
    expect(formatWalletError(new Error("insufficient funds"))).toBe("insufficient funds");
    expect(formatWalletError("wallet unavailable")).toBe("wallet unavailable");
    expect(formatWalletError(null, "Try again later")).toBe("Try again later");
    expect(formatWalletError({ message: 123 }, "Try again later")).toBe("Try again later");
  });
});
