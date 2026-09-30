export class TerminalInputQueue {
    private readonly chunks: Uint8Array[] = [];
    private offset = 0;
    private timer: number | undefined;

    constructor(private readonly send: (bytes: Uint8Array) => number) {}

    enqueue(bytes: Uint8Array): void {
        if (bytes.length === 0) return;
        this.chunks.push(bytes.slice());
        this.schedule();
    }

    clear(): void {
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = undefined;
        this.chunks.length = 0;
        this.offset = 0;
    }

    private schedule(): void {
        if (this.timer !== undefined || this.chunks.length === 0) return;
        this.timer = window.setTimeout((): void => {
            this.timer = undefined;
            const chunk = this.chunks[0];
            const bytes = chunk.subarray(this.offset, this.offset + 1024);
            const accepted = this.send(bytes);
            if (!Number.isInteger(accepted) || accepted < 0 || accepted > bytes.length) {
                this.clear();
                throw new Error(`Invalid VM input acceptance count: ${accepted}`);
            }
            this.offset += accepted;
            if (this.offset === chunk.length) {
                this.chunks.shift();
                this.offset = 0;
            }
            this.schedule();
        }, 10);
    }
}
