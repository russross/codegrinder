import { fileURLToPath } from "node:url";

// Both consumers apply the same guarded patches to the pinned Wterm sources.
export const clientCoreModules = fileURLToPath(new URL("../node_modules", import.meta.url));
export function clientCoreRules() {
    return [
        { test: /@wterm\/dom\/dist\/wterm\.js$/, use: fileURLToPath(new URL("wterm-viewport-loader.cjs", import.meta.url)) },
        { test: /@wterm\/dom\/dist\/renderer\.js$/, use: fileURLToPath(new URL("wterm-renderer-loader.cjs", import.meta.url)) },
    ];
}
