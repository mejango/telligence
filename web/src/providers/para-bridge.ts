"use client";

import { markParaSession } from "./ParaAuthContext";

type ParaSessionModule = typeof import("./para-config");
type ParaSessionLoader = () => Promise<ParaSessionModule>;
type ParaConnector = { id: string };

let signingOut: Promise<void> | null = null;
let signOuts = 0;

/** One sign-out at a time, app-wide: a second call joins the one under way. */
export function signOutOnce(run: () => Promise<unknown>): Promise<void> {
  if (signingOut) return signingOut;
  signOuts += 1;
  signingOut = run()
    .then(() => undefined)
    .finally(() => {
      signingOut = null;
    });
  return signingOut;
}

/** Changes whenever a sign-out starts; a session check that saw another value is stale. */
export function signOutGeneration() {
  return signingOut ? -1 : signOuts;
}

const loadParaSession: ParaSessionLoader = () => import("./para-config");

type ConnectParaSessionOptions<TConnector extends ParaConnector> = {
  connectors: readonly TConnector[];
  connect: (connector: TConnector) => Promise<unknown>;
  load?: ParaSessionLoader;
  markSession?: (active: boolean) => void;
};

/**
 * Bridge a completed Para authentication into Wagmi without making Para a
 * second source of wallet state.
 */
export async function connectParaSession<TConnector extends ParaConnector>({
  connectors,
  connect,
  load = loadParaSession,
  markSession = markParaSession,
}: ConnectParaSessionOptions<TConnector>): Promise<boolean> {
  const generation = signOutGeneration();
  if (generation < 0) return false;
  const { getParaClient } = await load();
  const loggedIn = await getParaClient().isFullyLoggedIn();
  // A sign-out that started during the check makes its answer stale.
  if (!loggedIn || signOutGeneration() !== generation) return false;

  const para = connectors.find((connector) => connector.id === "para");
  if (!para) return false;

  await connect(para);
  markSession(true);
  return true;
}
