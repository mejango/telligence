import { GET as llms } from "@/app/llms.txt/route";
import { GET as skill } from "@/app/skill.md/route";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent files", () => {
  it("map chain slugs to ids and link an example draft that is really published", async () => {
    const [map, instructions] = await Promise.all([llms().text(), skill().text()]);
    for (const text of [map, instructions]) {
      expect(text).toContain("`base` (8453)");
      expect(text).toContain("/examples/revnet.jb");
      expect(text).toContain("https://github.com/mejango/jbcenter/blob/main/mcp/README.md");
      expect(text).not.toContain("·");
    }
    expect(existsSync("public/examples/revnet.jb")).toBe(true);
    expect(instructions).toContain("POST only, no session (a GET returns 405)");
    expect(map).toContain("/learn#stages");
  });
});
