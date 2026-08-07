const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE
    || "C:\\Users\\cwtf\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright",
);

const project = path.resolve(__dirname, "..");
const root = path.join(project, "deployed-original");
const output = path.join(project, "test-results", "original-gameplay.png");
const edge = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const requests = [];
const pageErrors = [];

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/favicon.ico" || url.pathname.includes("/jsd/oneshot/") || url.pathname.includes("/cdn-cgi/challenge-platform/h/g/")) {
    response.writeHead(204).end();
    return;
  }
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.resolve(root, `.${pathname}`);
  requests.push(pathname);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) response.writeHead(404).end("Not found");
    else response.writeHead(200, {
      "content-type": path.extname(file) === ".js" ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8",
    }).end(data);
  });
});

const listen = () => new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolvePromise(server.address()));
});

(async () => {
  let browser;
  try {
    const address = await listen();
    browser = await chromium.launch({
      executablePath: edge,
      headless: true,
      args: ["--disable-gpu-sandbox", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => Boolean(globalThis.CARBOY), null, { timeout: 120000 });
    await page.locator(".carboyStartButton").click({ timeout: 30000 });
    await page.waitForFunction(() => !globalThis.CARBOY.titleScreen.open, null, { timeout: 30000 });
    await page.waitForTimeout(1400);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => ({
      titleOpen: globalThis.CARBOY.titleScreen.open,
      fps: globalThis.CARBOY.app.engine.getFps(),
      audioContext: globalThis.CARBOY.audio.ctx?.state,
      audioSamples: globalThis.CARBOY.audio.samples.size,
      keyboardUp: globalThis.CARBOY.controls.keys.has("ArrowUp"),
      canvas: (() => {
        const element = document.querySelector("canvas");
        const rect = element.getBoundingClientRect();
        return { cssWidth: rect.width, cssHeight: rect.height, backingWidth: element.width, backingHeight: element.height };
      })(),
    }));
    assert.equal(state.titleOpen, false);
    assert.ok(state.fps > 0);
    assert.equal(state.audioContext, "running");
    assert.equal(state.audioSamples, 3);
    assert.equal(state.keyboardUp, true);
    await page.keyboard.up("ArrowUp");
    assert.deepEqual(pageErrors, []);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    console.log(JSON.stringify({ passed: true, output, state, requests: [...new Set(requests)], pageErrors }, null, 2));
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

