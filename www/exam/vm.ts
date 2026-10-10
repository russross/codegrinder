import type { Riscbox } from "@riscbox/runtime";
import { VmSession } from "./vm-session";
import type { VmImage, VmSessionOptions, VmTarget, VmTransition } from "./vm-session";
import assets from "./vm/build/assets.json";

export const EXAM_TRANSITION: VmTransition = {
    workspace: "files", poweroff: "force", discardDiskChanges: true, boot: false,
};

// Runtime scripts are keyed by their immutable URL, including failed-load retries.
declare global { interface Window { Riscbox?: typeof Riscbox; } }
const runtimes = new Map<string, Promise<typeof Riscbox>>();
export function loadRuntime(image: VmImage): Promise<typeof Riscbox> {
    const existing = runtimes.get(image.runtimeUrl);
    if (existing !== undefined) return existing;
    const loading = new Promise<typeof Riscbox>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = image.runtimeUrl;
        script.onload = () => {
            const constructor = window.Riscbox;
            if (constructor === undefined) reject(new Error("VM runtime did not expose Riscbox"));
            else resolve(constructor);
        };
        script.onerror = () => { script.remove(); reject(new Error("Could not load the VM runtime")); };
        document.body.append(script);
    });
    runtimes.set(image.runtimeUrl, loading);
    void loading.catch(() => { runtimes.delete(image.runtimeUrl); });
    return loading;
}

// Asset identity is fixed when this application bundle is built.
export function vmImageForProblemType(problemType: string): VmImage | undefined {
    if (problemType !== "riscv") return undefined;
    const location = new URL(window.location.href);
    const last = location.pathname.split("/").pop() ?? "";
    if (!location.pathname.endsWith("/") && !last.includes(".")) location.pathname += "/";
    const base = new URL(".", location);
    return Object.freeze({
        configUrl: new URL(assets.configUrl, base).href,
        runtimeUrl: new URL(assets.runtimeUrl, base).href,
        wasmUrl: new URL(assets.wasmUrl, base).href,
        memoryMiB: 256,
        shareName: "workspace",
    });
}

export class VmController<Target extends VmTarget> extends VmSession<Target> {
    constructor(host: HTMLElement, options: Omit<VmSessionOptions<Target>, "loadRuntime">) {
        super(host, { ...options, loadRuntime });
    }
    get ready(): Promise<void> { return this.terminal.ready; }

}
