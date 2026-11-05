import type { IDisposable, IEvent, Terminal } from "@xterm/xterm";

interface UserInputSource { readonly onUserInput: IEvent<void>; }
function isUserInputSource(value: unknown): value is UserInputSource {
    return typeof value === "object" && value !== null && "onUserInput" in value
        && typeof value.onUserInput === "function";
}

// The pinned xterm 6 core emits this signal immediately before user onData.
// Its public onData combines user input and protocol replies without a tag.
export function observeUserInput(widget: Terminal, callback: () => void): IDisposable {
    const core: unknown = Reflect.get(widget, "_core");
    const service: unknown = typeof core === "object" && core !== null ? Reflect.get(core, "coreService") : undefined;
    if (!isUserInputSource(service)) throw new Error("xterm user-input integration changed; review protocol reply routing");
    return service.onUserInput(callback);
}
