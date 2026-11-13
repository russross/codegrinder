import MarkdownIt from "markdown-it";
import type { Filesystem } from "@riscbox/storage";
const decoder = new TextDecoder();
// Keep CommonMark syntax and safe output, with tables as the only extension.
const markdownParser = new MarkdownIt("commonmark").enable("table");
markdownParser.renderer.rules.html_block = markdownParser.renderer.rules.html_inline = () => "<!-- raw HTML omitted -->";
const validateLink = markdownParser.validateLink;
markdownParser.validateLink = url => validateLink(url) && !/^data:/i.test(url);
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
        case "webp": return "image/webp";
        case "svg": return "image/svg+xml";
        default: return null;
    }
}

export async function renderInstructions(filesystem: Pick<Filesystem, "listFiles" | "readFile">, dependencies: Set<string>, documentPath = "doc/doc.md"): Promise<string> {
    if (!(filesystem.listFiles()).includes(documentPath)) {
        return "";
    }
    const document = markdownParser.parse(decoder.decode(filesystem.readFile(documentPath)), {});
    const documentUrl = new URL(documentPath, "https://workspace.invalid/");
    const images = new Map<string, string>();
    // Inline tokens include images inside paragraphs, links, and table cells.
    function resolveImages(tokens: typeof document): void {
        for (const token of tokens) {
            const source = token.type === "image" ? token.attrGet("src") : null;
            if (typeof source === "string") {
                const url = new URL(source, documentUrl);
                if (url.origin === documentUrl.origin) {
                    const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
                    dependencies.add(path);
                    const content = filesystem.readFile(path);
                    const mimeType = imageMimeType(path);
                    if (mimeType === null) {
                        throw new Error(`Instruction image has an unsupported type: ${path}`);
                    }
                    images.set(url.href, `data:${mimeType};base64,${bytesToBase64(content)}`);
                    token.attrSet("src", url.href);
                }
            }
            if (token.children !== null) resolveImages(token.children);
        }
    }
    resolveImages(document);
    // Safe rendering runs before trusted workspace images receive their data URLs.
    const template = window.document.createElement("template");
    template.innerHTML = markdownParser.renderer.render(document, markdownParser.options, {});
    for (const image of template.content.querySelectorAll("img")) {
        const content = images.get(image.getAttribute("src") ?? "");
        if (content !== undefined) image.src = content;
    }
    return template.innerHTML;
}
