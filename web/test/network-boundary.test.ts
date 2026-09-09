import { describe, expect, it } from "vitest";

describe("deterministic unit-test network boundary", () => {
  it("fails closed for unstubbed HTTP and streaming transports", async () => {
    await expect(fetch("https://example.com/unexpected")).rejects.toThrow(
      /Unexpected network request/,
    );
    expect(() => new XMLHttpRequest()).toThrow(/Unexpected XMLHttpRequest connection/);
    expect(() => new WebSocket("wss://example.com/unexpected")).toThrow(
      /Unexpected WebSocket connection/,
    );
    expect(() => new EventSource("https://example.com/unexpected")).toThrow(
      /Unexpected EventSource connection/,
    );
  });
});
