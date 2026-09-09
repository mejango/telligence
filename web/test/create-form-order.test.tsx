import { DeployRevnetForm } from "@/app/create/form/DeployRevnetForm";
import { createSchema } from "@/app/create/helpers/createSchema";
import type { RevnetFormData } from "@/app/create/types";
import { withSchema } from "@/lib/formValidation";
import { FormProvider } from "@/lib/forms";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { baseSepolia, mainnet, sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ACCOUNT, TEST_BENEFICIARY, validRevnetForm } from "./fixtures/revnet";

// The deploy action is a wallet button; the section renders without a WagmiProvider here.
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

function renderCreateForm(initialValues: RevnetFormData) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {createForm(initialValues)}
    </QueryClientProvider>,
  );
}

function createForm(initialValues: RevnetFormData) {
  return (
    <FormProvider
      initialValues={initialValues}
      isInitialValid={false}
      validate={withSchema(createSchema)}
      onSubmit={() => undefined}
    >
      {({ values }) => (
        <>
          <DeployRevnetForm resetRelayrResponse={() => undefined} />
          <output data-testid="form-state">
            {JSON.stringify({
              chainIds: values.chainIds,
              operator: values.operator,
              stages: values.stages,
              issuanceBaseCurrency: values.issuanceBaseCurrency,
            })}
          </output>
        </>
      )}
    </FormProvider>
  );
}

function formState() {
  return JSON.parse(screen.getByTestId("form-state").textContent ?? "{}") as {
    chainIds: RevnetFormData["chainIds"];
    operator: RevnetFormData["operator"];
    stages: RevnetFormData["stages"];
    issuanceBaseCurrency: RevnetFormData["issuanceBaseCurrency"];
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
});

