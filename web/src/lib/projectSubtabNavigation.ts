/** Client-only view changes preserve unrelated filters and hash deep links. */
export function projectViewHref(currentHref: string, parameter: "subtab" | "range", value: string) {
  const url = new URL(currentHref);
  url.searchParams.set(parameter, value);
  return url.href;
}

/** Only a positively verified change of alias binding replaces the document. */
export function replaceProjectDocument(href: string) {
  window.location.replace(href);
}
