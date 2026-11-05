import type MarkdownIt from "markdown-it";

declare global {
  const CODEGRINDER_WEB_VERSION: string;
  var Sk: unknown;

  interface Window {
    ace: AceAjax.Ace;
    markdownit: typeof MarkdownIt;
  }
}

export {};
