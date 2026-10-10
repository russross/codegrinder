// Input remains copied host memory until the browser FIFO accepts each byte.
export class TerminalInputQueue {
    private readonly chunks: Uint8Array[] = [];
    private offset = 0;
    private timer: number | undefined;

    constructor(private readonly send: (bytes: Uint8Array) => number) {}

    enqueue(bytes: Uint8Array, immediate = false): void {
        if (bytes.length === 0) return;
        this.chunks.push(bytes.slice());
        if (immediate) {
            if (this.timer !== undefined) window.clearTimeout(this.timer);
            this.timer = undefined;
            this.drain();
        } else this.schedule();
    }

    clear(): void {
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = undefined;
        this.chunks.length = 0;
        this.offset = 0;
    }

    // A browser task yields to CPU work before retrying a full input FIFO.
    private schedule(): void {
        if (this.timer !== undefined || this.chunks.length === 0) return;
        this.timer = window.setTimeout(() => {
            this.timer = undefined;
            this.drain();
        }, 10);
    }

    // Protocol replies get an immediate FIFO attempt while retaining earlier input order.
    private drain(): void {
        let budget = 1024;
        while (this.chunks.length > 0 && budget > 0) {
            const chunk = this.chunks[0];
            const bytes = chunk.subarray(this.offset, this.offset + budget);
            const accepted = this.send(bytes);
            if (!Number.isInteger(accepted) || accepted < 0 || accepted > bytes.length) {
                this.clear();
                throw new Error(`Invalid VM input acceptance count: ${accepted}`);
            }
            this.offset += accepted;
            budget -= accepted;
            if (this.offset === chunk.length) { this.chunks.shift(); this.offset = 0; }
            if (accepted < bytes.length) break;
        }
        this.schedule();
    }
}
