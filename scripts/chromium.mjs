import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

// Prefer an explicit browser, then search installed Chrome and Chromium commands.
export async function chromiumExecutable() {
    const override = process.env.CODEGRINDER_CHROMIUM;
    if (override) {
        await access(override, constants.X_OK);
        return override;
    }
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
        for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
            const candidate = join(directory, name);
            try {
                await access(candidate, constants.X_OK);
                return candidate;
            } catch (error) {
                if (!["ENOENT", "EACCES", "ENOTDIR"].includes(error.code)) throw error;
            }
        }
    }
    throw new Error("Chrome or Chromium is unavailable; set CODEGRINDER_CHROMIUM to its executable path");
}
