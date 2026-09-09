"use client";

import {
  useReviewedCreatorSignature,
  type CreatorChallenge,
} from "@/hooks/useReviewedCreatorSignature";
import { GatewayError, gatewayRequest } from "@/lib/telligence/api";
import { requireNoViewAs } from "@/lib/view-as";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";

export type CreatorSession = { address: Address; expiresAt: string; csrfToken: string };
function validSession(value: CreatorSession, address: string): boolean {
  return (
    typeof value?.address === "string" &&
    isAddress(value.address) &&
    value.address.toLowerCase() === address.toLowerCase() &&
    typeof value.csrfToken === "string" &&
    value.csrfToken.length > 0 &&
    Number.isFinite(Date.parse(value.expiresAt)) &&
    Date.parse(value.expiresAt) > Date.now()
  );
}

/** Session cookies are HttpOnly. Only the CSRF token lives in React memory. */
export function useCreatorSession() {
  const { address } = useAccount();
  const config = useConfig();
  const { signCreatorMessageAsync } = useReviewedCreatorSignature();
  const [storedSession, setStoredSession] = useState<CreatorSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(0);
  const authenticating = useRef(false);
  const normalized = address?.toLowerCase();
  const session =
    normalized && storedSession && validSession(storedSession, normalized) ? storedSession : null;

  const clearSession = useCallback(() => {
    operation.current += 1;
    setStoredSession(null);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const current = ++operation.current;
    const controller = new AbortController();
    // The displayed session is derived from the connected wallet immediately;
    // the asynchronous restore can only populate this identity's session.
    if (!normalized)
      return () => {
        controller.abort();
        operation.current += 1;
      };
    void (async () => {
      setLoading(true);
      setError(null);
      setStoredSession(null);
      try {
        const restored = await gatewayRequest<CreatorSession>("/v1/auth/session", {
          signal: controller.signal,
        });
        if (operation.current === current && !controller.signal.aborted)
          setStoredSession(validSession(restored, normalized) ? restored : null);
      } catch (failure) {
        if (operation.current !== current || controller.signal.aborted) return;
        setStoredSession(null);
        if (!(failure instanceof GatewayError && failure.status === 401))
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not restore your session. Sign in again.",
          );
      } finally {
        if (operation.current === current && !controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      operation.current += 1;
    };
  }, [normalized]);

  useEffect(() => {
    if (!session) return;
    const timeout = window.setTimeout(
      clearSession,
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [session, clearSession]);

  const authenticate = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    const current = ++operation.current;
    setLoading(true);
    setError(null);
    setStoredSession(null);
    try {
      requireNoViewAs();
      const before = getAccount(config);
      if (!before.address) throw new Error("Connect a wallet first.");
      const signer = before.address;
      const verifyAccount = () => {
        if (
          current !== operation.current ||
          getAccount(config).address?.toLowerCase() !== signer.toLowerCase()
        )
          throw new Error("Connected account changed. Sign in again.");
        requireNoViewAs();
      };
      const challenge = await gatewayRequest<CreatorChallenge>("/v1/auth/challenge", {
        method: "POST",
        body: { address: signer },
      });
      verifyAccount();
      const signature = await signCreatorMessageAsync(challenge);
      verifyAccount();
      const verified = await gatewayRequest<CreatorSession>("/v1/auth/verify", {
        method: "POST",
        body: { challengeId: challenge.challengeId, signature },
      });
      verifyAccount();
      if (!validSession(verified, signer))
        throw new Error("The session does not match your wallet or has expired. Sign in again.");
      setStoredSession(verified);
    } catch (failure) {
      if (current === operation.current)
        setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
    } finally {
      authenticating.current = false;
      if (current === operation.current) setLoading(false);
    }
  }, [config, signCreatorMessageAsync]);

  const logout = useCallback(async () => {
    const csrfToken = session?.csrfToken;
    clearSession();
    if (!csrfToken) return;
    try {
      await gatewayRequest("/v1/auth/logout", { method: "POST", csrfToken });
    } catch {
      setError(
        "Signed out here, but the server session could not be closed. Close this browser session or retry signing out when the service returns.",
      );
    }
  }, [session, clearSession]);

  return { session, authenticate, loading, error, logout, clearSession };
}
