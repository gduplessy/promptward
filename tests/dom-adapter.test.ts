import { describe, expect, it } from "vitest";
import { findEditorIn, inputHandle } from "../src/content/dom-adapter";

describe("DOM adapter", () => {
  it("extracts and replaces textarea text", () => {
    document.body.innerHTML = `<form><textarea>Hello</textarea></form>`;
    const textarea = document.querySelector("textarea");
    if (!textarea) throw new Error("missing textarea");

    const handle = inputHandle(textarea);
    handle.setText("Redacted");

    expect(handle.getText()).toBe("Redacted");
  });

  it("finds contenteditable editors", () => {
    document.body.innerHTML = `<div contenteditable="true">Hello</div>`;
    const handle = findEditorIn(document.body);

    handle?.setText("Safe");

    expect(handle?.getText()).toBe("Safe");
  });
});
