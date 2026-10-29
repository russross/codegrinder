import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import webpack from "webpack";

// Fixtures exercise the bundled source in a real DOM; host type checks run separately.
export async function compileFixture(entry, library) {
    await mkdir(join(import.meta.dirname, "../build"), { recursive: true });
    const directory = await mkdtemp(join(import.meta.dirname, "../build/test-fixture-"));
    const compiler = webpack({ mode: "development", context: join(import.meta.dirname, ".."),
        entry, output: { path: directory, filename: "fixture.js", library: { name: library, type: "window" } },
        module: { rules: [
            { test: /\.ts$/, use: { loader: "ts-loader", options: { transpileOnly: true } }, exclude: /node_modules/ },
            { test: /\.css$/, use: ["style-loader", "css-loader"] }] },
        resolve: { extensions: [".ts", ".js"] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => {
        compiler.close(() => {});
        if (error) reject(error);
        else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
        else resolve();
    }));
    return directory;
}
