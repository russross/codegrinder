const sidebar = document.getElementById('terminal_container');
const resizeHandle = sidebar.getElementsByClassName('resize-handle')[0];

resizeHandle.addEventListener('mousedown', initResize, { passive: true });
resizeHandle.addEventListener('touchstart', initMobileResize, { passive: false });
resizeHandle.addEventListener('touchmove', mobileResize, { passive: false });

let startY;
let startHeight;

function initResize(e) {
  startY = e.clientY;
  startHeight = sidebar.clientHeight;
  document.addEventListener('mousemove', resize, { passive: false });
  document.addEventListener('mouseup', stopResize, { passive: true });
}
function initMobileResize(e) {
  startY = e.touches[0].clientY;
  startHeight = sidebar.clientHeight;
  if (e.cancelable) e.preventDefault();
}
function resize(e) {
  const height = startHeight - e.clientY + startY;
  sidebar.style.height = (height > 20 ? height : 20) + 'px';
  e.preventDefault();
}
function mobileResize(e) {
  const height = startHeight - e.touches[0].clientY + startY;
  sidebar.style.height = (height > 20 ? height : 20) + 'px';
  if (e.cancelable) e.preventDefault();
}

function stopResize() {
  document.removeEventListener('mousemove', resize);
  document.removeEventListener('mouseup', stopResize);
}