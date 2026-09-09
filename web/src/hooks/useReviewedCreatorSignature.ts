"use client";

import { requireTransactionReview } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { useCallback } from "react";
import { type Address, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { useConfig, useSwitchChain } from "wagmi";
import { getAccount, getWalletClient } from "wagmi/actions";

export type CreatorChallenge = { challengeId: string; message: string; expiresAt: string };
const STATEMENT = "Sign in to Telligence to manage your compute projects.";
const CHAIN_ID = 8453;

/** Refuse arbitrary personal_sign payloads, even when supplied by the gateway. */
function validateChallenge(challenge: CreatorChallenge, address: Address): void {
  const invalid = () =>
    new Error(
      "The sign-in message does not match this site, wallet, or Base session. Request a new message.",
    );
  try {
    const message = parseSiweMessage(challenge.message);
    const now = Date.now();
    if (
      message.address?.toLowerCase() !== address.toLowerCase() ||
      message.domain !== window.location.host ||
      message.uri !== window.location.origin ||
      message.chainId !== CHAIN_ID ||
      message.version !== "1" ||
      message.statement !== STATEMENT ||
      !message.nonce ||
      !/^[a-zA-Z0-9]{8,128}$/.test(message.nonce) ||
      !message.issuedAt ||
      !message.expirationTime ||
      message.issuedAt.getTime() > now + 30_000 ||
      message.expirationTime.getTime() <= now ||
      message.expirationTime.getTime() - message.issuedAt.getTime() > 300_000 ||
      message.expirationTime.getTime() !== Date.parse(challenge.expiresAt) ||
      message.requestId ||
      message.notBefore ||
      message.scheme ||
      message.resources?.length
    )
      throw invalid();
    const canonical = createSiweMessage({
      address: message.address,
      chainId: CHAIN_ID,
      domain: window.location.host,
      uri: window.location.origin,
      statement: STATEMENT,
      version: "1",
      nonce: message.nonce,
      issuedAt: message.issuedAt,
      expirationTime: message.expirationTime,
    });
    if (challenge.message !== canonical) throw invalid();
  } catch {
    throw invalid();
  }
}

export function useReviewedCreatorSignature() {
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const signCreatorMessageAsync = useCallback(
    async (request: CreatorChallenge): Promise<Hex> => {
      requireNoViewAs();
      const before = getAccount(config);
      if (!before.address) throw new Error("Connect a wallet first.");
      const address = before.address;
      const challenge = { ...request };
      validateChallenge(challenge, address);
      await requireTransactionReview({
        kind: "authorization",
        calls: [],
        title: "Sign in to Telligence",
        description:
          "This signature creates a short session for managing your compute projects and API keys.",
        confirmLabel: "Agree & sign in",
        authorization: {
          type: "EIP-4361 Sign-In with Ethereum",
          chainId: CHAIN_ID,
          address,
          message: challenge.message,
        },
      });
      await switchChainAsync({ chainId: CHAIN_ID });
      const verifyAccount = () => {
        requireNoViewAs();
        const current = getAccount(config);
        if (
          current.address?.toLowerCase() !== address.toLowerCase() ||
          current.chainId !== CHAIN_ID
        ) {
          throw new Error("Connected account or network changed. Sign in again.");
        }
        validateChallenge(challenge, address);
      };
      verifyAccount();
      const wallet = await getWalletClient(config, { chainId: CHAIN_ID, account: address });
      if (wallet.account?.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Connected account or network changed. Sign in again.");
      }
      verifyAccount();
      const signature = await wallet.signMessage({
        account: wallet.account,
        message: challenge.message,
      });
      verifyAccount();
      return signature;
    },
    [config, switchChainAsync],
  );
  return { signCreatorMessageAsync };
}
