// Sample the browser's preferred text size once; later zoom remains browser-owned.
export const defaultFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
export const monospaceFontFamily = '"Latin Modern Mono", monospace';
