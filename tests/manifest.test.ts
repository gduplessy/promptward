import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { manifest } from "../src/manifest";
import { APP_VERSION } from "../src/shared/debug";

describe("manifest", () => {
  it("does not expose model or ORT assets as web accessible resources", () => {
    const mv3 = manifest as chrome.runtime.ManifestV3;
    expect(JSON.stringify(mv3.web_accessible_resources ?? [])).not.toContain("models");
    expect(JSON.stringify(mv3.web_accessible_resources ?? [])).not.toContain("ort");
  });

  it("allows WASM under MV3 CSP without remote scripts", () => {
    const mv3 = manifest as chrome.runtime.ManifestV3;
    expect(mv3.content_security_policy?.extension_pages).toContain("'wasm-unsafe-eval'");
    expect(mv3.content_security_policy?.extension_pages).not.toContain("https:");
  });

  it("keeps visible versions aligned", () => {
    const mv3 = manifest as chrome.runtime.ManifestV3;
    expect(mv3.version).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
  });
});
