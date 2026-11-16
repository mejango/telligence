import { parseRevnetDraft } from "@/lib/revnet-draft";
import { DEFAULT_FORM_DATA, PERMANENTLY_DISABLED_OPERATOR } from "../constants";
import type { RevnetFormData } from "../types";

const STORAGE_KEY = "revnet:create-draft:v1";

export type BrowserDraft = {
  values: RevnetFormData;
  savedAt: number;
  /** Files stay in the tab, so items that held one come back without their media. */
  mediaMissing: boolean;
};

/** The form minus what it fills in by itself on opening: a default chain and its unset operator. */
const authored = (values: RevnetFormData) =>
  JSON.stringify({
    ...values,
    chainIds: [],
    operator: values.operator.filter(
      (entry) => entry.address.trim().toLowerCase() !== PERMANENTLY_DISABLED_OPERATOR,
    ),
  });

export function saveBrowserDraft(values: RevnetFormData): void {
  if (authored(values) === authored(DEFAULT_FORM_DATA)) {
    clearBrowserDraft();
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, app: "revnet.money", savedAt: Date.now(), data: values }),
    );
  } catch {
    // Storage refused: the form still works, it just won't come back after a reload.
  }
}

/** The draft saved in this browser, through the same whitelist as an imported file. */
export function readBrowserDraft(): BrowserDraft | undefined {
  try {
    const source = window.localStorage.getItem(STORAGE_KEY);
    if (!source) return undefined;
    const saved = JSON.parse(source) as {
      savedAt?: unknown;
      data?: { store?: { items?: { mediaFile?: unknown }[] } };
    };
    return {
      values: parseRevnetDraft(source),
      savedAt: Number(saved.savedAt) || 0,
      mediaMissing: (saved.data?.store?.items ?? []).some((item) => item?.mediaFile),
    };
  } catch {
    return undefined;
  }
}

export function clearBrowserDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing kept.
  }
}
