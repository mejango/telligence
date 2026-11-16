import { ChangeSplitRecipientsDialog } from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { stickyDistributorAddress } from "@bananapus/nana-sdk-core/v6";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmIsOpen, expectEveryWayOutRefused, findConfirm } from "./support/confirm";

type ChainSplit = {
  chainId: number;
  projectId: bigint;
  rulesetId: bigint;
  splits: Array<{ percent: number; beneficiary: string }>;
  fallbackSplitCount: number | null;
};

const state = vi.hoisted(() => ({
  permissionGranted: true,
  permissionError: false,
  permissionLoading: false,
  retryPermissions: vi.fn(),
  chainSplits: [] as unknown[],
  submitSplits: vi.fn(),
  relayrAvailable: true,
  /** The single-chain write went to a Safe whose result the app can't confirm. */
  txUnconfirmed: false,
  /** The single-chain write goes to a Safe as a proposal that has not executed. */
  proposeToSafe: false,
  /** The single-chain write's receipt never lands, and its bounded watch ends. */
  neverLands: false,
  address: "0x1111111111111111111111111111111111111111" as string | undefined,
  /** The on-chain sucker registry's pairs; null = every listed chain is verified. */
  verifiedPairs: null as { peerChainId: number; projectId: bigint }[] | null,
  suckersVerified: true,
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ isConnected: Boolean(state.address), address: state.address }),
  useChainId: () => 8453,
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock("@/hooks/useUserPermissions", () => ({
  useUserPermissions: () => ({
    hasPermission: () => state.permissionGranted,
    isLoading: state.permissionLoading,
    isError: state.permissionError,
    isFetching: false,
    refetch: state.retryPermissions,
  }),
}));

vi.mock("@/app/[slug]/owners/components/hooks/useChainSplits", () => ({
  useChainSplits: () => ({
    chainSplits: state.chainSplits,
    allRulesets: [],
    isLoading: false,
    verifiedPairs:
      state.verifiedPairs ??
      (state.chainSplits as { chainId: number; projectId: bigint }[]).map((c) => ({
        peerChainId: c.chainId,
        projectId: c.projectId,
      })),
    suckerCheck: { isVerified: state.suckersVerified, isError: false },
    refetch: vi.fn(),
  }),
}));

vi.mock("@/app/[slug]/owners/components/hooks/useSetSplitGroups", async () => {
  const { useState } = await import("react");
  return {
    // The hook's receipt watcher reports a Safe proposal as loading until it executes, or
    // until its result can't be confirmed.
    useSetSplitGroups: () => {
      const [submitting, setSubmitting] = useState(false);
      const [proposed, setProposed] = useState(false);
      const [unconfirmed, setUnconfirmed] = useState(false);
      return {
        // Submitting from the first line of the call until it settles, as the hook is.
        submitSplits: async (chains: unknown) => {
          setSubmitting(true);
          try {
            const result = await state.submitSplits(chains);
            if (state.proposeToSafe) setProposed(true);
            if (state.neverLands) setUnconfirmed(true);
            return result;
          } finally {
            setSubmitting(false);
          }
        },
        isSubmitting: submitting,
        isPending: false,
        isTxLoading: proposed && !state.txUnconfirmed,
        isSafeProposal: proposed,
        isTxUnconfirmed: state.txUnconfirmed,
        isTxReceiptUnconfirmed: unconfirmed,
        isSuccess: false,
        relayrAvailable: state.relayrAvailable,
      };
    },
  };
});

// The token status reads the chain; these tests cover the recipient controls.
vi.mock("@/components/sticky/StickyTokenStatus", () => ({ StickyTokenStatus: () => null }));

const BENEFICIARY = "0x000000000000000000000000000000000000dEaD";

function chain(overrides: Partial<ChainSplit> = {}): ChainSplit {
  return {
    chainId: 8453,
    projectId: 3n,
    rulesetId: 1_700_000_002n,
    splits: [{ percent: 1_000_000_000, beneficiary: BENEFICIARY }],
    fallbackSplitCount: 0,
    ...overrides,
  };
}

async function openDialog(stageIdx: number, initialChainId = 8453) {
  render(
    <ChangeSplitRecipientsDialog
      stageIdx={stageIdx}
      initialChainId={initialChainId as JBChainId}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change split recipients" }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  state.permissionGranted = true;
  state.permissionError = false;
  state.permissionLoading = false;
  state.retryPermissions = vi.fn();
  state.chainSplits = [chain()];
  state.submitSplits = vi.fn();
  state.relayrAvailable = true;
  state.txUnconfirmed = false;
  state.proposeToSafe = false;
  state.neverLands = false;
  state.verifiedPairs = null;
  state.suckersVerified = true;
  state.address = "0x1111111111111111111111111111111111111111";
});

describe("ChangeSplitRecipientsDialog over its own Safe proposal the app can't confirm", () => {
  it("says to check the proposal in Safe", async () => {
    state.txUnconfirmed = true;

    const dialog = await openDialog(0);

    expect(
      within(dialog).getByText("Check this proposal in your Safe before sending it again."),
    ).toBeInTheDocument();
  });
});

describe("ChangeSplitRecipientsDialog sucker pairs", () => {
  it("wallet-action:set-splits refuses a chain whose project id the sucker registry does not list", async () => {
    // The form's project id (3) came from the indexer; the registry says 4 on Base.
    state.verifiedPairs = [{ peerChainId: 8453, projectId: 4n }];
    const dialog = await openDialog(0);

    expect(dialog).toHaveTextContent("The Base project listed here isn't linked onchain.");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(confirmIsOpen()).toBe(false);
    expect(state.submitSplits).not.toHaveBeenCalled();
  });
});

describe("ChangeSplitRecipientsDialog while the registry read is in flight", () => {
  it("shows Save as loading, with no message or extra step", async () => {
    state.verifiedPairs = [];
    state.suckersVerified = false;
    const dialog = await openDialog(0);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(dialog.textContent).not.toMatch(/isn.t linked|belongs to this project/);
  });
});

describe("ChangeSplitRecipientsDialog stage labelling", () => {
  it("names the stage from its index, never a ruleset timestamp", async () => {
    const dialog = await openDialog(1);

    expect(dialog).toHaveTextContent("Stage 2");
    expect(dialog.textContent).not.toMatch(/Stage 1[0-9]{9}/);
  });

  it("loads the stage's recipients into the form", async () => {
    const dialog = await openDialog(1);

    expect(dialog.querySelectorAll('input[type="text"]')).toHaveLength(1);
    expect((dialog.querySelector('input[type="text"]') as HTMLInputElement).value).toBe(
      BENEFICIARY,
    );
  });
});

describe("ChangeSplitRecipientsDialog Sticky hook", () => {
  const optionsOf = (select: HTMLElement) =>
    Array.from((select as HTMLSelectElement).options).map((option) => option.textContent);

  it("offers Sticky as a hook type, never as a recipient type", async () => {
    const dialog = within(await openDialog(0));
    const kind = dialog.getByRole("combobox", { name: "Recipient type" });
    expect(optionsOf(kind)).toEqual(["Address", "Hook"]);
    expect(dialog.queryByText("Sticky")).toBeNull();

    fireEvent.change(kind, { target: { value: "hook" } });
    // One hook type exists, so it is plain text, not a dropdown.
    expect(await dialog.findByText("Sticky")).toBeInTheDocument();
    expect(dialog.queryByRole("combobox", { name: "Hook type" })).toBeNull();
    expect(dialog.getByRole("textbox", { name: "Sticky token" })).toBeInTheDocument();
  });

  it("loads a live Sticky split as Hook > Sticky", async () => {
    state.chainSplits = [
      {
        ...chain(),
        splits: [
          {
            percent: 1_000_000_000,
            beneficiary: BENEFICIARY,
            projectId: 0n,
            hook: stickyDistributorAddress(8453),
            lockedUntil: 0,
            preferAddToBalance: false,
          },
        ],
      },
    ];
    const dialog = within(await openDialog(0));
    expect(dialog.getByRole("combobox", { name: "Recipient type" })).toHaveValue("hook");
    expect(dialog.getByText("Sticky")).toBeInTheDocument();
    expect(dialog.getByRole("textbox", { name: "Sticky token" })).toHaveValue(BENEFICIARY);
  });
});

describe("ChangeSplitRecipientsDialog fallback-splits guard", () => {
  it("allows clearing every recipient when the fallback group is empty", async () => {
    const dialog = await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: /remove split/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/minted to the revnet's owner contract/i));
    expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled();
  });

  it("blocks clearing when the project's default splits would take over", async () => {
    state.chainSplits = [chain({ fallbackSplitCount: 3 })];
    const dialog = await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: /remove split/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/default splits \(3 recipients\)/i));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(dialog).not.toHaveTextContent(/minted to the revnet's owner contract/i);
  });

  it("fails closed when the fallback group could not be read", async () => {
    state.chainSplits = [chain({ fallbackSplitCount: null })];
    const dialog = await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: /remove split/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't read/i));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("keeps saving available when a populated recipient list is submitted", async () => {
    state.chainSplits = [chain({ fallbackSplitCount: 3 })];
    await openDialog(0);

    expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled();
  });
});

