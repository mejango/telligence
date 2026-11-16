import { ProjectHandleEditor } from "@/app/[slug]/components/v6/operator/ProjectHandleEditor";
import type { CrossChainHandleAuthorityStatus } from "@bananapus/nana-sdk-core/safe";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OPERATOR = "0x1111111111111111111111111111111111111111" as Address;

const mocks = vi.hoisted(() => ({
  authority: null as null | { status: string; allowed: boolean },
}));

// The editor's reads are live RPC and service queries; here each answers its fixture.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const queryClient = new actual.QueryClient();
  return {
    ...actual,
    useQueryClient: () => queryClient,
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
      data:
        queryKey[0] === "v6-project-handle-operator"
          ? OPERATOR
          : queryKey[0] === "v6-project-handle-authority"
            ? mocks.authority
            : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
  };
});
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteProjectPermissions: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
  useReviewedAction: () => ({ run: vi.fn() }),
}));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: OPERATOR }) }));

function openEditor(status: CrossChainHandleAuthorityStatus) {
  mocks.authority = { status, allowed: false };
  render(<ProjectHandleEditor project={{ chainId: 8453, projectId: 42 }} />);
  fireEvent.click(screen.getByRole("button", { name: "Set project handle" }));
}

describe("project handle editor authority", () => {
  beforeEach(() => {
    mocks.authority = null;
  });

  it("states an unproven operator Safe in exactly one line", () => {
    openEditor("unproven-creation");

    expect(
      screen.getByText("Can't verify this Safe is the same on Ethereum.", { exact: true }),
    ).toBeVisible();
  });

  it("keeps the other refusals with their own reason", () => {
    openEditor("authority-mismatch");

    expect(screen.getByText(/The operator Safe has different control on Ethereum/)).toBeVisible();
    expect(screen.queryByText(/Can't verify this Safe/)).toBeNull();
  });
});
