import {
  changeSplitsSchema,
  type ChangeSplitsValues,
} from "@/app/[slug]/owners/components/changeSplitsSchema";
import { createSchema } from "@/app/create/helpers/createSchema";
import {
  FieldArray,
  Form,
  FormField,
  FormProvider,
  getFormValue,
  setFormValue,
  useField,
  useFormContext,
} from "@/lib/forms";
import { issue, schema, type ValidationIssue, withSchema } from "@/lib/formValidation";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TEST_ACCOUNT, TEST_BENEFICIARY, validRevnetForm } from "./fixtures/revnet";

function NameError() {
  const [, meta] = useField("name");
  const { isValid, submitCount } = useFormContext<{ items: string[]; name: string }>();
  return (
    <>
      <output data-testid="error">{meta.touched ? meta.error : ""}</output>
      <output data-testid="valid">{String(isValid)}</output>
      <output data-testid="submits">{submitCount}</output>
    </>
  );
}

function TouchedItems() {
  const { touched, values } = useFormContext<{ items: string[] }>();
  return (
    <>
      <output data-testid="array-values">{values.items.join(",")}</output>
      <output data-testid="array-touched">{JSON.stringify(touched)}</output>
    </>
  );
}

function ReinitializingForm({
  initialName,
  onSubmit,
}: {
  initialName: string;
  onSubmit: (values: { name: string }) => Promise<void>;
}) {
  return (
    <FormProvider enableReinitialize initialValues={{ name: initialName }} onSubmit={onSubmit}>
      {({ isSubmitting, resetForm, values }) => (
        <Form>
          <FormField aria-label="Reinitialized name" name="name" />
          <output data-testid="current-name">{values.name}</output>
          <output data-testid="loading">{String(isSubmitting)}</output>
          <button type="button" onClick={() => resetForm()}>
            Reset
          </button>
          <button type="submit">Save</button>
        </Form>
      )}
    </FormProvider>
  );
}

describe("local form state", () => {
  it("updates nested paths immutably", () => {
    const original = { stages: [{ splits: [{ beneficiary: "old" }] }] };
    const updated = setFormValue(original, "stages.0.splits.0.beneficiary", "new");

    expect(getFormValue(updated, "stages[0].splits.0.beneficiary")).toBe("new");
    expect(original.stages[0].splits[0].beneficiary).toBe("old");
    expect(updated).not.toBe(original);

    const created = setFormValue({}, "stages.0.splits.0.percentage", "25");
    expect(created).toEqual({ stages: [{ splits: [{ percentage: "25" }] }] });
  });

  it("preserves touched errors, array helpers, and guarded submission", async () => {
    const onSubmit = vi.fn();
    render(
      <FormProvider
        initialValues={{ items: ["first"], name: "" }}
        isInitialValid={false}
        validate={(values) => (values.name.trim() ? {} : { name: "Name is required" })}
        onSubmit={onSubmit}
      >
        {({ values }) => (
          <Form>
            <FormField aria-label="Name" name="name" />
            <NameError />
            <FieldArray<string> name="items">
              {({ push, remove, replace }) => (
                <>
                  <output data-testid="items">{values.items.join(",")}</output>
                  <button type="button" onClick={() => push("second")}>
                    Push
                  </button>
                  <button type="button" onClick={() => replace(0, "replaced")}>
                    Replace
                  </button>
                  <button type="button" onClick={() => remove(0)}>
                    Remove
                  </button>
                </>
              )}
            </FieldArray>
            <button type="submit">Submit</button>
          </Form>
        )}
      </FormProvider>,
    );

    expect(screen.getByTestId("valid")).toHaveTextContent("false");
    fireEvent.blur(screen.getByLabelText("Name"));
    expect(screen.getByTestId("error")).toHaveTextContent("Name is required");

    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => expect(screen.getByTestId("submits")).toHaveTextContent("1"));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Revnet" } });
    expect(screen.getByTestId("valid")).toHaveTextContent("true");
    fireEvent.click(screen.getByText("Push"));
    expect(screen.getByTestId("items")).toHaveTextContent("first,second");
    fireEvent.click(screen.getByText("Replace"));
    expect(screen.getByTestId("items")).toHaveTextContent("replaced,second");
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.getByTestId("items")).toHaveTextContent("second");

    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.anything(), expect.anything()),
    );
    expect(onSubmit.mock.calls[0][0]).toEqual({ items: ["second"], name: "Revnet" });
  });

  it("reinitializes, resets, and exposes asynchronous submission state", async () => {
    let finishSubmission!: () => void;
    const pendingSubmission = new Promise<void>((resolve) => {
      finishSubmission = resolve;
    });
    const onSubmit = vi.fn(async () => pendingSubmission);
    const view = render(<ReinitializingForm initialName="First" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Reinitialized name"), {
      target: { value: "Edited" },
    });
    expect(screen.getByTestId("current-name")).toHaveTextContent("Edited");

    view.rerender(<ReinitializingForm initialName="Second" onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByTestId("current-name")).toHaveTextContent("Second"));

    fireEvent.change(screen.getByLabelText("Reinitialized name"), {
      target: { value: "Again" },
    });
    fireEvent.click(screen.getByText("Reset"));
    expect(screen.getByTestId("current-name")).toHaveTextContent("Second");

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("true"));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Second" }, expect.anything());

    finishSubmission();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
  });

  it("guards asynchronous submissions against rapid duplicate requests", async () => {
    let finishSubmission!: () => void;
    const pendingSubmission = new Promise<void>((resolve) => {
      finishSubmission = resolve;
    });
    const onSubmit = vi.fn(async () => pendingSubmission);

    render(<ReinitializingForm initialName="Only once" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    finishSubmission();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
  });

  it("preserves sibling touched state when removing a nested array item", () => {
    render(
      <FormProvider initialValues={{ items: ["first", "second"] }} onSubmit={() => undefined}>
        <Form>
          <FormField aria-label="First item" name="items.0" />
          <FormField aria-label="Second item" name="items.1" />
          <TouchedItems />
          <FieldArray<string> name="items">
            {({ remove }) => (
              <button type="button" onClick={() => remove(0)}>
                Remove first
              </button>
            )}
          </FieldArray>
        </Form>
      </FormProvider>,
    );

    fireEvent.blur(screen.getByLabelText("Second item"));
    expect(screen.getByTestId("array-touched")).toHaveTextContent(
      JSON.stringify({ items: [null, true] }),
    );

    fireEvent.click(screen.getByText("Remove first"));
    expect(screen.getByTestId("array-values")).toHaveTextContent("second");
    expect(screen.getByTestId("array-touched")).toHaveTextContent(
      JSON.stringify({ items: [true] }),
    );
  });

  it("keeps numeric checkbox values without string coercion", () => {
    render(
      <FormProvider initialValues={{ chains: [1] }} onSubmit={() => undefined}>
        {({ values }) => (
          <Form>
            <label>
              Optimism
              <FormField name="chains" type="checkbox" value={10} />
            </label>
            <output data-testid="chains">{JSON.stringify(values.chains)}</output>
          </Form>
        )}
      </FormProvider>,
    );

    fireEvent.click(screen.getByLabelText("Optimism"));
    expect(screen.getByTestId("chains")).toHaveTextContent("[1,10]");
    fireEvent.click(screen.getByLabelText("Optimism"));
    expect(screen.getByTestId("chains")).toHaveTextContent("[1]");
  });
});

