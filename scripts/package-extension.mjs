import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import yazl from "yazl";

const distDir = path.join(process.cwd(), "dist");
const packageDir = path.join(process.cwd(), "packages");
await fs.mkdir(packageDir, { recursive: true });

const output = path.join(packageDir, "promptward-extension.zip");
const files = [];
await walk(distDir, "");

const zip = new yazl.ZipFile();
for (const file of files.sort()) {
  zip.addFile(path.join(distDir, file), file);
}

await new Promise((resolve, reject) => {
  zip.outputStream.pipe(createWriteStream(output)).on("close", resolve).on("error", reject);
  zip.end();
});
console.log(`Wrote ${output}`);

async function walk(abs, rel) {
  const items = await fs.readdir(abs, { withFileTypes: true });
  for (const item of items) {
    const childAbs = path.join(abs, item.name);
    const childRel = path.posix.join(rel.replaceAll(path.sep, "/"), item.name);
    if (item.isDirectory()) await walk(childAbs, childRel);
    else files.push(childRel);
  }
}
