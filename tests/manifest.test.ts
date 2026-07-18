import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { manifest } from "../src/manifest";
import { APP_VERSION } from "../src/shared/debug";

// VERSION is the canonical source of truth for the release number; the three
// version strings users actually see (manifest, package.json, APP_VERSION) must
// all equal it. Catching drift here is what makes a version bump observable —
// otherwise reloading the unpacked extension shows the old number and it's not
// obvious which of the three sources was missed.
const VERSION_FILE = readFileSync(resolve(__dirname, "../VERSION"), "utf8").trim();

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

  it("keeps every version source equal to the VERSION file", () => {
    const mv3 = manifest as chrome.runtime.ManifestV3;
    expect(mv3.version).toBe(VERSION_FILE);
    expect(APP_VERSION).toBe(VERSION_FILE);
    expect(pkg.version).toBe(VERSION_FILE);
  });
});
