import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The layout loads the write-resume machinery only for a visitor whose transaction journal has
// rows; it still resumes once per page load, as it did when it was eager.
const journal = vi.hoisted(() => ({
  rows: [] as { id: string }[],
  listeners: new Set<() => void>(),
  set(rows: { id: string }[]) {
    journal.rows = rows;
    journal.listeners.forEach((listener) => listener());
  },
}));
const resume = vi.hoisted(() => ({ relayr: vi.fn(), safe: vi.fn(), followers: vi.fn() }));

vi.mock("@/lib/transaction-activity", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    transactionActivitySnapshot: () => journal.rows,
    useTransactionActivities: () =>
      useSyncExternalStore(
        (listener) => {
          journal.listeners.add(listener);
          return () => journal.listeners.delete(listener);
        },
        () => journal.rows,
        () => [],
      ),
  };
});
vi.mock("@/hooks/useReviewedRelayr", () => ({ resumePendingRelayrBundles: resume.relayr }));
vi.mock("@/lib/held-rows", () => ({ resumeSafeProposalTracking: resume.safe }));
vi.mock("@/components/HeldRowFollowers", () => ({
  HeldRowFollowers: () => {
    resume.followers();
    return <span data-followers />;
  },
}));
vi.mock("@/lib/browserEnvironment", () => ({
  IS_DETERMINISTIC_BROWSER: false,
  PARA_EMBEDDED_WALLET_ENABLED: false,
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false }),
  useConnect: () => ({ connectAsync: vi.fn() }),
  useConnectors: () => [],
  WagmiProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: { wagmi: true } }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/query-persist", () => ({ installQueryPersistence: () => undefined }));
vi.mock("@/lib/safe-connector", () => ({ watchSafeWalletPeer: () => undefined }));
vi.mock("@/components/TransactionReviewProvider", () => ({
  TransactionReviewProvider: ({ children }: { children: ReactNode }) => children,
}));

import { AppSpecificProviders } from "@/app/AppSpecificProviders";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  journal.rows = [];
  resume.relayr.mockReset();
  resume.safe.mockReset();
  resume.followers.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount() {
  await act(async () => root.render(<AppSpecificProviders>page</AppSpecificProviders>));
  await settle();
}

describe("write resume at startup", () => {
  it("loads nothing for a visitor with an empty journal", async () => {
    await mount();
    expect(container.textContent).toBe("page");
    expect(resume.relayr).not.toHaveBeenCalled();
    expect(resume.safe).not.toHaveBeenCalled();
    expect(resume.followers).not.toHaveBeenCalled();
  });

  it("resumes Relayr bundles and Safe proposals once, and follows held rows, when the journal has rows", async () => {
    journal.rows = [{ id: "tx:1:0xabc" }];
    await mount();
    expect(resume.relayr).toHaveBeenCalledTimes(1);
    expect(resume.safe).toHaveBeenCalledWith({ wagmi: true });
    expect(container.querySelector("[data-followers]")).not.toBeNull();
  });

  it("follows a row written later in the session without resuming again", async () => {
    await mount();
    act(() => journal.set([{ id: "tx:1:0xdef" }]));
    await settle();
    expect(container.querySelector("[data-followers]")).not.toBeNull();
    expect(resume.relayr).not.toHaveBeenCalled();
    expect(resume.safe).not.toHaveBeenCalled();
  });
});
