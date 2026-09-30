// Ghostty's selection copier must use the page's private clipboard policy.
module.exports = function ghosttyClipboardLoader(source) {
    const copier = /async copyToClipboard\(A\) \{[\s\S]*?\n  \}\n  \/\*\*/g;
    const matches = [...source.matchAll(copier)];
    if (matches.length !== 1 || !matches[0][0].includes("navigator.clipboard.writeText(A)")) {
        throw new Error("Ghostty selection copier changed; review the exam clipboard integration");
    }
    return source.replace(copier, `async copyToClipboard() {
    this.textarea.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }));
  }
  /**`);
};
