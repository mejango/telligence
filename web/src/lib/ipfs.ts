import { isIpfsCid, isIpfsUri } from "./ipfs-cid";
import { JBCENTER_IPFS_GATEWAY } from "./jbcenter-ipfs";

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]{1,128}$/u;

// This is an open gateway. It exposes any IPFS content, not just content we
// pin. It is the last fallback after the media cache and Pinata.
export const OPEN_IPFS_GATEWAY_HOSTNAME = "juicebox.center";

/**
 * Return a URL to our open IPFS gateway for the given cid (optionally with a
 * path). The 'open' gateway returns any content that is available on IPFS, not
 * just the content we have pinned.
 *
 * Kept local rather than using the SDK's `ipfsGatewayUrl`: the SDK only checks
 * that the leading segment looks like a CID, while these URLs also reach the
 * shared Juicebox Center gateway and the Next image optimizer, so every
 * segment has to clear `isSafeIpfsPath` (no traversal, bounded length/depth).
 */
const ipfsGatewayUrl = (cid: string): string => {
  if (!isSafeIpfsPath(cid)) throw new Error("Invalid IPFS CID or path");
  return `${JBCENTER_IPFS_GATEWAY}${cid}`;
};

/**
 * Return an IPFS URI using the IPFS URI scheme.
 */
export function ipfsUri(cid: string, path?: string) {
  const suffix = `${cid}${path ?? ""}`;
  if (!isSafeIpfsPath(suffix)) throw new Error("Invalid IPFS CID or path");
  return `ipfs://${suffix}`;
}

export const cidFromIpfsUri = (uri: string) =>
  isIpfsUri(uri) ? uri.slice("ipfs://".length) : undefined;

/**
 * Returns a native IPFS link (`ipfs://`) as a https link.
 */
export function ipfsUriToGatewayUrl(ipfsUri: string): string | undefined {
  // Project metadata is untrusted. Only content-addressed images may pass
  // through the server-side Next image optimizer; arbitrary HTTPS URLs would
  // turn it into a public fetch proxy.
  if (!ipfsUri.startsWith("ipfs://")) return undefined;
  const suffix = ipfsUri.slice("ipfs://".length);
  if (!isSafeIpfsPath(suffix)) return undefined;
  return suffix ? ipfsGatewayUrl(suffix) : undefined;
}

/**
 * Returns the Juicebox Center gateway URL for an untrusted, content-addressed
 * IPFS URI. Every path segment is validated before reaching the shared gateway.
 */
export function ipfsUriToAppUrl(ipfsUri: unknown): string | undefined {
  if (typeof ipfsUri !== "string" || !ipfsUri.startsWith("ipfs://")) return undefined;
  const suffix = ipfsUri.slice("ipfs://".length);
  if (!isSafeIpfsPath(suffix)) return undefined;
  return `${JBCENTER_IPFS_GATEWAY}${suffix}`;
}

/**
 * The canonical Juicebox Center read candidate for immutable media.
 */
export function ipfsMediaGatewayUrls(ipfsUri: unknown): string[] {
  if (typeof ipfsUri !== "string" || !ipfsUri.startsWith("ipfs://")) return [];
  const suffix = ipfsUri.slice("ipfs://".length);
  if (!isSafeIpfsPath(suffix)) return [];

  return [`${JBCENTER_IPFS_GATEWAY}${suffix}`];
}

function isSafeIpfsPath(value: string): boolean {
  const segments = value.split("/");
  if (segments.length < 1 || segments.length > 8 || !isIpfsCid(segments[0])) return false;
  if (
    segments
      .slice(1)
      .some((segment) => segment === "." || segment === ".." || !SAFE_PATH_SEGMENT.test(segment))
  ) {
    return false;
  }
  return value.length <= 512;
}
