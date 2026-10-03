import * as commonmark from "commonmark";
import type { Filesystem } from "@riscbox/storage";
const decoder = new TextDecoder();
const markdownParser = new commonmark.Parser();
const markdownRenderer = new commonmark.HtmlRenderer();
function bytesToBase64(content: Uint8Array): string {
    const chunks: string[] = [];
    for (let offset = 0; offset < content.length; offset += 32768) {
        chunks.push(String.fromCharCode(...content.subarray(offset, offset + 32768)));
    }
    return btoa(chunks.join(""));
}

function imageMimeType(path: string): string | null {
    const extension = path.split(".").pop()?.toLowerCase();
    switch (extension) {
        case "gif": return "image/gif";
        case "jpg":
        case "jpeg": return "image/jpeg";
        case "png": return "image/png";
        case "svg": return "image/svg+xml";
        default: return null;
    }
}

export async function renderInstructions(filesystem: Pick<Filesystem, "listFiles" | "readFile">, dependencies: Set<string>, documentPath = "doc/doc.md"): Promise<string> {
    if (!(filesystem.listFiles()).includes(documentPath)) {
        return "";
    }
    const document = markdownParser.parse(decoder.decode(filesystem.readFile(documentPath)));
    const documentUrl = new URL(documentPath, "https://workspace.invalid/");
    const walker = document.walker();
    let event = walker.next();
    while (event !== null) {
        if (event.entering && event.node.type === "image" && event.node.destination !== null) {
            const url = new URL(event.node.destination, documentUrl);
            if (url.origin === documentUrl.origin) {
                const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
                dependencies.add(path);
                const content = filesystem.readFile(path);
                const mimeType = imageMimeType(path);
                if (mimeType === null) {
                    throw new Error(`Instruction image has an unsupported type: ${path}`);
                }
                event.node.destination = `data:${mimeType};base64,${bytesToBase64(content)}`;
            }
        }
        event = walker.next();
    }
    return markdownRenderer.render(document);
}
