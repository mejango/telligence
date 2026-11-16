import { StartTimeField } from "@/app/create/form/StartTimeField";
import { FormProvider } from "@/lib/forms";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { validRevnetForm } from "./fixtures/revnet";

it("shows the same whole-cycle delay as the deployed schedule", () => {
  const first = validRevnetForm().stages[0];
  const second = { ...first, stageStart: "45", stageStartCuts: "1.5" };
  render(
    <FormProvider initialValues={second} onSubmit={() => undefined}>
      <StartTimeField stageIdx={1} stages={[first, second]} />
    </FormProvider>,
  );
  expect(screen.getByText(/= 60 days, at the next cut boundary/)).toBeInTheDocument();
});
