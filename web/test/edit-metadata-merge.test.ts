import {
  applyMetadataEdits,
  customPropertyCollisions,
  formatCustomProperties,
  mergeProjectMetadata,
  otherMetadataKeys,
  parseCustomProperties,
} from "@/app/[slug]/about/components/metadataMerge";
import { describe, expect, it } from "vitest";

const baseValues = {
  name: "Revnet",
  description: "A revnet.",
  logoUri: "",
  twitter: "",
  telegram: "",
  discord: "",
  infoUri: "",
  farcaster: "",
  payDisclosure: "",
};

describe("applyMetadataEdits", () => {
  it("applies a name edit while retaining every unedited destination field", () => {
    const baseline = {
      ...baseValues,
      logoUri: "ipfs://source",
      twitter: "source",
      farcaster: "source-fid",
      leagueID: "source-league",
      tags: ["source"],
      version: 1,
    };
    const current = {
      ...baseline,
      name: "Peer",
      description: "Peer description",
      logoUri: "ipfs://peer",
      twitter: "peer",
      farcaster: "peer-fid",
      telegram: "peer-only",
      leagueID: "peer-league",
      tags: ["peer"],
      peerOnly: { keep: true },
      version: 2,
    };

    expect(
      applyMetadataEdits(
        current,
        baseline,
        { ...baseline, name: "Edited" },
        {
          leagueID: baseline.leagueID,
          tags: baseline.tags,
        },
      ),
    ).toEqual({ ...current, name: "Edited" });
  });

  it("applies explicit managed edits and clears on each destination, including farcaster", () => {
    const baseline = {
      ...baseValues,
      twitter: "source",
      farcaster: "source-fid",
      payDisclosure: "Source notice",
    };
    const values = {
      ...baseline,
      description: "Edited description",
      twitter: "  ",
      farcaster: " new-fid ",
      payDisclosure: "New notice",
    };
    for (const current of [baseline, { ...baseline, twitter: "peer", farcaster: "peer-fid" }]) {
      const edited = applyMetadataEdits(current, baseline, values);
      expect(edited.description).toBe("Edited description");
      expect(edited).not.toHaveProperty("twitter");
      expect(edited.farcaster).toBe("new-fid");
      expect(edited.payDisclosure).toBe("New notice");
      expect(
        applyMetadataEdits(current, baseline, { ...baseline, farcaster: "" }),
      ).not.toHaveProperty("farcaster");
    }
  });

  it("keeps the current logo for a blank or unchanged upload and applies a new upload", () => {
    const baseline = { ...baseValues, logoUri: "ipfs://source" };
    const current = { ...baseline, logoUri: "ipfs://peer" };
    expect(applyMetadataEdits(current, baseline, { ...baseline, logoUri: " " }).logoUri).toBe(
      "ipfs://peer",
    );
    expect(applyMetadataEdits(current, baseline, baseline).logoUri).toBe("ipfs://peer");
    expect(
      applyMetadataEdits(current, baseline, { ...baseline, logoUri: " ipfs://new " }).logoUri,
    ).toBe("ipfs://new");
  });

  it("adds, replaces, and deletes only edited custom keys without mutating its inputs", () => {
    const nested = Object.freeze({ source: true, list: Object.freeze([1, 2]) });
    const baseline = Object.freeze({ ...baseValues, nested, deleteMe: "source", keep: "source" });
    const current = Object.freeze({
      ...baseline,
      nested: Object.freeze({ peer: true }),
      deleteMe: "peer",
      keep: "peer",
      peerOnly: true,
    });
    const custom = Object.freeze({
      nested: Object.freeze({ source: false, list: Object.freeze([2, 1]) }),
      keep: "source",
      added: Object.freeze({ enabled: true }),
    });

    for (const destination of [baseline, current]) {
      const result = applyMetadataEdits(destination, baseline, baseValues, custom);
      expect(result.nested).toEqual(custom.nested);
      expect(result.added).toEqual(custom.added);
      expect(result).not.toHaveProperty("deleteMe");
      expect(result.keep).toBe(destination.keep);
    }
    expect(applyMetadataEdits(current, baseline, baseValues, custom).peerOnly).toBe(true);
    expect(baseline.nested).toEqual({ source: true, list: [1, 2] });
    expect(current.nested).toEqual({ peer: true });
    expect(current.deleteMe).toBe("peer");
    expect(custom.nested).toEqual({ source: false, list: [2, 1] });
  });

  it("recognizes unchanged nested JSON despite object key reordering", () => {
    const baseline = {
      ...baseValues,
      nested: { first: 1, object: { a: true, b: null }, array: [{ x: 1, y: 2 }, "value"] },
    };
    const current = { ...baseline, nested: { destinationSpecific: true } };
    const custom = JSON.parse(
      '{"nested":{"array":[{"y":2,"x":1},"value"],"object":{"b":null,"a":true},"first":1}}',
    );
    expect(applyMetadataEdits(current, baseline, baseValues, custom)).toEqual(current);
  });

  it.each([
    [{ a: 1 }, { b: 1 }],
    [
      [1, 2],
      [2, 1],
    ],
    [[1], [1, 2]],
    [1, "1"],
    [null, {}],
    [[1], { 0: 1 }],
  ])("applies a structural or type change from %j to %j", (before, after) => {
    expect(
      applyMetadataEdits(
        { ...baseValues, custom: "peer" },
        { ...baseValues, custom: before },
        baseValues,
        { custom: after },
      ).custom,
    ).toEqual(after);
  });

  it("ignores custom managed-key collisions and preserves each destination version", () => {
    const baseline = { ...baseValues, farcaster: "source", version: 1, removed: true };
    const current = { ...baseline, name: "Peer", farcaster: "peer", version: 2, peerOnly: true };
    expect(
      applyMetadataEdits(current, baseline, baseline, {
        name: "Injected",
        farcaster: "Injected",
        logoUri: "ipfs://injected",
        version: 99,
      }),
    ).toEqual({ ...baseValues, name: "Peer", farcaster: "peer", version: 2, peerOnly: true });
  });

  it("preserves all custom properties when the editor is not supplied", () => {
    const baseline = { ...baseValues, custom: "source" };
    const current = { ...baseline, custom: "peer", peerOnly: true };
    expect(applyMetadataEdits(current, baseline, baseValues)).toEqual(current);
  });

  it("handles missing metadata and unchanged blank optional controls", () => {
    expect(applyMetadataEdits(null, undefined, baseValues, { added: true })).toEqual({
      name: baseValues.name,
      description: baseValues.description,
      added: true,
    });
    const current = { ...baseValues, telegram: "peer", farcaster: "peer" };
    const baseline = { name: baseValues.name, description: baseValues.description };
    expect(applyMetadataEdits(current, baseline, baseValues, {})).toEqual(current);
  });
});

