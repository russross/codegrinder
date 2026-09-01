import path from "node:path";
import { fileURLToPath } from "node:url";
import webpack from "webpack";

import packageMetadata from "./package.json" with { type: "json" };

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const typescriptRule = {
  test: /\.ts$/,
  use: {
    loader: "ts-loader",
    options: { transpileOnly: true },
  },
  exclude: /node_modules/,
};

const resolve = {
  extensions: [".ts", ".js"],
  extensionAlias: {
    ".js": [".ts", ".js"],
  },
  modules: [path.resolve(dirname, "node_modules"), "node_modules"],
};

const browserConfig = {
  mode: "production",
  entry: {
    app: "./scripts/app.ts",
    directoryTree: "./scripts/directoryTree.ts",
    editorTabs: "./scripts/editorTabs.ts",
    embed: "./scripts/embed.ts",
    jsHandler: "./scripts/jsHandler.ts",
    jsRuntime: "./scripts/jsRuntime.ts",
    jsWorker: "./scripts/jsWorker.ts",
    localRuntime: "./scripts/localRuntime.ts",
    prompt: "./scripts/prompt.ts",
    pythonHandler: "./scripts/pythonHandler.ts",
    pythonRuntime: "./scripts/pythonRuntime.ts",
    pythonWorker: "./scripts/pythonWorker.ts",
    resizeInstructions: "./scripts/resizeInstructions.ts",
    resizeTerminal: "./scripts/resizeTerminal.ts",
    version: "./scripts/version.ts",
  },
  output: {
    path: path.resolve(dirname, "scripts"),
    filename: "[name].js",
    library: {
      type: "module",
    },
  },
  experiments: {
    outputModule: true,
  },
  plugins: [
    new webpack.DefinePlugin({
      CODEGRINDER_WEB_VERSION: JSON.stringify(packageMetadata.version),
    }),
  ],
  module: {
    rules: [typescriptRule],
  },
  resolve,
};

const serviceWorkerConfig = {
  mode: "production",
  target: "webworker",
  entry: {
    sw: "./sw.ts",
  },
  output: {
    path: path.resolve(dirname),
    filename: "[name].js",
  },
  module: {
    rules: [typescriptRule],
  },
  resolve,
};

export default [browserConfig, serviceWorkerConfig];
