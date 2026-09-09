import { REVNET_AUDIT_PROMPT } from "@/lib/audit-prompt";
import { describe, expect, it } from "vitest";

describe("Revnet audit prompt", () => {
  it("directs auditors to both the app and protocol in version-6", () => {
    expect(REVNET_AUDIT_PROMPT).toContain(
      "git clone --recursive https://github.com/Bananapus/version-6.git",
    );
    expect(REVNET_AUDIT_PROMPT).toContain("webclients/revnet-money");
    expect(REVNET_AUDIT_PROMPT).toContain("revnet-core-v6");
    expect(REVNET_AUDIT_PROMPT).toContain("AUDIT_INSTRUCTIONS.md");
  });
});
