// Cell edges, backing dimensions, and box strokes share the physical pixel grid.
module.exports = function ghosttyRendererLoader(source) {
    const replacements = [
        ["E = Math.ceil(g.width)", "E = Math.ceil(g.width * this.devicePixelRatio) / this.devicePixelRatio"],
        ["D = Math.ceil(C + I) + 2", "D = Math.ceil((C + I + 2) * this.devicePixelRatio) / this.devicePixelRatio"],
        ["i = Math.ceil(C) + 1", "i = Math.ceil((C + 1) * this.devicePixelRatio) / this.devicePixelRatio"],
        ["this.canvas.width = g * this.devicePixelRatio", "this.canvas.width = Math.round(g * this.devicePixelRatio)"],
        ["this.canvas.height = E * this.devicePixelRatio", "this.canvas.height = Math.round(E * this.devicePixelRatio)"],
        ["this.canvas.width !== D.cols * this.metrics.width * this.devicePixelRatio", "this.canvas.width !== Math.round(D.cols * this.metrics.width * this.devicePixelRatio)"],
        ["this.canvas.height !== D.rows * this.metrics.height * this.devicePixelRatio", "this.canvas.height !== Math.round(D.rows * this.metrics.height * this.devicePixelRatio)"],
        ["this.ctx.fillText(N, w, s)", "drawBoxCharacter(this.ctx, N, E, C, I, this.metrics.height, this.devicePixelRatio) || this.ctx.fillText(N, w, s)"],
    ];
    for (const [original, replacement] of replacements) {
        if (source.split(original).length !== 2) {
            throw new Error("Ghostty canvas sizing changed; review the fractional pixel ratio integration");
        }
        source = source.replace(original, replacement);
    }
    const boxDrawing = JSON.stringify(require.resolve("./box-drawing.ts"));
    return `import { drawBoxCharacter } from ${boxDrawing};\n${source}`;
};
