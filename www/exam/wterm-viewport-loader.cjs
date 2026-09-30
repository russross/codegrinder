module.exports = function (source) {
    const original = `scrollTop: this._shouldScrollToBottom
                ? Math.max(0, (scrollbackCount + this.rows) * rowHeight -
                    this.element.clientHeight)
                : scrollTop,`;
    if (source.split(original).length !== 2) {
        throw new Error("Wterm viewport alignment changed; review the live-screen integration");
    }
    return source.replace(original, `scrollTop: this._shouldScrollToBottom ? scrollbackCount * rowHeight : scrollTop,
            overscanRows: this._shouldScrollToBottom || scrollTop >= scrollbackCount * rowHeight ? 0 : undefined,`);
};
