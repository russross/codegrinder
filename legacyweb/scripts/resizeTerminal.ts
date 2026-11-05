const terminalElement = document.getElementById("terminal_container");
if (!(terminalElement instanceof HTMLElement)) {
  throw new Error("Required page element #terminal_container is missing");
}
const terminal: HTMLElement = terminalElement;
const resizeHandle = terminal.getElementsByClassName("resize-handle").item(0);
if (!(resizeHandle instanceof HTMLElement)) {
  throw new Error("Required terminal resize handle is missing");
}

let startHeight = 0;
let startY = 0;

function stopResize(): void {
  document.removeEventListener("mousemove", resize);
  document.removeEventListener("mouseup", stopResize);
}

function resize(event: MouseEvent): void {
  terminal.style.height = `${Math.max(20, startHeight - event.clientY + startY)}px`;
  event.preventDefault();
}

function initializeResize(event: MouseEvent): void {
  startY = event.clientY;
  startHeight = terminal.clientHeight;
  document.addEventListener("mousemove", resize, { passive: false });
  document.addEventListener("mouseup", stopResize, { passive: true });
}

function mobileResize(event: TouchEvent): void {
  const touch = event.touches.item(0);
  if (touch === null) {
    return;
  }
  terminal.style.height = `${Math.max(20, startHeight - touch.clientY + startY)}px`;
  if (event.cancelable) {
    event.preventDefault();
  }
}

function initializeMobileResize(event: TouchEvent): void {
  const touch = event.touches.item(0);
  if (touch === null) {
    return;
  }
  startY = touch.clientY;
  startHeight = terminal.clientHeight;
  if (event.cancelable) {
    event.preventDefault();
  }
}

resizeHandle.addEventListener("mousedown", initializeResize, { passive: true });
resizeHandle.addEventListener("touchstart", initializeMobileResize, { passive: false });
resizeHandle.addEventListener("touchmove", mobileResize, { passive: false });

export {};
