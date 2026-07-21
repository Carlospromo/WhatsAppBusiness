import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve, dirname, sep } from "node:path";

const outputRoot = resolve(process.cwd(), "dist", "worker");

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : entry.name.endsWith(".js") ? [path] : [];
  }));
  return files.flat();
}

function esmPath(path) {
  const normalized = path.split(sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function localSpecifier(file, specifier) {
  const source = specifier.startsWith("@/")
    ? resolve(outputRoot, specifier.slice(2))
    : resolve(dirname(file), specifier);
  return esmPath(relative(dirname(file), `${source}.js`));
}

for (const file of await filesIn(outputRoot)) {
  const source = await readFile(file, "utf8");
  const rewritten = source.replaceAll(/(from\s*["']|import\s*["'])(@\/[^"']+|\.\.?\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => `${prefix}${localSpecifier(file, specifier)}${suffix}`);
  if (rewritten !== source) await writeFile(file, rewritten, "utf8");
}

await writeFile(resolve(outputRoot, "package.json"), '{"type":"module"}\n', "utf8");
