import { promises as fs } from "node:fs";
import path from "node:path";
import { modelDir, requiredModelFiles, writeChecksums } from "./assets.mjs";

const base = "https://huggingface.co/nationaldesignstudio/rampart/resolve/main";

await fs.mkdir(modelDir, { recursive: true });

for (const file of requiredModelFiles) {
  const target = path.join(modelDir, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const response = await fetch(`${base}/${file}`);
  if (!response.ok) {
    throw new Error(`Failed to download ${file}: ${response.status} ${response.statusText}`);
  }
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}

await writeChecksums();
console.log(`Vendored Rampart model assets into ${modelDir}`);
