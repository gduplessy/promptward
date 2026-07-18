import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const root = process.cwd();
export const modelDir = path.join(root, "public", "models", "rampart");
export const ortDir = path.join(root, "public", "ort");
export const assetManifestPath = path.join(root, "public", "asset-manifest.json");

export const requiredModelFiles = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.txt",
  "onnx/model_q4.onnx",
  "README.md",
  "LICENSE"
];

// @huggingface/transformers imports the bare "onnxruntime-web" specifier,
// which onnxruntime-web's package.json "exports" resolves to
// dist/ort.bundle.min.mjs (the jsep-capable bundle) regardless of the
// device option passed to the transformers pipeline — device: "wasm" only
// gates the WebGPU *buffer registration* inside that bundle's init, not
// which WASM binary it instantiates. So the jsep pair is the one actually
// fetched at runtime, not the plain (non-jsep) pair — confirmed by grepping
// ort.bundle.min.mjs for "ort-wasm-simd-threaded" references (4 jsep, 0
// plain). If a future change switches the import to the "onnxruntime-web/wasm"
// subpath (dist/ort.wasm.bundle.min.mjs), re-derive this list — that bundle
// loads the plain pair instead. See plans/007's maintenance notes.
export const requiredOrtFiles = ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"];

export async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

export async function writeChecksums() {
  const entries = {};
  for (const relative of await listPublicAssetFiles()) {
    entries[relative] = await sha256(path.join(root, "public", relative));
  }
  await fs.writeFile(assetManifestPath, `${JSON.stringify({ sha256: entries }, null, 2)}\n`);
}

export async function listPublicAssetFiles() {
  const files = [];
  await walk(path.join(root, "public"), "");
  return files.sort();

  async function walk(abs, rel) {
    const items = await fs.readdir(abs, { withFileTypes: true });
    for (const item of items) {
      const childAbs = path.join(abs, item.name);
      const childRel = path.posix.join(rel.replaceAll(path.sep, "/"), item.name);
      if (childRel === "asset-manifest.json") continue;
      if (item.isDirectory()) {
        await walk(childAbs, childRel);
      } else {
        files.push(childRel);
      }
    }
  }
}
