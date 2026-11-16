"use client";

import { useEffect, useState } from "react";

const MAX_CONTENT_LENGTH = 50_000;

function toPlainParagraphs(source: string): string[] {
  return source
    .slice(0, MAX_CONTENT_LENGTH)
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/giu, "\n")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gmu, "")
    .replace(/(\*\*|__|\*|_|~~|`)/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&nbsp;/gu, " ")
    .split(/\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export const ProjectRichText = ({ className, source }: { className?: string; source: string }) => {
  const [sanitized, setSanitized] = useState<{
    source: string;
    html: string;
  } | null>(null);
  const sanitizedHtml = sanitized?.source === source ? sanitized.html : null;

  useEffect(() => {
    let live = true;
    void import("./html-sanitize").then(({ sanitizeProjectRichText }) => {
      if (live) setSanitized({ source, html: sanitizeProjectRichText(source) });
    });
    return () => {
      live = false;
    };
  }, [source]);

  if (sanitizedHtml === null) {
    return (
      <div id="rich-text" className={className}>
        {toPlainParagraphs(source).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    );
  }

  return (
    <div
      id="rich-text"
      className={className}
      // This is the single reviewed project-controlled HTML boundary.
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};
