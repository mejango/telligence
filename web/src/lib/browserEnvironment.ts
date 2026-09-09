export const IS_DETERMINISTIC_BROWSER = process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER === "true";

const PARA_ENVIRONMENTS = new Set(["DEV", "SANDBOX", "BETA", "PROD"]);

export const PARA_EMBEDDED_WALLET_ENABLED =
  !IS_DETERMINISTIC_BROWSER &&
  (process.env.NEXT_PUBLIC_PARA_API_KEY?.trim().length ?? 0) >= 8 &&
  PARA_ENVIRONMENTS.has(process.env.NEXT_PUBLIC_PARA_ENV ?? "");
