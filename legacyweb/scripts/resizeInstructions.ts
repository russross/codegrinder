const instructionsElement = document.getElementById("instructions_container");
if (!(instructionsElement instanceof HTMLElement)) {
  throw new Error("Required page element #instructions_container is missing");
}
const instructions: HTMLElement = instructionsElement;
const resizeHandle = instructions.getElementsByClassName("resize-handle").item(0);
if (!(resizeHandle instanceof HTMLElement)) {
  throw new Error("Required instructions resize handle is missing");
}

let startWidth = 0;
let startX = 0;

function stopResize(): void {
  document.removeEventListener("mousemove", resize);
  document.removeEventListener("mouseup", stopResize);
}

function resize(event: MouseEvent): void {
  instructions.style.width = `${Math.max(20, startWidth - event.clientX + startX)}px`;
  event.preventDefault();
}

function initializeResize(event: MouseEvent): void {
  startX = event.clientX;
  startWidth = instructions.clientWidth;
  document.addEventListener("mousemove", resize, { passive: false });
  document.addEventListener("mouseup", stopResize, { passive: true });
}

function mobileResize(event: TouchEvent): void {
  const touch = event.touches.item(0);
  if (touch === null) {
    return;
  }
  instructions.style.width = `${Math.max(20, startWidth - touch.clientX + startX)}px`;
  if (event.cancelable) {
    event.preventDefault();
  }
}

function initializeMobileResize(event: TouchEvent): void {
  const touch = event.touches.item(0);
  if (touch === null) {
    return;
  }
  startX = touch.clientX;
  startWidth = instructions.clientWidth;
  if (event.cancelable) {
    event.preventDefault();
  }
}

resizeHandle.addEventListener("mousedown", initializeResize, { passive: true });
resizeHandle.addEventListener("touchstart", initializeMobileResize, { passive: false });
resizeHandle.addEventListener("touchmove", mobileResize, { passive: false });

export {};
