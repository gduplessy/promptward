import { promises as fs } from "node:fs";
import path from "node:path";
import { ortDir, root, writeChecksums } from "./assets.mjs";

const sourceDir = path.join(root, "node_modules", "onnxruntime-web", "dist");
await fs.mkdir(ortDir, { recursive: true });

const copied = [];
for (const item of await fs.readdir(sourceDir)) {
  if (!/\.(wasm|mjs)$/.test(item)) continue;
  await fs.copyFile(path.join(sourceDir, item), path.join(ortDir, item));
  copied.push(item);
}

if (!copied.some((file) => file.endsWith(".wasm"))) {
  throw new Error("No ONNX Runtime Web WASM assets were copied");
}

await writeChecksums();
console.log(`Vendored ${copied.length} ONNX Runtime Web assets into ${ortDir}`);
