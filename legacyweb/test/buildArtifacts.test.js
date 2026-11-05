import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { webBuildVersion } from "../buildVersion.mjs";

const scriptsDirectory = new URL("../scripts/", import.meta.url);
const webDirectory = new URL("../", import.meta.url);

function readArtifact(name) {
  return readFileSync(new URL(name, scriptsDirectory), "utf8");
}

function webpackAssetBase(source, name) {
  const match = source.match(/new URL\("([^"]+)",import\.meta\.url\)/);
  assert.notEqual(match, null, `${name} does not contain a webpack asset base`);
  return match[1];
}

test("every deployable script belongs to the current source generation", () => {
  const expectedBanner = `/*! CodeGrinder web build ${webBuildVersion} */`;
  const artifactNames = readdirSync(scriptsDirectory)
    .filter((name) => name.endsWith(".js"));

  for (const name of artifactNames) {
    assert.equal(readArtifact(name).split("\n", 1)[0], expectedBanner, name);
  }
  const serviceWorker = readFileSync(new URL("sw.js", webDirectory), "utf8");
  assert.equal(serviceWorker.split("\n", 1)[0], expectedBanner, "sw.js");
});

test("classic worker bundles contain no module-only syntax", () => {
  for (const [name, source] of [
    ["jsWorker.js", readArtifact("jsWorker.js")],
    ["pythonWorker.js", readArtifact("pythonWorker.js")],
    ["sw.js", readFileSync(new URL("sw.js", webDirectory), "utf8")],
  ]) {
    assert.doesNotMatch(source, /\bimport\.meta\b/, name);
    assert.doesNotMatch(source, /(?:^|[;\n])\s*export(?:\s|\{)/, name);
  }
});

test("browser bundles contain no build-machine file URLs", () => {
  const artifactNames = readdirSync(scriptsDirectory)
    .filter((name) => name.endsWith(".js"));

  for (const name of artifactNames) {
    assert.doesNotMatch(readArtifact(name), /file:\/\/\//, name);
  }
});

test("browser bundles resolve deployed assets relative to the scripts directory", () => {
  for (const name of ["app.js", "localRuntime.js"]) {
    assert.equal(webpackAssetBase(readArtifact(name), name), "./", name);
  }
});
