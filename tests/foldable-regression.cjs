const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE
    || "C:\\Users\\cwtf\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright",
);

const project = path.resolve(__dirname, "..");
const root = path.join(project, "foldable-game");
const resultsDir = path.join(project, "test-results");
const edge = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const targetSizes = [
  { width: 360, height: 800 },
  { width: 412, height: 915 },
  { width: 717, height: 512 },
  { width: 768, height: 1024 },
  { width: 884, height: 1104 },
  { width: 1768, height: 2208 },
];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
};

const requests = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/favicon.ico") {
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
    else response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" }).end(data);
  });
});

const listen = () => new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolvePromise(server.address()));
});

function attachDiagnostics(page, label, diagnostics) {
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push({ label, text: message.text() });
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push({ label, text: error.message }));
  page.on("requestfailed", (request) => diagnostics.failedRequests.push({
    label,
    url: request.url(),
    error: request.failure()?.errorText,
  }));
}

async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(globalThis.CARBOY && globalThis.CARBOY_FOLDABLE), null, { timeout: 120000 });
  await page.waitForTimeout(700);
}

async function startGame(page) {
  const button = page.locator(".carboyStartButton");
  if (await button.count()) {
    await button.click({ timeout: 30000 });
    await page.waitForFunction(() => globalThis.CARBOY && !globalThis.CARBOY.titleScreen.open, null, { timeout: 30000 });
    await page.waitForTimeout(650);
  }
}

async function readState(page) {
  return page.evaluate(() => {
    const stage = document.getElementById("stage");
    const frame = document.getElementById("frame");
    const canvas = document.getElementById("render");
    const secondary = document.getElementById("foldable-secondary");
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const secondaryRect = secondary.getBoundingClientRect();
    const visibleTargets = [...frame.querySelectorAll("button,[role='button']")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent.trim().slice(0, 80),
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      });
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      frame: { left: frameRect.left, top: frameRect.top, right: frameRect.right, bottom: frameRect.bottom, width: frameRect.width, height: frameRect.height },
      canvas: { left: canvasRect.left, top: canvasRect.top, width: canvasRect.width, height: canvasRect.height, backingWidth: canvas.width, backingHeight: canvas.height },
      segmented: stage.classList.contains("is-segmented"),
      segmentCount: Number(stage.dataset.segmentCount || 1),
      primarySegment: Number(stage.dataset.primarySegment || 0),
      secondary: {
        display: getComputedStyle(secondary).display,
        left: secondaryRect.left,
        top: secondaryRect.top,
        right: secondaryRect.right,
        bottom: secondaryRect.bottom,
        width: secondaryRect.width,
        height: secondaryRect.height,
        text: secondary.innerText,
      },
      targets: visibleTargets,
      game: {
        ready: Boolean(globalThis.CARBOY),
        titleOpen: globalThis.CARBOY?.titleScreen?.open,
        day: globalThis.CARBOY?.progress?.day,
        playerId: globalThis.CARBOY?.player?.id,
        enemies: globalThis.CARBOY?.enemies?.length,
        fps: globalThis.CARBOY?.app?.engine?.getFps?.(),
        audioContext: globalThis.CARBOY?.audio?.ctx?.state || null,
        audioSamples: globalThis.CARBOY?.audio?.samples?.size || 0,
      },
      sameReferences: globalThis.__foldableReferenceCheck
        ? globalThis.__foldableReferenceCheck.carboy === globalThis.CARBOY
          && globalThis.__foldableReferenceCheck.engine === globalThis.CARBOY.app.engine
          && globalThis.__foldableReferenceCheck.player === globalThis.CARBOY.player
        : true,
      layout: globalThis.CARBOY_FOLDABLE?.getState?.(),
    };
  });
}

