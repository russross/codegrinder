enum Arm {
    Left = 1,
    Right = 2,
    Up = 4,
    Down = 8,
}

const armsByCharacter: ReadonlyMap<string, number> = new Map([
    ["─", Arm.Left | Arm.Right],
    ["│", Arm.Up | Arm.Down],
    ["┌", Arm.Right | Arm.Down],
    ["┐", Arm.Left | Arm.Down],
    ["└", Arm.Right | Arm.Up],
    ["┘", Arm.Left | Arm.Up],
    ["├", Arm.Right | Arm.Up | Arm.Down],
    ["┤", Arm.Left | Arm.Up | Arm.Down],
    ["┬", Arm.Left | Arm.Right | Arm.Down],
    ["┴", Arm.Left | Arm.Right | Arm.Up],
    ["┼", Arm.Left | Arm.Right | Arm.Up | Arm.Down],
]);

export function drawBoxCharacter(
    context: CanvasRenderingContext2D,
    character: string,
    x: number,
    y: number,
    width: number,
    height: number,
    pixelRatio: number,
): boolean {
    const arms = armsByCharacter.get(character);
    if (arms === undefined) return false;
    const left = Math.round(x * pixelRatio);
    const top = Math.round(y * pixelRatio);
    const right = Math.round((x + width) * pixelRatio);
    const bottom = Math.round((y + height) * pixelRatio);
    const thickness = Math.max(1, Math.round(pixelRatio));
    const centerX = Math.floor((left + right - thickness) / 2);
    const centerY = Math.floor((top + bottom - thickness) / 2);
    context.save();
    context.resetTransform();
    if (arms & (Arm.Left | Arm.Right)) {
        const start = arms & Arm.Left ? left : centerX;
        const end = arms & Arm.Right ? right : centerX + thickness;
        context.fillRect(start, centerY, end - start, thickness);
    }
    if (arms & (Arm.Up | Arm.Down)) {
        const start = arms & Arm.Up ? top : centerY;
        const end = arms & Arm.Down ? bottom : centerY + thickness;
        context.fillRect(centerX, start, thickness, end - start);
    }
    context.restore();
    return true;
}