describe("ChangeSplitRecipientsDialog confirm stage", () => {
  it.each([
    { label: "testnet EOA", chainIds: [11155111, 84532], relayrAvailable: true, relayed: true },
    { label: "testnet Safe", chainIds: [11155111, 84532], relayrAvailable: false, relayed: false },
    {
      label: "mixed network families",
      chainIds: [1, 84532],
      relayrAvailable: true,
      relayed: false,
    },
  ])(
    "shows the matching confirmation route for $label",
    async ({ chainIds, relayrAvailable, relayed }) => {
      state.relayrAvailable = relayrAvailable;
      state.chainSplits = chainIds.map((chainId) => chain({ chainId }));
      await openDialog(0, chainIds[0]);
      fireEvent.click(screen.getByRole("checkbox", { name: "Base Sepolia" }));
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      const confirm = (await screen.findAllByRole("dialog")).at(-1)!;
      await waitFor(() => expect(confirm).toHaveTextContent("Confirm split recipients"));
      if (relayed) {
        expect(confirm).toHaveTextContent(
          "Choose a funding chain and pay once to update each chain.",
        );
        expect(confirm).toHaveTextContent("Quoted in ETH after you sign");
      } else {
        expect(confirm).toHaveTextContent("Update the recipients on Base Sepolia");
        expect(confirm).not.toHaveTextContent("Quoted in ETH after you sign");
      }
    },
  );

  it("reviews the recipients before the write", async () => {
    state.submitSplits = vi.fn().mockResolvedValue({ success: true });
    await openDialog(0);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const confirm = (await screen.findAllByRole("dialog")).at(-1)!;
    await waitFor(() => expect(confirm).toHaveTextContent("Confirm split recipients"));
    expect(confirm).toHaveTextContent("1 recipient");
    expect(confirm).toHaveTextContent(`100% to ${BENEFICIARY}`);
    expect(confirm).toHaveTextContent("Your wallet will ask for one action.");

    await waitFor(() => expect(state.submitSplits).toHaveBeenCalledTimes(1));
    expect(state.submitSplits.mock.calls[0][0]).toHaveLength(1);
    expect(state.submitSplits.mock.calls[0][0][0].chainId).toBe(8453);
  });

  it("shows a failed update's line with Try again, which sends the same review again", async () => {
    state.submitSplits = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: "The update reverted." })
      .mockResolvedValueOnce({ success: true });
    await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
    await within(dialog).findByText("The update reverted.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(state.submitSplits).toHaveBeenCalledTimes(2));
    expect(state.submitSplits.mock.calls[1][0]).toEqual(state.submitSplits.mock.calls[0][0]);
  });

  it("ends on Done when a single-chain change went to the Safe as a proposal", async () => {
    state.submitSplits = vi.fn().mockResolvedValue({ success: true });
    state.proposeToSafe = true;
    await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
    await waitFor(() => expect(dialog).toHaveTextContent("Confirm split recipients"));
    // The proposal waits on the Safe's signers, so the confirm is not held busy on it.
    const done = await within(dialog).findByRole("button", { name: "Done" });
    expect(dialog).toHaveTextContent("Proposed to Safe.");
    fireEvent.click(done);

    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(state.submitSplits).toHaveBeenCalledTimes(1);
    // The form stays locked while the proposal is pending, so it cannot be proposed twice.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("ends on Done with its line when a single-chain change's Safe proposal can't be confirmed", async () => {
    state.submitSplits = vi.fn().mockImplementation(async () => {
      // The change's proposal ends where the app can't confirm its result.
      state.txUnconfirmed = true;
      return { success: true };
    });
    state.proposeToSafe = true;
    await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
    await waitFor(() => expect(dialog).toHaveTextContent("Confirm split recipients"));
    const done = await within(dialog).findByRole("button", { name: "Done" });
    const line = "Check this proposal in your Safe before sending it again.";
    expect(dialog).toHaveTextContent(line);
    expect(dialog).not.toHaveTextContent("Proposed to Safe.");
    fireEvent.click(done);

    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    // The form keeps the line, and Save stays locked: the proposal may still execute.
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(state.submitSplits).toHaveBeenCalledTimes(1);
  });

  it("ends on Done, with Save locked, when a single-chain change's receipt never lands", async () => {
    state.submitSplits = vi.fn().mockResolvedValue({ success: true });
    state.neverLands = true;
    await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
    await waitFor(() => expect(dialog).toHaveTextContent("Confirm split recipients"));
    const done = await within(dialog).findByRole("button", { name: "Done" });
    expect(dialog).toHaveTextContent("Couldn't confirm the change yet.");
    fireEvent.click(done);

    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(state.submitSplits).toHaveBeenCalledTimes(1);
    // The change may still land, so the form cannot send it again.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("refuses every way out while the change is sent, then closes once it is", async () => {
    let finish!: (result: unknown) => void;
    state.submitSplits = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    state.chainSplits = [11155111, 84532].map((chainId) => chain({ chainId }));
    await openDialog(0, 11155111);
    fireEvent.click(screen.getByRole("checkbox", { name: "Base Sepolia" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const confirm = await findConfirm();
    await waitFor(() => expect(state.submitSplits).toHaveBeenCalledTimes(1));

    expectEveryWayOutRefused(confirm);

    finish({ success: true });
    await waitFor(() => expect(confirmIsOpen()).toBe(false));
    expect(state.submitSplits).toHaveBeenCalledTimes(1);
  });

  it("asks for a wallet before the confirm opens", async () => {
    // Permission came from a viewed account; no wallet is connected.
    state.address = undefined;
    await openDialog(0);

    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(confirmIsOpen()).toBe(false);
    expect(state.submitSplits).not.toHaveBeenCalled();
  });

  it("ends on Done when a multi-chain change stopped at a Safe proposal", async () => {
    const message = "setSplitGroupsOf on Sepolia was proposed to Safe, but it has not executed.";
    state.submitSplits = vi.fn().mockResolvedValue({ success: false, proposal: message });
    state.relayrAvailable = false;
    state.chainSplits = [11155111, 84532].map((chainId) => chain({ chainId }));
    await openDialog(0, 11155111);
    fireEvent.click(screen.getByRole("checkbox", { name: "Base Sepolia" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const confirm = await findConfirm();

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent(message);
    expect(within(confirm).queryByRole("button", { name: "Save changes" })).toBeNull();
    fireEvent.click(done);

    await waitFor(() => expect(confirmIsOpen()).toBe(false));
    expect(state.submitSplits).toHaveBeenCalledTimes(1);
  });
});

describe("split editor permission availability", () => {
  it("offers retry for failed verification without offering an unverified editor", () => {
    state.permissionGranted = false;
    state.permissionError = true;
    render(<ChangeSplitRecipientsDialog stageIdx={0} initialChainId={8453} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not verify your project permissions.",
    );
    expect(screen.queryByRole("button", { name: "Change split recipients" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry permissions" }));
    expect(state.retryPermissions).toHaveBeenCalledTimes(1);
  });

  it("distinguishes loading from a verified denial", () => {
    state.permissionGranted = false;
    state.permissionLoading = true;
    const { rerender } = render(<ChangeSplitRecipientsDialog stageIdx={0} initialChainId={8453} />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking permissions");
    state.permissionLoading = false;
    rerender(<ChangeSplitRecipientsDialog stageIdx={0} initialChainId={8453} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry permissions" })).toBeNull();
  });

  it("states who can edit when a panel asks and the account is verified to lack the permission", () => {
    state.permissionGranted = false;
    render(
      <ChangeSplitRecipientsDialog
        stageIdx={0}
        initialChainId={8453}
        deniedNote="Connect an account with this permission to change recipients."
      />,
    );
    expect(
      screen.getByText("Connect an account with this permission to change recipients."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change split recipients" })).toBeNull();
  });

  it("does not state the denial while the permission read is pending or failed", () => {
    state.permissionGranted = false;
    state.permissionLoading = true;
    const dialog = (
      <ChangeSplitRecipientsDialog stageIdx={0} initialChainId={8453} deniedNote="Denied." />
    );
    const { rerender } = render(dialog);
    expect(screen.queryByText("Denied.")).toBeNull();
    state.permissionLoading = false;
    state.permissionError = true;
    rerender(dialog);
    expect(screen.queryByText("Denied.")).toBeNull();
  });
});
