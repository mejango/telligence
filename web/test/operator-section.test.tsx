import { PERMANENTLY_DISABLED_OPERATOR } from "@/app/create/constants";
import { OperatorSection } from "@/app/create/form/OperatorSection";
import { createSchema } from "@/app/create/helpers/createSchema";
import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import type { RevnetFormData } from "@/app/create/types";
import { withSchema } from "@/lib/formValidation";
import { FormProvider, useFormContext } from "@/lib/forms";
import { fireEvent, render, screen } from "@testing-library/react";
import { baseSepolia, sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SUCKER_CONFIG,
  TEST_ACCOUNT,
  TEST_BENEFICIARY,
  TEST_SALT,
  TEST_TIMESTAMP,
  validRevnetForm,
} from "./fixtures/revnet";

/**
 * Selection order deliberately differs from the sorted render order
 * (sortChains renders Sepolia before Base Sepolia): binding by index would
 * cross-wire the typed address onto the wrong chain.
 */
function operatorForm(): RevnetFormData {
  const form = validRevnetForm();
  form.chainIds = [baseSepolia.id, sepolia.id];
  form.operator = [];
  form.stages[0].initialOperator = "";
  return form;
}

/** Selecting chains happens in an earlier section; this stands in for it. */
function PickChains({ chainIds }: { chainIds: RevnetFormData["chainIds"] }) {
  const { setFieldValue } = useFormContext<RevnetFormData>();
  return (
    <button type="button" onClick={() => setFieldValue("chainIds", chainIds)}>
      pick-chains
    </button>
  );
}

function Harness({
  initialValues,
  picks,
}: {
  initialValues: RevnetFormData;
  picks?: RevnetFormData["chainIds"];
}) {
  return (
    <FormProvider
      initialValues={initialValues}
      isInitialValid={false}
      validate={withSchema(createSchema)}
      onSubmit={() => undefined}
    >
      {({ values }) => (
        <>
          <OperatorSection />
          {picks ? <PickChains chainIds={picks} /> : null}
          <output data-testid="operator-state">{JSON.stringify(values.operator)}</output>
        </>
      )}
    </FormProvider>
  );
}

function operatorState(): RevnetFormData["operator"] {
  return JSON.parse(screen.getByTestId("operator-state").textContent ?? "[]");
}

function toggle() {
  return screen.getByRole("checkbox", { name: /enable limited operator controls/i });
}

function deployOperatorFor(form: RevnetFormData, chainId: number) {
  const request = parseDeployData(form, {
    metadataCid: "bafy-metadata",
    chainId: chainId as RevnetFormData["chainIds"][number],
    suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
    timestamp: TEST_TIMESTAMP,
    salt: TEST_SALT,
    creationFee: 123n,
  });
  return (request.args[1] as { operator: string }).operator;
}

