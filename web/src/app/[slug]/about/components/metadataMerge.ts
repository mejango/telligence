import { isRecord } from "@/lib/formValidation";
import type { JBProjectMetadata } from "@bananapus/nana-sdk-core";

/**
 * Keys the edit-metadata form recognizes. `version` has no editable control,
 * but is retained outside the custom-properties section.
 */
const EDITOR_MANAGED_KEYS = [
  "name",
  "description",
  "logoUri",
  "twitter",
  "telegram",
  "discord",
  "infoUri",
  "farcaster",
  "payDisclosure",
  "version",
] as const;

const OPTIONAL_TEXT_KEYS = [
  "twitter",
  "telegram",
  "discord",
  "infoUri",
  "farcaster",
  "payDisclosure",
] as const;

function isManagedKey(key: string): boolean {
  return (EDITOR_MANAGED_KEYS as readonly string[]).includes(key);
}

export type EditableMetadataValues = {
  name: string;
  description: string;
  logoUri?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  infoUri?: string;
  farcaster?: string;
  payDisclosure?: string;
};

function metadataText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** JSON object ordering is irrelevant; array ordering and value types are not. */
function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]))
  );
}

/**
 * Apply only edits made relative to the metadata that initially filled the form.
 * Each destination retains its current values for fields the user did not edit.
 * Custom properties are compared per top-level key, with structural JSON equality:
 * an edited key replaces that key, and removing a baseline key deletes it on every
 * destination. Keys absent from the baseline and editor remain destination-specific.
 */
export function applyMetadataEdits(
  current: unknown,
  baseline: unknown,
  values: EditableMetadataValues,
  customProperties?: Record<string, unknown>,
): JBProjectMetadata & Record<string, unknown> {
  const merged: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  const initial = isRecord(baseline) ? baseline : {};

  for (const key of ["name", "description"] as const) {
    if (values[key] !== metadataText(initial[key])) merged[key] = values[key];
  }

  // The form cannot clear the logo; blank means no new upload.
  const logoUri = values.logoUri?.trim();
  if (logoUri && logoUri !== metadataText(initial.logoUri).trim()) merged.logoUri = logoUri;

  for (const key of OPTIONAL_TEXT_KEYS) {
    const value = values[key]?.trim() ?? "";
    if (value === metadataText(initial[key]).trim()) continue;
    if (value) merged[key] = value;
    else delete merged[key];
  }

  const customEdits: Array<[string, unknown]> = [];
  if (customProperties !== undefined) {
    for (const key of otherMetadataKeys(initial)) {
      if (!Object.hasOwn(customProperties, key)) delete merged[key];
    }
    for (const [key, value] of Object.entries(customProperties)) {
      if (isManagedKey(key)) continue;
      if (!Object.hasOwn(initial, key) || !equalJson(value, initial[key])) {
        customEdits.push([key, value]);
      }
    }
  }

  return { ...merged, ...Object.fromEntries(customEdits) } as JBProjectMetadata &
    Record<string, unknown>;
}

/**
 * Merge edited form values on top of the project's CURRENT metadata JSON.
 *
 * The current metadata is spread first so unknown/custom keys (e.g. a custom
 * `leagueID`, `tags`, `payButton`, nested objects) survive an edit that only
 * touches the fields this form knows about. Optional text fields the user
 * cleared are removed rather than written back as empty strings.
 *
 * `customProperties` is the parsed advanced JSON editor. When it is undefined
 * the editor was never loaded/touched and every unmanaged key is preserved.
 * When it is defined it REPLACES the unmanaged key set, so removing a key from
 * the JSON deletes it. Managed keys inside it are ignored; the form wins.
 */
export function mergeProjectMetadata(
  current: unknown,
  values: EditableMetadataValues,
  customProperties?: Record<string, unknown>,
): JBProjectMetadata & Record<string, unknown> {
  const merged: Record<string, unknown> = isRecord(current) ? { ...current } : {};

  if (customProperties) {
    for (const key of Object.keys(merged)) {
      if (!isManagedKey(key)) delete merged[key];
    }
    for (const [key, value] of Object.entries(customProperties)) {
      if (isManagedKey(key)) continue;
      merged[key] = value;
    }
  }

  merged.name = values.name;
  merged.description = values.description;

  // Keep the existing logo unless a new one was uploaded.
  const logoUri = values.logoUri?.trim();
  if (logoUri) merged.logoUri = logoUri;

  for (const key of OPTIONAL_TEXT_KEYS) {
    const value = values[key]?.trim();
    if (value) {
      merged[key] = value;
    } else {
      delete merged[key];
    }
  }

  return merged as JBProjectMetadata & Record<string, unknown>;
}

/**
 * Keys present on the current metadata that the edit form does not manage.
 * Surfaced read-only in the dialog so users know they are preserved.
 */
export function otherMetadataKeys(current: unknown): string[] {
  if (!isRecord(current)) return [];
  return Object.keys(current).filter((key) => !isManagedKey(key));
}

/**
 * The current metadata's unmanaged keys as pretty-printed JSON, ready to
 * prefill the advanced custom-properties editor. Blank when there are none.
 */
export function formatCustomProperties(current: unknown): string {
  if (!isRecord(current)) return "";
  const custom: Record<string, unknown> = {};
  for (const key of otherMetadataKeys(current)) {
    custom[key] = current[key];
  }
  if (Object.keys(custom).length === 0) return "";
  return JSON.stringify(custom, null, 2);
}

export type CustomPropertiesParse =
  { error: string; ok: false } | { ok: true; value: Record<string, unknown> };

/**
 * Parse the advanced editor's text. Blank text means "no custom properties",
 * which is distinct from never having loaded the editor at all.
 */
export function parseCustomProperties(text: string): CustomPropertiesParse {
  if (text.trim().length === 0) return { ok: true, value: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, ok: false };
  }

  if (!isRecord(parsed)) {
    return { error: "Custom properties must be a JSON object", ok: false };
  }

  return { ok: true, value: parsed };
}

/**
 * Custom-property keys the form itself manages. These are dropped on save so
 * the form fields stay authoritative; the dialog notes them to the user.
 */
export function customPropertyCollisions(value: Record<string, unknown> | undefined): string[] {
  if (!value) return [];
  return Object.keys(value).filter(isManagedKey);
}
