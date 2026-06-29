import { describe, expect, it } from "vitest";
import { findEditorIn, inputHandle, submitNative } from "../src/content/dom-adapter";

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

  it("replays native form submits", () => {
    document.body.innerHTML = `<form><textarea>Hello</textarea><button type="submit">Send</button></form>`;
    const form = document.querySelector("form");
    if (!form) throw new Error("missing form");
    let submitted = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted = true;
    });

    submitNative(form);

    expect(submitted).toBe(true);
  });
});
