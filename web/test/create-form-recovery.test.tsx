import { DEFAULT_FORM_DATA } from "@/app/create/constants";
import { AddStageDialog } from "@/app/create/form/AddStageDialog";
import { DeployRevnetForm } from "@/app/create/form/DeployRevnetForm";
import { OperatorSection } from "@/app/create/form/OperatorSection";
import { createSchema } from "@/app/create/helpers/createSchema";
import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import type { RevnetFormData, StageData } from "@/app/create/types";
import { Button } from "@/components/ui/button";
import { withSchema } from "@/lib/formValidation";
import { FormProvider, useFormContext } from "@/lib/forms";
import { writeJbDraftFile } from "@/lib/jb-draft";
import { parseRevnetDraft } from "@/lib/revnet-draft";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { encodeFunctionData } from "viem";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_SUCKER_CONFIG,
  TEST_BENEFICIARY,
  TEST_SALT,
  TEST_TIMESTAMP,
  validRevnetForm,
} from "./fixtures/revnet";

vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    ...props
  }: {
    children: React.ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));

const OPERATOR = "0x6b92c73682f0e1fac35a18ab17efa5e77dde9fe1";
const LOGO = "ipfs://QmS6aZ8q2PAZWPwqzeiYu8oC95agn2sgg65irud99cfbqp";

/** The shape of REV's real export: an address per chain, no wrapper. */
function revDraft(overrides: Record<string, unknown> = {}) {
  return {
    name: "Revnet Network",
    description: "REV",
    logoUri: LOGO,
    tokenSymbol: "REV",
    chainIds: [mainnet.id, base.id],
    operator: [
      { chainId: String(mainnet.id), address: OPERATOR },
      { chainId: String(base.id), address: OPERATOR },
    ],
    stages: [
      {
        initialIssuance: "10000",
        priceCeilingIncreasePercentage: "38",
        priceCeilingIncreaseFrequency: "360",
        priceFloorTaxIntensity: "10",
        autoIssuance: [],
        splits: [],
        stageStart: "0",
      },
    ],
    ...overrides,
  };
}

function CreateForm() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <FormProvider
        initialValues={DEFAULT_FORM_DATA}
        isInitialValid={false}
        validate={withSchema(createSchema)}
        onSubmit={() => undefined}
      >
        {({ values, errors }) => (
          <>
            <DeployRevnetForm resetRelayrResponse={() => undefined} />
            <output data-testid="values">{JSON.stringify(values)}</output>
            <output data-testid="errors">{JSON.stringify(errors)}</output>
          </>
        )}
      </FormProvider>
    </QueryClientProvider>
  );
}

const formValues = () =>
  JSON.parse(screen.getByTestId("values").textContent ?? "{}") as RevnetFormData;

async function importDraft(draft: unknown) {
  // Tests state drafts as form values; the importer reads the shared file.
  const source = writeJbDraftFile(parseRevnetDraft(JSON.stringify(draft)));
  const file = Object.assign(new File([source], "rev.jb"), { text: async () => source });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Import deployment draft"), {
      target: { files: [file] },
    });
  });
  await screen.findByText(/Draft imported/u);
}

const controls = () => screen.getByRole("checkbox", { name: /enable limited operator controls/i });

beforeEach(() => {
  window.localStorage.clear();
});

describe("importing a .jb on a fresh page", () => {
  it("shows the operator on the first import", async () => {
    render(<CreateForm />);
    await importDraft(revDraft());

    expect(controls()).toBeChecked();
    expect(screen.getByLabelText("Revnet operator address")).toHaveValue(OPERATOR);
    expect(formValues().operator.map((entry) => entry.address)).toEqual([OPERATOR, OPERATOR]);
  });

  it("opens the per-chain rows on the first import when the addresses differ", async () => {
    render(<CreateForm />);
    await importDraft(
      revDraft({
        operator: [
          { chainId: String(mainnet.id), address: OPERATOR },
          { chainId: String(base.id), address: TEST_BENEFICIARY },
        ],
      }),
    );

    expect(screen.getByLabelText("Ethereum operator address")).toHaveValue(OPERATOR);
    expect(screen.getByLabelText("Base operator address")).toHaveValue(TEST_BENEFICIARY);
  });

  it("clears the operator answer when a later draft has none", async () => {
    render(<CreateForm />);
    await importDraft(revDraft());
    await importDraft(revDraft({ operator: [] }));

    expect(controls()).not.toBeChecked();
  });

  it("shows an operator an older draft saved on its first stage", async () => {
    render(<CreateForm />);
    const draft = revDraft({ operator: [] });
    (draft.stages as Record<string, unknown>[])[0].initialOperator = OPERATOR;
    await importDraft(draft);

    expect(controls()).toBeChecked();
    expect(screen.getByLabelText("Revnet operator address")).toHaveValue(OPERATOR);
  });

  it("previews the imported logo", async () => {
    render(<CreateForm />);
    await importDraft(revDraft());

    expect(screen.getByAltText("Uploaded file").getAttribute("src")).toContain(
      "QmS6aZ8q2PAZWPwqzeiYu8oC95agn2sgg65irud99cfbqp",
    );
  });
});

