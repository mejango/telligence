import {
  ApiError,
  validateInference,
  validatePrices,
  quoteReservation,
  costFromUsage,
} from "./policy.mjs";

const VENICE_COMPLETIONS_URL = "https://api.venice.ai/api/v1/chat/completions";
const MAX_EVENT_BYTES = 64 * 1024;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const unavailable = () =>
  new ApiError(
    502,
    "inference_unavailable",
    "The inference could not be confirmed. Check request status before trying again.",
  );
const disconnected = () =>
  new ApiError(499, "client_disconnected", "The client disconnected.");

// This parser retains one bounded SSE event and its final usage, never a transcript.
// A usage event must immediately precede DONE. An interrupted stream cannot refund
// capacity: Venice may already have completed and charged the generation.
class UsageStream {
  constructor(maxEventBytes) {
    this.maxEventBytes = maxEventBytes;
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.line = "";
    this.data = [];
    this.eventBytes = 0;
    this.skipLf = false;
    this.done = false;
    this.lastUsage = null;
    this.requestId = null;
  }
  feed(bytes) {
    this.consume(this.decoder.decode(bytes, { stream: true }));
  }
  consume(text) {
    for (const character of text) {
      if (this.skipLf) {
        this.skipLf = false;
        if (character === "\n") continue;
      }
      if (character === "\r" || character === "\n") {
        this.parseLine();
        this.skipLf = character === "\r";
      } else {
        this.eventBytes += Buffer.byteLength(character);
        if (this.eventBytes > this.maxEventBytes) throw unavailable();
        this.line += character;
      }
    }
  }
  parseLine() {
    const line = this.line;
    this.line = "";
    if (line === "") {
      if (this.data.length) {
        const value = this.data.join("\n");
        this.data = [];
        if (this.done) throw unavailable();
        if (value === "[DONE]") this.done = true;
        else {
          let event;
          try {
            event = JSON.parse(value);
          } catch {
            throw unavailable();
          }
          if (
            !event ||
            typeof event !== "object" ||
            Array.isArray(event) ||
            event.error
          )
            throw unavailable();
          this.lastUsage = event.usage ?? null;
          if (event.id !== undefined) {
            if (
              typeof event.id !== "string" ||
              !PROVIDER_ID.test(event.id) ||
              (this.requestId !== null && this.requestId !== event.id)
            )
              throw unavailable();
            this.requestId = event.id;
          }
        }
      }
      this.eventBytes = 0;
    } else if (line.startsWith("data:"))
      this.data.push(line.slice(5).replace(/^ /, ""));
    else if (line.startsWith("event:") && line.slice(6).trim() === "error")
      throw unavailable();
  }
  finish() {
    this.consume(this.decoder.decode());
    if (!this.done || this.line || this.data.length) throw unavailable();
    return this.lastUsage;
  }
}

function bearer(request) {
  const header = request.headers?.authorization;
  const match = typeof header === "string" && /^Bearer ([^\s]+)$/i.exec(header);
  if (!match)
    throw new ApiError(401, "unauthorized", "Valid credentials are required.");
  return match[1];
}

function waitForDrain(response, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.off("drain", drained);
      response.off("close", closed);
      response.off("error", closed);
      signal.removeEventListener("abort", aborted);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const closed = () => {
      cleanup();
      reject(disconnected());
    };
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    response.once("drain", drained);
    response.once("close", closed);
    response.once("error", closed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else if (response.destroyed) closed();
  });
}

