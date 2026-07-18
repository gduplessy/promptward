import { promises as fs } from "node:fs";
import path from "node:path";
import { ortDir, requiredOrtFiles, root, writeChecksums } from "./assets.mjs";

const sourceDir = path.join(root, "node_modules", "onnxruntime-web", "dist");
await fs.mkdir(ortDir, { recursive: true });

const available = new Set(await fs.readdir(sourceDir));
const missing = requiredOrtFiles.filter((file) => !available.has(file));
if (missing.length > 0) {
  throw new Error(`Missing expected ONNX Runtime Web assets in ${sourceDir}: ${missing.join(", ")}`);
}

const copied = [];
for (const item of requiredOrtFiles) {
  await fs.copyFile(path.join(sourceDir, item), path.join(ortDir, item));
  copied.push(item);
}

await writeChecksums();
console.log(`Vendored ${copied.length} ONNX Runtime Web assets into ${ortDir}`);
