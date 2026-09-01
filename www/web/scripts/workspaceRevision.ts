interface WorkspaceRevision {
  readonly value: number;
}

class WorkspaceRevisionState {
  #current = 0;
  #synced = 0;

  get dirty(): boolean {
    return this.#current > this.#synced;
  }

  capture(): WorkspaceRevision {
    return { value: this.#current };
  }

  markChanged(): void {
    this.#current += 1;
  }

  markLoaded(): void {
    this.#synced = this.#current;
  }

  markSaved(revision: WorkspaceRevision): void {
    this.#synced = Math.max(this.#synced, Math.min(revision.value, this.#current));
  }
}

export { WorkspaceRevisionState };
export type { WorkspaceRevision };
