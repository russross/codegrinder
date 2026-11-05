const webVersion = CODEGRINDER_WEB_VERSION;

function versionedAssetUrl(url: URL): URL {
  url.searchParams.set("version", webVersion);
  return url;
}

export { versionedAssetUrl, webVersion };
