import { renderInstructions } from "../instructions.ts";

const encoder = new TextEncoder();
const check = (condition, message) => { if (!condition) throw new Error(message); };

export async function run() {
    const files = new Map();
    const fs = {
        listFiles: () => [...files.keys()],
        readFile: path => {
            if (!files.has(path)) throw new Error(`Missing file: ${path}`);
            return encoder.encode(files.get(path));
        },
    };
    const host = document.createElement("section");
    document.body.append(host);
    const dependencies = new Set();
    const render = async () => { host.innerHTML = await renderInstructions(fs, dependencies); };

    // Safe Markdown keeps ordinary formatting while denying executable HTML and URLs.
    files.set("doc/doc.md", '# Documentation\n<img src="/missing" onerror="window.instructionsExecuted=true">\n\n[unsafe](javascript:alert(1))');
    await render();
    await new Promise(resolve => setTimeout(resolve, 50));
    check(!window.instructionsExecuted && !host.querySelector("img"), "raw HTML became executable");
    check(!host.querySelector('a[href^="javascript:"]'), "unsafe link survived filtering");
    check(host.querySelector("h1").textContent === "Documentation", "ordinary Markdown changed");

    // Missing images remain dependencies, and an SVG image cannot execute in the host origin.
    files.set("doc/doc.md", '# New documentation\n![diagram](diagram.svg)');
    await render().then(() => { throw new Error("missing image should fail"); }, error => {
        check(error.message.includes("Missing file"), "image failure changed");
    });
    check(dependencies.has("doc/diagram.svg"), "missing image dependency was lost");
    files.set("doc/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" onload="window.instructionsExecuted=true"><rect width="20" height="20"/></svg>');
    await render();
    const image = host.querySelector("img");
    await image.decode();
    check(image.src.startsWith("data:image/svg+xml;base64,") && image.naturalWidth === 20, "relative SVG image did not load");
    check(!window.instructionsExecuted, "SVG image executed host JavaScript");

    // Tables support inline content, alignment, escaped pipes, and workspace images.
    files.set("doc/doc.md", '| Item | Value |\n| :--- | ---: |\n| **bold** | `a\\|b` |\n| ![diagram](diagram.svg) | [link](https://example.com) |');
    await render();
    check(host.querySelectorAll("thead th").length === 2 && host.querySelectorAll("tbody tr").length === 2, "table structure changed");
    check(host.querySelector("th").style.textAlign === "left" && host.querySelectorAll("th")[1].style.textAlign === "right", "table alignment was lost");
    check(host.querySelector("td strong").textContent === "bold" && host.querySelector("td code").textContent === "a|b", "table inline formatting changed");
    await host.querySelector("td img").decode();
    check(host.querySelector("td img").naturalWidth === 20 && dependencies.has("doc/diagram.svg"), "table image did not load or track its dependency");

    // Other extension syntax remains ordinary CommonMark text.
    files.set("doc/doc.md", '~~plain~~ https://example.com note[^1]\n\n[^1]: footnote\n\n- [ ] task');
    await render();
    check(!host.querySelector('del, a[href="https://example.com"], input, sup, .footnotes'), "an unrequested extension was enabled");
    check(host.textContent.includes("~~plain~~") && host.textContent.includes("[ ] task"), "extension syntax disappeared");

    // Unsupported images fail clearly, while removing documentation clears the rendered result.
    files.set("doc/doc.md", '![unsupported](diagram.txt)');
    files.set("doc/diagram.txt", "not an image");
    await render().then(() => { throw new Error("unsupported image should fail"); }, error => {
        check(error.message.includes("unsupported type"), "unsupported image error changed");
    });
    files.delete("doc/doc.md");
    await render();
    check(host.textContent === "", "removed documentation left stale content");
}
