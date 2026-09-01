import type { RuntimeName } from "./localRuntime.js";
import type { WorkspaceFiles } from "./directoryTree.js";
type EmbedLocation = Pick<Location, "origin" | "pathname">;
type SupportedProblemTypes = ReadonlyMap<string, RuntimeName>;

interface SerializedFileNode {
  content: string;
}

interface SerializedDirectoryNode {
  children: Record<string, SerializedDirectoryNode | SerializedFileNode>;
}

const legacyWebProblemType = "python3unittest";
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFilePath(path: string): string {
  const parts = path.split("/");
  if (path === "" || path.startsWith("/") || path.includes("\\")
      || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Invalid embedded workspace path ${JSON.stringify(path)}`);
  }
  return parts.join("/");
}

function parseSerializedDirectory(value: unknown, parentPath = "", files: WorkspaceFiles = {}): WorkspaceFiles {
  if (!isRecord(value) || !isRecord(value.children)) {
    throw new Error("Embedded workspace directory must contain children");
  }
  for (const [name, node] of Object.entries(value.children)) {
    if (name === "" || name.includes("/")) {
      throw new Error(`Invalid embedded workspace name ${JSON.stringify(name)}`);
    }
    const path = parentPath === "" ? name : `${parentPath}/${name}`;
    if (!isRecord(node)) {
      throw new Error(`Invalid embedded workspace node ${JSON.stringify(path)}`);
    }
    if ("children" in node) {
      parseSerializedDirectory(node, path, files);
      continue;
    }
    if (typeof node.content !== "string") {
      throw new Error(`Embedded workspace file ${JSON.stringify(path)} must contain text`);
    }
    files[normalizeFilePath(path)] = textEncoder.encode(node.content);
  }
  return files;
}

function serializeFiles(files: Readonly<WorkspaceFiles>): SerializedDirectoryNode {
  const root: SerializedDirectoryNode = { children: {} };
  for (const [rawPath, content] of Object.entries(files)) {
    const parts = normalizeFilePath(rawPath).split("/");
    const fileName = parts.pop();
    if (fileName === undefined) {
      throw new Error(`Workspace path does not name a file: ${JSON.stringify(rawPath)}`);
    }
    let directory = root;
    for (const part of parts) {
      const existing = directory.children[part];
      if (existing !== undefined && !("children" in existing)) {
        throw new Error(`Workspace path crosses file ${JSON.stringify(part)}`);
      }
      if (existing === undefined) {
        directory.children[part] = { children: {} };
      }
      const child = directory.children[part];
      if (child === undefined || !("children" in child)) {
        throw new Error(`Workspace path crosses file ${JSON.stringify(part)}`);
      }
      directory = child;
    }
    directory.children[fileName] = { content: textDecoder.decode(content) };
  }
  return root;
}

function standaloneProblemType(
  searchParams: URLSearchParams,
  supportedProblemTypes: SupportedProblemTypes,
): string {
  const specified = searchParams.get("problemType");
  const requested = specified ?? legacyWebProblemType;
  if (specified === null) {
    console.info(`CodeGrinder: no runtime specified; defaulting to ${legacyWebProblemType}`);
  } else {
    console.info(`CodeGrinder: embed requested ${requested}`);
  }
  if (!supportedProblemTypes.has(requested)) {
    throw new Error(`No local runtime is configured for ${JSON.stringify(requested)}`);
  }
  return requested;
}

function problemTypeFromFilePaths(
  filePaths: readonly string[],
  supportedProblemTypes: SupportedProblemTypes,
): string | null {
  let hasJavaScript = false;
  let hasPython = false;
  for (const path of filePaths) {
    hasJavaScript ||= path.endsWith(".js");
    hasPython ||= path.endsWith(".py");
  }
  if (hasJavaScript === hasPython) {
    return null;
  }

  const runtimeName: RuntimeName = hasJavaScript ? "javascript" : "python";
  const matchingProblemTypes = [...supportedProblemTypes]
    .filter(([, configuredRuntime]) => configuredRuntime === runtimeName)
    .map(([problemType]) => problemType);
  return matchingProblemTypes.length === 1 ? matchingProblemTypes[0] : null;
}

function createEmbedHtml(
  location: EmbedLocation,
  files: Readonly<WorkspaceFiles>,
  problemType: string,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("dummy", "true");
  url.searchParams.set("problemType", problemType);
  url.searchParams.set("files", JSON.stringify(serializeFiles(files)));
  const escapedUrl = url.toString().replaceAll("&", "&amp;");
  return `<div style="position: relative; padding-bottom: 56.25%; padding-top: 0px; height: 0; overflow: hidden;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" src="${escapedUrl}"></iframe></div>`;
}

export {
  createEmbedHtml,
  legacyWebProblemType,
  parseSerializedDirectory,
  problemTypeFromFilePaths,
  standaloneProblemType,
};

export type { SupportedProblemTypes };
