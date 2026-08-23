function releaseSharedBuffers(identifiers) {
  const fallbackIdentifiers = identifiers.filter(identifier => identifier !== undefined);
  if (fallbackIdentifiers.length === 0) {
    return;
  }
  fetch(new URL("./ponyfill/release", import.meta.url), {
    body: JSON.stringify(fallbackIdentifiers),
    method: "POST",
  }).catch(error => console.warn("CodeGrinder: could not release emulated shared buffers", error));
}

export { releaseSharedBuffers };
