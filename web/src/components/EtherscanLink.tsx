import { useChain, useJBChainId } from "@/lib/nana/project";
import { etherscanLink, formatEthAddress } from "@/lib/utils";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { twMerge } from "tailwind-merge";
import { Chain } from "viem";
import { ExternalLink } from "./ExternalLink";

const EtherscanLink: React.FC<
  React.PropsWithChildren<{
    value: string | undefined;
    className?: string;
    type?: "tx" | "address" | "token";
    truncateTo?: number;
    chain?: Chain;
  }>
> = ({ className, value, type = "address", truncateTo, chain, children }) => {
  // Inside a project page the link follows the project, not whichever chain the wallet is on.
  const projectChainId = useJBChainId();
  const connectedChain = useChain();
  const chainToLink = chain ?? JB_CHAINS[projectChainId as JBChainId]?.chain ?? connectedChain;
  if (!value) return null;

  const renderValue = truncateTo ? formatEthAddress(value, { truncateTo }) : value;

  return (
    <ExternalLink
      className={twMerge("hover:underline", className)}
      href={etherscanLink(value, {
        type,
        chain: chainToLink,
      })}
    >
      {children ?? renderValue}
    </ExternalLink>
  );
};

export default EtherscanLink;
