import { V6BurnTokensDialog } from "@/app/[slug]/components/v6/owners/accounts/V6BurnTokensDialog";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONTROLLER = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"cd".repeat(32)}` as Hex;
/** A burn proposed to a Safe whose result the app can't confirm. */
const PROPOSAL = `0x${"ce".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  usePublicClient: () => ({ readContract: mocks.read }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    variant: _variant,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionThrough } = await import("./support/reviewed-action");
  // A burn's own Safe proposal ends where the app can't confirm its result.
  const { hook } = reviewedActionThrough(mocks.write, { proposed: (hash) => hash === PROPOSAL });
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: hook,
  };
});

const confirmPanel = () => document.querySelector<HTMLElement>("[data-tx-confirm]");
const burnDialog = () => screen.getByRole("dialog", { name: "Burn tokens" }) as HTMLDialogElement;
/** The burn dialog's own ×, hidden while the confirm replaces its content. */
const dialogClose = () =>
  [...burnDialog().querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => !button.closest("[data-tx-confirm]") && button.textContent === "Close",
  )!;

/** Holds the first read (the balance check before the prompt) until the test answers it. */
function heldRead() {
  let answer!: () => void;
  const held = new Promise<void>((resolve) => {
    answer = resolve;
  });
  let first = true;
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (first) {
      first = false;
      await held;
    }
    return functionName === "totalBalanceOf" ? 10n ** 21n : CONTROLLER;
  });
  return answer;
}

async function openConfirm() {
  render(
    <V6BurnTokensDialog
      rows={[{ chainId: 8453 as JBChainId, projectId: 4n, balance: 10n ** 21n }]}
      tokenSymbol="ART"
    >
      <button>Burn</button>
    </V6BurnTokensDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Burn" }));
  fireEvent.change(await screen.findByPlaceholderText("Amount of ART"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Burn permanently" }));
  await waitFor(() => expect(confirmPanel()).not.toBeNull());
  return confirmPanel()!;
}

beforeEach(() => {
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === "totalBalanceOf" ? 10n ** 21n : CONTROLLER,
  );
  mocks.write.mockResolvedValue(HASH);
});

describe("burn tokens confirm", () => {
  it("wallet-action:burn-tokens refuses every way out from Confirm through the reads before the wallet prompt", async () => {
    const answerRead = heldRead();
    // Every send happens with the confirm on screen, never after a close.
    mocks.write.mockImplementation(async () => {
      expect(confirmPanel()).not.toBeNull();
      return HASH;
    });
    const confirm = await openConfirm();

    await waitFor(() => expect(mocks.read).toHaveBeenCalled());
    const close = within(confirm).getByRole("button", { name: "Close" });
    expect(close).toBeDisabled();
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(burnDialog());
    fireEvent.click(dialogClose());
    expect(burnDialog().open).toBe(true);
    expect(confirmPanel()).toBe(confirm);
    expect(mocks.write).not.toHaveBeenCalled();

    answerRead();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ chainId: 8453, address: CONTROLLER });
    // Submitted: the confirm closes on its own, back to the burn form.
    await waitFor(() => expect(confirmPanel()).toBeNull());
    expect(burnDialog().open).toBe(true);
  });
});

describe("a burn left open over its own Safe proposal the app can't confirm", () => {
  it("wallet-action:burn-tokens says to check the proposal in Safe", async () => {
    mocks.write.mockResolvedValue(PROPOSAL);
    render(
      <V6BurnTokensDialog
        rows={[{ chainId: 1 as JBChainId, projectId: 7n, balance: 10n ** 21n }]}
        tokenSymbol="REV"
      >
        <button type="button">Open burn</button>
      </V6BurnTokensDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open burn" }));
    fireEvent.change(await screen.findByPlaceholderText("Amount of REV"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Burn permanently" }));
    await waitFor(() => expect(confirmPanel()).not.toBeNull());
    confirmPanel()!;

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    await screen.findByText("Check this proposal in your Safe before sending it again.");
    // The proposal is named as one, never as a burn that happened.
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Safe proposal submitted" }),
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Tokens burned" }),
    );
    expect(screen.queryByRole("button", { name: "Burned" })).toBeNull();
  });
});
