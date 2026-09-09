import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { forwardInference } from "../inference.mjs";

const body = {
  model: "model-a",
  messages: [{ role: "user", content: "private prompt" }],
  max_tokens: 10,
};
const usage = { prompt_tokens: 4, completion_tokens: 3 };
const prices = () => ({
  validUntil: new Date(Date.now() + 3600000).toISOString(),
  models: {
    "model-a": {
      inputMicroUsdPerMillion: 1000000,
      outputMicroUsdPerMillion: 2000000,
      maxOutputTokens: 2048,
      maxInputBytes: 16384,
      maxContextTokens: 20000,
    },
  },
});
class ClientResponse extends Writable {
  constructor({ slow = false } = {}) {
    super({ highWaterMark: 1 });
    this.headers = {};
    this.statusCode = 200;
    this.chunks = [];
    this.headersSent = false;
    this.slow = slow;
    this.on("error", () => {});
  }
  setHeader(key, value) {
    this.headers[key.toLowerCase()] = value;
  }
  _write(chunk, encoding, callback) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    if (this.slow) setTimeout(callback, 2);
    else callback();
  }
  get text() {
    return Buffer.concat(this.chunks).toString();
  }
}
function fixture(options = {}) {
  const request = new EventEmitter();
  request.headers = {
    authorization: "Bearer tlg_secret",
    "idempotency-key": "request-1",
    cookie: "private-cookie",
    "sign-in-with-x": "attacker",
  };
  const response = new ClientResponse(options);
  const reservations = [];
  const finishes = [];
  const requests = [];
  const providerIds = [];
  const store = {
    async noteProviderRequestId(id, providerRequestId) {
      providerIds.push({ id, providerRequestId });
    },
    async reserve(args) {
      reservations.push(args);
      return {
        id: "reservation-id",
        projectId: "project-id",
        vaultAddress: "0x123",
      };
    },
    async finish(id, args) {
      finishes.push({ id, ...args });
    },
  };
  const authHeader = async (projectId) => {
    assert.equal(projectId, "project-id");
    return "vault-siwe-secret";
  };
  const fetchImpl = async (...args) => {
    requests.push(args);
    return Response.json({
      choices: [{ message: { content: "hello" } }],
      usage,
    });
  };
  return {
    request,
    response,
    store,
    prices: prices(),
    body,
    fetchImpl,
    authHeader,
    reservations,
    finishes,
    requests,
    providerIds,
  };
}
function streamResponse(parts, { close = true } = {}) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(Buffer.from(part));
        if (close) controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
        "x-private": "upstream-secret",
      },
    },
  );
}
function terminalUsage() {
  return `data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`;
}

test("reserves once, sends only fixed upstream authorization and settles exact nonstream usage", async () => {
  const f = fixture();
  await forwardInference(f);
  assert.equal(f.reservations.length, 1);
  assert.equal(f.reservations[0].secret, "tlg_secret");
  assert.equal(f.reservations[0].idempotencyKey, "request-1");
  assert.ok(f.reservations[0].maximumMicroUsd > 10n);
  assert.equal(f.requests.length, 1);
  const [url, options] = f.requests[0];
  assert.equal(url, "https://api.venice.ai/api/v1/chat/completions");
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "error");
  assert.deepEqual(options.headers, {
    "content-type": "application/json",
    "SIGN-IN-WITH-X": "vault-siwe-secret",
  });
  assert.deepEqual(JSON.parse(options.body), {
    ...body,
    venice_parameters: {
      include_venice_system_prompt: false,
      enable_web_search: "off",
      enable_web_scraping: false,
      enable_x_search: false,
      disable_thinking: true,
    },
  });
  assert.deepEqual(f.finishes, [
    { id: "reservation-id", state: "settled", chargedMicroUsd: 10n },
  ]);
  assert.deepEqual(f.response.headers, {
    "content-type": "application/json",
    "x-request-id": "reservation-id",
  });
  assert.equal(JSON.parse(f.response.text).choices[0].message.content, "hello");
});

test("expired price catalog and unbounded requests are rejected before money is reserved", async () => {
  for (const changes of [
    { prices: { ...prices(), validUntil: new Date(0).toISOString() } },
    { body: { ...body, tools: [{}] } },
  ]) {
    const f = Object.assign(fixture(), changes);
    await assert.rejects(forwardInference(f));
    assert.equal(f.reservations.length, 0);
    assert.equal(f.requests.length, 0);
  }
});

