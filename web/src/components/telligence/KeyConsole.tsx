"use client";

import { WalletConnectButton } from "@/components/WalletButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreatorSession } from "@/hooks/useCreatorSession";
import { GatewayError, gatewayOrigin, gatewayRequest } from "@/lib/telligence/api";
import { requireNoViewAs } from "@/lib/view-as";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAccount } from "wagmi";

type ApiKey = {
  id: string;
  prefix: string;
  name: string;
  dailyLimitUsd: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

function activeKey(key: ApiKey): boolean {
  return !key.revokedAt && (!key.expiresAt || Date.parse(key.expiresAt) > Date.now());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "This request could not be completed. Try again.";
}

/** Changing the identity remounts all state so an old request cannot reveal a key. */
export function KeyConsole({ projectId }: { projectId: string }) {
  const auth = useCreatorSession();
  const { address } = useAccount();
  const matchesWallet = !!address && auth.session?.address.toLowerCase() === address.toLowerCase();
  const session =
    matchesWallet && auth.session && Date.parse(auth.session.expiresAt) > Date.now()
      ? auth.session
      : null;
  if (!session) {
    return (
      <section
        className="space-y-5 border border-melon-300 bg-melon-25 p-6"
        aria-label="API key access"
      >
        <div className="space-y-2">
          <h2 className="text-xl">Your project&apos;s API keys.</h2>
          <p className="max-w-xl text-sm text-zinc-600">
            Sign in with the project creator’s wallet to create and manage API keys. Each key spends
            from this project’s available compute.
          </p>
        </div>
        {address ? (
          <Button loading={auth.loading} onClick={() => void auth.authenticate()}>
            Sign in to manage keys
          </Button>
        ) : (
          <WalletConnectButton label="Connect wallet" />
        )}
        {auth.error ? (
          <p role="alert" className="text-sm text-red-700">
            {auth.error}
          </p>
        ) : null}
      </section>
    );
  }
  return (
    <AuthenticatedKeys
      key={`${projectId}:${session.address}:${session.csrfToken}`}
      projectId={projectId}
      csrfToken={session.csrfToken}
      onSessionExpired={auth.clearSession}
      onLogout={auth.logout}
    />
  );
}

function AuthenticatedKeys({
  projectId,
  csrfToken,
  onSessionExpired,
  onLogout,
}: {
  projectId: string;
  csrfToken: string;
  onSessionExpired: () => void;
  onLogout: () => Promise<void>;
}) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const displayedSecret =
    secret && keys.some((key) => key.id === secret.id && activeKey(key)) ? secret : null;

  useEffect(() => {
    const now = Date.now();
    const nextExpiry = Math.min(
      ...keys
        .filter((key) => !key.revokedAt && key.expiresAt)
        .map((key) => Date.parse(key.expiresAt!))
        .filter((expiry) => expiry > now),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => {
        setSecret((current) =>
          current && keys.some((key) => key.id === current.id && activeKey(key)) ? current : null,
        );
        // Re-evaluate labels and schedule the next key's expiration.
        setKeys((current) => [...current]);
      },
      Math.min(nextExpiry - now, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [keys]);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [expiry, setExpiry] = useState("");
  const mounted = useRef(true);
  const busy = useRef(false);
  const nameId = useId();
  const limitId = useId();
  const expiryId = useId();
  const endpointId = useId();
  const endpoint = `${gatewayOrigin()}/api/v1`;
  const path = `/v1/projects/${encodeURIComponent(projectId)}/keys`;
  const numericLimit = Number(limit);
  const validExpiry =
    !expiry || (Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now());
  const canCreate =
    name.trim().length > 0 &&
    name.trim().length <= 80 &&
    /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(limit) &&
    numericLimit > 0 &&
    validExpiry &&
    !pending &&
    !loading &&
    !loadError;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reportError = useCallback(
    (failure: unknown, setter: (value: string | null) => void) => {
      if (!mounted.current) return;
      if (failure instanceof GatewayError && failure.status === 401) onSessionExpired();
      setter(errorMessage(failure));
    },
    [onSessionExpired],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await gatewayRequest<{ keys: ApiKey[] }>(path, { signal });
        if (mounted.current && !signal?.aborted) setKeys(response.keys);
      } catch (failure) {
        if (!signal?.aborted) reportError(failure, setLoadError);
      } finally {
        if (mounted.current && !signal?.aborted) setLoading(false);
      }
    },
    [path, reportError],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function createKey() {
    if (!canCreate || busy.current) return;
    busy.current = true;
    setPending("create");
    setError(null);
    setSecret(null);
    setCopied(false);
    try {
      requireNoViewAs();
      const created = await gatewayRequest<{ key: ApiKey; secret: string }>(path, {
        method: "POST",
        csrfToken,
        body: {
          name: name.trim(),
          dailyLimitUsd: limit,
          ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {}),
        },
      });
      if (!mounted.current) return;
      setKeys((existing) => [created.key, ...existing]);
      setSecret({ id: created.key.id, value: created.secret });
      setName("");
    } catch (failure) {
      reportError(failure, setError);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  async function revokeKey(key: ApiKey) {
    if (busy.current) return;
    busy.current = true;
    setPending(key.id);
    setError(null);
    try {
      requireNoViewAs();
      await gatewayRequest(`${path}/${encodeURIComponent(key.id)}`, {
        method: "DELETE",
        csrfToken,
      });
      if (!mounted.current) return;
      setKeys((existing) =>
        existing.map((item) =>
          item.id === key.id ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
      setSecret((current) => (current?.id === key.id ? null : current));
    } catch (failure) {
      reportError(failure, setError);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  async function copySecret() {
    if (!secret || !keys.some((key) => key.id === secret.id && activeKey(key))) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      if (mounted.current) setCopied(true);
    } catch {
      if (mounted.current)
        setError("Copying is unavailable. Select the API key and copy it manually.");
    }
  }

  return (
    <div className="space-y-8">
      <section
        className="space-y-5 border border-melon-300 bg-melon-25 p-6"
        aria-label="Create an API key"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="text-xl">A key to your compute.</h2>
            <p className="max-w-xl text-sm text-zinc-600">
              Give each application its own key and daily limit. All keys share this project’s
              available compute; a limit does not reserve capacity.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void onLogout()}>
            Sign out
          </Button>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createKey();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={nameId}>Key name</Label>
              <Input
                id={nameId}
                value={name}
                maxLength={80}
                autoComplete="off"
                placeholder="Production"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={limitId}>Daily limit (USD)</Label>
              <Input
                id={limitId}
                value={limit}
                type="number"
                min="0.000001"
                step="any"
                inputMode="decimal"
                placeholder="5.00"
                onChange={(event) => setLimit(event.target.value)}
              />
            </div>
          </div>
          <div className="max-w-sm space-y-2">
            <Label htmlFor={expiryId}>Expires at (optional)</Label>
            <Input
              id={expiryId}
              value={expiry}
              type="datetime-local"
              onChange={(event) => setExpiry(event.target.value)}
            />
            <p className="text-xs text-zinc-500">
              Uses your local time. Leave empty to keep the key active until revoked.
            </p>
          </div>
          <Button type="submit" disabled={!canCreate} loading={pending === "create"}>
            Create API key
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>

      {displayedSecret ? (
        <section
          aria-label="New API key"
          className="space-y-3 border-2 border-melon-500 bg-melon-100 p-6"
        >
          <h3 className="text-lg">Save this key now.</h3>
          <p className="text-sm">
            This is the only time it will be shown. Keep it on your server; anyone with this key can
            use its compute allowance.
          </p>
          <Input
            aria-label="New API key"
            readOnly
            value={displayedSecret.value}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copySecret()} aria-label="Copy API key">
              {copied ? "Copied" : "Copy API key"}
            </Button>
            <Button variant="outline" onClick={() => setSecret(null)}>
              I’ve saved my key
            </Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-4" aria-label="Project API keys">
        <h2 className="text-lg">Project keys</h2>
        {loading ? (
          <p role="status" className="text-sm text-zinc-500">
            Loading API keys…
          </p>
        ) : loadError ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-700">
              {loadError}
            </p>
            <Button variant="outline" onClick={() => void load()}>
              Retry loading keys
            </Button>
          </div>
        ) : !keys.length ? (
          <p className="border border-dashed border-melon-300 p-6 text-sm text-zinc-500">
            No API keys yet.
          </p>
        ) : (
          <ul className="divide-y divide-melon-200 border-y border-melon-200">
            {keys.map((key) => {
              const expired = !!key.expiresAt && Date.parse(key.expiresAt) <= Date.now();
              return (
                <li key={key.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <div className="space-y-1">
                    <p>{key.name}</p>
                    <p className="font-mono text-xs text-zinc-500">{key.prefix}…</p>
                    <p className="text-xs text-zinc-600">
                      $
                      {Number(key.dailyLimitUsd).toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}{" "}
                      / day
                      {key.expiresAt
                        ? ` · Expires ${new Date(key.expiresAt).toLocaleString()}`
                        : " · No expiration"}
                    </p>
                  </div>
                  {key.revokedAt ? (
                    <span className="text-sm text-zinc-500">Revoked</span>
                  ) : expired ? (
                    <span className="text-sm text-zinc-500">Expired</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Revoke ${key.name}`}
                      disabled={!!pending}
                      loading={pending === key.id}
                      onClick={() => void revokeKey(key)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 border-t border-melon-200 pt-6" aria-label="Use your API key">
        <h2 className="text-lg">Plug into your application.</h2>
        <p className="text-sm text-zinc-600">
          Use your key as the bearer token with an OpenAI-compatible client. Requests stop when the
          key’s limit or the project’s available compute is reached.
        </p>
        <Label htmlFor={endpointId}>API base URL</Label>
        <Input
          id={endpointId}
          value={
            endpoint.startsWith("/") && typeof window !== "undefined"
              ? `${window.location.origin}${endpoint}`
              : endpoint
          }
          readOnly
          className="font-mono"
        />
        <p className="text-xs text-zinc-500">
          Keys grant compute access. They cannot move project funds.
        </p>
      </section>
    </div>
  );
}
