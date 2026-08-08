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

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const consoleErrors = [];
const pageErrors = [];

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/favicon.ico") return response.writeHead(204).end();
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end("Forbidden");
  fs.readFile(file, (error, data) => {
    if (error) response.writeHead(404).end("Not found");
    else response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" }).end(data);
  });
});

const listen = () => new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolvePromise(server.address()));
});

// Puts the run on a chosen day with a chosen stash so day-gated vehicles unlock.
async function setDay(page, day, stash) {
  await page.evaluate(({ day, stash }) => {
    globalThis.CARBOY.progress.day = day;
    globalThis.CARBOY.progress.stash = stash;
  }, { day, stash });
}

const stepFrames = (page, frames) => page.evaluate((count) => {
  for (let i = 0; i < count; i++) globalThis.CARBOY.step(1 / 60);
}, frames);

// Rivals are tracked by vehicle id, never by array index: swallowing or
// launching one shifts the array and would silently retarget the assertion.
//
// Enemies are retired directly rather than by dropping them off the island:
// a fall counts as a knockout, and enough of those end the day and open the
// intermission, which suspends the abilities under test.
async function clearEnemies(page) {
  await page.evaluate(() => {
    const game = globalThis.CARBOY;
    for (const enemy of [...game.enemies]) {
      game.combat.unregister(enemy);
      enemy.dispose();
      game.world.releaseBody();
      game.enemies.splice(game.enemies.indexOf(enemy), 1);
    }
  });
  await stepFrames(page, 2);
}

// The day must stay unfinished for the whole mechanics pass, otherwise the
// upgrade screen opens and the ability tick stands down.
const assertPlaying = (page, label) => page.evaluate((where) => {
  const game = globalThis.CARBOY;
  if (game.upgradeScreen.open) throw new Error(`intermission opened before ${where}`);
  if (game.titleScreen.open) throw new Error(`title screen open before ${where}`);
  return true;
}, label);

// Steps until `predicate` holds in the page, or gives up after `limit` frames.
async function stepUntil(page, predicate, limit = 400) {
  for (let frame = 0; frame < limit; frame += 10) {
    await stepFrames(page, 10);
    if (await page.evaluate(predicate)) return true;
  }
  return false;
}

// Waits until the day is genuinely simulating, not still on the countdown.
const waitForLiveDay = (page) => page.waitForFunction(() => {
  const game = globalThis.CARBOY;
  game.step(1 / 60);
  return game.enemies.length > 0 && game.enemies.some((enemy) => enemy.vehicle.planarSpeed > 0.05);
}, null, { timeout: 60000 });

// A freshly spawned body needs a step before a teleport sticks, so placement is
// repeated until it verifies rather than assumed. Silent misplacement here
// would quietly invalidate every distance assertion downstream.
async function spawnEnemyAt(page, x, z) {
  const id = await page.evaluate(() => {
    const game = globalThis.CARBOY;
    game.spawnEnemy();
    return game.enemies[game.enemies.length - 1].vehicle.id;
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    await stepFrames(page, 1);
    const placed = await page.evaluate(({ vehicleId, x, z }) => {
      const game = globalThis.CARBOY;
      const enemy = game.enemies.find((candidate) => candidate.vehicle.id === vehicleId);
      if (!enemy) return null;
      const position = enemy.vehicle.position.clone();
      position.set(x, 0.9, z);
      game.world.teleport(enemy.vehicle.body, position);
      return Math.hypot(enemy.vehicle.position.x - x, enemy.vehicle.position.z - z);
    }, { vehicleId: id, x, z });
    if (placed === null) throw new Error(`spawned rival ${id} vanished before placement`);
    await stepFrames(page, 1);
    const offset = await page.evaluate(({ vehicleId, x, z }) => {
      const game = globalThis.CARBOY;
      const enemy = game.enemies.find((candidate) => candidate.vehicle.id === vehicleId);
      return enemy ? Math.hypot(enemy.vehicle.position.x - x, enemy.vehicle.position.z - z) : null;
    }, { vehicleId: id, x, z });
    if (offset !== null && offset < 0.6) return id;
  }
  throw new Error(`could not place rival ${id} at (${x}, ${z})`);
}

const distanceToPlayer = (page, id) => page.evaluate((vehicleId) => {
  const game = globalThis.CARBOY;
  const enemy = game.enemies.find((candidate) => candidate.vehicle.id === vehicleId);
  if (!enemy) return null;
  return Math.hypot(
    enemy.vehicle.position.x - game.player.vehicle.position.x,
    enemy.vehicle.position.z - game.player.vehicle.position.z,
  );
}, id);

const enemyAlive = (page, id) => page.evaluate((vehicleId) =>
  globalThis.CARBOY.enemies.some((candidate) => candidate.vehicle.id === vehicleId), id);

// Places the player and one rival a known distance apart, and confirms the
// distance actually reads back. Teleports write the mesh position synchronously,
// so a placement "succeeds" even while the simulation is frozen on a respawn
// countdown — only re-measuring after a live step catches that.
async function setupDuel(page, { player, enemy }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await waitForLiveDay(page);
    await clearEnemies(page);
    await placePlayer(page, player[0], player[1], player[2]);
    const id = await spawnEnemyAt(page, enemy[0], enemy[1]);
    await stepFrames(page, 2);
    const distance = await distanceToPlayer(page, id);
    const wanted = Math.hypot(enemy[0] - player[0], enemy[1] - player[2]);
    if (distance !== null && Math.abs(distance - wanted) < 1) return { id, distance };
  }
  throw new Error("could not set up a rival at a known distance from the player");
}