describe("OperatorSection", () => {
  it("starts with no operator, and offers no address inputs until controls are enabled", () => {
    render(<Harness initialValues={operatorForm()} />);

    expect(toggle()).not.toBeChecked();
    expect(screen.queryByLabelText("Sepolia operator address")).not.toBeInTheDocument();
  });

  it("can be answered before the chains are picked, and fills in once they are", () => {
    // The chains live in an earlier section. Gating this question on them left the checkbox
    // dead for anyone answering the form out of order.
    const form = operatorForm();
    form.chainIds = [];
    render(<Harness initialValues={form} picks={[sepolia.id]} />);

    fireEvent.click(toggle());
    expect(toggle()).toBeChecked();

    fireEvent.click(screen.getByText("pick-chains"));
    expect(screen.getByLabelText("Revnet operator address")).toBeInTheDocument();
    expect(operatorState()).toEqual([{ chainId: String(sepolia.id), address: "" }]);
  });

  it("encodes 0xdead on every chain when limited controls are switched off", () => {
    render(<Harness initialValues={operatorForm()} />);

    fireEvent.click(toggle()); // on
    fireEvent.click(toggle()); // off again

    expect(operatorState()).toEqual([
      { chainId: String(sepolia.id), address: PERMANENTLY_DISABLED_OPERATOR },
      { chainId: String(baseSepolia.id), address: PERMANENTLY_DISABLED_OPERATOR },
    ]);

    const form = { ...operatorForm(), operator: operatorState() };
    expect(deployOperatorFor(form, sepolia.id)).toBe(PERMANENTLY_DISABLED_OPERATOR);
    expect(deployOperatorFor(form, baseSepolia.id)).toBe(PERMANENTLY_DISABLED_OPERATOR);
  });

  it("seeds an entry per chain when enabled, so an unfilled operator cannot deploy as 0xdead", () => {
    // The stage carries the disabled sentinel, which is what parseDeployData falls back to when
    // a chain has no entry of its own. Without a seeded entry, checking the box would read as
    // "operator enabled" and still deploy with nobody holding the controls.
    const form = operatorForm();
    form.stages[0].initialOperator = PERMANENTLY_DISABLED_OPERATOR;
    render(<Harness initialValues={form} />);

    fireEvent.click(toggle());

    expect(operatorState()).toEqual([
      { chainId: String(sepolia.id), address: "" },
      { chainId: String(baseSepolia.id), address: "" },
    ]);
    expect(createSchema.safeParse({ ...form, operator: operatorState() }).success).toBe(false);
  });

  it("sets one operator on every chain unless asked for per-chain addresses", () => {
    render(<Harness initialValues={operatorForm()} />);
    fireEvent.click(toggle());

    fireEvent.change(screen.getByLabelText("Revnet operator address"), {
      target: { value: TEST_ACCOUNT },
    });
    expect(operatorState()).toEqual([
      { chainId: String(sepolia.id), address: TEST_ACCOUNT },
      { chainId: String(baseSepolia.id), address: TEST_ACCOUNT },
    ]);
  });

  it("binds each typed address to the chain it is rendered beside, not the selection index", () => {
    render(<Harness initialValues={operatorForm()} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByLabelText(/set operator per chain/i));

    fireEvent.change(screen.getByLabelText("Sepolia operator address"), {
      target: { value: TEST_ACCOUNT },
    });
    fireEvent.change(screen.getByLabelText("Base Sepolia operator address"), {
      target: { value: TEST_BENEFICIARY },
    });

    const operators = operatorState();
    expect(operators).toContainEqual({ chainId: String(sepolia.id), address: TEST_ACCOUNT });
    expect(operators).toContainEqual({
      chainId: String(baseSepolia.id),
      address: TEST_BENEFICIARY,
    });

    // The deploy encoding receives the address typed next to each chain.
    const form = { ...operatorForm(), operator: operators };
    expect(deployOperatorFor(form, sepolia.id)).toBe(TEST_ACCOUNT);
    expect(deployOperatorFor(form, baseSepolia.id)).toBe(TEST_BENEFICIARY);
  });

  it("shows the operator an imported draft saved on its first stage", () => {
    const form = operatorForm();
    form.stages[0].initialOperator = TEST_ACCOUNT;
    render(<Harness initialValues={form} />);

    expect(toggle()).toBeChecked();
    expect(screen.getByLabelText("Revnet operator address")).toHaveValue(TEST_ACCOUNT);
    expect(operatorState()).toEqual([
      { chainId: String(sepolia.id), address: TEST_ACCOUNT },
      { chainId: String(baseSepolia.id), address: TEST_ACCOUNT },
    ]);
  });

  it("drops entries for chains that are no longer selected", () => {
    const form = operatorForm();
    form.chainIds = [sepolia.id];
    form.operator = [
      { chainId: String(sepolia.id), address: TEST_ACCOUNT },
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
    ];
    render(<Harness initialValues={form} />);

    expect(operatorState()).toEqual([{ chainId: String(sepolia.id), address: TEST_ACCOUNT }]);
  });
});
