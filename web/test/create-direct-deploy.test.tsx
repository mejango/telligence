import { createSchema } from "@/app/create/helpers/createSchema";
import type { RevnetFormData } from "@/app/create/types";
import { withSchema } from "@/lib/formValidation";
import { FormProvider } from "@/lib/forms";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validRevnetForm } from "./fixtures/revnet";

const mocks = vi.hoisted(() => ({
  useTransactionReceipt: vi.fn(),
}));

// The direct-deploy landing reads the receipt via wagmi; stub only that hook
// so no provider is needed.
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useTransactionReceipt: mocks.useTransactionReceipt,
}));

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

import { DeployRevnetForm } from "@/app/create/form/DeployRevnetForm";

const TX_HASH = `0x${"ab".repeat(32)}`;

function renderForm(directDeployment?: {
  chainId: RevnetFormData["chainIds"][number];
  hash: string;
}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <FormProvider
        initialValues={validRevnetForm()}
        isInitialValid={false}
        validate={withSchema(createSchema)}
        onSubmit={() => undefined}
      >
        <DeployRevnetForm
          resetRelayrResponse={() => undefined}
          directDeployment={directDeployment}
        />
      </FormProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.useTransactionReceipt.mockReset();
  mocks.useTransactionReceipt.mockReturnValue({ data: undefined });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
});

describe("single-chain direct deploy landing", () => {
  it("renders no landing when nothing was submitted directly", () => {
    renderForm();
    expect(screen.queryByText("Go to your revnet")).not.toBeInTheDocument();
  });

  it("renders the go-to-project landing once a direct deployment is submitted", () => {
    renderForm({ chainId: sepolia.id, hash: TX_HASH });

    // The receipt is still pending, so the button waits, disabled.
    const button = screen.getByRole("button", { name: /go to your revnet/i });
    expect(button).toBeDisabled();
    expect(mocks.useTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: sepolia.id, hash: TX_HASH }),
    );
  });

  it("does not expose the console test-data hook outside development builds", () => {
    renderForm();
    // NODE_ENV is "test" here; the hook must only install in development.
    expect((window as unknown as { testdata?: unknown }).testdata).toBeUndefined();
  });
});
