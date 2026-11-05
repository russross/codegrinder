import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import puppeteer from "puppeteer-core";

const defaultTarget = "https://codegrinder.russross.com/web/";
const buildBannerPattern = /^\/\*! CodeGrinder web build ([^ ]+) \*\//;

async function chromiumExecutable() {
  if (process.env.CODEGRINDER_CHROMIUM !== undefined) {
    await access(process.env.CODEGRINDER_CHROMIUM);
    return process.env.CODEGRINDER_CHROMIUM;
  }
  for (const candidate of ["/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported system package name.
    }
  }
  throw new Error("Chromium is unavailable; set CODEGRINDER_CHROMIUM to its executable path");
}

function authorizationHeaders() {
  const username = process.env.CODEGRINDER_BROWSER_USERNAME;
  const password = process.env.CODEGRINDER_BROWSER_PASSWORD;
  if (username === undefined && password === undefined) {
    return {};
  }
  if (username === undefined || password === undefined) {
    throw new Error("Set both CODEGRINDER_BROWSER_USERNAME and CODEGRINDER_BROWSER_PASSWORD");
  }
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

async function deployedBuildVersion(webUrl, headers) {
  let version = null;
  for (const path of [
    "scripts/app.js",
    "scripts/jsRuntime.js",
    "scripts/jsHandler.js",
    "scripts/jsWorker.js",
    "scripts/pythonRuntime.js",
    "scripts/pythonHandler.js",
    "scripts/pythonWorker.js",
    "sw.js",
  ]) {
    const response = await fetch(new URL(path, webUrl), {
      cache: "no-store",
      headers,
    });
    assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
    const match = (await response.text()).match(buildBannerPattern);
    assert.notEqual(match, null, `${path} has no CodeGrinder build identity`);
    version ??= match[1];
    assert.equal(match[1], version, `${path} belongs to another deployment generation`);
  }
  assert.notEqual(version, null);
  return version;
}

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: await chromiumExecutable(),
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
  });
}

test("live JavaScript runtime crosses the worker input bridge", { timeout: 120_000 }, async () => {
  const webUrl = new URL(process.env.CODEGRINDER_BROWSER_TEST_URL ?? defaultTarget);
  const headers = authorizationHeaders();
  const buildVersion = await deployedBuildVersion(webUrl, headers);
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    if (Object.keys(headers).length > 0) {
      await page.setExtraHTTPHeaders(headers);
    }
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    const files = {
      children: {
        lib: {
          children: {
            "greeting.js": { content: "exports.greeting = 'Hello';\n" },
          },
        },
        "main.js": {
          content: "const { greeting } = require('./lib/greeting');\nconst name = prompt('Name? ');\nconsole.log(`${greeting} ${name}`);\n",
        },
      },
    };
    const smokeUrl = new URL(webUrl);
    smokeUrl.searchParams.set("dummy", "true");
    smokeUrl.searchParams.set("problemType", "javascriptunittest");
    smokeUrl.searchParams.set("files", JSON.stringify(files));
    const response = await page.goto(smokeUrl.href, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200);

    await page.waitForFunction(() => {
      const run = document.querySelector("#run");
      return run instanceof HTMLButtonElement && !run.disabled && run.textContent === "Run";
    }, { timeout: 60_000 });
    assert.equal(await page.evaluate(() => globalThis.crossOriginIsolated), true);

    const controllerUrl = await page.evaluate(
      () => navigator.serviceWorker.controller?.scriptURL ?? "",
    );
    assert.equal(new URL(controllerUrl).searchParams.get("version"), buildVersion);

    await page.click("#run");
    await page.waitForFunction(
      () => document.querySelector("#output_terminal pre")?.textContent?.includes("Name? "),
      { timeout: 15_000 },
    );
    await page.focus("#output_terminal textarea");
    await page.keyboard.type("Ada");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector("#output_terminal pre")?.textContent?.includes("Hello Ada"),
      { timeout: 15_000 },
    );

    await page.click("#run");
    await page.waitForFunction(() => {
      const output = document.querySelector("#output_terminal pre")?.textContent ?? "";
      return output.split("Name? ").length === 3;
    }, { timeout: 15_000 });
    await page.click("#run");
    await page.waitForFunction(() => {
      const run = document.querySelector("#run");
      return run instanceof HTMLButtonElement && !run.disabled && run.textContent === "Run";
    }, { timeout: 60_000 });

    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});

