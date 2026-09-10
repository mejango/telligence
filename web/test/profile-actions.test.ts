import { fetchProfile, fetchProfiles } from "@/lib/profile";
import { describe, expect, it, vi } from "vitest";

const address = "0x1111111111111111111111111111111111111111";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("profile server actions", () => {
  it("returns nothing for bogus or oversized address lists without any fetch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const oversized = Array.from({ length: 201 }, (_, i) => `0x${String(i).padStart(40, "0")}`);
    for (const input of [
      null,
      undefined,
      "0x1111111111111111111111111111111111111111",
      { length: 1 },
      [1],
      ["not-an-address"],
      ["0x1234"],
      oversized,
    ]) {
      expect(await fetchProfiles(input as string[])).toEqual({});
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("batches in fixed chunks, terminates and keys results by lowercase address", async () => {
    const fetch = vi.fn().mockResolvedValue(json([{ address, platform: "ens", identity: "a" }]));
    vi.stubGlobal("fetch", fetch);
    const addresses = Array.from({ length: 25 }, (_, i) => `0x${String(i).padStart(40, "a")}`);
    const profiles = await fetchProfiles([...addresses, `0x${address.slice(2).toUpperCase()}`]);
    // 26 unique addresses in chunks of 10 -> 3 requests, never more.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(profiles[address]).toMatchObject({ identity: "a" });
  });

  it("validates a single address before fetching a profile", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await fetchProfile("../admin")).toBeNull();
    expect(await fetchProfile("")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue(json([{ address, platform: "ens", identity: "a" }]));
    expect(await fetchProfile(`0x${address.slice(2).toUpperCase()}`)).toMatchObject({
      identity: "a",
    });
    expect(fetch).toHaveBeenCalledWith(
      `https://api.web3.bio/profile/${address}`,
      expect.anything(),
    );
  });
});
