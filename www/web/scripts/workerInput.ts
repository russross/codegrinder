interface WorkerInput {
  readonly readUrl: string;
  close(): void;
  write(value: string): Promise<void>;
}

class ServiceWorkerInput implements WorkerInput {
  readonly readUrl: string;
  readonly #closeUrl: URL;
  readonly #writeUrl: URL;
  #closed = false;

  constructor(channelId: string) {
    const channelUrl = new URL(
      /* webpackIgnore: true */ `../worker-input/${channelId}/`,
      import.meta.url,
    );
    this.readUrl = new URL("read", channelUrl).href;
    this.#writeUrl = new URL("write", channelUrl);
    this.#closeUrl = new URL("close", channelUrl);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    fetch(this.#closeUrl, { keepalive: true, method: "POST" }).catch((error: unknown) => {
      console.warn("CodeGrinder: could not close worker input channel", error);
    });
  }

  async write(value: string): Promise<void> {
    if (this.#closed) {
      throw new Error("The local runtime input channel is closed");
    }
    const response = await fetch(this.#writeUrl, {
      body: value,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Could not send local runtime input: HTTP ${response.status}`);
    }
  }
}

function createWorkerInput(): WorkerInput {
  return new ServiceWorkerInput(crypto.randomUUID());
}

export { createWorkerInput };
export type { WorkerInput };