test("canonical Python compatibility runs in the deployed Pyodide worker", { timeout: 180_000 }, async () => {
  const webUrl = new URL(process.env.CODEGRINDER_BROWSER_TEST_URL ?? defaultTarget);
  const headers = authorizationHeaders();
  const buildVersion = await deployedBuildVersion(webUrl, headers);
  const asttest = await readFile(new URL(
    "../../../problemtypes/types/python3unittest/files/tests/asttest.py",
    import.meta.url,
  ), "utf8");
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    if (Object.keys(headers).length > 0) {
      await page.setExtraHTTPHeaders(headers);
    }
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    const files = {
      children: {
        "asttest.py": { content: asttest },
        bin: {
          children: {
            "requirements.txt": { content: "sqlite3\n" },
            "setup.py": {
              content: [
                "import sqlite3",
                "from pathlib import Path",
                "",
                "Path('./bin').mkdir(parents=True, exist_ok=True)",
                "with sqlite3.connect('bin/data.db') as connection:",
                "    connection.execute('create table people (name text)')",
                "",
              ].join("\n"),
            },
          },
        },
        "exam.sql": { content: "insert into people values ('Grace');\n" },
        "turtle_demo.py": {
          content: [
            "import turtle",
            "",
            "name = input('Turtle name? ')",
            "print(f'Turtle hello {name}')",
            "for _ in range(4):",
            "    turtle.forward(40)",
            "    turtle.right(90)",
            "",
          ].join("\n"),
        },
        "solution.py": {
          content: [
            "def classify(value):",
            "    if value > 0:",
            "        return 'positive'",
            "    return 'other'",
            "",
            "assert classify(1) == 'positive'",
            "assert classify(0) == 'other'",
            "",
          ].join("\n"),
        },
        "main.py": {
          content: [
            "import asttest",
            "",
            "case = asttest.ASTTest()",
            "case.setUp('solution.py')",
            "case.ensure_coverage(['classify'], 0.99)",
            "print('canonical asttest passed in Pyodide')",
            "",
          ].join("\n"),
        },
      },
    };
    const smokeUrl = new URL(webUrl);
    smokeUrl.searchParams.set("dummy", "true");
    smokeUrl.searchParams.set("problemType", "python3unittest");
    smokeUrl.searchParams.set("files", JSON.stringify(files));
    const response = await page.goto(smokeUrl.href, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200);

    await page.waitForFunction(() => {
      const run = document.querySelector("#run");
      return run instanceof HTMLButtonElement && !run.disabled && run.textContent === "Run";
    }, { timeout: 120_000 });
    const controllerUrl = await page.evaluate(
      () => navigator.serviceWorker.controller?.scriptURL ?? "",
    );
    assert.equal(new URL(controllerUrl).searchParams.get("version"), buildVersion);

    await page.click("#run");
    try {
      await page.waitForFunction(
        () => document.querySelector("#output_terminal pre")?.textContent
          ?.includes("canonical asttest passed in Pyodide"),
        { timeout: 30_000 },
      );
    } catch (error) {
      const output = await page.$eval("#output_terminal pre", (element) => element.textContent ?? "");
      throw new Error(`Pyodide asttest did not complete:\n${output}`, { cause: error });
    }
    await page.waitForFunction(() => {
      const run = document.querySelector("#run");
      return run instanceof HTMLButtonElement && !run.disabled && run.textContent === "Run";
    });
    await page.evaluate(() => {
      const sqlTab = [...document.querySelectorAll(".tabs-container li")]
        .find((element) => element.textContent?.includes("exam.sql"));
      if (!(sqlTab instanceof HTMLElement)) {
        throw new Error("SQL editor tab was not created");
      }
      sqlTab.click();
    });
    await page.click("#run");
    await page.waitForFunction(
      () => document.querySelector("#output_terminal pre")?.textContent?.includes("Running /exam.sql"),
    );
    await page.waitForFunction(() => {
      const run = document.querySelector("#run");
      return run instanceof HTMLButtonElement && !run.disabled && run.textContent === "Run";
    });
    await page.focus("#output_terminal textarea");
    await page.keyboard.type("select name from people");
    await page.keyboard.press("Enter");
    try {
      await page.waitForFunction(
        () => document.querySelector("#output_terminal pre")?.textContent?.includes("Grace"),
        { timeout: 15_000 },
      );
    } catch (error) {
      const output = await page.$eval("#output_terminal pre", (element) => element.textContent ?? "");
      throw new Error(`Pyodide SQL compatibility did not complete:\n${output}`, { cause: error });
    }
    await page.waitForFunction(() => {
      const run = document.querySelector("#run");
      return run instanceof HTMLButtonElement && !run.disabled && run.textContent === "Run";
    });
    await page.evaluate(() => {
      const turtleTab = [...document.querySelectorAll(".tabs-container li")]
        .find((element) => element.textContent?.includes("turtle_demo.py"));
      if (!(turtleTab instanceof HTMLElement)) {
        throw new Error("Turtle editor tab was not created");
      }
      turtleTab.click();
    });
    await page.click("#run");
    await page.waitForFunction(
      () => document.querySelector("#output_terminal pre")?.textContent?.includes("Turtle name? "),
      { timeout: 30_000 },
    );
    await page.focus("#output_terminal textarea");
    await page.keyboard.type("Ada");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector("#output_terminal pre")?.textContent?.includes("Turtle hello Ada"),
      { timeout: 15_000 },
    );
    await page.waitForSelector("#turtle canvas", { timeout: 30_000 });
    await page.waitForFunction(() => {
      const run = document.querySelector("#run");
      return run instanceof HTMLButtonElement && !run.disabled && run.textContent === "Run";
    });
    await page.click("#run");
    await page.waitForFunction(() => {
      const output = document.querySelector("#output_terminal pre")?.textContent ?? "";
      return output.split("Turtle name? ").length === 3;
    }, { timeout: 30_000 });
    await page.click("#run");
    await page.waitForFunction(() => {
      const run = document.querySelector("#run");
      return run instanceof HTMLButtonElement && !run.disabled && run.textContent === "Run";
    }, { timeout: 30_000 });
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