describe("explicit form validators", () => {
  it("preserves field errors when a parent collection also has an error", () => {
    const validator = withSchema(
      schema<{ rows: Array<{ value: string }> }>(() => {
        const issues: ValidationIssue[] = [];
        issue(issues, ["rows", 0, "value"], "Value is required");
        issue(issues, ["rows"], "Rows are invalid");
        return issues;
      }),
    );

    expect(validator({ rows: [{ value: "" }] })).toEqual({
      rows: Object.assign([{ value: "Value is required" }], { _form: "Rows are invalid" }),
    });
  });

  it("accepts contract-safe create values and rejects non-encodable decimals", () => {
    expect(createSchema.safeParse(validRevnetForm()).success).toBe(true);

    const invalid = validRevnetForm();
    invalid.stages[0].initialIssuance = "1e6";
    invalid.stages[0].splits = [
      { percentage: "60", defaultBeneficiary: TEST_ACCOUNT },
      { percentage: "60", defaultBeneficiary: TEST_BENEFICIARY },
    ];
    const result = createSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["stages", 0, "initialIssuance"] }),
          expect.objectContaining({ path: ["stages", 0, "splits"] }),
        ]),
      );
    }
  });

  it("requires an effective operator and selected chain for every encoded stage action", () => {
    const invalid = validRevnetForm();
    invalid.operator = [];
    invalid.stages[0].initialOperator = "";
    invalid.stages[0].autoIssuance[0].chainId = 8453;

    const result = createSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["operator"] }),
          expect.objectContaining({
            path: ["stages", 0, "autoIssuance", 0, "chainId"],
          }),
        ]),
      );
    }
  });

  it("requires a selected chain, valid recipients, and an exact selected split total", () => {
    const base: ChangeSplitsValues = {
      chains: [
        {
          chainId: 1,
          selected: true,
          splits: [
            { beneficiary: TEST_ACCOUNT, percentage: "40" },
            { beneficiary: TEST_BENEFICIARY, percentage: "60" },
          ],
        },
      ],
    };
    expect(changeSplitsSchema.safeParse(base).success).toBe(true);

    const wrongTotal = structuredClone(base);
    wrongTotal.chains[0].splits[1].percentage = "50";
    const wrongTotalResult = changeSplitsSchema.safeParse(wrongTotal);
    expect(wrongTotalResult.success).toBe(false);
    if (!wrongTotalResult.success) {
      expect(wrongTotalResult.error.issues).toContainEqual({
        message: "Splits must sum to 100%",
        path: ["chains", 0, "splits"],
      });
    }

    const invalid = structuredClone(base);
    invalid.chains[0].selected = false;
    invalid.chains[0].splits[0].beneficiary = "not-an-address";
    const result = changeSplitsSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "Select at least one chain", path: ["chains"] }),
          expect.objectContaining({
            message: "Invalid Ethereum address",
            path: ["chains", 0, "splits", 0, "beneficiary"],
          }),
        ]),
      );
    }
  });
});
