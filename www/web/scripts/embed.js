const legacyWebProblemType = "python3unittest";

function standaloneProblemType(searchParams, supportedProblemTypes) {
  const requested = searchParams.get("problemType") ?? legacyWebProblemType;
  if (!supportedProblemTypes.has(requested)) {
    throw new Error(`No local runtime is configured for ${JSON.stringify(requested)}`);
  }
  return requested;
}

function createEmbedHtml(location, rootNode, problemType) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("dummy", "true");
  url.searchParams.set("problemType", problemType);
  url.searchParams.set("files", JSON.stringify(rootNode));
  const escapedUrl = url.toString().replaceAll("&", "&amp;");
  return `<div style="position: relative; padding-bottom: 56.25%; padding-top: 0px; height: 0; overflow: hidden;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" src="${escapedUrl}"></iframe></div>`;
}

export { createEmbedHtml, legacyWebProblemType, standaloneProblemType };
