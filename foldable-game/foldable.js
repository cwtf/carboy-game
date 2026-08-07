(function () {
  "use strict";

  const stage = document.getElementById("stage");
  const frame = document.getElementById("frame");
  const canvas = document.getElementById("render");
  if (!stage || !frame || !canvas) return;

  const testMode = new URLSearchParams(location.search).get("foldable");
  const requestedPrimary = Number(new URLSearchParams(location.search).get("primary"));
  const requestedGap = Number(new URLSearchParams(location.search).get("hinge"));

  const secondary = document.createElement("aside");
  secondary.id = "foldable-secondary";
  secondary.setAttribute("aria-label", "Game status and controls summary");
  secondary.innerHTML = `
    <div class="foldable-kicker">Trouble in paradise</div>
    <h1 class="foldable-title">CAR<br>BOY</h1>
    <dl class="foldable-stats">
      <div class="foldable-stat"><dt>Day</dt><dd data-fold-stat="day">1</dd></div>
      <div class="foldable-stat"><dt>Coins</dt><dd data-fold-stat="coins">0</dd></div>
      <div class="foldable-stat"><dt>Combo</dt><dd data-fold-stat="combo">—</dd></div>
      <div class="foldable-stat"><dt>Speed</dt><dd data-fold-stat="speed">0</dd></div>
    </dl>
    <p class="foldable-help">Drag on the game screen to steer. Hold RAM to aim by touch, or hold Shift and aim with the mouse. Release to strike; press Esc to pause.</p>
    <div class="foldable-status" data-fold-status>Game loading</div>
  `;
  stage.appendChild(secondary);

  const safeProbe = document.createElement("div");
  safeProbe.className = "foldable-probe";
  safeProbe.setAttribute("aria-hidden", "true");
  safeProbe.style.cssText = [
    "left:0",
    "top:0",
    "width:0",
    "height:0",
    "padding-top:env(safe-area-inset-top, 0px)",
    "padding-right:env(safe-area-inset-right, 0px)",
    "padding-bottom:env(safe-area-inset-bottom, 0px)",
    "padding-left:env(safe-area-inset-left, 0px)",
  ].join(";");
  document.body.appendChild(safeProbe);

  const segmentProbes = [];
  for (const [column, row] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const probe = document.createElement("div");
    probe.className = "foldable-probe";
    probe.dataset.column = String(column);
    probe.dataset.row = String(row);
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = [
      `left:env(viewport-segment-left ${column} ${row}, -10000px)`,
      `top:env(viewport-segment-top ${column} ${row}, -10000px)`,
      `width:env(viewport-segment-width ${column} ${row}, 0px)`,
      `height:env(viewport-segment-height ${column} ${row}, 0px)`,
    ].join(";");
    document.body.appendChild(probe);
    segmentProbes.push(probe);
  }

  const statElements = Object.fromEntries(
    [...secondary.querySelectorAll("[data-fold-stat]")].map((element) => [element.dataset.foldStat, element]),
  );
  const statusElement = secondary.querySelector("[data-fold-status]");

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const round = (value) => Math.round(value * 100) / 100;

  function normalizedRect(rect) {
    const x = number(rect.x ?? rect.left);
    const y = number(rect.y ?? rect.top);
    const width = number(rect.width, number(rect.right) - x);
    const height = number(rect.height, number(rect.bottom) - y);
    return { x, y, width, height, right: x + width, bottom: y + height };
  }

  function getSafeInsets() {
    const style = getComputedStyle(safeProbe);
    return {
      top: Number.parseFloat(style.paddingTop) || 0,
      right: Number.parseFloat(style.paddingRight) || 0,
      bottom: Number.parseFloat(style.paddingBottom) || 0,
      left: Number.parseFloat(style.paddingLeft) || 0,
    };
  }

  function getSafeViewport() {
    const rect = normalizedRect(stage.getBoundingClientRect());
    const inset = getSafeInsets();
    const x = rect.x + inset.left;
    const y = rect.y + inset.top;
    const width = Math.max(1, rect.width - inset.left - inset.right);
    const height = Math.max(1, rect.height - inset.top - inset.bottom);
    return { x, y, width, height, right: x + width, bottom: y + height };
  }

  function intersect(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    if (right - x < 2 || bottom - y < 2) return null;
    return { x, y, width: right - x, height: bottom - y, right, bottom };
  }

  function simulatedSegments(viewport) {
    if (testMode !== "vertical" && testMode !== "horizontal") return [];
    const gap = Number.isFinite(requestedGap) && requestedGap >= 0 ? requestedGap : 24;
    if (testMode === "vertical") {
      const width = Math.max(1, (viewport.width - gap) / 2);
      return [
        { x: viewport.x, y: viewport.y, width, height: viewport.height, right: viewport.x + width, bottom: viewport.bottom },
        { x: viewport.x + width + gap, y: viewport.y, width, height: viewport.height, right: viewport.right, bottom: viewport.bottom },
      ];
    }
    const height = Math.max(1, (viewport.height - gap) / 2);
    return [
      { x: viewport.x, y: viewport.y, width: viewport.width, height, right: viewport.right, bottom: viewport.y + height },
      { x: viewport.x, y: viewport.y + height + gap, width: viewport.width, height, right: viewport.right, bottom: viewport.bottom },
    ];
  }

  function exposedSegments(viewport) {
    const simulated = simulatedSegments(viewport);
    if (simulated.length) return simulated;

    if (typeof window.getWindowSegments === "function") {
      try {
        const legacy = window.getWindowSegments().map(normalizedRect).map((rect) => intersect(rect, viewport)).filter(Boolean);
        if (legacy.length > 1) return legacy;
      } catch (_) {
        // Continue to standards-based CSS env() probing.
      }
    }

    const probed = segmentProbes
      .map((probe) => normalizedRect(probe.getBoundingClientRect()))
      .filter((rect) => rect.x > -9999 && rect.width > 1 && rect.height > 1)
      .map((rect) => intersect(rect, viewport))
      .filter(Boolean);
    const unique = probed.filter((rect, index) => probed.findIndex((other) =>
      Math.abs(other.x - rect.x) < 1
      && Math.abs(other.y - rect.y) < 1
      && Math.abs(other.width - rect.width) < 1
      && Math.abs(other.height - rect.height) < 1) === index);
    return unique.length > 1 ? unique : [];
  }

  function applyRect(element, rect) {
    element.style.left = `${round(rect.x)}px`;
    element.style.top = `${round(rect.y)}px`;
    element.style.width = `${round(rect.width)}px`;
    element.style.height = `${round(rect.height)}px`;
  }

  function syncBackingBuffer() {
    const engine = globalThis.CARBOY?.app?.engine;
    if (engine && typeof engine.resize === "function") engine.resize(true);
  }

  let lastLayout = null;
  function layout() {
    const viewport = getSafeViewport();
    const segments = exposedSegments(viewport);
    let gameAvailable = viewport;
    let secondaryAvailable = null;
    let primaryIndex = 0;

    if (segments.length > 1) {
      if (Number.isInteger(requestedPrimary) && requestedPrimary >= 0 && requestedPrimary < segments.length) {
        primaryIndex = requestedPrimary;
      } else {
        primaryIndex = segments.reduce((best, segment, index) =>
          segment.width * segment.height > segments[best].width * segments[best].height ? index : best, 0);
      }
      gameAvailable = segments[primaryIndex];
      secondaryAvailable = segments
        .map((segment, index) => ({ segment, index }))
        .filter((item) => item.index !== primaryIndex)
        .sort((a, b) => b.segment.width * b.segment.height - a.segment.width * a.segment.height)[0]?.segment ?? null;
      stage.classList.add("is-segmented");
      stage.dataset.primarySegment = String(primaryIndex);
      stage.dataset.segmentCount = String(segments.length);
    } else {
      stage.classList.remove("is-segmented");
      delete stage.dataset.primarySegment;
      stage.dataset.segmentCount = "1";
    }

    const gameRect = normalizedRect(gameAvailable);
    applyRect(frame, gameRect);
    frame.style.transform = "none";

    if (secondaryAvailable) {
      const inset = Math.min(24, Math.max(10, Math.min(secondaryAvailable.width, secondaryAvailable.height) * 0.025));
      applyRect(secondary, {
        x: secondaryAvailable.x + inset,
        y: secondaryAvailable.y + inset,
        width: Math.max(1, secondaryAvailable.width - inset * 2),
        height: Math.max(1, secondaryAvailable.height - inset * 2),
      });
    } else {
      secondary.removeAttribute("style");
    }

    const nextLayout = {
      segmented: Boolean(secondaryAvailable),
      viewport,
      segments,
      primaryIndex,
      gameRect,
      secondaryRect: secondaryAvailable,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    lastLayout = nextLayout;
    stage.dispatchEvent(new CustomEvent("carboylayoutchange", { detail: nextLayout }));
    requestAnimationFrame(syncBackingBuffer);
  }

  let animationFrame = 0;
  function scheduleLayout() {
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      layout();
      requestAnimationFrame(syncBackingBuffer);
    });
  }

  function updateSecondary() {
    installAutoSave();
    installExpandedUpgradeShop();
    const game = globalThis.CARBOY;
    const progress = game?.progress;
    if (statElements.day) statElements.day.textContent = String(number(progress?.day, 1));
    if (statElements.coins) statElements.coins.textContent = String(Math.round(number(progress?.stash) + number(progress?.carried)));
    if (statElements.combo) {
      const combo = number(game?.combo?.combo);
      statElements.combo.textContent = combo > 1 ? `×${combo}` : "—";
    }
    if (statElements.speed) statElements.speed.textContent = String(Math.round(number(game?.player?.planarSpeed)));
    if (statusElement) {
      statusElement.textContent = !game
        ? "Game loading"
        : game.titleScreen?.open
          ? "Ready to start"
          : document.hidden
            ? "Paused in background"
            : "Game running";
    }
  }

  window.addEventListener("resize", scheduleLayout, { passive: true });
  window.addEventListener("orientationchange", () => {
    scheduleLayout();
    setTimeout(scheduleLayout, 80);
    setTimeout(scheduleLayout, 320);
    setTimeout(scheduleLayout, 750);
  }, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleLayout, { passive: true });

  for (const query of ["(horizontal-viewport-segments: 2)", "(vertical-viewport-segments: 2)"]) {
    const media = window.matchMedia(query);
    if (typeof media.addEventListener === "function") media.addEventListener("change", scheduleLayout);
  }

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(document.documentElement);
  }

  const ALL_UPGRADES = [
    { id: "speed", name: "TUNED ENGINE", blurb: "More top speed.", effect: "+18% speed" },
    { id: "power", name: "REINFORCED BUMPER", blurb: "Shove harder. Same size.", effect: "+22% push" },
    { id: "size", name: "HEAVY CHASSIS", blurb: "Bigger and harder to move. Pushes no harder.", effect: "+16% mass, −18% knockback taken" },
    { id: "ram", name: "NITRO RAM", blurb: "A charged hit launches further.", effect: "+25% ram force" },
    { id: "magnet", name: "COIN MAGNET", blurb: "Pull gold in from further away.", effect: "+35% magnet range" },
    { id: "grip", name: "RACE TYRES", blurb: "Hold a line through corners.", effect: "+30% grip" },
    { id: "charge", name: "QUICK WIND-UP", blurb: "Reach full ram sooner.", effect: "−18% charge time" },
  ];
  const NEXT_DAY_UPGRADE_ID = "__carboy_next_day__";
  const UPGRADE_BASE_COST = 10;
  const SAVE_KEY = "carboy-progress-v1";
  const VALID_UPGRADE_IDS = new Set(ALL_UPGRADES.map((upgrade) => upgrade.id));
  let autoSaveInstalled = false;
  let savingDisabled = false;
  let sessionHasProgress = false;
  let lastSavedPayload = "";

  function sanitizeSavedGame(value) {
    if (!value || typeof value !== "object") return null;
    const day = Math.max(1, Math.min(9999, Math.floor(number(value.day, 1))));
    const stash = Math.max(0, Math.min(1_000_000_000, Math.floor(number(value.stash))));
    const taken = Array.isArray(value.taken)
      ? value.taken.filter((id) => VALID_UPGRADE_IDS.has(id)).slice(0, 500)
      : [];
    return { version: 1, day, stash, taken };
  }

  function readSavedGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? sanitizeSavedGame(JSON.parse(raw)) : null;
    } catch (_) {
      return null;
    }
  }

  function currentSavedGame() {
    const game = globalThis.CARBOY;
    if (!game?.progress) return null;
    const atIntermission = Boolean(game.upgradeScreen?.open);
    return sanitizeSavedGame({
      version: 1,
      day: game.progress.day + (atIntermission ? 1 : 0),
      stash: game.progress.stash,
      taken: game.progress.taken,
    });
  }

  function saveProgress(force = false) {
    if (savingDisabled || (!sessionHasProgress && !force)) return false;
    const data = currentSavedGame();
    if (!data) return false;
    try {
      const payload = JSON.stringify(data);
      if (payload !== lastSavedPayload) {
        localStorage.setItem(SAVE_KEY, payload);
        lastSavedPayload = payload;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function resetNewGameButton(button) {
    button.dataset.confirmNewGame = "false";
    button.textContent = button.dataset.defaultLabel || "NEW GAME";
    button.classList.remove("is-confirming");
  }

  function startNewGame() {
    savingDisabled = true;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (_) {
      // Reloading still resets this in-memory run if storage is unavailable.
    }
    location.reload();
  }

  function addNewGameButton(container, locationName) {
    if (!container || container.querySelector(`[data-new-game-location="${locationName}"]`)) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `carboy-new-game carboy-new-game-${locationName}`;
    button.dataset.newGameLocation = locationName;
    button.dataset.defaultLabel = "NEW GAME";
    button.textContent = "NEW GAME";
    button.setAttribute("aria-label", "Start a new game and erase saved progress");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.confirmNewGame === "true") {
        startNewGame();
        return;
      }
      button.dataset.confirmNewGame = "true";
      button.textContent = "CONFIRM NEW GAME";
      button.classList.add("is-confirming");
      setTimeout(() => document.contains(button) && resetNewGameButton(button), 3500);
    });
    container.appendChild(button);
    return button;
  }

  function installNewGameControls(game, saved) {
    const titleRoot = game.titleScreen?.root;
    const startButton = titleRoot?.querySelector(".carboyStartButton");
    if (startButton && startButton.dataset.autoSaveBound !== "true") {
      startButton.dataset.autoSaveBound = "true";
      const markStarted = () => {
        sessionHasProgress = true;
        queueMicrotask(() => saveProgress(true));
      };
      startButton.addEventListener("pointerdown", markStarted);
      startButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") markStarted();
      });
    }
    if (saved && startButton) {
      startButton.textContent = `CONTINUE DAY ${saved.day}`;
      startButton.setAttribute("aria-label", `Continue Day ${saved.day}`);
      let saveSummary = titleRoot.querySelector(".carboy-save-summary");
      if (!saveSummary) {
        saveSummary = document.createElement("div");
        saveSummary.className = "carboy-save-summary";
        titleRoot.appendChild(saveSummary);
      }
      saveSummary.textContent = `AUTO-SAVE FOUND · DAY ${saved.day} · STASH ${saved.stash}`;
      addNewGameButton(titleRoot, "title");
    }

    const pauseRoot = [...frame.children].find((element) =>
      element !== titleRoot
      && element.textContent.includes("PAUSED")
      && [...element.querySelectorAll("button")].some((button) => button.textContent.trim() === "RESUME"));
    addNewGameButton(pauseRoot?.firstElementChild, "pause");
  }

  function installAutoSave() {
    const game = globalThis.CARBOY;
    if (autoSaveInstalled || !game?.progress || !game?.titleScreen) return;
    autoSaveInstalled = true;

    const saved = readSavedGame();
    if (saved) {
      game.progress.day = saved.day;
      game.progress.stash = saved.stash;
      game.progress.carried = 0;
      game.progress.taken = [...saved.taken];
      game.progress.apply();
      game.player.vehicle.setMass(game.TUNING.player.mass);
      game.player.rig.setScale(game.progress.visualScale);
      sessionHasProgress = true;
      lastSavedPayload = JSON.stringify(saved);
    }
    installNewGameControls(game, saved);

    setInterval(() => {
      if (!game.titleScreen.open) sessionHasProgress = true;
      saveProgress();
    }, 500);
    window.addEventListener("pagehide", () => saveProgress());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) saveProgress();
    });
  }
  let upgradeShopInstalled = false;

  function upgradeCost(level) {
    return UPGRADE_BASE_COST * (level + 1);
  }

  function installExpandedUpgradeShop() {
    const game = globalThis.CARBOY;
    if (upgradeShopInstalled || !game?.upgradeScreen || !game?.progress) return;
    upgradeShopInstalled = true;

    const screen = game.upgradeScreen;
    const progress = game.progress;
    const originalTake = progress.take.bind(progress);
    progress.take = (id) => id === NEXT_DAY_UPGRADE_ID ? undefined : originalTake(id);

    screen.show = (day, summary) => {
      screen.title.textContent = `DAY ${day} CLEARED`;
      screen.root.classList.add("carboy-upgrade-shop");
      const shopLabel = screen.root.children[2];
      if (shopLabel) {
        shopLabel.classList.add("carboy-upgrade-label");
        shopLabel.textContent = "UPGRADE AS MUCH AS YOU CAN AFFORD";
      }
      screen.cards.classList.add("carboy-upgrade-cards");
      screen.root.style.display = "flex";

      const render = () => {
        screen.stats.innerHTML = `${summary.knockouts} knocked off &nbsp;·&nbsp; ${summary.coins} coins &nbsp;·&nbsp; best ×${summary.bestCombo}<br><span style="color:#ffd23f">STASH ${progress.stash}</span>`;
        const grid = document.createElement("div");
        grid.className = "carboy-upgrade-grid";

        for (const upgrade of ALL_UPGRADES) {
          const level = progress.count(upgrade.id);
          const cost = upgradeCost(level);
          const affordable = progress.stash >= cost;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "carboy-upgrade-card";
          button.dataset.upgradeId = upgrade.id;
          button.disabled = !affordable;
          button.setAttribute("aria-label", `${upgrade.name}, level ${level}, upgrade to level ${level + 1} for ${cost} coins`);

          const heading = document.createElement("div");
          heading.className = "carboy-upgrade-heading";
          const name = document.createElement("span");
          name.className = "carboy-upgrade-name";
          name.textContent = upgrade.name;
          const levelText = document.createElement("span");
          levelText.className = "carboy-upgrade-level";
          levelText.textContent = `LEVEL ${level}`;
          heading.append(name, levelText);

          const blurb = document.createElement("div");
          blurb.className = "carboy-upgrade-blurb";
          blurb.textContent = upgrade.blurb;
          const footer = document.createElement("div");
          footer.className = "carboy-upgrade-footer";
          const effect = document.createElement("span");
          effect.className = "carboy-upgrade-effect";
          effect.textContent = upgrade.effect;
          const price = document.createElement("span");
          price.className = "carboy-upgrade-price";
          price.textContent = affordable ? `${cost} COINS → LEVEL ${level + 1}` : `NEED ${cost} COINS`;
          footer.append(effect, price);
          button.append(heading, blurb, footer);

          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const currentLevel = progress.count(upgrade.id);
            const currentCost = upgradeCost(currentLevel);
            if (progress.stash < currentCost) return;
            button.disabled = true;
            progress.stash -= currentCost;
            originalTake(upgrade.id);
            sessionHasProgress = true;
            saveProgress(true);
            game.player.vehicle.setMass(game.TUNING.player.mass);
            game.player.rig.setScale(progress.visualScale);
            render();
          });
          grid.appendChild(button);
        }

        const nextButton = document.createElement("button");
        nextButton.type = "button";
        nextButton.className = "carboy-next-day";
        nextButton.textContent = `START DAY ${day + 1}`;
        nextButton.setAttribute("aria-label", `Proceed to Day ${day + 1}`);
        nextButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          nextButton.disabled = true;
          screen.root.style.display = "none";
          screen.resolve?.({ id: NEXT_DAY_UPGRADE_ID });
          screen.resolve = null;
        });

        screen.cards.replaceChildren(grid, nextButton);
        addNewGameButton(screen.cards, "upgrade");
      };

      render();
      return new Promise((resolve) => {
        screen.resolve = resolve;
      });
    };
  }
  document.addEventListener("visibilitychange", updateSecondary);
  const ramKeys = new Set();
  const mouseAim = { x: 0, y: 0, available: false };
  let aimAnimationFrame = 0;
  const isTypingTarget = (target) => target instanceof HTMLElement
    && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

  function getPauseButton() {
    return [...frame.querySelectorAll("button")].find((button) =>
      /^(Pause|Resume) game$/i.test(button.getAttribute("aria-label") || ""));
  }

  function releaseKeyboardRam() {
    ramKeys.clear();
    const controls = globalThis.CARBOY?.controls;
    if (controls?.charging) {
      controls.charging = false;
      controls.released = true;
    }
    if (controls) controls.aiming = false;
    cancelAnimationFrame(aimAnimationFrame);
    aimAnimationFrame = 0;
  }

  function updateKeyboardAim() {
    const game = globalThis.CARBOY;
    const controls = game?.controls;
    if (!controls || ramKeys.size === 0 || !mouseAim.available) return false;

    const rect = canvas.getBoundingClientRect();
    const pointerX = mouseAim.x - rect.left;
    const pointerY = mouseAim.y - rect.top;
    const playerPosition = game.player?.vehicle?.position;
    let directionX = 0;
    let directionZ = 0;

    try {
      const ray = game.app.scene.createPickingRay(pointerX, pointerY, undefined, game.app.camera);
      const distance = playerPosition && Math.abs(ray.direction.y) > 0.00001
        ? (playerPosition.y - ray.origin.y) / ray.direction.y
        : -1;
      if (distance > 0) {
        directionX = ray.origin.x + ray.direction.x * distance - playerPosition.x;
        directionZ = ray.origin.z + ray.direction.z * distance - playerPosition.z;
      }
    } catch (_) {
      // The screen-space fallback below matches the original touch aim mapping.
    }

    let length = Math.hypot(directionX, directionZ);
    if (length < 0.001) {
      directionX = mouseAim.x - (rect.left + rect.width / 2);
      directionZ = -(mouseAim.y - (rect.top + rect.height / 2));
      length = Math.hypot(directionX, directionZ);
    }
    if (length < 0.001) return false;

    controls.aimDir.set(directionX / length, 0, directionZ / length);
    controls.aiming = true;
    return true;
  }

  function animateKeyboardAim() {
    aimAnimationFrame = 0;
    if (ramKeys.size === 0) return;
    updateKeyboardAim();
    aimAnimationFrame = requestAnimationFrame(animateKeyboardAim);
  }

  function startKeyboardAim() {
    updateKeyboardAim();
    if (!aimAnimationFrame) aimAnimationFrame = requestAnimationFrame(animateKeyboardAim);
  }

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    mouseAim.x = event.clientX;
    mouseAim.y = event.clientY;
    mouseAim.available = true;
    if (ramKeys.size) updateKeyboardAim();
  }, { passive: true, capture: true });

  window.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target)) return;

    if (event.code === "Escape") {
      if (event.repeat) return;
      const pauseButton = getPauseButton();
      if (pauseButton && getComputedStyle(pauseButton).display !== "none") {
        event.preventDefault();
        pauseButton.click();
      }
      return;
    }

    if (event.code !== "ShiftLeft" && event.code !== "ShiftRight") return;
    event.preventDefault();
    ramKeys.add(event.code);
    const controls = globalThis.CARBOY?.controls;
    if (controls && !controls.charging) controls.charging = true;
    startKeyboardAim();
  });

  window.addEventListener("keyup", (event) => {
    if (event.code !== "ShiftLeft" && event.code !== "ShiftRight") return;
    event.preventDefault();
    ramKeys.delete(event.code);
    if (ramKeys.size === 0) releaseKeyboardRam();
  });

  window.addEventListener("blur", releaseKeyboardRam);
  setInterval(updateSecondary, 250);
  updateSecondary();
  layout();

  globalThis.CARBOY_FOLDABLE = {
    version: 5,
    layout: scheduleLayout,
    getState: () => lastLayout,
    upgrades: { all: ALL_UPGRADES, costForLevel: upgradeCost },
    save: {
      key: SAVE_KEY,
      read: readSavedGame,
      saveNow: () => {
        sessionHasProgress = true;
        return saveProgress(true);
      },
      startNewGame,
    },
  };
})();