describe("mergeProjectMetadata", () => {
  it("preserves unknown keys, nested objects, and tags on a name-only edit", () => {
    const current = {
      name: "Old name",
      description: "A revnet.",
      logoUri: "ipfs://logo",
      leagueID: "league-42",
      tags: ["defi", "art"],
      nested: { deep: { keep: true }, list: [1, 2, 3] },
      payButton: "Join",
    };

    const merged = mergeProjectMetadata(current, {
      ...baseValues,
      name: "New name",
      description: "A revnet.",
    });

    expect(merged.name).toBe("New name");
    expect(merged.description).toBe("A revnet.");
    expect(merged.logoUri).toBe("ipfs://logo");
    expect(merged.leagueID).toBe("league-42");
    expect(merged.tags).toEqual(["defi", "art"]);
    expect(merged.nested).toEqual({ deep: { keep: true }, list: [1, 2, 3] });
    expect(merged.payButton).toBe("Join");
  });

  it("overwrites edited fields", () => {
    const current = { name: "Old", description: "Old", twitter: "oldhandle" };
    const merged = mergeProjectMetadata(current, {
      ...baseValues,
      name: "New",
      description: "New desc",
      twitter: "newhandle",
    });
    expect(merged.name).toBe("New");
    expect(merged.description).toBe("New desc");
    expect(merged.twitter).toBe("newhandle");
  });

  it("removes an optional field the user cleared", () => {
    const current = { name: "P", description: "d", telegram: "t.me/old" };
    const merged = mergeProjectMetadata(current, { ...baseValues, name: "P", description: "d" });
    expect("telegram" in merged).toBe(false);
  });

  it("keeps the current logo when no new logo is uploaded", () => {
    const current = { name: "P", description: "d", logoUri: "ipfs://keep" };
    const merged = mergeProjectMetadata(current, { ...baseValues, name: "P", description: "d" });
    expect(merged.logoUri).toBe("ipfs://keep");
  });

  it("replaces the logo when a new one is uploaded", () => {
    const current = { name: "P", description: "d", logoUri: "ipfs://old" };
    const merged = mergeProjectMetadata(current, {
      ...baseValues,
      name: "P",
      description: "d",
      logoUri: "ipfs://new",
    });
    expect(merged.logoUri).toBe("ipfs://new");
  });

  it("sets and clears payDisclosure", () => {
    const set = mergeProjectMetadata(
      { name: "P", description: "d" },
      { ...baseValues, name: "P", description: "d", payDisclosure: "Read before paying." },
    );
    expect(set.payDisclosure).toBe("Read before paying.");

    const cleared = mergeProjectMetadata(
      { name: "P", description: "d", payDisclosure: "Old notice" },
      { ...baseValues, name: "P", description: "d" },
    );
    expect("payDisclosure" in cleared).toBe(false);
  });

  it("sets and clears farcaster", () => {
    expect(mergeProjectMetadata({}, { ...baseValues, farcaster: " new-fid " }).farcaster).toBe(
      "new-fid",
    );
    expect(mergeProjectMetadata({ farcaster: "old-fid" }, baseValues)).not.toHaveProperty(
      "farcaster",
    );
  });

  it("tolerates a missing or non-record current metadata", () => {
    const merged = mergeProjectMetadata(undefined, { ...baseValues, name: "P", description: "d" });
    expect(merged.name).toBe("P");
    expect(merged.description).toBe("d");
  });
});

