// Single-source version bump. Updates VERSION (canonical), package.json,
// src/manifest.ts, and src/shared/debug.ts together so the version-sync test
// (tests/manifest.test.ts) never trips on a partial bump.
//
// Usage: npm run bump-version -- 0.11.0
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Usage: npm run bump-version -- <x.y.z>  (got "${next ?? ""}")`);
  process.exit(1);
}

const versionFilePath = path.join(root, "VERSION");
const packagePath = path.join(root, "package.json");
const manifestPath = path.join(root, "src", "manifest.ts");
const debugPath = path.join(root, "src", "shared", "debug.ts");

const files = {
  [versionFilePath]: (content) => `${next}\n`,
  [packagePath]: (content) => {
    const pkg = JSON.parse(content);
    if (pkg.version === next) throw new Error(`package.json already at ${next}`);
    pkg.version = next;
    return `${JSON.stringify(pkg, null, 2)}\n`;
  },
  [manifestPath]: (content) =>
    content.replace(/(version:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`),
  [debugPath]: (content) =>
    content.replace(/(APP_VERSION\s*=\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`)
};

const updated = [];
for (const [file, transform] of Object.entries(files)) {
  const before = await fs.readFile(file, "utf8");
  const after = transform(before);
  if (before === after) {
    console.error(`✗ ${path.relative(root, file)}: no version string matched (already ${next}?)`);
    process.exit(1);
  }
  await fs.writeFile(file, after, "utf8");
  updated.push(path.relative(root, file));
}

console.log(`Bumped to ${next}:`);
for (const file of updated) console.log(`  ✓ ${file}`);
console.log("Run `npm test` to confirm the version-sync test passes.");
