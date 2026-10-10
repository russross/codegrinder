import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";

// Content names let existing pages continue loading their original asset bytes.
async function asset(path, stem, extension) {
    const content = await readFile(path);
    const digest = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const name = `${stem}-${digest}.${extension}`;
    await writeFile(`dist/${name}`, content);
    return `dist/${name}`;
}

async function main() {
    await mkdir("dist", { recursive: true });
    const files = await readdir("build/ui");
    const scripts = files.filter(name => /^app-.*\.js$/.test(name));
    if (scripts.length !== 1) throw new Error("expected one application entry bundle");
    for (const name of files.filter(name => name !== ".built")) await copyFile(`build/ui/${name}`, `dist/${name}`);
    const replacements = {
        app: `dist/${scripts[0]}`,
        style: await asset("style.css", "style", "css"),
        favicon: await asset("favicon.svg", "favicon", "svg"),
    };
    let page = await readFile("index.template.html", "utf8");
    for (const [key, value] of Object.entries(replacements)) page = page.replaceAll(`{{${key}}}`, value);
    if (page.includes("{{")) throw new Error("unresolved entry-page placeholder");
    // Publish the entry only after every referenced asset is available.
    await writeFile("index.html.part", page);
    await rename("index.html.part", "index.html");
}

main().catch(error => { console.error(`Exam publication: ${error.message}`); process.exitCode = 1; });
