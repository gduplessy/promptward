import { promises as fs } from "node:fs";
import path from "node:path";
import { assetManifestPath, listPublicAssetFiles, modelDir, ortDir, requiredModelFiles, root, sha256 } from "./assets.mjs";

const failures = [];

for (const file of requiredModelFiles) {
  await expectFile(path.join(modelDir, file));
}

const ortFiles = await readdirSafe(ortDir);
if (!ortFiles.some((file) => file.endsWith(".wasm"))) {
  failures.push("Missing public/ort/*.wasm");
}
if (!ortFiles.some((file) => file.endsWith(".mjs"))) {
  failures.push("Missing public/ort/*.mjs");
}

const manifest = await readAssetManifest();
if (!manifest) {
  failures.push("Missing public/asset-manifest.json; run npm run vendor:rampart && npm run vendor:ort");
} else {
  const actualFiles = await listPublicAssetFiles();
  for (const relative of actualFiles) {
    const expected = manifest.sha256?.[relative];
    if (!expected) {
      failures.push(`Missing checksum for public/${relative}`);
      continue;
    }
    const actual = await sha256(path.join(root, "public", relative));
    if (actual !== expected) failures.push(`Checksum mismatch for public/${relative}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log("Local model and ORT assets verified");

async function expectFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size === 0) failures.push(`Missing or empty ${path.relative(root, filePath)}`);
  } catch {
    failures.push(`Missing ${path.relative(root, filePath)}`);
  }
}

async function readdirSafe(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function readAssetManifest() {
  try {
    return JSON.parse(await fs.readFile(assetManifestPath, "utf8"));
  } catch {
    return undefined;
  }
}