test("missing bearer credentials never reserve or forward", async () => {
  const f = fixture();
  delete f.request.headers.authorization;
  await assert.rejects(forwardInference(f), (error) => error.status === 401);
  assert.equal(f.reservations.length, 0);
  assert.equal(f.requests.length, 0);
});

test("authentication failure releases a preflight reservation without echoing credentials", async () => {
  const f = fixture();
  f.authHeader = async () => {
    throw new Error("vault-siwe-secret private prompt");
  };
  await assert.rejects(
    forwardInference(f),
    (error) =>
      error.status === 502 && !/secret|private prompt/.test(error.message),
  );
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "released" }]);
});

test("all upstream errors and redirects are ambiguous and never retried or echoed", async () => {
  for (const status of [302, 400, 401, 429, 500, 503]) {
    const f = fixture();
    let calls = 0;
    f.fetchImpl = async () => {
      calls++;
      return new Response("private prompt vault-siwe-secret", { status });
    };
    await assert.rejects(
      forwardInference(f),
      (error) =>
        error.status === 409 && !/secret|private prompt/.test(error.message),
    );
    assert.equal(calls, 1);
    assert.equal(f.response.text, "");
    assert.deepEqual(f.finishes, [
      { id: "reservation-id", state: "uncertain" },
    ]);
  }
});

test("a transit failure consumes one conservative reservation", async () => {
  const f = fixture();
  let calls = 0;
  f.fetchImpl = async () => {
    calls++;
    throw new Error("private upstream detail");
  };
  await assert.rejects(
    forwardInference(f),
    (error) => !error.message.includes("private"),
  );
  assert.equal(calls, 1);
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "uncertain" }]);
});

test("nonstream malformed, missing, overbound usage and oversized response retain capacity", async () => {
  for (const data of [
    "not json",
    JSON.stringify({ choices: [] }),
    JSON.stringify({ usage: { prompt_tokens: 4, completion_tokens: 99999 } }),
    "x".repeat(1025),
  ]) {
    const f = fixture();
    f.maxResponseBytes = 1024;
    f.fetchImpl = async () => new Response(data);
    await assert.rejects(forwardInference(f));
    assert.deepEqual(f.finishes, [
      { id: "reservation-id", state: "uncertain" },
    ]);
    assert.equal(f.response.text, "");
  }
});

test("streaming injects usage request, preserves UTF-8 and CRLF boundaries, and handles backpressure", async () => {
  const f = fixture({ slow: true });
  f.body = { ...body, stream: true };
  const content = `data: ${JSON.stringify({ choices: [{ delta: { content: "café" } }] })}\r\n\r\n`;
  const full = Buffer.from(content + terminalUsage().replaceAll("\n", "\r\n"));
  const parts = Array.from(full, (byte) => Buffer.from([byte]));
  f.fetchImpl = async (...args) => {
    f.requests.push(args);
    return streamResponse(parts);
  };
  await forwardInference(f);
  assert.deepEqual(JSON.parse(f.requests[0][1].body).stream_options, {
    include_usage: true,
  });
  assert.equal(f.response.text, full.toString());
  assert.deepEqual(f.finishes, [
    { id: "reservation-id", state: "settled", chargedMicroUsd: 10n },
  ]);
  assert.deepEqual(f.response.headers, {
    "content-type": "text/event-stream",
    "x-request-id": "reservation-id",
  });
});

test("stream settlement requires the final usage event and DONE marker", async () => {
  for (const data of [
    `data: ${JSON.stringify({ usage })}\n\n`,
    "data: [DONE]\n\n",
    `data: ${JSON.stringify({ usage })}\n\ndata: {"choices":[]}\n\ndata: [DONE]\n\n`,
    `data: ${JSON.stringify({ usage })}\n\ndata: [DONE]\n\ndata: {"choices":[]}\n\n`,
    "data: {broken}\n\n",
  ]) {
    const f = fixture();
    f.body = { ...body, stream: true };
    f.fetchImpl = async () => streamResponse([data]);
    await assert.rejects(forwardInference(f));
    assert.deepEqual(f.finishes, [
      { id: "reservation-id", state: "uncertain" },
    ]);
    if (f.response.headersSent) assert.ok(f.response.destroyed);
  }
});

