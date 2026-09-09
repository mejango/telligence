const MAX_DATA_IMAGE_URL_LENGTH = 1_000_000;
const SAFE_RASTER_DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/u;
const SVG_DATA_IMAGE_PREFIX = "data:image/svg+xml,";
const UNSAFE_SVG =
  /<(?:script|foreignObject|iframe|object|embed|image|use|style)\b|(?:on[a-z]+|href|src)\s*=|url\s*\(|@import|<!doctype|<\?xml-stylesheet/iu;

/**
 * Accept a bounded inline image from project metadata without allowing an
 * arbitrary network URL. SVGs are restricted to inert, self-contained shape
 * and text markup before they can enter an <img>.
 */
export function safeDataImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DATA_IMAGE_URL_LENGTH) {
    return undefined;
  }
  if (SAFE_RASTER_DATA_IMAGE.test(value)) return value;
  if (!value.startsWith(SVG_DATA_IMAGE_PREFIX)) return undefined;

  try {
    const svg = decodeURIComponent(value.slice(SVG_DATA_IMAGE_PREFIX.length));
    if (
      svg.length === 0 ||
      svg.length > 256_000 ||
      !/^\s*<svg(?:\s|>)/iu.test(svg) ||
      UNSAFE_SVG.test(svg)
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

export function decodeSafeDataImage(
  value: unknown,
): { bytes: Uint8Array; contentType: string } | undefined {
  const safe = safeDataImageUrl(value);
  if (!safe) return undefined;

  const comma = safe.indexOf(",");
  const header = safe.slice(5, comma);
  const payload = safe.slice(comma + 1);
  const contentType = header.split(";", 1)[0].toLowerCase();
  try {
    if (header.endsWith(";base64")) {
      const decoded = atob(payload);
      return {
        bytes: Uint8Array.from(decoded, (character) => character.charCodeAt(0)),
        contentType,
      };
    }
    return {
      bytes: new TextEncoder().encode(decodeURIComponent(payload)),
      contentType,
    };
  } catch {
    return undefined;
  }
}
