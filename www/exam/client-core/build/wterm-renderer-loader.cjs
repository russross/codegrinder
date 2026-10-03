module.exports = function (source) {
    const original = 'style: `background-image:${selected.map(() => "linear-gradient(currentColor,currentColor)").join(",")};background-position:${selected.map(([position]) => position).join(",")};background-size:${selected.map(([, size]) => size).join(",")};background-repeat:no-repeat;`,';
    if (source.split(original).length !== 2) {
        throw new Error("Wterm box drawing changed; review the geometric renderer integration");
    }
    const replacement = [
        'style: `',
        '--terminal-horizontal:${arms.includes("l") || arms.includes("r") ? "block" : "none"};',
        '--terminal-vertical:${arms.includes("u") || arms.includes("d") ? "block" : "none"};',
        '--terminal-left:${arms.includes("l") ? "-0.5px" : "calc(50% - var(--term-box-stroke) / 2)"};',
        '--terminal-right:${arms.includes("r") ? "-0.5px" : "calc(50% - var(--term-box-stroke) / 2)"};',
        '--terminal-top:${arms.includes("u") ? "-0.5px" : "calc(50% - var(--term-box-stroke) / 2)"};',
        '--terminal-bottom:${arms.includes("d") ? "-0.5px" : "calc(50% - var(--term-box-stroke) / 2)"};',
        '`,',
    ].join("");
    return source.replace(original, replacement);
};
