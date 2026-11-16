import {
  clearExtensionSalt,
  discardUnreadableSalts,
  saltForExtension,
} from "@/lib/suckerExtensionSalt";
import { SAVED_ATTEMPT_UNREADABLE_LINE } from "@bananapus/nana-sdk-core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OPERATOR = "0x000000000000000000000000000000000000dEaD";

beforeEach(() => window.localStorage.clear());

describe("the sucker extension's saved salts", () => {
  it("keep one in-flight salt per attempt across retries", () => {
    const salt = saltForExtension(OPERATOR, 7n, 10);
    expect(saltForExtension(OPERATOR, 7n, 10)).toBe(salt);
    expect(saltForExtension(OPERATOR, 8n, 10)).not.toBe(salt);
  });

  it("are never overwritten or cleared when the store can't be read", () => {
    saltForExtension(OPERATOR, 7n, 10);
    const key = Object.keys(window.localStorage)[0]!;
    const before = window.localStorage.getItem(key)!;
    // Another attempt's salt the store can't be parsed with: a fresh salt would strand its peers.
    window.localStorage.setItem(key, `${before}garbage`);
    expect(() => saltForExtension(OPERATOR, 8n, 10)).toThrow(SAVED_ATTEMPT_UNREADABLE_LINE);
    clearExtensionSalt(OPERATOR, 7n, 10);
    expect(window.localStorage.getItem(key)).toBe(`${before}garbage`);

    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const written = vi.spyOn(Storage.prototype, "setItem");
    expect(() => saltForExtension(OPERATOR, 9n, 10)).toThrow(SAVED_ATTEMPT_UNREADABLE_LINE);
    expect(written).not.toHaveBeenCalled();
    read.mockRestore();
    written.mockRestore();
  });

  it("start fresh only after the user's warned continue over an unreadable store", () => {
    window.localStorage.setItem("revnet-sucker-extension-salt-v1", "garbage");
    expect(() => saltForExtension(OPERATOR, 7n, 10)).toThrow(SAVED_ATTEMPT_UNREADABLE_LINE);
    discardUnreadableSalts();
    const salt = saltForExtension(OPERATOR, 7n, 10);
    expect(salt).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(saltForExtension(OPERATOR, 7n, 10)).toBe(salt);
  });
});
