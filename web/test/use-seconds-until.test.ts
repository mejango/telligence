import { useSecondsUntil } from "@/hooks/useSecondsUntil";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000_000);
});
afterEach(() => vi.useRealTimers());

it("counts whole seconds down to an end, then stops ticking at zero", () => {
  const { result } = renderHook(() => useSecondsUntil(1_000_002));
  expect(result.current).toBe(2);
  act(() => vi.advanceTimersByTime(1_000));
  expect(result.current).toBe(1);
  act(() => vi.advanceTimersByTime(1_000));
  expect(result.current).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("has no countdown without an end", () => {
  expect(renderHook(() => useSecondsUntil(undefined)).result.current).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
