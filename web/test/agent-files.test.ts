import { GET as llms } from "@/app/llms.txt/route";
import { GET as skill } from "@/app/skill.md/route";
import { describe, expect, it } from "vitest";

describe("agent files", () => {
  it("describe Telligence on Base and link pages this site serves", async () => {
    const [map, instructions] = await Promise.all([llms().text(), skill().text()]);
    for (const text of [map, instructions]) {
      expect(text).toContain("# Telligence");
      expect(text).toContain("`base` (8453)");
      expect(text).toContain("/compute/<id>");
      expect(text).toContain("https://github.com/mejango/jbcenter/blob/main/mcp/README.md");
      expect(text).toContain("have not been audited");
      // The Create page takes no .jb draft here.
      expect(text).not.toContain(".jb");
      expect(text).not.toContain("·");
    }
    expect(map).toContain("/learn#stages");
    expect(map).toContain("/how-it-works");
  });
});
