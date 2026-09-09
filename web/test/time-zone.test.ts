import { timestampToZonedDateTimeInput, zonedDateTimeInputToTimestamp } from "@/lib/time-zone";
import { describe, expect, it } from "vitest";

describe("timezone-aware datetime inputs", () => {
  it("round-trips an instant through a selected timezone", () => {
    const timestamp = Date.parse("2026-08-08T12:30:00Z");
    expect(timestampToZonedDateTimeInput(timestamp, "America/New_York")).toBe("2026-08-08T08:30");
    expect(zonedDateTimeInputToTimestamp("2026-08-08T08:30", "America/New_York")).toBe(timestamp);
  });

  it("rejects a wall clock skipped by daylight saving time", () => {
    expect(zonedDateTimeInputToTimestamp("2026-03-08T02:30", "America/New_York")).toBeNull();
  });
});