test("stream total bytes and a single unbounded event are capped before being forwarded", async () => {
  for (const [maxResponseBytes, parts] of [
    [
      256,
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "x".repeat(300) } }] })}\n\n`,
      ],
    ],
    [100000, ["data: " + "x".repeat(70000)]],
  ]) {
    const f = fixture();
    Object.assign(f, {
      body: { ...body, stream: true },
      maxResponseBytes,
      fetchImpl: async () => streamResponse(parts),
    });
    await assert.rejects(forwardInference(f));
    assert.equal(f.response.text, "");
    assert.deepEqual(f.finishes, [
      { id: "reservation-id", state: "uncertain" },
    ]);
  }
});

test("deadline aborts paid upstream exactly once and retains the reservation", async () => {
  const f = fixture();
  f.requestTimeoutMs = 10;
  let signal;
  let calls = 0;
  f.fetchImpl = async (_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise(() => {});
  };
  await assert.rejects(forwardInference(f), (error) => error.status === 409);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "uncertain" }]);
});

test("deadline during signer preflight releases the reservation", async () => {
  const f = fixture();
  f.requestTimeoutMs = 10;
  f.authHeader = async () => new Promise(() => {});
  await assert.rejects(forwardInference(f), (error) => error.status === 504);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "released" }]);
});

test("client disconnect while reading a paid stream cancels upstream and retains capacity", async () => {
  const f = fixture();
  f.body = { ...body, stream: true };
  let signal;
  let canceled = false;
  f.fetchImpl = async (_url, options) => {
    signal = options.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('data: {"choices":[]}\n\n'));
          setImmediate(() => f.response.destroy());
        },
        cancel() {
          canceled = true;
        },
      }),
    );
  };
  await assert.rejects(forwardInference(f));
  assert.equal(signal.aborted, true);
  assert.equal(canceled, true);
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "uncertain" }]);
});

test("settlement database failure does not release or mutate a reservation a second time", async () => {
  const f = fixture();
  f.store.finish = async (id, args) => {
    f.finishes.push({ id, ...args });
    throw new Error("database unavailable");
  };
  await forwardInference(f);
  assert.deepEqual(f.finishes, [
    { id: "reservation-id", state: "settled", chargedMicroUsd: 10n },
  ]);
  assert.equal(JSON.parse(f.response.text).usage.completion_tokens, 3);
});

test("streaming upstream rejection leaves an unwritten response available for a generic API error", async () => {
  const f = fixture();
  f.body = { ...body, stream: true };
  f.fetchImpl = async () => new Response("private prompt", { status: 429 });
  await assert.rejects(forwardInference(f), (error) => error.status === 409);
  assert.equal(f.response.headersSent, false);
  assert.equal(f.response.destroyed, false);
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "uncertain" }]);
});

test("an uncooperative upstream cancellation cannot hold a timed out reservation open", async () => {
  const f = fixture();
  f.body = { ...body, stream: true };
  f.requestTimeoutMs = 5;
  f.fetchImpl = async () =>
    new Response(
      new ReadableStream({
        cancel() {
          return new Promise(() => {});
        },
      }),
    );
  let timeout;
  try {
    await Promise.race([
      assert.rejects(forwardInference(f), (error) => error.status === 409),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Cancellation blocked settlement")),
          100,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "uncertain" }]);
});

test("provider completion identity persists before invalid usage leaves an uncertain debit", async () => {
  const f = fixture();
  f.fetchImpl = async () =>
    Response.json({ id: "chatcmpl-proof-123", usage: null });
  await assert.rejects(forwardInference(f));
  assert.deepEqual(f.providerIds, [
    { id: "reservation-id", providerRequestId: "chatcmpl-proof-123" },
  ]);
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "uncertain" }]);
});

test("interrupted streams preserve their first provider identity but reject conflicting identities", async () => {
  for (const tail of ["", 'data: {"id":"chatcmpl-other","choices":[]}\n\n']) {
    const f = fixture();
    f.body = { ...body, stream: true };
    f.fetchImpl = async () =>
      streamResponse([
        'data: {"id":"chatcmpl-proof-123","choices":[]}\n\n' + tail,
      ]);
    await assert.rejects(forwardInference(f));
    assert.deepEqual(f.providerIds, [
      { id: "reservation-id", providerRequestId: "chatcmpl-proof-123" },
    ]);
    assert.deepEqual(f.finishes, [
      { id: "reservation-id", state: "uncertain" },
    ]);
  }
});

test("paid ambiguity is nonretryable HTTP409 and carries its reserved request identity", async () => {
  const f = fixture();
  f.authHeader = async () => {
    assert.equal(f.response.headers["x-request-id"], "reservation-id");
    return "vault-siwe-secret";
  };
  f.fetchImpl = async () =>
    new Response("provider unavailable", { status: 503 });
  await assert.rejects(
    forwardInference(f),
    (error) => error.status === 409 && error.code === "inference_unconfirmed",
  );
  assert.deepEqual(f.finishes, [{ id: "reservation-id", state: "uncertain" }]);
});
