import { chainDisplayName, chainIdToLogo } from "@/app/constants";
import type { JBChainId } from "@/lib/nana/types";
import Image from "next/image";

type ImageProps = React.ComponentProps<typeof Image>;

type Props = {
  chainId: JBChainId;
  /**
   * Set only where the mark is the sole chain signal — a bare table cell, an
   * icon-only link, a stack of marks. Beside a visible chain name the mark is
   * decorative, and naming it too would announce the chain twice.
   */
  standalone?: boolean;
} & Omit<ImageProps, "src" | "alt" | "title">;

export const ChainLogo = (props: Props) => {
  const { chainId, width, height, style, standalone, ...rest } = props;
  const chainName = chainDisplayName(chainId);
  const src = chainIdToLogo[chainId];
  const displayWidth = width ?? 20;
  const displayHeight = height ?? 20;
  const isArbitrum = src.endsWith("/arbitrum.svg");

  return (
    <Image
      {...rest}
      src={src}
      alt={standalone ? chainName : ""}
      aria-hidden={standalone ? undefined : "true"}
      width={isArbitrum ? 374 : 1}
      height={isArbitrum ? 422 : 1}
      style={{
        width: displayWidth,
        height: "auto",
        minWidth: displayWidth,
        minHeight: displayHeight,
        flexShrink: 0,
        ...style,
      }}
    />
  );
};
