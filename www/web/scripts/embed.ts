import type { RuntimeName } from "./localRuntime.js";
import type { DirectoryNodeData } from "./directoryTree.js";
type EmbedLocation = Pick<Location, "origin" | "pathname">;
type SupportedProblemTypes = ReadonlyMap<string, RuntimeName>;

const legacyWebProblemType = "python3unittest";

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
  rootNode: DirectoryNodeData,
  problemType: string,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("dummy", "true");
  url.searchParams.set("problemType", problemType);
  url.searchParams.set("files", JSON.stringify(rootNode));
  const escapedUrl = url.toString().replaceAll("&", "&amp;");
  return `<div style="position: relative; padding-bottom: 56.25%; padding-top: 0px; height: 0; overflow: hidden;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" src="${escapedUrl}"></iframe></div>`;
}

export {
  createEmbedHtml,
  legacyWebProblemType,
  problemTypeFromFilePaths,
  standaloneProblemType,
};

export type { SupportedProblemTypes };