describe("operator answer", () => {
  function OperatorHarness({ initialValues }: { initialValues: RevnetFormData }) {
    return (
      <FormProvider initialValues={initialValues} onSubmit={() => undefined}>
        {({ values }) => (
          <>
            <OperatorSection />
            <PickChains />
            <output data-testid="values">{JSON.stringify(values)}</output>
          </>
        )}
      </FormProvider>
    );
  }
  function PickChains() {
    const { setFieldValue } = useFormContext<RevnetFormData>();
    return (
      <button type="button" onClick={() => setFieldValue("chainIds", [sepolia.id, baseSepolia.id])}>
        add-chain
      </button>
    );
  }
  const typedForm = () => {
    const form = validRevnetForm();
    form.stages[0].initialOperator = "";
    form.operator = [{ chainId: String(sepolia.id), address: OPERATOR }];
    return form;
  };

  it("keeps the typed address across an off and on toggle, and encodes nobody while off", () => {
    render(<OperatorHarness initialValues={typedForm()} />);

    fireEvent.click(controls());
    expect(formValues().operator).toEqual([
      { chainId: String(sepolia.id), address: "0xdead000000000000000000000000000000000000" },
    ]);

    fireEvent.click(controls());
    expect(screen.getByLabelText("Revnet operator address")).toHaveValue(OPERATOR);
    expect(formValues().operator).toEqual([{ chainId: String(sepolia.id), address: OPERATOR }]);
  });

  it("gives a chain added later the one address the single field shows", () => {
    render(<OperatorHarness initialValues={typedForm()} />);

    fireEvent.click(screen.getByText("add-chain"));
    expect(formValues().operator.map((entry) => entry.address)).toEqual([OPERATOR, OPERATOR]);
  });

  it("leaves no hidden address when the per-chain rows close", () => {
    const form = typedForm();
    form.chainIds = [sepolia.id, baseSepolia.id];
    form.operator = [
      { chainId: String(sepolia.id), address: OPERATOR },
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
    ];
    render(<OperatorHarness initialValues={form} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /different operator on each chain/i }));
    expect(new Set(formValues().operator.map((entry) => entry.address)).size).toBe(1);
  });
});

