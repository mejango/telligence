const BUILD_VALUES = {
  NEXT_PUBLIC_SITE_URL: "url",
  NEXT_PUBLIC_BENDYSTRAW_URL: "url",
  NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL: "url",
  NEXT_PUBLIC_PARA_API_KEY: "para-key",
  NEXT_PUBLIC_PARA_ENV: "para-env",
  NEXT_PUBLIC_VERSION: "revision",
};

const PRODUCTION_SITE_ORIGINS = new Set([
  "https://revnet.money",
  "https://telligence.money",
  "https://www.telligence.money",
]);

function validUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function validate(name, kind) {
  const value = process.env[name]?.trim();
  if (!value) return `${name} is required`;

  if (kind === "url" && !validUrl(value)) {
    return `${name} must use HTTPS (HTTP is allowed only for loopback development)`;
  }
  if (kind === "para-key" && value.length < 8) {
    return `${name} must be at least 8 characters`;
  }
  if (kind === "revision" && value.length < 7) {
    return `${name} must be at least 7 characters`;
  }
  if (kind === "para-env" && !["DEV", "SANDBOX", "BETA", "PROD"].includes(value)) {
    return `${name} must be DEV, SANDBOX, BETA, or PROD`;
  }
  return null;
}

const phase = process.argv[2];
if (phase !== "build" && phase !== "runtime") {
  console.error("Usage: node scripts/validate-env.mjs <build|runtime>");
  process.exit(2);
}

const specification = phase === "build" ? BUILD_VALUES : {};
const entries = Object.entries(specification);
const errors = entries.map(([name, kind]) => validate(name, kind)).filter(Boolean);
if (phase === "build" && process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER === "true") {
  errors.push("NEXT_PUBLIC_DETERMINISTIC_BROWSER cannot be enabled in a deployment build");
}
if (phase === "build") {
  const factory = process.env.NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS?.trim();
  if (factory && (!/^0x[0-9a-fA-F]{40}$/.test(factory) || /^0x0{40}$/.test(factory))) {
    errors.push("NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS must be a nonzero Base factory address");
  }
  try {
    const siteOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").origin;
    if (PRODUCTION_SITE_ORIGINS.has(siteOrigin) && process.env.NEXT_PUBLIC_PARA_ENV !== "PROD") {
      errors.push("NEXT_PUBLIC_PARA_ENV must be PROD for a production site origin");
    }
  } catch {
    // The ordinary URL validator above reports the malformed or absent value.
  }
}

if (errors.length) {
  console.error(`Invalid ${phase}-time environment:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Validated ${entries.length} ${phase}-time environment values.`);
