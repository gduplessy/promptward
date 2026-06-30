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

  it("ignores unlabeled submit buttons outside prompt forms", () => {
    document.body.innerHTML = `<button><svg><path id="path"></path></svg></button>`;

    expect(findSubmitTrigger(document.querySelector("#path"))).toBeUndefined();
  });

  it("ignores search submitters without send signals", () => {
    document.body.innerHTML = `
      <form>
        <input name="q" value="are there easy hikes at yosemite" />
        <button type="submit" aria-label="Search"><span id="search-icon"></span></button>
      </form>
    `;

    expect(findSubmitTrigger(document.querySelector("#search-icon"))).toBeUndefined();
  });

  it("matches data-testid send controls", () => {
    document.body.innerHTML = `<button type="button" data-testid="send-button"><span id="send-icon"></span></button>`;

    expect(findSubmitTrigger(document.querySelector("#send-icon"))?.tagName).toBe("BUTTON");
  });

  it("ignores disabled send controls", () => {
    document.body.innerHTML = `<button aria-label="Send prompt" disabled><span id="send-icon"></span></button>`;

    expect(findSubmitTrigger(document.querySelector("#send-icon"))).toBeUndefined();
  });
});
