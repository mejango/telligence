import { isMutableHandlePath } from "@/components/MutableHandleNavigationGuard";
import { describe, expect, it } from "vitest";

describe("mutable handle history navigation", () => {
  it("recognizes literal and once-encoded aliases only", () => {
    expect(isMutableHandlePath("/@design.juicebox/operator")).toBe(true);
    expect(isMutableHandlePath("/%40design.juicebox/owners")).toBe(true);
    expect(isMutableHandlePath("/%2540design.juicebox/operator")).toBe(false);
    expect(isMutableHandlePath("/base:42/operator")).toBe(false);
  });
});
