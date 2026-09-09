import "server-only";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
// This single private service name is also the local Compose network alias.
// It cannot be broadened to other Railway services or caller-supplied targets.
const PRIVATE_GATEWAY_HOST = "gateway.railway.internal";

function validatedOrigin(value: string | undefined, privateGateway: boolean) {
  if (!value) throw new Error("The compute service origin is not configured.");
  const url = new URL(value);
  if (
    (value !== url.origin && value !== `${url.origin}/`) ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (LOOPBACK_HOSTS.includes(url.hostname) ||
          (privateGateway && url.hostname === PRIVATE_GATEWAY_HOST))
      ))
  )
    throw new Error("The compute service origin is invalid.");
  return url.origin;
}

/** Only a server-owned origin can choose a gateway host. Normalization is not validation. */
export function validatedGatewayOrigin(value = process.env.TELLIGENCE_GATEWAY_URL) {
  return validatedOrigin(value, true);
}

/** Browser authentication is bound to the configured public origin, never a proxy Host header. */
export function validatedSiteOrigin(value = process.env.NEXT_PUBLIC_SITE_URL) {
  return validatedOrigin(value, false);
}
