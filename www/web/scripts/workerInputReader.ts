function readWorkerInput(url: string): string {
  const request = new XMLHttpRequest();
  request.open("POST", url, false);
  request.send();
  if (request.status !== 200) {
    throw new Error(`Could not read local runtime input: HTTP ${request.status}`);
  }
  return request.responseText;
}

export { readWorkerInput };
