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
    version: 3,
    layout: scheduleLayout,
    getState: () => lastLayout,
  };
})();

