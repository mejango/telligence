import { capacityPresentation } from "@/lib/telligence/presentation";
import type { ProjectSnapshot } from "@/lib/telligence/types";
import { useGatewayResource } from "@/lib/telligence/useGatewayResource";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/telligence/api", () => ({ gatewayRequest: mocks.request }));
const parse = (value: unknown) => value as { id: string };

describe("gateway resource identity and freshness", () => {
  it("never exposes the previous identity, including the first render of a route change", async () => {
    mocks.request.mockResolvedValueOnce({ id: "first" }).mockReturnValueOnce(new Promise(() => {}));
    const renders: Array<{ path: string; id: string | undefined }> = [];
    const { result, rerender } = renderHook(
      ({ path }) => {
        const resource = useGatewayResource(path, parse);
        renders.push({ path, id: resource.data?.id });
        return resource;
      },
      { initialProps: { path: "/v1/projects/first" } },
    );
    await waitFor(() => expect(result.current.data?.id).toBe("first"));
    rerender({ path: "/v1/projects/second" });
    expect(
      renders.filter(({ path }) => path.endsWith("second")).every(({ id }) => id === undefined),
    ).toBe(true);
  });

  it("refreshes time-dependent observations even while polling is stalled", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-09-09T12:00:00.000Z");
    vi.setSystemTime(now);
    const project = {
      status: "active",
      capacity: {
        status: "ready",
        dailyCreditUsd: "10",
        remainingCreditUsd: "5",
        observedAt: new Date(now - 299_000).toISOString(),
      },
    } as ProjectSnapshot;
    mocks.request.mockResolvedValueOnce(project).mockReturnValue(new Promise(() => {}));
    const parseProject = (value: unknown) => value as ProjectSnapshot;
    const { result } = renderHook(() => {
      const resource = useGatewayResource("/v1/projects/first", parseProject);
      return resource.data ? capacityPresentation(resource.data) : null;
    });
    await act(async () => {});
    expect(result.current?.usable).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current?.usable).toBe(false);
    expect(result.current?.daily).toBe("—");
  });

  it("ignores a completed request after its route has been replaced", async () => {
    let resolve!: (value: unknown) => void;
    mocks.request
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce({ id: "second" });
    const { result, rerender } = renderHook(({ path }) => useGatewayResource(path, parse), {
      initialProps: { path: "/v1/projects/first" },
    });
    rerender({ path: "/v1/projects/second" });
    await waitFor(() => expect(result.current.data?.id).toBe("second"));
    await act(async () => resolve({ id: "first" }));
    expect(result.current.data?.id).toBe("second");
  });
});
