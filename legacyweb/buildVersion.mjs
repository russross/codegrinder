import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import packageMetadata from "./package.json" with { type: "json" };

const webDirectory = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(directory, entry.name));
}

const buildInputPaths = [
  path.join(webDirectory, "browser-globals.d.ts"),
  path.join(webDirectory, "buildVersion.mjs"),
  path.join(webDirectory, "index.html"),
  path.join(webDirectory, "local-runtimes.json"),
  path.join(webDirectory, "package-lock.json"),
  path.join(webDirectory, "package.json"),
  path.join(webDirectory, "styles.css"),
  path.join(webDirectory, "sw.ts"),
  path.join(webDirectory, "tsconfig.json"),
  path.join(webDirectory, "tsconfig.worker.json"),
  path.join(webDirectory, "webpack.config.mjs"),
  path.resolve(webDirectory, "../../protocol/codegrinder.proto"),
  ...sourceFiles(path.join(webDirectory, "scripts")),
].sort();

function computeBuildRevision() {
  const hash = createHash("sha256");
  for (const inputPath of buildInputPaths) {
    hash.update(path.relative(webDirectory, inputPath));
    hash.update("\0");
    hash.update(readFileSync(inputPath));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

const webBuildVersion = `${packageMetadata.version}+${computeBuildRevision()}`;

export { buildInputPaths, webBuildVersion };
