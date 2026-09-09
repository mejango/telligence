import test from "node:test";
import assert from "node:assert/strict";
import { ModelCatalog, validateModelPolicy } from "../catalog.mjs";
const now = Date.parse("2026-09-09T12:00:00Z");
const policy = {
  models: {
    "archive-model": {
      inputMicroUsdPerMillion: 500000,
      outputMicroUsdPerMillion: 1000000,
      maxOutputTokens: 1000,
      maxInputBytes: 2000,
      maxContextTokens: 8192,
    },
  },
};
const model = {
  id: "archive-model",
  type: "text",
  model_spec: {
    offline: false,
    availableContextTokens: 8192,
    maxCompletionTokens: 1000,
    capabilities: { supportsReasoning: false },
    pricing: {
      input: { diem: 0.25, usd: 100 },
      output: { diem: 0.5, usd: 100 },
    },
  },
};
const response = (models = [model]) =>
  new Response(JSON.stringify({ data: models }), {
    headers: { "content-type": "application/json" },
  });
test("refresh verifies DIEM prices but preserves reviewed conservative reservation ceilings", async () => {
  const catalog = new ModelCatalog({
    policy,
    now: () => now,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.venice.ai/api/v1/models?type=text");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.authorization, undefined);
      return response();
    },
  });
  assert.equal(catalog.current(), null);
  await catalog.refresh();
  assert.deepEqual(catalog.current().models, policy.models);
  assert.equal(Date.parse(catalog.current().validUntil), now + 300000);
});
test("outages preserve only unexpired observations and never extend their lifetime", async () => {
  let time = now,
    failed = false;
  const catalog = new ModelCatalog({
    policy,
    now: () => time,
    fetchImpl: async () => {
      if (failed) throw Error("offline");
      return response();
    },
  });
  await catalog.refresh();
  failed = true;
  await assert.rejects(catalog.refresh());
  assert.ok(catalog.current());
  time += 300000;
  assert.equal(catalog.current(), null);
});
test("price increases, removed models, reasoning capabilities, and smaller provider bounds fail closed", async () => {
  for (const change of [
    { pricing: { input: { diem: 0.500001 }, output: { diem: 0.5 } } },
    { offline: true },
    { availableContextTokens: 4096 },
    { maxCompletionTokens: 999 },
    { capabilities: { supportsReasoning: true } },
  ]) {
    let changed = false;
    const catalog = new ModelCatalog({
      policy,
      now: () => now,
      fetchImpl: async () =>
        response(
          changed
            ? [{ ...model, model_spec: { ...model.model_spec, ...change } }]
            : [model],
        ),
    });
    await catalog.refresh();
    changed = true;
    await catalog.refresh();
    assert.equal(catalog.current(), null);
  }
  const catalog = new ModelCatalog({
    policy,
    now: () => now,
    fetchImpl: async () => response([]),
  });
  await catalog.refresh();
  assert.equal(catalog.current(), null);
});
test("unreviewed models are never added and malformed decimal prices are never rounded down", async () => {
  const catalog = new ModelCatalog({
    policy,
    now: () => now,
    fetchImpl: async () =>
      response([
        { ...model, id: "unreviewed" },
        {
          ...model,
          model_spec: {
            ...model.model_spec,
            pricing: { input: { diem: 0.5000001 }, output: { diem: 0.5 } },
          },
        },
      ]),
  });
  await catalog.refresh();
  assert.equal(catalog.current(), null);
});
test("duplicate model identities invalidate the response immediately", async () => {
  let duplicate = false;
  const catalog = new ModelCatalog({
    policy,
    now: () => now,
    fetchImpl: async () => response(duplicate ? [model, model] : [model]),
  });
  await catalog.refresh();
  duplicate = true;
  await assert.rejects(catalog.refresh());
  assert.equal(catalog.current(), null);
});
test("response length is bounded and pending fetches share one refresh", async () => {
  let resolve,
    calls = 0;
  const catalog = new ModelCatalog({
    policy,
    now: () => now,
    fetchImpl: async () => {
      calls++;
      await new Promise((done) => {
        resolve = done;
      });
      return new Response("x", { headers: { "content-length": "1048577" } });
    },
  });
  const first = catalog.refresh(),
    second = catalog.refresh();
  resolve();
  await Promise.all([assert.rejects(first), assert.rejects(second)]);
  assert.equal(calls, 1);
  assert.equal(catalog.current(), null);
});
test("invalid operator policies cannot enable automatic refresh", () => {
  assert.throws(() => validateModelPolicy({ models: {} }));
  assert.throws(() =>
    validateModelPolicy({
      models: {
        ...policy.models,
        invalid: {
          ...policy.models["archive-model"],
          inputMicroUsdPerMillion: 0,
        },
      },
    }),
  );
});
