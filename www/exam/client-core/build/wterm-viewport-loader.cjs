module.exports = function (source) {
    const original = `scrollTop: this._shouldScrollToBottom
                ? Math.max(0, (scrollbackCount + this.rows) * rowHeight -
                    this.element.clientHeight)
                : scrollTop,`;
    if (source.split(original).length !== 2) {
        throw new Error("Wterm viewport alignment changed; review the live-screen integration");
    }
    const inputSync = "        this.input?.syncInputPosition();";
    if (source.split(inputSync).length !== 2) {
        throw new Error("Wterm input positioning changed; review the live-screen integration");
    }
    // Browser scroll offsets can round across the live boundary at fractional
    // scaling. Clip retained history there, including rows kept for selection.
    return source.replace(original, `scrollTop: this._shouldScrollToBottom || scrollTop >= scrollbackCount * rowHeight - 1
                ? scrollbackCount * rowHeight : scrollTop,
            overscanRows: this._shouldScrollToBottom || scrollTop >= scrollbackCount * rowHeight - 1 ? 0 : undefined,`)
        .replace(inputSync, `        this._container.style.clipPath = this._shouldScrollToBottom || this.element.scrollTop >= scrollbackCount * rowHeight - 1
            ? \`inset(\${scrollbackCount * rowHeight}px 0 0 0)\` : "";
${inputSync}`);
};