describe("formatCustomProperties", () => {
  it("pretty-prints only the keys the editor does not manage", () => {
    const text = formatCustomProperties({
      name: "P",
      description: "d",
      logoUri: "ipfs://x",
      version: 1,
      leagueID: "l-1",
      nested: { deep: true },
    });

    expect(JSON.parse(text)).toEqual({ leagueID: "l-1", nested: { deep: true } });
    // Pretty-printed so it is editable by hand.
    expect(text).toContain("\n");
  });

  it("is blank when there are no custom properties", () => {
    expect(formatCustomProperties({ name: "P", description: "d", version: 1 })).toBe("");
    expect(formatCustomProperties(undefined)).toBe("");
    expect(formatCustomProperties("nope")).toBe("");
  });

  it("round-trips through parseCustomProperties", () => {
    const current = {
      name: "P",
      description: "d",
      leagueID: "l-1",
      tags: ["a", "b"],
      version: 1,
    };
    const parsed = parseCustomProperties(formatCustomProperties(current));
    expect(parsed).toEqual({ ok: true, value: { leagueID: "l-1", tags: ["a", "b"] } });
  });
});

describe("parseCustomProperties", () => {
  it("treats blank text as an empty object", () => {
    expect(parseCustomProperties("")).toEqual({ ok: true, value: {} });
    expect(parseCustomProperties("   \n ")).toEqual({ ok: true, value: {} });
  });

  it("rejects invalid JSON with a message", () => {
    const result = parseCustomProperties("{ oops");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("rejects JSON that is not a plain object", () => {
    for (const text of ["[1,2]", '"a string"', "42", "null", "true"]) {
      const result = parseCustomProperties(text);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/object/i);
    }
  });

  it("accepts an empty object and nested values", () => {
    expect(parseCustomProperties("{}")).toEqual({ ok: true, value: {} });
    expect(parseCustomProperties('{"a":{"b":[1,2]}}')).toEqual({
      ok: true,
      value: { a: { b: [1, 2] } },
    });
  });
});

describe("customPropertyCollisions", () => {
  it("lists custom keys the form manages", () => {
    expect(
      customPropertyCollisions({ name: "x", leagueID: "l", twitter: "t", version: 99 }),
    ).toEqual(["name", "twitter", "version"]);
  });

  it("is empty when nothing collides", () => {
    expect(customPropertyCollisions({ leagueID: "l" })).toEqual([]);
    expect(customPropertyCollisions(undefined)).toEqual([]);
  });
});

describe("mergeProjectMetadata custom properties", () => {
  const current = {
    name: "Old",
    description: "d",
    leagueID: "l-1",
    tags: ["a"],
    payButton: "Join",
    version: 1,
  };

  it("keeps every unmanaged key when custom properties were not touched", () => {
    const merged = mergeProjectMetadata(current, { ...baseValues, name: "P", description: "d" });
    expect(merged.leagueID).toBe("l-1");
    expect(merged.tags).toEqual(["a"]);
    expect(merged.payButton).toBe("Join");
    expect(merged.version).toBe(1);
  });

  it("replaces the unmanaged key set: edits, adds, and deletes", () => {
    const merged = mergeProjectMetadata(
      current,
      { ...baseValues, name: "P", description: "d" },
      { leagueID: "l-2", newKey: { deep: true } },
    );

    expect(merged.leagueID).toBe("l-2");
    expect(merged.newKey).toEqual({ deep: true });
    // tags and payButton were removed from the JSON, so they are deleted.
    expect("tags" in merged).toBe(false);
    expect("payButton" in merged).toBe(false);
    expect(merged.version).toBe(1);
    // Managed fields still come from the form.
    expect(merged.name).toBe("P");
    expect(merged.description).toBe("d");
  });

  it("clears every custom property when the prefill is cleared to an empty object", () => {
    const merged = mergeProjectMetadata(
      current,
      { ...baseValues, name: "P", description: "d" },
      {},
    );
    expect("leagueID" in merged).toBe(false);
    expect("tags" in merged).toBe(false);
    expect("payButton" in merged).toBe(false);
    expect(merged.version).toBe(1);
    expect(merged.name).toBe("P");
  });

  it("lets managed form fields win on key collision", () => {
    const merged = mergeProjectMetadata(
      { name: "Old", description: "old" },
      { ...baseValues, name: "Form name", description: "Form desc", twitter: "formhandle" },
      {
        name: "Custom name",
        twitter: "customhandle",
        logoUri: "ipfs://custom",
        leagueID: "l-9",
        version: 99,
      },
    );

    expect(merged.name).toBe("Form name");
    expect(merged.description).toBe("Form desc");
    expect(merged.twitter).toBe("formhandle");
    expect(merged.logoUri).toBeUndefined();
    expect(merged.leagueID).toBe("l-9");
    expect(merged.version).toBeUndefined();
  });

  it("does not let a custom property resurrect a cleared optional field", () => {
    const merged = mergeProjectMetadata(
      { name: "P", description: "d", telegram: "t.me/old" },
      { ...baseValues, name: "P", description: "d" },
      { telegram: "t.me/sneaky" },
    );
    expect("telegram" in merged).toBe(false);
  });

  it("tolerates a non-record current metadata with custom properties", () => {
    const merged = mergeProjectMetadata(
      undefined,
      { ...baseValues, name: "P", description: "d" },
      { leagueID: "l-1" },
    );
    expect(merged.name).toBe("P");
    expect(merged.leagueID).toBe("l-1");
  });
});

describe("otherMetadataKeys", () => {
  it("lists only keys the editor does not manage", () => {
    const keys = otherMetadataKeys({
      name: "P",
      description: "d",
      logoUri: "ipfs://x",
      twitter: "h",
      telegram: "t",
      discord: "d",
      infoUri: "u",
      farcaster: "f",
      payDisclosure: "n",
      leagueID: "l-1",
      tags: ["a"],
      payButton: "Join",
    });
    expect(keys).toEqual(["leagueID", "tags", "payButton"]);
  });

  it("returns an empty list for missing or non-record metadata", () => {
    expect(otherMetadataKeys(undefined)).toEqual([]);
    expect(otherMetadataKeys(null)).toEqual([]);
    expect(otherMetadataKeys("nope")).toEqual([]);
  });
});
