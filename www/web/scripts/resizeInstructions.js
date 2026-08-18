const sidebar = document.getElementById('instructions_container');
const resizeHandle = sidebar.getElementsByClassName('resize-handle')[0];

resizeHandle.addEventListener('mousedown', initResize, { passive: true });
resizeHandle.addEventListener('touchstart', initMobileResize, { passive: false });
resizeHandle.addEventListener('touchmove', mobileResize, { passive: false });

let startX;
let startWidth;

function initResize(e) {
  startX = e.clientX;
  startWidth = sidebar.clientWidth;
  document.addEventListener('mousemove', resize, { passive: false });
  document.addEventListener('mouseup', stopResize, { passive: true });
}
function initMobileResize(e) {
  startX = e.touches[0].clientX;
  startWidth = sidebar.clientWidth;
  if (e.cancelable) e.preventDefault();
}
function resize(e) {
  const width = startWidth - e.clientX + startX;
  sidebar.style.width = (width > 20 ? width : 20) + 'px';
  e.preventDefault();
}
function mobileResize(e) {
  const width = startWidth - e.touches[0].clientX + startX;
  sidebar.style.width = (width > 20 ? width : 20) + 'px';
  if (e.cancelable) e.preventDefault();
}

function stopResize() {
  document.removeEventListener('mousemove', resize);
  document.removeEventListener('mouseup', stopResize);
}