function assertLayout(state, label) {
  const epsilon = 2;
  assert.equal(state.game.ready, true, `${label}: game ready`);
  assert.equal(state.game.titleOpen, false, `${label}: gameplay started`);
  assert.equal(state.sameReferences, true, `${label}: game, engine, and player references survived resize`);
  assert.ok(Math.abs(state.canvas.width - state.frame.width) < 1, `${label}: canvas CSS width follows frame`);
  assert.ok(Math.abs(state.canvas.height - state.frame.height) < 1, `${label}: canvas CSS height follows frame`);
  assert.ok(Math.abs(state.canvas.backingWidth / state.canvas.backingHeight - state.frame.width / state.frame.height) < 0.003, `${label}: canvas backing buffer follows the rendered aspect ratio`);
  if (!state.segmented) {
    assert.ok(Math.abs(state.frame.left) < epsilon && Math.abs(state.frame.top) < epsilon, `${label}: frame starts at the safe viewport origin`);
    assert.ok(Math.abs(state.frame.width - state.viewport.width) < epsilon, `${label}: frame fills viewport width`);
    assert.ok(Math.abs(state.frame.height - state.viewport.height) < epsilon, `${label}: frame fills viewport height`);
  }
  assert.ok(state.canvas.backingWidth >= state.canvas.width - 1, `${label}: backing buffer is not undersized`);
  assert.ok(state.canvas.backingHeight >= state.canvas.height - 1, `${label}: backing buffer height is not undersized`);
  assert.ok(state.frame.left >= -epsilon && state.frame.top >= -epsilon, `${label}: frame starts inside viewport`);
  assert.ok(state.frame.right <= state.viewport.width + epsilon && state.frame.bottom <= state.viewport.height + epsilon, `${label}: frame ends inside viewport`);
  for (const target of state.targets) {
    assert.ok(target.width >= 43 && target.height >= 43, `${label}: touch target '${target.text}' is at least 44px`);
    assert.ok(target.left >= state.frame.left - epsilon && target.right <= state.frame.right + epsilon, `${label}: target '${target.text}' avoids horizontal clipping`);
    assert.ok(target.top >= state.frame.top - epsilon && target.bottom <= state.frame.bottom + epsilon, `${label}: target '${target.text}' avoids vertical clipping`);
  }
}

async function verifyKeyboardShortcuts(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Pause game"]');
    return button && getComputedStyle(button).display !== "none";
  }, null, { timeout: 60000 });
  const canvas = await page.locator("#render").boundingBox();
  assert.ok(canvas, "Canvas is available for mouse aiming");
  await page.mouse.move(canvas.x + canvas.width * 0.92, canvas.y + canvas.height * 0.5);
  await page.keyboard.down("Shift");
  await page.waitForFunction(() => globalThis.CARBOY.controls.charging === true
    && globalThis.CARBOY.controls.aiming === true
    && globalThis.CARBOY.controls.aimDir.x > 0.1);
  const aimRight = await page.evaluate(() => globalThis.CARBOY.controls.aimDir.x);
  await page.mouse.move(canvas.x + canvas.width * 0.08, canvas.y + canvas.height * 0.5);
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

  assert.equal(shiftHeld, true, "Shift holds the RAM charge state");
  assert.ok(aimRight > 0.1 && aimLeft < -0.1, "Mouse movement changes RAM aim direction while Shift is held");
  assert.equal(pausedByEscape, true, "Escape opens the existing pause menu");
  return { shiftHeld, aimRight, aimLeft, pausedByEscape };
}
async function verifyPointerCoordinates(page, state, label) {
  const point = {
    x: state.canvas.left + state.canvas.width * 0.24,
    y: state.canvas.top + state.canvas.height * 0.52,
  };
  await page.touchscreen.tap(point.x, point.y);
  const origin = await page.evaluate(() => ({
    x: globalThis.CARBOY.controls.originX,
    y: globalThis.CARBOY.controls.originY,
  }));
  assert.ok(Math.hypot(origin.x - point.x, origin.y - point.y) < 3, `${label}: pointer coordinates remain aligned after resize`);
  return { point, origin };
}