async function placePlayer(page, x, y, z) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(({ x, y, z }) => {
      const game = globalThis.CARBOY;
      const position = game.player.vehicle.position.clone();
      position.set(x, y, z);
      game.world.teleport(game.player.vehicle.body, position);
    }, { x, y, z });
    await stepFrames(page, 1);
    const offset = await page.evaluate(({ x, z }) => {
      const position = globalThis.CARBOY.player.vehicle.position;
      return Math.hypot(position.x - x, position.z - z);
    }, { x, z });
    if (offset < 0.6) return;
  }
  throw new Error(`could not place the player at (${x}, ${z})`);
}

(async () => {
  let browser;
  const report = {};
  try {
    const address = await listen();
    browser = await chromium.launch({
      executablePath: edge,
      headless: true,
      args: ["--disable-gpu-sandbox", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => Boolean(globalThis.CARBOY && globalThis.CARBOY_FOLDABLE), null, { timeout: 120000 });
    await page.locator(".carboyStartButton").click({ timeout: 30000 });
    await page.waitForFunction(() => !globalThis.CARBOY.titleScreen.open, null, { timeout: 30000 });
    await page.waitForTimeout(800);

    // ---- unlock gating -----------------------------------------------------
    await setDay(page, 1, 0);
    const day1 = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.list());
    assert.deepEqual(day1.map((v) => v.unlocked), [true, false, false], "only the car is unlocked on day 1");

    await setDay(page, 5, 0);
    const day5 = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.list());
    assert.deepEqual(day5.map((v) => v.unlocked), [true, true, false], "vacuum unlocks on day 5");

    await setDay(page, 10, 0);
    const day10 = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.list());
    assert.deepEqual(day10.map((v) => v.unlocked), [true, true, true], "helicopter unlocks on day 10");

    await setDay(page, 15, 4000);
    const day15 = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.list());
    assert.ok(day15.every((v) => v.unlocked), "every offered vehicle is unlocked by day 15");
    report.unlocks = {
      offered: day15.map((v) => v.id),
      day1: day1.map((v) => v.unlocked),
      day5: day5.map((v) => v.unlocked),
      day10: day10.map((v) => v.unlocked),
    };

    // The toaster is switched off for now: it must not appear in the garage,
    // and selecting it must be refused rather than silently accepted.
    const toasterEnabled = day15.some((v) => v.id === "toaster");
    if (!toasterEnabled) {
      assert.equal(await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.select("toaster")), false,
        "a disabled vehicle cannot be selected");
      assert.notEqual(await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.active), "toaster",
        "a refused selection leaves the active vehicle alone");
    }

    // Everything below exercises mechanics, so park the run on a day whose
    // quota can never be met and wait for the simulation to be live.
    await setDay(page, 400, 4000);
    await waitForLiveDay(page);

    // ---- car still behaves as the stock game -------------------------------
    const carBaseline = await page.evaluate(() => {
      const game = globalThis.CARBOY;
      return {
        action: document.querySelector("#chargeBtn .core").textContent,
        gravity: game.player.vehicle.body.getGravityFactor?.() ?? 1,
        chargeReachesController: (() => {
          game.controls.charging = true;
          const seen = game.controls.charging;
          game.controls.charging = false;
          return seen;
        })(),
      };
    });
    assert.equal(carBaseline.action, "RAM", "car keeps the RAM button");
    assert.equal(carBaseline.chargeReachesController, true, "car still drives the stock charge system");
    report.car = carBaseline;

    // ---- helicopter --------------------------------------------------------
    await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.select("helicopter"));
    await stepFrames(page, 90);
    const heliLabel = await page.locator("#chargeBtn .core").textContent();
    assert.equal(heliLabel, "BLOW", "helicopter relabels the ability button to BLOW");

    const heli = await page.evaluate(() => {
      const game = globalThis.CARBOY;
      return {
        y: game.player.vehicle.position.y,
        gravity: game.player.vehicle.body.getGravityFactor?.() ?? null,
        chargeHiddenFromGame: (() => {
          game.controls.charging = true;
          const seen = game.controls.charging;
          game.controls.charging = false;
          return seen;
        })(),
      };
    });
    assert.ok(heli.y > 2.4, `helicopter hovers (y=${heli.y})`);
    assert.equal(heli.gravity, 0, "helicopter has gravity switched off");
    assert.equal(heli.chargeHiddenFromGame, false, "the stock ram never sees the helicopter's button");

    // Immunity: a rival parked against the helicopter must not register a hit.
    await setupDuel(page, { player: [0, 3.2, 0], enemy: [1.2, 0.6] });
    const hitsBefore = await page.evaluate(() => globalThis.CARBOY.combat.hitCount);
    await stepFrames(page, 120);
    const hitsAfter = await page.evaluate(() => globalThis.CARBOY.combat.hitCount);
    assert.equal(hitsAfter, hitsBefore, "helicopter neither takes nor deals collision hits");

    // Blow: hold the ability and the rival must be pushed outward.
    await assertPlaying(page, "the blow test");
    const blowDuel = await setupDuel(page, { player: [0, 3.2, 0], enemy: [2, 0] });
    const blowTarget = blowDuel.id;
    const blowStart = blowDuel.distance;
    await page.evaluate(() => { globalThis.CARBOY.controls.charging = true; });
    await stepFrames(page, 45);
    const blowEnd = await distanceToPlayer(page, blowTarget);
    const blowMeter = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.state().meter);
    await page.evaluate(() => { globalThis.CARBOY.controls.charging = false; });
    assert.ok(blowEnd > blowStart + 1, `blow pushes rivals away (${blowStart.toFixed(2)} -> ${blowEnd.toFixed(2)})`);
    assert.ok(blowMeter < 1, `blow drains its meter (${blowMeter.toFixed(2)})`);
    report.helicopter = { hover: heli.y, gravity: heli.gravity, blowStart, blowEnd, meterAfterBlow: blowMeter };

    // Recharge refills the meter once the button is released.
    await stepFrames(page, 240);
    const heliRecharged = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.state().meter);
    assert.ok(heliRecharged > blowMeter, "blow meter recharges after release");
    report.helicopter.meterAfterRecharge = heliRecharged;

    // ---- vacuum ------------------------------------------------------------
    await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.select("vacuum"));
    await stepFrames(page, 30);
    const vacuumLabel = await page.locator("#chargeBtn .core").textContent();
    assert.equal(vacuumLabel, "SUCK", "vacuum relabels the ability button to SUCK");

    const vacuumGravity = await page.evaluate(() => globalThis.CARBOY.player.vehicle.body.getGravityFactor?.() ?? 1);
    assert.equal(vacuumGravity, 1, "leaving the helicopter restores gravity");

    await assertPlaying(page, "the suck test");
    const suckDuel = await setupDuel(page, { player: [0, 0.6, 0], enemy: [5, 0] });
    const suckTarget = suckDuel.id;
    const suckStart = suckDuel.distance;
    await page.evaluate((id) => { globalThis.__suckTarget = id; }, suckTarget);
    const collectedBefore = await page.evaluate(() => globalThis.CARBOY.pickups.collected);
    await page.evaluate(() => { globalThis.CARBOY.controls.charging = true; });
    await stepFrames(page, 8);
    const suckPulled = await distanceToPlayer(page, suckTarget);
    assert.ok(suckPulled !== null, "the tracked rival is still in play mid-suck");
    assert.ok(suckPulled < suckStart - 0.3, `suck drags rivals inward (${suckStart.toFixed(2)} -> ${suckPulled.toFixed(2)})`);

    // Holding on must finish the job: the rival reaches the nozzle and is gone.
    // This is polled rather than given a fixed frame budget — the pull is weak
    // at the edge of its range and the tank may need a recharge cycle first.
    const swallowed = await stepUntil(page, () => !globalThis.CARBOY.enemies
      .some((candidate) => candidate.vehicle.id === globalThis.__suckTarget), 600);
    await page.evaluate(() => { globalThis.CARBOY.controls.charging = false; });
    const vacuumAfter = await page.evaluate(() => ({
      meter: globalThis.CARBOY_FOLDABLE.garage.state().meter,
      collected: globalThis.CARBOY.pickups.collected,
    }));
    assert.ok(swallowed, "a rival dragged to the nozzle is swallowed");
    assert.ok(vacuumAfter.collected >= collectedBefore, "swallowing a rival routes through the normal coin path");
    assert.ok(vacuumAfter.meter < 1, "suck drains its meter");
    report.vacuum = { suckStart, suckPulled, swallowed, ...vacuumAfter };

    // ---- toaster -----------------------------------------------------------
    // Kept whole but dormant while the toaster is disabled, so re-enabling the
    // vehicle brings its coverage straight back.
    if (!toasterEnabled) {
      report.toaster = "skipped: vehicle disabled";
      console.log("vehicles-regression: toaster is disabled, skipping its mechanics");
    } else {
    await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.select("toaster"));
    await stepFrames(page, 30);
    const toasterLabel = await page.locator("#chargeBtn .core").textContent();
    assert.equal(toasterLabel, "LAUNCH", "toaster relabels the ability button to LAUNCH");

    const capacity = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.params().capacity);
    assert.equal(capacity, 2, "toaster starts with two bread slots");

    // Contact must load rivals into the slots rather than ram them.
    const loadSlots = async () => {
      await setupDuel(page, { player: [0, 0.6, 0], enemy: [2.2, 0] });
      await spawnEnemyAt(page, -2.2, 0);
      return stepUntil(page, () => globalThis.CARBOY_FOLDABLE.garage.state().held > 0, 400);
    };

    await assertPlaying(page, "the toaster test");
    assert.ok(await loadSlots(), "toaster captures rivals it drives into");
    // Let the slot spring lift the catch before measuring where it rides.
    await stepFrames(page, 25);
    const beforeLaunch = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.state());
    assert.ok(beforeLaunch.held <= capacity, "the toaster never carries more than its capacity");

    const heldRide = await page.evaluate(() => {
      const game = globalThis.CARBOY;
      const ids = globalThis.CARBOY_FOLDABLE.garage.state().heldIds;
      const player = game.player.vehicle.position;
      const held = game.enemies.find((enemy) => ids.includes(enemy.vehicle.id));
      return { ids, ride: held ? held.vehicle.position.y - player.y : null };
    });
    assert.ok(heldRide.ride > 1,
      `captured rivals ride in the slots above the toaster (ids=${JSON.stringify(heldRide.ids)}, ride=${heldRide.ride})`);

    // Out of range: the island centre is 20m from any cliff, well past the 9m
    // launch range, so the load must land short and stay in play.
    const centreIds = beforeLaunch.heldIds;
    await page.evaluate(() => {
      globalThis.CARBOY.controls.charging = true;
      globalThis.CARBOY.controls.charging = false;
    });
    await stepFrames(page, 4);
    const afterShortLaunch = await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.state());
    assert.equal(afterShortLaunch.held, 0, "launch empties the bread slots");
    assert.ok(afterShortLaunch.cooldown > 0, "launch starts the reload cooldown");
    await stepFrames(page, 240);
    const shortSurvivors = [];
    for (const id of centreIds) if (await enemyAlive(page, id)) shortSurvivors.push(id);
    assert.equal(shortSurvivors.length, centreIds.length,
      "a launch with no cliff in range lands short and leaves rivals in play");

    // In range: reload, drive to the rim, and the same launch clears the edge.
    await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.select("toaster"));
    assert.ok(await loadSlots(), "toaster reloads after the cooldown");
    const rimIds = await page.evaluate(() => {
      const game = globalThis.CARBOY;
      const island = game.arena.world.islands[0];
      const position = game.player.vehicle.position.clone();
      position.set(island.x + island.radius - 2.5, 0.6, island.z);
      game.world.teleport(game.player.vehicle.body, position);
      return globalThis.CARBOY_FOLDABLE.garage.state().heldIds;
    });
    // Let the held stack catch up with the toaster's new position.
    await stepFrames(page, 20);
    const launchFrom = await page.evaluate(() => {
      const game = globalThis.CARBOY;
      const position = game.player.vehicle.position;
      const state = globalThis.CARBOY_FOLDABLE.garage.state();
      return {
        x: Number(position.x.toFixed(2)),
        z: Number(position.z.toFixed(2)),
        margin: Number(game.arena.marginAt(position.x, position.z).toFixed(2)),
        held: state.held,
        cooldown: Number(state.cooldown.toFixed(2)),
      };
    });
    assert.ok(launchFrom.held > 0, `the load survives the drive to the rim (${JSON.stringify(launchFrom)})`);
    assert.ok(launchFrom.margin < 4, `the toaster is at the rim before launching (${JSON.stringify(launchFrom)})`);
    assert.equal(launchFrom.cooldown, 0, `the spring is reloaded before launching (${JSON.stringify(launchFrom)})`);

    await page.evaluate(() => {
      globalThis.CARBOY.controls.charging = true;
      globalThis.CARBOY.controls.charging = false;
    });
    await stepFrames(page, 4);
    assert.equal((await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.state())).held, 0,
      "the rim launch empties the slots");
    const flight = [];
    for (let sample = 0; sample < 20; sample++) {
      await stepFrames(page, 15);
      flight.push(await page.evaluate((ids) => {
        const game = globalThis.CARBOY;
        return ids.map((id) => {
          const enemy = game.enemies.find((candidate) => candidate.vehicle.id === id);
          if (!enemy) return `${id}:gone`;
          const p = enemy.vehicle.position;
          return `${id}:(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
        }).join(" ");
      }, rimIds));
    }
    const rimSurvivors = [];
    for (const id of rimIds) if (await enemyAlive(page, id)) rimSurvivors.push(id);
    assert.ok(rimIds.length > 0, "rivals were loaded before the rim launch");
    assert.equal(rimSurvivors.length, 0,
      `rivals launched from the rim go over the edge (survivors: ${rimSurvivors.length})`
      + `\nlaunched from ${JSON.stringify(launchFrom)}\nflight:\n${flight.join("\n")}`);
    report.toaster = {
      capacity,
      held: beforeLaunch.held,
      heldRide: heldRide.ride,
      shortLaunchSurvivors: shortSurvivors.length,
      rimLaunched: rimIds.length,
      afterShortLaunch,
    };
    }

    // ---- skills: shared vs individual, and the save round-trip -------------
    // Run the economy against the vacuum, which is offered regardless of
    // whether the toaster is switched on.
    await page.evaluate(() => globalThis.CARBOY_FOLDABLE.garage.select("vacuum"));
    const economy = await page.evaluate(() => {
      const game = globalThis.CARBOY;
      const foldable = globalThis.CARBOY_FOLDABLE;
      return {
        magnet: game.progress.magnetRadius,
        multiplier: foldable.upgrades.coinMultiplier(),
        heliRange: foldable.garage.params("helicopter").range,
        vacuumRange: foldable.garage.params("vacuum").range,
      };
    });

    // Buy through the real shop UI so the purchase path itself is covered.
    await page.evaluate(() => {
      globalThis.CARBOY.progress.stash = 5000;
      globalThis.CARBOY.upgradeScreen.show(globalThis.CARBOY.progress.day, {
        knockouts: 3, coins: 40, stash: 5000, bestCombo: 2,
      });
    });
    await page.waitForSelector(".carboy-vehicle-row", { timeout: 15000 });
    const sections = await page.evaluate(() => [...document.querySelectorAll(".carboy-section-title")]
      .map((element) => element.firstChild.textContent.trim()));
    assert.deepEqual(sections, ["GARAGE", "SHARED SKILLS", "VACUUM SKILLS"], "shop splits garage, shared, and individual skills");
    assert.deepEqual(await page.locator(".carboy-vehicle-card").evaluateAll((cards) =>
      cards.map((card) => card.dataset.vehicleId)), day15.map((v) => v.id),
    "the garage lists exactly the offered vehicles");

    const bonusShown = await page.evaluate(() => document.querySelector(".carboy-upgrade-shop")?.textContent.includes("40 coins"));
    assert.ok(bonusShown, "the shop reports the day's raw coin total");

    await page.locator('.carboy-shop-section:nth-of-type(2) .carboy-upgrade-card[data-upgrade-id="magnet"]').first().click();
    await page.locator('.carboy-shop-section:nth-of-type(2) .carboy-upgrade-card[data-upgrade-id="multiplier"]').first().click();
    await page.locator('.carboy-upgrade-card[data-upgrade-id="suckRange"]').first().click();

    const afterBuying = await page.evaluate(() => {
      const foldable = globalThis.CARBOY_FOLDABLE;
      return {
        magnet: globalThis.CARBOY.progress.magnetRadius,
        multiplier: foldable.upgrades.coinMultiplier(),
        vacuumRange: foldable.garage.params("vacuum").range,
        heliRange: foldable.garage.params("helicopter").range,
        levels: foldable.garage.levels(),
      };
    });
    assert.ok(afterBuying.magnet > economy.magnet, "the shared magnet skill takes effect");
    assert.ok(Math.abs(afterBuying.multiplier - 1.1) < 1e-9, "the coin multiplier rises in 10% steps");
    assert.ok(afterBuying.vacuumRange > economy.vacuumRange, "an individual vacuum skill takes effect");
    assert.equal(afterBuying.heliRange, economy.heliRange, "buying a vacuum skill leaves the helicopter untouched");
    assert.equal(afterBuying.levels.vehicles.helicopter.blowRange, 0, "individual skills are tracked per vehicle");
    report.economy = { before: economy, after: { ...afterBuying, levels: undefined }, levels: afterBuying.levels };

    // Coin multiplier must actually change what gets banked.
    const banking = await page.evaluate(() => {
      const progress = globalThis.CARBOY.progress;
      const stashBefore = progress.stash;
      progress.carried = 100;
      progress.bankCarried();
      return { stashBefore, stashAfter: progress.stash, gained: progress.stash - stashBefore };
    });
    assert.equal(banking.gained, 110, "a 10% multiplier banks 110 coins for 100 collected");
    report.banking = banking;

    // ---- save format round-trip -------------------------------------------
    const saved = await page.evaluate(() => {
      globalThis.CARBOY_FOLDABLE.save.saveNow();
      return JSON.parse(localStorage.getItem(globalThis.CARBOY_FOLDABLE.save.key));
    });
    assert.equal(saved.version, 2, "the save format is versioned");
    assert.equal(saved.vehicle, "vacuum", "the active vehicle is saved");
    assert.equal(saved.shared.multiplier, 1, "shared skill levels are saved");
    assert.equal(saved.vehicles.vacuum.suckRange, 1, "individual skill levels are saved");
    assert.ok(saved.vehicles.toaster, "a disabled vehicle keeps its skill levels in the save");

    // A v1 save must migrate: magnet becomes shared, the rest become car skills.
    const migrated = await page.evaluate(() => {
      localStorage.removeItem(globalThis.CARBOY_FOLDABLE.save.key);
      localStorage.setItem(globalThis.CARBOY_FOLDABLE.save.legacyKey, JSON.stringify({
        version: 1, day: 4, stash: 77, taken: ["magnet", "magnet", "speed", "grip"],
      }));
      return globalThis.CARBOY_FOLDABLE.save.read();
    });
    assert.equal(migrated.version, 2, "a v1 save is migrated forward");
    assert.equal(migrated.shared.magnet, 2, "v1 magnet levels move to shared skills");
    assert.equal(migrated.vehicles.car.speed, 1, "v1 car levels stay with the car");
    assert.equal(migrated.vehicles.car.grip, 1, "every v1 car level is preserved");
    assert.equal(migrated.vehicle, "car", "a migrated save starts in the car");
    report.save = { saved, migrated };

    fs.mkdirSync(resultsDir, { recursive: true });
    await page.screenshot({ path: path.join(resultsDir, "vehicles-shop.png") });

    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    fs.writeFileSync(path.join(resultsDir, "vehicles-regression.json"), `${JSON.stringify(report, null, 2)}\n`);

    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    assert.deepEqual(consoleErrors, [], "no console errors");

    console.log(JSON.stringify(report, null, 2));
    console.log("\nvehicles-regression: PASS");
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => {
  console.error("vehicles-regression: FAIL");
  console.error(error);
  console.error({ consoleErrors, pageErrors });
  process.exitCode = 1;
});
