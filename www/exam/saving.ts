const AUTOSAVE_DELAY_MS = 30_000;

export class SaveState {
    private readonly requestSave: () => void;
    private savedRevision: number;
    private pendingEdits = false;
    private timer: number | undefined;
    private stopped = false;

    constructor(revision: number, requestSave: () => void) {
        this.requestSave = requestSave;
        this.savedRevision = revision;
    }

    isDirty(revision: number): boolean {
        return revision !== this.savedRevision;
    }

    changed(): void {
        if (this.stopped || this.pendingEdits) {
            return;
        }
        this.pendingEdits = true;
        const timer = window.setTimeout((): void => {
            if (this.timer !== timer) {
                return;
            }
            this.timer = undefined;
            this.requestSave();
        }, AUTOSAVE_DELAY_MS);
        this.timer = timer;
    }

    cancelTimer(): void {
        if (this.timer === undefined) {
            return;
        }
        window.clearTimeout(this.timer);
        this.timer = undefined;
    }

    submitted(): void {
        this.cancelTimer();
        this.pendingEdits = false;
    }

    acknowledge(revision: number, currentRevision: number): void {
        if (this.stopped) {
            return;
        }
        this.savedRevision = Math.max(this.savedRevision, revision);
        if (!this.isDirty(currentRevision)) {
            this.cancelTimer();
            this.pendingEdits = false;
        }
    }

    retry(): void {
        if (this.stopped || this.timer !== undefined) {
            return;
        }
        this.pendingEdits = false;
        this.changed();
    }

    stop(): void {
        this.stopped = true;
        this.cancelTimer();
    }
}
