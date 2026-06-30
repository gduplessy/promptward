import { describe, expect, it } from "vitest";
import { findSubmitTrigger } from "../src/content/submit-detection";

describe("submit trigger detection", () => {
  it("matches SVG descendants inside send buttons", () => {
    document.body.innerHTML = `
      <button aria-label="Send prompt">
        <svg><path id="send-path"></path></svg>
      </button>
    `;
    const path = document.querySelector("#send-path");

    const trigger = findSubmitTrigger(path);

    expect(trigger?.tagName).toBe("BUTTON");
  });

  it("ignores non-submit buttons", () => {
    document.body.innerHTML = `<button type="button" aria-label="Attach file"><span id="icon"></span></button>`;

    expect(findSubmitTrigger(document.querySelector("#icon"))).toBeUndefined();
  });
});
