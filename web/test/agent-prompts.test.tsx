import { AuditPromptActions } from "@/components/AuditPromptActions";
import { CopyRevnetBuildPrompt } from "@/components/guides/CopyRevnetBuildPrompt";
import { REVNET_AUDIT_PROMPT } from "@/lib/audit-prompt";
import { REVNET_ONE_LINER } from "@/lib/one-liner";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Revnet audit prompts", () => {
  it("puts both prompts in the page markup, collapsed, without a click", () => {
    const { container } = render(<AuditPromptActions />);
    const fields = [...container.querySelectorAll("details:not([open]) textarea")];
    expect(fields).toHaveLength(2);
    expect((fields[0] as HTMLTextAreaElement).value).toBe(REVNET_AUDIT_PROMPT);
    expect((fields[1] as HTMLTextAreaElement).value).toContain("Audit this exact transaction");
  });
});

describe("Revnet build prompt", () => {
  it("opens by saying it is about a revnet and where to start", () => {
    const { container } = render(<CopyRevnetBuildPrompt />);
    expect(container.querySelector("textarea")?.value).toContain(
      `I want to build this on a revnet (Juicebox V6): ${REVNET_ONE_LINER} Start at https://revnet.money/skill.md;`,
    );
  });
});
