const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE
    || "C:\\Users\\cwtf\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright",
);

const project = path.resolve(__dirname, "..");
const site = project;
const prefix = "/carboy-foldable/";
const requests = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const mime = {
  ".html": "text/html",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  requests.push(url.pathname);
  if (url.pathname === "/favicon.ico") return response.writeHead(204).end();
  if (!url.pathname.startsWith(prefix)) return response.writeHead(404).end("Not found");
  const relative = url.pathname.slice(prefix.length) || "index.html";
  const file = path.resolve(site, relative);
  if (file !== site && !file.startsWith(`${site}${path.sep}`)) return response.writeHead(403).end("Forbidden");
  fs.readFile(file, (error, data) => {
    if (error) response.writeHead(404).end("Not found");
    else response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" }).end(data);
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
      executablePath: process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      headless: true,
      args: ["--disable-gpu-sandbox", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));

    await page.goto(`http://127.0.0.1:${address.port}${prefix}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => Boolean(globalThis.CARBOY && globalThis.CARBOY_FOLDABLE), null, { timeout: 120000 });
    await page.locator(".carboyStartButton").click({ timeout: 30000 });
    await page.waitForFunction(() => !globalThis.CARBOY.titleScreen.open, null, { timeout: 30000 });
    await page.evaluate(() => {
      globalThis.__pagesRefs = { game: globalThis.CARBOY, engine: globalThis.CARBOY.app.engine, player: globalThis.CARBOY.player };
    });
    await page.setViewportSize({ width: 1768, height: 846 });
    await page.waitForTimeout(900);

    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="Pause game"]');
      return button && getComputedStyle(button).display !== "none";
    }, null, { timeout: 60000 });
    const aimCanvas = await page.locator("#render").boundingBox();
    assert.ok(aimCanvas, "Canvas is available for mouse aiming");
    await page.mouse.move(aimCanvas.x + aimCanvas.width * 0.92, aimCanvas.y + aimCanvas.height * 0.5);
    await page.keyboard.down("Shift");
    await page.waitForFunction(() => globalThis.CARBOY.controls.charging === true
      && globalThis.CARBOY.controls.aiming === true
      && globalThis.CARBOY.controls.aimDir.x > 0.1);
    const aimRight = await page.evaluate(() => globalThis.CARBOY.controls.aimDir.x);
    await page.mouse.move(aimCanvas.x + aimCanvas.width * 0.08, aimCanvas.y + aimCanvas.height * 0.5);
    await page.waitForFunction(() => globalThis.CARBOY.controls.aimDir.x < -0.1);
    const aimLeft = await page.evaluate(() => globalThis.CARBOY.controls.aimDir.x);
    const shiftHeld = await page.evaluate(() => globalThis.CARBOY.controls.charging);
    await page.keyboard.up("Shift");
    await page.waitForFunction(() => globalThis.CARBOY.controls.charging === false
      && globalThis.CARBOY.controls.aiming === false);

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="Resume game"]');
      return button && getComputedStyle(button).display !== "none";
    });
    const pausedByEscape = await page.evaluate(() => document.body.innerText.includes("PAUSED"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => Boolean(document.querySelector('button[aria-label="Pause game"]')));

    const state = await page.evaluate(() => {
      const frame = document.getElementById("frame").getBoundingClientRect();
      const canvas = document.getElementById("render");
      return {
        characterSet: document.characterSet,
        charsetMeta: document.querySelector("meta[charset]")?.getAttribute("charset"),
        sourceContainsCorrectSymbols: document.documentElement.innerHTML.includes("−18%") && document.documentElement.innerHTML.includes("×"),
        sourceContainsMojibake: /[âÃÂ]/.test(document.documentElement.innerHTML),
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content,
        favicon: document.querySelector('link[rel="icon"]')?.href,
        frame: { width: frame.width, height: frame.height, left: frame.left, top: frame.top },
        buffer: { width: canvas.width, height: canvas.height },
        sameGame: globalThis.__pagesRefs.game === globalThis.CARBOY,
        sameEngine: globalThis.__pagesRefs.engine === globalThis.CARBOY.app.engine,
        samePlayer: globalThis.__pagesRefs.player === globalThis.CARBOY.player,
        fps: globalThis.CARBOY.app.engine.getFps(),
        audioSamples: globalThis.CARBOY.audio.samples.size,
      };
    });

    assert.equal(state.characterSet, "UTF-8");
    assert.equal(state.charsetMeta.toLowerCase(), "utf-8");
    assert.equal(state.sourceContainsCorrectSymbols, true);
    assert.equal(state.sourceContainsMojibake, false);
    assert.equal(state.title, "CAR BOY");
    assert.equal(state.description, "CAR BOY — Trouble in Paradise");
    assert.ok(state.favicon.startsWith("data:image/svg+xml,"));
    assert.ok(Math.abs(state.frame.left) < 1 && Math.abs(state.frame.top) < 1);
    assert.ok(Math.abs(state.frame.width - 1768) < 1 && Math.abs(state.frame.height - 846) < 1);
    assert.ok(Math.abs(state.buffer.width / state.buffer.height - state.frame.width / state.frame.height) < 0.003);
    assert.equal(shiftHeld, true);
    assert.ok(aimRight > 0.1 && aimLeft < -0.1);
    assert.equal(pausedByEscape, true);
    assert.equal(state.sameGame && state.sameEngine && state.samePlayer, true);
    assert.ok(state.fps > 0);
    assert.equal(state.audioSamples, 3);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(failedRequests, []);
    assert.deepEqual([...new Set(requests)], [prefix, `${prefix}foldable.css`, `${prefix}foldable.js`]);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForFunction(() => globalThis.CARBOY.upgradeScreen.show.toString().includes("carboy-upgrade-shop"));
    await page.evaluate(() => {
      globalThis.CARBOY.progress.stash = 35;
      globalThis.__upgradeShopPromise = globalThis.CARBOY.upgradeScreen.show(1, {
        knockouts: 3,
        coins: 35,
        stash: 35,
        bestCombo: 2,
      }, []);
      return true;
    });
    await page.waitForSelector(".carboy-upgrade-shop", { state: "visible" });
    assert.equal(await page.locator(".carboy-upgrade-card").count(), 7);
    assert.deepEqual(await page.locator(".carboy-upgrade-card").evaluateAll((cards) =>
      cards.map((card) => card.dataset.upgradeId)), ["speed", "power", "size", "ram", "magnet", "grip", "charge"]);
    assert.match(await page.locator('[data-upgrade-id="speed"]').innerText(), /LEVEL 0[\s\S]*10 COINS/);

    await page.locator('[data-upgrade-id="speed"]').click();
    await page.locator('[data-upgrade-id="speed"]').click();
    const upgradeShop = await page.evaluate(() => ({
      stash: globalThis.CARBOY.progress.stash,
      speedLevel: globalThis.CARBOY.progress.count("speed"),
      speedCard: document.querySelector('[data-upgrade-id="speed"]').innerText,
      cardCount: document.querySelectorAll(".carboy-upgrade-card").length,
      nextText: document.querySelector(".carboy-next-day").textContent,
      nextVisible: (() => {
        const rect = document.querySelector(".carboy-next-day").getBoundingClientRect();
        return rect.height >= 44 && rect.top >= 0 && rect.bottom <= innerHeight;
      })(),
    }));
    assert.equal(upgradeShop.stash, 5);
    assert.equal(upgradeShop.speedLevel, 2);
    assert.equal(upgradeShop.cardCount, 7);
    assert.match(upgradeShop.speedCard, /LEVEL 2[\s\S]*NEED 30 COINS/);
    assert.equal(upgradeShop.nextText, "START DAY 2");
    assert.equal(upgradeShop.nextVisible, true);

    const upgradeScreenshot = path.join(project, "test-results", "upgrade-shop-360x800.png");
    await page.screenshot({ path: upgradeScreenshot });
    await page.locator(".carboy-next-day").click();
    const continuation = await page.evaluate(async () => {
      const selection = await globalThis.__upgradeShopPromise;
      const before = globalThis.CARBOY.progress.count("speed");
      globalThis.CARBOY.progress.take(selection.id);
      return {
        selection: selection.id,
        open: globalThis.CARBOY.upgradeScreen.open,
        levelUnchanged: globalThis.CARBOY.progress.count("speed") === before,
      };
    });
    assert.equal(continuation.open, false);
    assert.equal(continuation.levelUnchanged, true);
    const screenshot = path.join(project, "test-results", "github-pages-subpath.png");
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot });
    console.log(JSON.stringify({ passed: true, prefix, requests: [...new Set(requests)], state, upgradeShop, continuation, screenshot, upgradeScreenshot }, null, 2));
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