function precedes(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("create form section order", () => {
  it("numbers the sections in render order", () => {
    renderCreateForm(validRevnetForm());

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");

    expect(headings).toEqual([
      "1. Look",
      "2. Settlement",
      "3. Terms",
      "4. Store",
      "5. Operator",
      "6. Deploy",
    ]);
  });

  it("settles chains and the reserve asset in one section, chains first", () => {
    renderCreateForm(validRevnetForm());

    // "Look" (name, ticker, logo, about, socials) has no chain-dependent
    // field, so it leads. Everything from the chain picker down does.
    const environment = screen.getByLabelText("Deployment environment");
    const chain = screen.getByRole("checkbox", { name: "Ethereum" });
    const reserveAsset = screen.getByRole("checkbox", { name: "Custom token" });
    const terms = screen.getByRole("heading", { name: "3. Terms" });

    expect(precedes(environment, chain)).toBe(true);
    expect(precedes(chain, reserveAsset)).toBe(true);
    expect(precedes(reserveAsset, terms)).toBe(true);
  });

  it("describes chains and reserve asset from the settlement section's copy", () => {
    renderCreateForm(validRevnetForm());

    const settlement = screen.getByRole("heading", { name: "2. Settlement" }).closest("div");
    expect(settlement?.textContent).toContain(
      "Pick which chains your revnet will accept money on and issue SAFE from, and which reserve asset will back the value of SAFE.",
    );
    expect(settlement?.textContent).toContain(
      "Holders of SAFE can cash out on any of the selected chains for the reserve token(s), and can move their SAFE between chains at any time, which moves proportional reserved tokens alongside.",
    );
  });

  it("promises operator-added chains from the deploy step, not the chain picker", () => {
    renderCreateForm(validRevnetForm());

    // The operator is named in its own section, below the chain picker: this
    // promise only reads correctly once it sits with the other post-deploy
    // expectations.
    const copy = screen.getByText(/able to add new chains to the revnet later/i);
    expect(copy.closest("div")?.querySelector("h2")?.textContent).toBe("6. Deploy");
  });

  it("keeps at least one chain selected", () => {
    const form = validRevnetForm();
    form.chainIds = [mainnet.id];
    renderCreateForm(form);

    // A revnet is deployed to chains; unchecking the last one leaves the form with nothing to
    // deploy to and silently drops every per-chain value along with it.
    fireEvent.click(screen.getByRole("checkbox", { name: "Ethereum" }));
    expect(formState().chainIds).toEqual([mainnet.id]);
  });

  it("shows create validation beside the button that requested the quote", () => {
    const invalid = validRevnetForm();
    invalid.name = "";
    invalid.description = "";
    invalid.chainIds = [];
    invalid.stages = [];
    renderCreateForm(invalid);

    fireEvent.click(screen.getByRole("button", { name: /deploy the revnet|sign and get quote/i }));

    const message = screen.getByText("Please fix these details:");
    expect(message.closest('[role="alert"]')).toHaveTextContent("Name is required");
    expect(message.closest('[role="alert"]')).toHaveTextContent("Description is required");
    expect(message.closest('[role="alert"]')).toHaveTextContent("At least one stage is required");
    // No chain error to assert: the picker selects one for you, so an empty selection is not a
    // state the form can be left in. The schema rule stays for drafts and programmatic input.
    expect(formState().chainIds).toHaveLength(1);
  });
});

describe("inline per-chain inputs driven by the up-front chain selection", () => {
  function multiChainForm() {
    const form = validRevnetForm();
    form.chainIds = [sepolia.id, baseSepolia.id];
    form.operator = [];
    form.stages[0].splits[0].beneficiary = undefined;
    return form;
  }

  function twoStageForm() {
    const form = multiChainForm();
    form.stages = [form.stages[0], { ...form.stages[0], stageStart: "30" }];
    return form;
  }

  function issuanceSuffixText(dialog: HTMLElement) {
    const suffix = dialog.querySelector("#initialIssuance + span");
    return (suffix?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  it("expands a split beneficiary to per-chain values at the field", () => {
    renderCreateForm(multiChainForm());

    fireEvent.click(screen.getByLabelText("Edit stage 1"));

    // Single value by default; expandable to the selected chains, seeded with
    // the single default value.
    expect(screen.queryByLabelText("Sepolia beneficiary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/per chain/i, { selector: "#perChainBeneficiary-0" }));
    expect(screen.getByLabelText("Sepolia beneficiary")).toHaveValue(TEST_BENEFICIARY);
    expect(screen.getByLabelText("Base Sepolia beneficiary")).toHaveValue(TEST_BENEFICIARY);

    fireEvent.change(screen.getByLabelText("Base Sepolia beneficiary"), {
      target: { value: TEST_ACCOUNT },
    });

    fireEvent.click(screen.getByText("Save stage"));
    expect(formState().stages[0].splits[0].beneficiary).toEqual([
      { chainId: sepolia.id, address: TEST_BENEFICIARY },
      { chainId: baseSepolia.id, address: TEST_ACCOUNT },
    ]);
  });

  it("edits the issuance denomination inline in the stage, as one global value", () => {
    renderCreateForm(multiChainForm());

    // No standalone denomination block in the form body: the control lives at
    // the point of use, in the stage's issuance row.
    expect(screen.queryByLabelText("Issuance currency")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    const inline = screen.getByRole("combobox", { name: "Issuance currency" });
    expect(inline).toHaveValue("ETH");
    fireEvent.change(inline, { target: { value: "USD" } });

    // Buffered like the dialog's other parent-form fields: nothing reaches the
    // create form until Save.
    expect(formState().issuanceBaseCurrency).toBe("ETH");
    fireEvent.click(screen.getByText("Save stage"));
    expect(formState().issuanceBaseCurrency).toBe("USD");

    // The value is global: the stage summary quotes issuance in it.
    expect(
      screen.getAllByText(
        (_, element) => element?.tagName === "DD" && /\/\s*USD/.test(element.textContent ?? ""),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("offers the denomination only in the first stage, and quotes it statically after", () => {
    renderCreateForm(twoStageForm());

    // Stage 1 owns the one global denomination.
    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    expect(
      within(screen.getByRole("dialog")).getByRole("combobox", { name: "Issuance currency" }),
    ).toHaveValue("ETH");

    // Later stages quote it, they don't offer it: the protocol has no
    // per-stage base currency, so a second control would advertise a choice
    // that doesn't exist.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Edit stage 2"));
    const laterStage = screen.getByRole("dialog");
    expect(
      within(laterStage).queryByRole("combobox", { name: "Issuance currency" }),
    ).not.toBeInTheDocument();
    expect(laterStage.querySelectorAll("select")).toHaveLength(0);
    expect(issuanceSuffixText(laterStage)).toMatch(/^SAFE \/\s*ETH$/);

    // And it quotes the current value, including one just picked in stage 1.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    fireEvent.change(screen.getByRole("combobox", { name: "Issuance currency" }), {
      target: { value: "USD" },
    });
    fireEvent.click(screen.getByText("Save stage"));

    fireEvent.click(screen.getByLabelText("Edit stage 2"));
    const reopened = screen.getByRole("dialog");
    expect(
      within(reopened).queryByRole("combobox", { name: "Issuance currency" }),
    ).not.toBeInTheDocument();
    expect(issuanceSuffixText(reopened)).toMatch(/^SAFE \/\s*USD$/);

    // Both stage summaries follow the one global value.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const issuanceSummaries = screen
      .getAllByText((_, element) => element?.tagName === "DD")
      .map((element) => element.textContent ?? "")
      .filter((text) => /\/\s*(ETH|USD)/.test(text));
    expect(issuanceSummaries).toHaveLength(2);
    expect(issuanceSummaries.every((text) => /\/\s*USD/.test(text))).toBe(true);
  });

  it("assigns each auto-issuance row a selected chain at input time and saves it", () => {
    renderCreateForm(multiChainForm());

    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    fireEvent.click(screen.getByText("add auto issuance +"));

    // Both rows' chain pickers show a chain from the up-front selection: the
    // fixture row keeps its chain, the new row defaults to the first one.
    expect(screen.getAllByText("Sepolia").length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByLabelText("... and"), { target: { value: "40" } });
    // "to" labels: the split beneficiary, then one per auto-issuance row.
    fireEvent.change(screen.getAllByLabelText("to")[2], { target: { value: TEST_ACCOUNT } });
    fireEvent.click(screen.getByText("Save stage"));

    expect(formState().stages[0].autoIssuance).toEqual([
      { amount: "25", beneficiary: TEST_BENEFICIARY, chainId: sepolia.id },
      { amount: "40", beneficiary: TEST_ACCOUNT, chainId: sepolia.id },
    ]);
  });
});