describe("the browser draft", () => {
  const nameField = () => screen.getByLabelText("Name") as HTMLInputElement;

  it("offers the saved form after a reload, and changes nothing until asked", async () => {
    const first = render(<CreateForm />);
    fireEvent.change(nameField(), { target: { value: "Kept" } });
    await importDraft(revDraft({ name: "Kept" }));
    first.unmount();

    render(<CreateForm />);
    expect(nameField()).toHaveValue("");
    expect(formValues().stages).toEqual([]);
    expect(controls()).not.toBeChecked();

    fireEvent.click(await screen.findByRole("button", { name: "Restore draft" }));
    expect(nameField()).toHaveValue("Kept");
    expect(controls()).toBeChecked();
    expect(screen.getByLabelText("Revnet operator address")).toHaveValue(OPERATOR);
    expect(screen.getByText(/Draft restored/u)).toBeInTheDocument();
  });

  it("forgets a field that was typed and then erased", async () => {
    const first = render(<CreateForm />);
    fireEvent.change(nameField(), { target: { value: "Gone" } });
    await waitFor(() => expect(Object.keys(window.localStorage)).toHaveLength(1));
    fireEvent.change(nameField(), { target: { value: "" } });
    await waitFor(() => expect(Object.keys(window.localStorage)).toHaveLength(0));
    first.unmount();
  });

  it("holds a start that passed while the restore offer sat open", async () => {
    const start = Math.floor(Date.now() / 1000) + 60;
    const first = render(<CreateForm />);
    await importDraft(
      revDraft({ stages: [{ ...revDraft().stages[0], futureStartTimestamp: start }] }),
    );
    first.unmount();

    render(<CreateForm />);
    const restore = await screen.findByRole("button", { name: "Restore draft" });
    const later = vi.spyOn(Date, "now").mockReturnValue((start + 60) * 1000);
    fireEvent.click(restore);
    later.mockRestore();
    expect(formValues().stages[0].futureStartTimestamp).toBeNull();
  });

  it("forgets the draft when discarded", async () => {
    const first = render(<CreateForm />);
    await importDraft(revDraft());
    first.unmount();

    const second = render(<CreateForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    expect(screen.queryByRole("button", { name: "Restore draft" })).not.toBeInTheDocument();
    second.unmount();

    render(<CreateForm />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Restore draft" })).not.toBeInTheDocument();
  });

  it("opens on test chains for a draft saved on them", async () => {
    const first = render(<CreateForm />);
    await importDraft(
      revDraft({
        chainIds: [sepolia.id],
        operator: [{ chainId: String(sepolia.id), address: OPERATOR }],
      }),
    );
    expect(screen.getByRole("checkbox", { name: "Sepolia" })).toBeChecked();
    first.unmount();

    render(<CreateForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore draft" }));
    expect(screen.getByRole("checkbox", { name: "Sepolia" })).toBeChecked();
  });

  it("does not offer an unreadable draft", async () => {
    const first = render(<CreateForm />);
    await importDraft(revDraft());
    first.unmount();
    const key = Object.keys(window.localStorage)[0]!;
    window.localStorage.setItem(key, "{not json");

    render(<CreateForm />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Restore draft" })).not.toBeInTheDocument();
  });

  it("asks for a new start when the saved one has passed", async () => {
    const first = render(<CreateForm />);
    const draft = revDraft();
    (draft.stages as StageData[])[0].futureStartTimestamp = Math.floor(Date.now() / 1000) + 7_200;
    await importDraft(draft);
    first.unmount();

    const key = Object.keys(window.localStorage)[0]!;
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    saved.data.stages[0].futureStartTimestamp = TEST_TIMESTAMP;
    window.localStorage.setItem(key, JSON.stringify(saved));

    render(<CreateForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore draft" }));

    expect(formValues().stages[0].futureStartTimestamp).toBeNull();
    expect(screen.getByTestId("errors").textContent).toContain("Choose a start date and time");
    expect(screen.getByText(/saved start time has passed/u)).toBeInTheDocument();
  });

  it("says when item media has to be added again", async () => {
    const first = render(<CreateForm />);
    await importDraft(revDraft());
    first.unmount();

    const key = Object.keys(window.localStorage)[0]!;
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    saved.data.store.items = [{ name: "Shirt", price: "1", mediaFile: {} }];
    window.localStorage.setItem(key, JSON.stringify(saved));

    render(<CreateForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore draft" }));
    expect(screen.getByText(/Add item media again/u)).toBeInTheDocument();
  });

  it("restores to the same deploy calldata", () => {
    const form = validRevnetForm();
    const calldata = (values: RevnetFormData) => {
      const request = parseDeployData(values, {
        metadataCid: "bafy-metadata",
        chainId: sepolia.id,
        suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
        timestamp: TEST_TIMESTAMP,
        salt: TEST_SALT,
        creationFee: 123n,
      });
      return encodeFunctionData({
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
      } as Parameters<typeof encodeFunctionData>[0]);
    };

    const restored = parseRevnetDraft(JSON.stringify({ v: 1, app: "revnet.money", data: form }));
    expect(calldata(restored)).toBe(calldata(form));
  });
});

describe("stage dialog", () => {
  function StageHarness({ onSave }: { onSave: (stage: StageData) => void }) {
    const form = { ...validRevnetForm(), stages: [] };
    return (
      <QueryClientProvider client={new QueryClient()}>
        <FormProvider initialValues={form} onSubmit={() => undefined}>
          <AddStageDialog stageIdx={0} onSave={onSave}>
            <Button type="button">Add stage</Button>
          </AddStageDialog>
        </FormProvider>
      </QueryClientProvider>
    );
  }
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Add stage" }));
  const dialog = () => within(screen.getByRole("dialog"));
  const cut = () => document.getElementById("enableCut") as HTMLInputElement;

  it("blocks a future start with no date, above the Save button", async () => {
    const onSave = vi.fn();
    render(<StageHarness onSave={onSave} />);
    open();
    fireEvent.click(dialog().getByRole("checkbox", { name: /start the revnet in the future/i }));
    const save = dialog().getByRole("button", { name: "Save stage" });
    await act(async () => {
      fireEvent.click(save);
    });

    expect(onSave).not.toHaveBeenCalled();
    const alert = dialog().getByRole("alert");
    expect(alert).toHaveTextContent("Choose a start date and time");
    expect(alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("starts a new stage with the cut off after one was discarded", () => {
    render(<StageHarness onSave={vi.fn()} />);
    open();
    fireEvent.click(cut());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    open();

    expect(cut()).not.toBeChecked();
  });

  it("starts the next stage with the cut off after one was saved with it", async () => {
    const onSave = vi.fn();
    render(<StageHarness onSave={onSave} />);
    open();
    fireEvent.click(cut());
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Save stage" }));
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].priceCeilingIncreasePercentage).toBe("10");

    open();
    expect(cut()).not.toBeChecked();
  });
});