/** Forward exactly one bounded inference, with conservative capacity accounting. */
export async function forwardInference({
  request,
  response,
  body,
  store,
  prices,
  fetchImpl = fetch,
  authHeader,
  requestTimeoutMs = 120000,
  maxResponseBytes = 8 * 1024 * 1024,
}) {
  const secret = bearer(request);
  try {
    validatePrices(prices);
  } catch {
    throw new ApiError(
      503,
      "pricing_unavailable",
      "A current reviewed model price catalog is required.",
    );
  }
  const payload = validateInference(body, prices.models);
  const price = prices.models[payload.model];
  const quote = quoteReservation(payload, price);
  const reservation = await store.reserve({
    secret,
    maximumMicroUsd: quote.maximumMicroUsd,
    model: payload.model,
    idempotencyKey: request.headers?.["idempotency-key"],
  });

  response.setHeader("x-request-id", reservation.id);
  const controller = new AbortController();
  const { signal } = controller;
  let started = false;
  let finishAttempted = false;
  let reader;
  let upstream;
  const abortPromise = new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
  // The deadline may expire between awaits. Keep its rejection observed.
  abortPromise.catch(() => {});
  const withinDeadline = (promise) => Promise.race([promise, abortPromise]);
  const clientClosed = () => {
    if (!response.writableFinished) controller.abort(disconnected());
  };
  const clientAborted = () => controller.abort(disconnected());
  request.once("aborted", clientAborted);
  response.once("close", clientClosed);
  response.once("error", clientAborted);
  const timer = setTimeout(
    () =>
      controller.abort(
        new ApiError(
          504,
          "inference_timeout",
          "The inference deadline elapsed. Check request status before trying again.",
        ),
      ),
    requestTimeoutMs,
  );

  // A failed database write leaves the original reservation reserved. Never try
  // to release it or issue a second settlement whose first result is unknown.
  const finish = async (state, chargedMicroUsd) => {
    if (finishAttempted) return;
    finishAttempted = true;
    try {
      await store.finish(reservation.id, {
        state,
        ...(chargedMicroUsd !== undefined ? { chargedMicroUsd } : {}),
      });
    } catch {
      /* Retained reservations fail closed until reconciled. */
    }
  };
  const headers = (type) => {
    response.statusCode = 200;
    response.setHeader("content-type", type);
    response.setHeader("x-request-id", reservation.id);
  };

  try {
    if (request.aborted || response.destroyed) throw disconnected();
    const upstreamAuthorization = await withinDeadline(
      Promise.resolve().then(() => authHeader(reservation.projectId)),
    );
    if (
      typeof upstreamAuthorization !== "string" ||
      !upstreamAuthorization ||
      /[\r\n]/.test(upstreamAuthorization)
    )
      throw unavailable();
    if (signal.aborted) throw signal.reason;
    started = true;
    upstream = await withinDeadline(
      fetchImpl(VENICE_COMPLETIONS_URL, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "content-type": "application/json",
          "SIGN-IN-WITH-X": upstreamAuthorization,
        },
        body: JSON.stringify(payload),
      }),
    );
    if (!upstream.ok || !upstream.body) throw unavailable();
    const contentLength = upstream.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > maxResponseBytes)
    )
      throw unavailable();
    reader = upstream.body.getReader();
    let totalBytes = 0;
    let chargedMicroUsd;
    const parser = payload.stream
      ? new UsageStream(Math.min(MAX_EVENT_BYTES, maxResponseBytes))
      : null;
    const chunks = [];
    let recordedProviderId = null;
    const recordIdentity = async (id) => {
      if (id === undefined || id === null || id === recordedProviderId) return;
      if (typeof id !== "string" || !PROVIDER_ID.test(id)) throw unavailable();
      await withinDeadline(store.noteProviderRequestId(reservation.id, id));
      recordedProviderId = id;
    };
    if (payload.stream) headers("text/event-stream");

    while (true) {
      const { done, value } = await withinDeadline(reader.read());
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) throw unavailable();
      if (parser) {
        let parseError;
        try {
          parser.feed(value);
        } catch (error) {
          parseError = error;
        }
        // Preserve the first provider-issued identity even if a later event in
        // this same chunk is malformed. It is never supplied by the caller.
        await recordIdentity(parser.requestId);
        if (parseError) throw parseError;
        if (signal.aborted || response.destroyed)
          throw signal.reason ?? disconnected();
        if (!response.write(value)) await waitForDrain(response, signal);
      } else chunks.push(Buffer.from(value));
    }

    if (parser) chargedMicroUsd = costFromUsage(parser.finish(), price, quote);
    else {
      let completion;
      try {
        completion = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        throw unavailable();
      }
      if (
        !completion ||
        typeof completion !== "object" ||
        Array.isArray(completion) ||
        completion.error
      )
        throw unavailable();
      await recordIdentity(completion.id);
      chargedMicroUsd = costFromUsage(completion.usage, price, quote);
    }
    if (chargedMicroUsd === null || signal.aborted || response.destroyed)
      throw signal.reason ?? unavailable();
    await finish("settled", chargedMicroUsd);
    if (!payload.stream) headers("application/json");
    response.end(payload.stream ? undefined : Buffer.concat(chunks));
  } catch (error) {
    const reason = signal.aborted ? signal.reason : error;
    const safeError =
      reason?.code === "client_disconnected"
        ? reason
        : started
          ? new ApiError(
              409,
              "inference_unconfirmed",
              "The provider may have charged this request. Inspect its request identifier before trying again.",
            )
          : signal.aborted
            ? signal.reason
            : unavailable();
    controller.abort(safeError);
    // Cancellation cannot prove that no inference occurred after fetch began.
    // Releasing is safe only when the signer/preflight failed before that point.
    // Start cancellation without awaiting provider-controlled stream cleanup.
    // A stalled cancel must never prevent conservative database settlement.
    if (reader) {
      try {
        reader.cancel().catch(() => {});
      } catch {
        /* Already failed/cancelled. */
      }
    } else if (upstream?.body) {
      try {
        upstream.body.cancel().catch(() => {});
      } catch {
        /* Already failed/cancelled. */
      }
    }
    await finish(started ? "uncertain" : "released");
    if (response.headersSent || response.destroyed) response.destroy();
    throw safeError;
  } finally {
    clearTimeout(timer);
    request.off("aborted", clientAborted);
    response.off("close", clientClosed);
    response.off("error", clientAborted);
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        /* A cancelled read may retain its lock momentarily. */
      }
    }
  }
}
