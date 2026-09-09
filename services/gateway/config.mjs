import { validatePrices } from "./policy.mjs";
import { validateModelPolicy } from "./catalog.mjs";
function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
export function configFromEnv(env = process.env) {
  const keyPepper = required(env, "API_KEY_PEPPER");
  if (Buffer.byteLength(keyPepper) < 32)
    throw new Error("API_KEY_PEPPER needs at least 32 random bytes.");
  const allowedOrigins = required(env, "ALLOWED_WEB_ORIGINS")
    .split(",")
    .map((s) => s.trim());
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      (url.protocol !== "https:" &&
        !(
          env.NODE_ENV !== "production" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    )
      throw new Error("Invalid ALLOWED_WEB_ORIGINS.");
  }
  const signerUrl = new URL(required(env, "AUTH_SIGNER_URL"));
  if (
    !["http:", "https:"].includes(signerUrl.protocol) ||
    signerUrl.username ||
    signerUrl.password ||
    signerUrl.pathname !== "/" ||
    signerUrl.search ||
    signerUrl.hash
  )
    throw new Error("Invalid AUTH_SIGNER_URL.");
  const signerSecret = required(env, "AUTH_SIGNER_SERVICE_SECRET");
  if (Buffer.byteLength(signerSecret) < 32)
    throw new Error("AUTH_SIGNER_SERVICE_SECRET is too short.");
  if (env.MODEL_PRICES_JSON && env.MODEL_POLICY_JSON) throw new Error("Choose MODEL_POLICY_JSON for refreshed pricing or MODEL_PRICES_JSON for a fixed observation, not both.");
  const modelPolicy = env.MODEL_POLICY_JSON ? validateModelPolicy(JSON.parse(env.MODEL_POLICY_JSON)) : null;
  const catalog = env.MODEL_PRICES_JSON
    ? validatePrices(JSON.parse(env.MODEL_PRICES_JSON))
    : null;
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    keyPepper,
    allowedOrigins,
    signerUrl: signerUrl.origin,
    signerSecret,
    catalog,
    modelPolicy,
    port: Number(env.PORT ?? 8080),
    secureCookies: env.NODE_ENV === "production",
    capacityMaxAgeMs: 30000,
    safetyMarginMicroUsd: 1000n,
    rpcUrl: env.BASE_RPC_URL,
    manifestPath: env.TELLIGENCE_MANIFEST_PATH,
    apiBaseUrl: required(env, "PUBLIC_API_BASE_URL"),
  };
}
