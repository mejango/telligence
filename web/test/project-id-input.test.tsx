import { ProjectIdInput } from "@/components/ProjectIdInput";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ProjectIdInput", () => {
  it("shows the exact-chain project name as field subtext", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ found: true, name: "KMAC" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <ProjectIdInput value="11" onChange={vi.fn()} chainId={84532} ariaLabel="Target project" />,
    );
    await act(async () => vi.runAllTimersAsync());
    expect(screen.getByText("→ KMAC")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/project-name?chainId=84532&projectId=11");
  });

  it("keeps the input numeric", async () => {
    const onChange = vi.fn();
    render(<ProjectIdInput value="" onChange={onChange} chainId={84532} />);
    fireEvent.change(screen.getByLabelText("Project ID"), { target: { value: "11abc" } });
    expect(onChange).toHaveBeenCalledWith("11");
  });
});
