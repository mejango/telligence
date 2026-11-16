import "server-only";

import { ipfsMediaGatewayUrls } from "@/lib/ipfs";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { unstable_cache } from "next/cache";

const MAX_METADATA_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

export type IpfsProjectMetadata = { name?: unknown; logoUri?: unknown; projectTagline?: unknown };

export async function fetchIpfsMetadata(uri: string | null): Promise<IpfsProjectMetadata | null> {
  for (const url of ipfsMediaGatewayUrls(uri)) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      const body = await readBoundedBody(response.body, MAX_METADATA_BYTES);
      if (!body) continue;
      const value = JSON.parse(new TextDecoder().decode(body)) as unknown;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value as IpfsProjectMetadata;
      }
    } catch {
      // Try the next gateway.
    }
  }
  return null;
}

// The uri is content-addressed, so a hit never goes stale; the revalidate
// window only bounds how long a miss is remembered.
const cachedIpfsMetadata = unstable_cache(fetchIpfsMetadata, ["ipfs-project-metadata"], {
  revalidate: 600,
});

type IndexedNameRow = {
  name?: string | null;
  logoUri?: string | null;
  projectTagline?: string | null;
  metadataUri?: string | null;
};

/**
 * Bendystraw fetches project metadata once, when the uri is set; when its
 * gateway misses, the row indexes with no name or logo for good. Fill those
 * rows from the uri itself so a list never shows "Project #N" with a blank
 * logo for a project whose metadata resolves fine.
 */
export async function fillIndexedMetadata<T extends IndexedNameRow>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (row.name || row.logoUri || !row.metadataUri) return row;
      const metadata = await cachedIpfsMetadata(row.metadataUri).catch(() => null);
      if (!metadata) return row;
      return {
        ...row,
        name: typeof metadata.name === "string" ? metadata.name : row.name,
        logoUri: typeof metadata.logoUri === "string" ? metadata.logoUri : row.logoUri,
        projectTagline:
          typeof metadata.projectTagline === "string"
            ? metadata.projectTagline
            : row.projectTagline,
      };
    }),
  );
}
