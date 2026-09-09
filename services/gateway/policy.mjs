import {
  randomBytes,
  randomUUID,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function usdToMicro(value) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(value)
  )
    throw new ApiError(
      400,
      "invalid_amount",
      "Use a decimal dollar amount with at most six fractional digits.",
    );
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
}
export function microToUsd(value) {
  const amount = BigInt(value);
  return `${amount / 1000000n}.${(amount % 1000000n).toString().padStart(6, "0")}`;
}
export function authorizeOrigin(origin, allowedOrigins) {
  return typeof origin === "string" && allowedOrigins.includes(origin);
}
export function digest(value, pepper) {
  return createHmac("sha256", pepper).update(value).digest("hex");
}
export function equalSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function signKey(pepper) {
  const id = randomUUID();
  const secret = `tlg_${id}_${randomBytes(32).toString("base64url")}`;
  return {
    id,
    secret,
    prefix: `tlg_${id.slice(0, 8)}`,
    hash: digest(secret, pepper),
  };
}
export function keyId(secret) {
  return /^tlg_([0-9a-f-]{36})_[A-Za-z0-9_-]{43}$/.exec(secret)?.[1] ?? null;
}
export function verifyKey(secret, hash, pepper) {
  return !!keyId(secret) && equalSecret(digest(secret, pepper), hash);
}
const FIELDS = new Set([
  "model",
  "messages",
  "max_tokens",
  "max_completion_tokens",
  "stream",
  "stream_options",
  "temperature",
  "top_p",
  "stop",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "n",
]);
export function validateInference(body, prices) {
  const bad = () => {
    throw new ApiError(
      400,
      "unsupported_request",
      "Use an approved text model, bounded text messages and an explicit output limit.",
    );
  };
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !FIELDS.has(k))
  )
    bad();
  if (typeof body.model !== "string" || !Object.hasOwn(prices, body.model))
    bad();
  const price = prices[body.model];
  if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined)
    bad();
  const max = body.max_completion_tokens ?? body.max_tokens;
  if (!Number.isSafeInteger(max) || max < 1 || max > price.maxOutputTokens)
    bad();
  if (body.n !== undefined && body.n !== 1) bad();
  if (body.stream !== undefined && typeof body.stream !== "boolean") bad();
  if (
    body.stream_options !== undefined &&
    (typeof body.stream_options !== "object" ||
      body.stream_options === null ||
      Object.keys(body.stream_options).some((k) => k !== "include_usage") ||
      body.stream_options.include_usage !== true)
  )
    bad();
  if (
    !Array.isArray(body.messages) ||
    body.messages.length < 1 ||
    body.messages.length > 128
  )
    bad();
  for (const message of body.messages) {
    if (
      !message ||
      typeof message !== "object" ||
      Object.keys(message).some((k) => !["role", "content"].includes(k)) ||
      !["system", "user", "assistant"].includes(message.role) ||
      typeof message.content !== "string"
    )
      bad();
  }
  const bytes = Buffer.byteLength(JSON.stringify(body.messages));
  if (
    bytes > price.maxInputBytes ||
    bytes + body.messages.length * 32 + 256 + max > price.maxContextTokens
  )
    bad();
  for (const [k, min, maxVal] of [
    ["temperature", 0, 2],
    ["top_p", 0, 1],
    ["presence_penalty", -2, 2],
    ["frequency_penalty", -2, 2],
  ]) {
    if (
      body[k] !== undefined &&
      (typeof body[k] !== "number" ||
        !Number.isFinite(body[k]) ||
        body[k] < min ||
        body[k] > maxVal)
    )
      bad();
  }
  if (body.seed !== undefined && !Number.isSafeInteger(body.seed)) bad();
  if (
    body.stop !== undefined &&
    !(typeof body.stop === "string" && body.stop.length <= 256) &&
    !(
      Array.isArray(body.stop) &&
      body.stop.length <= 4 &&
      body.stop.every((v) => typeof v === "string" && v.length <= 256)
    )
  )
    bad();
  return {
    ...body,
    venice_parameters: {
      include_venice_system_prompt: false,
      enable_web_search: "off",
      enable_web_scraping: false,
      enable_x_search: false,
      disable_thinking: true,
    },
    ...(body.stream ? { stream_options: { include_usage: true } } : {}),
  };
}
export function quoteReservation(body, price) {
  const inputTokenBound =
    Buffer.byteLength(JSON.stringify(body.messages)) +
    body.messages.length * 32 +
    256;
  const outputTokenBound = body.max_completion_tokens ?? body.max_tokens;
  const raw =
    BigInt(inputTokenBound) * BigInt(price.inputMicroUsdPerMillion) +
    BigInt(outputTokenBound) * BigInt(price.outputMicroUsdPerMillion);
  return {
    inputTokenBound,
    outputTokenBound,
    maximumMicroUsd: (raw + 999999n) / 1000000n + 1n,
  };
}
export function costFromUsage(usage, price, quote) {
  if (
    !usage ||
    !Number.isSafeInteger(usage.prompt_tokens) ||
    !Number.isSafeInteger(usage.completion_tokens) ||
    usage.prompt_tokens < 0 ||
    usage.completion_tokens < 0 ||
    usage.prompt_tokens > quote.inputTokenBound ||
    usage.completion_tokens > quote.outputTokenBound
  )
    return null;
  // Cached/reasoning usage is deliberately charged at the noncached upper price.
  return (
    (BigInt(usage.prompt_tokens) * BigInt(price.inputMicroUsdPerMillion) +
      BigInt(usage.completion_tokens) * BigInt(price.outputMicroUsdPerMillion) +
      999999n) /
    1000000n
  );
}
export function validatePrices(prices, now = Date.now()) {
  if (
    !prices ||
    typeof prices !== "object" ||
    !Number.isFinite(Date.parse(prices.validUntil)) ||
    Date.parse(prices.validUntil) <= now ||
    Date.parse(prices.validUntil) > now + 86400000
  )
    throw new Error(
      "MODEL_PRICES_JSON must contain a reviewed catalog expiring within 24 hours.",
    );
  if (!prices.models || Object.keys(prices.models).length === 0)
    throw new Error("An explicit model catalog is required.");
  for (const [name, price] of Object.entries(prices.models)) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9/_.:-]{0,127}$/.test(name) ||
      ![
        "inputMicroUsdPerMillion",
        "outputMicroUsdPerMillion",
        "maxOutputTokens",
        "maxInputBytes",
        "maxContextTokens",
      ].every((k) => Number.isSafeInteger(price[k]) && price[k] > 0) ||
      price.maxInputBytes > 131072 ||
      price.maxOutputTokens > 16384 ||
      price.inputMicroUsdPerMillion > 1000000000 ||
      price.outputMicroUsdPerMillion > 1000000000
    )
      throw new Error("Invalid model price policy.");
  }
  return prices;
}
