import { proxy } from "@/proxy";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

describe("legacy project proxy", () => {
  it("permanently redirects legacy v6 routes and preserves suffixes and queries", () => {
    const response = proxy(new NextRequest("https://revnet.money/v6:base:3/shop?category=1"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://revnet.money/base:3/shop?category=1");
  });

  it("rejects double-encoded handle spellings at the raw request boundary", () => {
    const response = proxy(new NextRequest("https://revnet.money/%2540design.juicebox/operator"));
    expect(response.status).toBe(404);
  });

  it("does not redirect canonical or malformed paths", () => {
    const canonical = proxy(new NextRequest("https://revnet.money/base:3"));
    const zeroProject = proxy(new NextRequest("https://revnet.money/v6:base:0"));

    expect(canonical.headers.get("x-middleware-next")).toBe("1");
    expect(zeroProject.headers.get("x-middleware-next")).toBe("1");
  });
});
