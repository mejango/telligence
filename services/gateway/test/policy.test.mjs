import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateInference,
  quoteReservation,
  usdToMicro,
  microToUsd,
  authorizeOrigin,
  signKey,
  verifyKey,
} from "../policy.mjs";
const prices = {
  "model-a": {
    inputMicroUsdPerMillion: 1000000,
    outputMicroUsdPerMillion: 2000000,
    maxOutputTokens: 2048,
    maxInputBytes: 16384,
    maxContextTokens: 20000,
  },
};
test("monetary conversions never pass through floating point", () => {
  assert.equal(usdToMicro("0.100001"), 100001n);
  assert.equal(microToUsd(100001n), "0.100001");
  for (const invalid of [
    "-1",
    "1e2",
    "NaN",
    "0.0000001",
    "1000000000000000000000000000000",
    1.2,
  ])
    assert.throws(() => usdToMicro(invalid));
});
test("bounded explicit model and output with no remote tools or paid fallback", () => {
  const body = {
    model: "model-a",
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 10,
    stream: true,
  };
  assert.equal(validateInference(body, prices).model, "model-a");
  for (const extra of [
    { model: "unknown" },
    { max_tokens: 999999 },
    { max_tokens: undefined },
    { n: 2 },
    { tools: [{}] },
    { venice_parameters: { enable_web_search: "on" } },
    {
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://evil" } }],
        },
      ],
    },
  ])
    assert.throws(() => validateInference({ ...body, ...extra }, prices));
});
test("reservation treats every UTF-8 input byte as a possible token plus protocol framing", () => {
  const body = {
    model: "model-a",
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 10,
  };
  const q = quoteReservation(
    validateInference(body, prices),
    prices["model-a"],
  );
  assert.ok(q.maximumMicroUsd >= 20n + 5n);
  assert.ok(
    q.inputTokenBound >= Buffer.byteLength(JSON.stringify(body.messages)),
  );
});
test("strict origins reject suffix and null origin confusion", () => {
  assert.equal(
    authorizeOrigin("https://telligence.example", [
      "https://telligence.example",
    ]),
    true,
  );
  assert.equal(
    authorizeOrigin("https://telligence.example.evil", [
      "https://telligence.example",
    ]),
    false,
  );
  assert.equal(authorizeOrigin("null", ["https://telligence.example"]), false);
});
test("random bearer hashes bind key ID, reject malformed keys, never store the secret", () => {
  const key = signKey("pepper-is-at-least-thirty-two-bytes-long");
  assert.match(key.secret, /^tlg_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/);
  assert.ok(!key.hash.includes(key.secret));
  assert.equal(
    verifyKey(key.secret, key.hash, "pepper-is-at-least-thirty-two-bytes-long"),
    true,
  );
  assert.equal(
    verifyKey(
      key.secret + "x",
      key.hash,
      "pepper-is-at-least-thirty-two-bytes-long",
    ),
    false,
  );
});
test("provider defaults cannot inject unpriced hidden system prompts or search", () => {
  const result = validateInference(
    {
      model: "model-a",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 16,
    },
    prices,
  );
  assert.deepEqual(result.venice_parameters, {
    include_venice_system_prompt: false,
    enable_web_search: "off",
    enable_web_scraping: false,
    enable_x_search: false,
    disable_thinking: true,
  });
});
