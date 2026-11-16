"use client";

import { loadEngine, reviewedWalletAdapter } from "@/hooks/useReviewedAction";
import { requireNoViewAs } from "@/lib/view-as";
import { useCallback } from "react";
import { type Address, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";

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
  const signCreatorMessageAsync = useCallback(
    async (request: CreatorChallenge): Promise<Hex> => {
      requireNoViewAs();
      const { address, connector } = getAccount(config);
      if (!address) throw new Error("Connect a wallet first.");
      const challenge = { ...request };
      validateChallenge(challenge, address);
      const { signReviewed } = await loadEngine();
      const adapter = reviewedWalletAdapter(config, address, connector);
      // wallet-action:telligence-creator-signature
      const [signature] = await signReviewed(
        [{ kind: "message", chainId: CHAIN_ID, message: challenge.message }],
        {
          account: address,
          title: "Sign in to Telligence",
          description:
            "This signature creates a short session for managing your compute projects and API keys.",
          reverify: async () => {
            requireNoViewAs();
            validateChallenge(challenge, address);
          },
        },
        { adapter },
      );
      // A wallet prompt has no time bound: the wallet and the challenge are checked again.
      adapter.requireUnchanged();
      validateChallenge(challenge, address);
      return signature!;
    },
    [config],
  );
  return { signCreatorMessageAsync };
}