(async () => {
  fs.mkdirSync(resultsDir, { recursive: true });
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  const report = { targetSizes: [], segmented: [], diagnostics, requests: [] };
  let browser;
  try {
    const address = await listen();
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    browser = await chromium.launch({
      executablePath: edge,
      headless: true,
      args: ["--disable-gpu-sandbox", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
    });

    const context = await browser.newContext({
      viewport: targetSizes[0],
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    attachDiagnostics(page, "responsive-resize", diagnostics);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForGame(page);
    await startGame(page);
    await page.evaluate(() => {
      globalThis.__foldableReferenceCheck = {
        carboy: globalThis.CARBOY,
        engine: globalThis.CARBOY.app.engine,
        player: globalThis.CARBOY.player,
      };
    });

    for (const size of targetSizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(850);
      const label = `${size.width}x${size.height}`;
      const state = await readState(page);
      assertLayout(state, label);
      const pointer = await verifyPointerCoordinates(page, state, label);
      const screenshot = path.join(resultsDir, `foldable-${label}.png`);
      await page.screenshot({ path: screenshot });
      report.targetSizes.push({ label, screenshot: path.relative(project, screenshot), state, pointer });
    }
    report.keyboardShortcuts = await verifyKeyboardShortcuts(page);
    await context.close();

    for (const scenario of [
      { name: "vertical-hinge", mode: "vertical", viewport: { width: 884, height: 1104 }, gap: 32 },
      { name: "horizontal-hinge", mode: "horizontal", viewport: { width: 1768, height: 2208 }, gap: 36 },
    ]) {
      const segmentedContext = await browser.newContext({
        viewport: scenario.viewport,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      });
      const segmentedPage = await segmentedContext.newPage();
      attachDiagnostics(segmentedPage, scenario.name, diagnostics);
      await segmentedPage.goto(`${baseUrl}?foldable=${scenario.mode}&hinge=${scenario.gap}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await waitForGame(segmentedPage);
      await startGame(segmentedPage);
      const state = await readState(segmentedPage);
      assertLayout(state, scenario.name);
      assert.equal(state.segmented, true, `${scenario.name}: segmented layout is active`);
      assert.equal(state.segmentCount, 2, `${scenario.name}: two viewport segments detected`);
      assert.equal(state.secondary.display, "flex", `${scenario.name}: secondary UI uses the other segment`);
      assert.match(state.secondary.text, /Day[\s\S]*Coins[\s\S]*Combo[\s\S]*Speed/i, `${scenario.name}: secondary status is populated`);
      const hingeStart = scenario.mode === "vertical"
        ? (scenario.viewport.width - scenario.gap) / 2
        : (scenario.viewport.height - scenario.gap) / 2;
      const hingeEnd = hingeStart + scenario.gap;
      if (scenario.mode === "vertical") {
        assert.ok(state.frame.right <= hingeStart + 1 || state.frame.left >= hingeEnd - 1, `${scenario.name}: gameplay avoids vertical hinge`);
        assert.ok(state.secondary.right <= hingeStart + 1 || state.secondary.left >= hingeEnd - 1, `${scenario.name}: secondary UI avoids vertical hinge`);
      } else {
        assert.ok(state.frame.bottom <= hingeStart + 1 || state.frame.top >= hingeEnd - 1, `${scenario.name}: gameplay avoids horizontal hinge`);
        assert.ok(state.secondary.bottom <= hingeStart + 1 || state.secondary.top >= hingeEnd - 1, `${scenario.name}: secondary UI avoids horizontal hinge`);
      }
      const screenshot = path.join(resultsDir, `foldable-${scenario.name}.png`);
      await segmentedPage.screenshot({ path: screenshot });
      report.segmented.push({ ...scenario, screenshot: path.relative(project, screenshot), state });
      await segmentedContext.close();
    }

    report.requests = [...new Set(requests)];
    assert.deepEqual(diagnostics.pageErrors, [], "No uncaught page errors");
    assert.deepEqual(diagnostics.failedRequests, [], "No failed runtime requests");
    fs.writeFileSync(path.join(resultsDir, "foldable-regression.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      passed: true,
      testedSizes: report.targetSizes.map((item) => item.label),
      segmentedScenarios: report.segmented.map((item) => item.name),
      runtimeRequests: report.requests,
      consoleErrors: diagnostics.consoleErrors,
      pageErrors: diagnostics.pageErrors,
      failedRequests: diagnostics.failedRequests,
    }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

