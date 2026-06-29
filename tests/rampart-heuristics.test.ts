import { createGuard } from "@nationaldesignstudio/rampart";
import { describe, expect, it } from "vitest";

describe("Rampart heuristic safety net", () => {
  it("redacts structurally valid SSN-like values", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    const result = await guard.protect("My name is John Smith and my social security number is 123-34-1223.");

    expect(result.text).toContain("[SSN_1]");
    expect(result.text).not.toContain("123-34-1223");
  });
});
