"use client";

import { ipfsUriToAppUrl } from "@/lib/ipfs";
import { safeDataImageUrl } from "@/lib/safe-data-image";
import type { ImgHTMLAttributes, ReactNode } from "react";
import { useState } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "onError" | "src"> & {
  alt: string;
  fallback: ReactNode;
  src: string | null | undefined;
};

export function ImageWithFallback({ alt, fallback, src, ...props }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return fallback;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={src}
      alt={alt}
      decoding={props.decoding ?? (props.loading === "eager" ? "sync" : "async")}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
    />
  );
}

/**
 * Render only CID-validated IPFS media, without involving Next's image
 * optimizer. Juicebox Center owns the shared gateway boundary; a failed
 * browser load becomes an intentional UI fallback rather than a broken icon.
 */
export function IpfsImage({ alt, fallback, src, ...props }: Props) {
  const inlineSrc = safeDataImageUrl(src);
  const centerSrc = ipfsUriToAppUrl(src);
  const candidates = [inlineSrc, centerSrc].filter((url): url is string => !!url);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const safeSrc = candidates.find((candidate) => !failedSources.includes(candidate));

  if (!safeSrc) return fallback;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={safeSrc}
      alt={alt}
      decoding={props.decoding ?? (props.loading === "eager" ? "sync" : "async")}
      referrerPolicy="no-referrer"
      onError={() => setFailedSources((failed) => [...failed, safeSrc])}
    />
  );
}
