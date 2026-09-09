import { chainDisplayName } from "@/app/constants";
import { toast } from "@/components/ui/use-toast";
import { useJBChainId } from "@/lib/nana/project";
import { JBChainId } from "@bananapus/nana-sdk-core";
import React from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { WalletConnectButton } from "./WalletButton";
import { Button, ButtonProps } from "./ui/button";

const ButtonWithWallet = React.forwardRef<
  HTMLButtonElement,
  {
    connectWalletText?: string;
    targetChainId?: JBChainId;
    children: React.ReactNode;
    /** Kept for callers; the label is always the children now. */
    forceChildren?: boolean;
  } & ButtonProps
>(
  (
    { children, connectWalletText, targetChainId, forceChildren: _forceChildren, ...props },
    ref,
  ) => {
    const jbChainId = useJBChainId();
    const userChainId = useChainId();
    const { isConnected } = useAccount();
    const { switchChainAsync, isPending } = useSwitchChain();

    const _targetChainId = targetChainId || jbChainId;

    if (!isConnected) {
      return (
        <WalletConnectButton
          {...props}
          onClick={undefined}
          label={connectWalletText ?? "Connect Wallet"}
        />
      );
    }

    // A wallet parked on another chain is switched on click, behind the same
    // label — the user asked to act, not to manage networks. A connector that
    // cannot switch (a Safe app) gets told what to do instead of a dead button.
    if (typeof _targetChainId !== "undefined" && userChainId !== _targetChainId) {
      return (
        <Button
          {...props}
          onClick={async (e) => {
            e.preventDefault();
            try {
              await switchChainAsync({ chainId: _targetChainId });
            } catch {
              toast({
                variant: "destructive",
                title: `Switch your wallet to ${chainDisplayName(_targetChainId)} to continue.`,
              });
              return;
            }
            props.onClick?.(e);
          }}
          loading={isPending || props.loading}
        >
          {children}
        </Button>
      );
    }

    return (
      <Button ref={ref} {...props}>
        {children}
      </Button>
    );
  },
);

ButtonWithWallet.displayName = "ButtonWithWallet";

export { ButtonWithWallet };
