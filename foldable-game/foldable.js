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
      <div class="foldable-stat"><dt>Vehicle</dt><dd data-fold-stat="vehicle">CAR BOY</dd></div>
      <div class="foldable-stat"><dt>Ability</dt><dd data-fold-stat="ability">RAM</dd></div>
    </dl>
    <p class="foldable-help" data-fold-help>Drag on the game screen to steer. Hold RAM to aim by touch, or hold Shift and aim with the mouse. Release to strike; press Esc to pause.</p>
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
  const helpElement = secondary.querySelector("[data-fold-help]");

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const round = (value) => Math.round(value * 100) / 100;
  const clamp = (value, low, high) => value < low ? low : value > high ? high : value;

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

  // ---------------------------------------------------------------------------
  // Skills: shared across every vehicle, or individual to one vehicle
  // ---------------------------------------------------------------------------

  const SHARED_SKILLS = [
    { id: "magnet", name: "COIN MAGNET", blurb: "Pull gold in from further away.", effect: "+35% magnet range" },
    { id: "multiplier", name: "COIN MULTIPLIER", blurb: "Every banked coin is worth more.", effect: "+10% coins banked" },
  ];

  const SPEED_SKILL = { id: "speed", name: "TUNED ENGINE", blurb: "More top speed.", effect: "+18% speed" };

  const VEHICLES = [
    {
      id: "car",
      name: "CAR BOY",
      unlockDay: 1,
      action: "RAM",
      blurb: "Charge, aim, and shove rivals off the island.",
      help: "Hold RAM to aim by touch, or hold Shift and aim with the mouse. Release to strike.",
      skills: [
        SPEED_SKILL,
        { id: "power", name: "REINFORCED BUMPER", blurb: "Shove harder. Same size.", effect: "+22% push" },
        { id: "size", name: "HEAVY CHASSIS", blurb: "Bigger and harder to move. Pushes no harder.", effect: "+16% mass, −18% knockback taken" },
        { id: "ram", name: "NITRO RAM", blurb: "A charged hit launches further.", effect: "+25% ram force" },
        { id: "grip", name: "RACE TYRES", blurb: "Hold a line through corners.", effect: "+30% grip" },
        { id: "charge", name: "QUICK WIND-UP", blurb: "Reach full ram sooner.", effect: "−18% charge time" },
      ],
    },
    {
      id: "vacuum",
      name: "VACUUM",
      unlockDay: 5,
      action: "SUCK",
      blurb: "Still rams. Hold SUCK to drag rivals in and swallow them.",
      help: "Hold SUCK (or Shift) to drag rivals in. Anything that reaches the nozzle is swallowed. The tank empties as you hold it and refills when you let go.",
      skills: [
        SPEED_SKILL,
        { id: "suckPower", name: "TURBO MOTOR", blurb: "Drag rivals in harder.", effect: "+20% vacuum power" },
        { id: "suckRange", name: "WIDE NOZZLE", blurb: "Reach further down the street.", effect: "+30% vacuum range" },
        { id: "suckDuration", name: "BIGGER TANK", blurb: "Hold the suction for longer.", effect: "+25% vacuum duration" },
        { id: "suckRecharge", name: "FAST PURGE", blurb: "Empty the bag sooner.", effect: "−25% recharge time" },
      ],
    },
    {
      id: "helicopter",
      name: "HELICOPTER",
      unlockDay: 10,
      action: "BLOW",
      blurb: "Hovers out of reach. Cannot hit or be hit — only downwash moves rivals.",
      help: "You hover, so nothing can touch you and you cannot ram. Hold BLOW (or Shift) to blast rivals away from you and over the edge.",
      skills: [
        SPEED_SKILL,
        { id: "blowRange", name: "WIDER WASH", blurb: "Downwash reaches further out.", effect: "+20% blow range" },
        { id: "blowPower", name: "HEAVY ROTOR", blurb: "Shove rivals harder.", effect: "+30% blow power" },
        { id: "blowDuration", name: "LONG BURST", blurb: "Hold the blast for longer.", effect: "+25% blow duration" },
        { id: "blowRecharge", name: "QUICK SPOOL", blurb: "Spin back up sooner.", effect: "−25% recharge time" },
      ],
    },
    {
      id: "toaster",
      name: "TOASTER",
      unlockDay: 15,
      action: "LAUNCH",
      blurb: "Catches rivals in its bread slots, then fires them at the nearest cliff.",
      help: "Drive into rivals to load them into the slots. Press LAUNCH (or Shift) to fire the load at the nearest cliff — get close enough or they land short.",
      skills: [
        SPEED_SKILL,
        { id: "capacity", name: "EXTRA SLOT", blurb: "Carry one more rival at a time.", effect: "+1 car capacity" },
        { id: "launchRange", name: "STRONGER SPRING", blurb: "Fling the load further.", effect: "+25% launch range" },
        { id: "launchRecharge", name: "RAPID ELEMENT", blurb: "Reload the slots sooner.", effect: "−30% recharge time" },
      ],
    },
  ];

  const VEHICLES_BY_ID = new Map(VEHICLES.map((vehicle) => [vehicle.id, vehicle]));
  const DEFAULT_VEHICLE_ID = "car";

  // Ability baselines. Individual skills scale these; the shop only ever shows
  // the multiplier, so the raw numbers stay a single place to retune.
  const ABILITY_BASE = {
    // `accel` ramps the radial speed, `speed` caps it. The blow has to out-argue
    // a rival driving straight back at the helicopter at 44 m/s², so its ramp is
    // set well above that; the vacuum works with the rival's own approach, so it
    // needs far less.
    helicopter: { range: 7, accel: 115, speed: 21, duration: 1.6, recharge: 3 },
    // Capture sits just outside body contact (1.1 + 1.5 half-lengths), so a
    // rival dragged onto the nozzle is swallowed rather than bouncing off it.
    vacuum: { range: 8.5, accel: 36, speed: 16, duration: 1.8, recharge: 3.2, capture: 2.5 },
    toaster: { range: 9, recharge: 2.6, capacity: 2 },
  };
  const HOVER_HEIGHT = 3.2;

  const NEXT_DAY_UPGRADE_ID = "__carboy_next_day__";
  const UPGRADE_BASE_COST = 10;
  const SAVE_KEY = "carboy-progress-v2";
  const LEGACY_SAVE_KEY = "carboy-progress-v1";

  const skills = { shared: {}, vehicles: {} };
  for (const skill of SHARED_SKILLS) skills.shared[skill.id] = 0;
  for (const vehicle of VEHICLES) {
    skills.vehicles[vehicle.id] = {};
    for (const skill of vehicle.skills) skills.vehicles[vehicle.id][skill.id] = 0;
  }
  let activeVehicleId = DEFAULT_VEHICLE_ID;

  let autoSaveInstalled = false;
  let savingDisabled = false;
  let sessionHasProgress = false;
  let lastSavedPayload = "";

  const sharedLevel = (id) => number(skills.shared[id]);
  const vehicleLevel = (vehicleId, id) => number(skills.vehicles[vehicleId]?.[id]);
  const activeVehicle = () => VEHICLES_BY_ID.get(activeVehicleId) || VEHICLES_BY_ID.get(DEFAULT_VEHICLE_ID);
  const upgradeCost = (level) => UPGRADE_BASE_COST * (level + 1);
  const coinMultiplier = () => 1 + 0.1 * sharedLevel("multiplier");
  const currentDay = () => Math.max(1, Math.floor(number(globalThis.CARBOY?.progress?.day, 1)));
  const isUnlocked = (vehicle) => currentDay() >= vehicle.unlockDay;

  function abilityParams(vehicleId = activeVehicleId) {
    const base = ABILITY_BASE[vehicleId];
    if (!base) return null;
    const level = (id) => vehicleLevel(vehicleId, id);
    if (vehicleId === "helicopter") {
      const power = Math.pow(1.3, level("blowPower"));
      return {
        range: base.range * Math.pow(1.2, level("blowRange")),
        accel: base.accel * power,
        speed: base.speed * power,
        duration: base.duration * Math.pow(1.25, level("blowDuration")),
        recharge: base.recharge * Math.pow(0.75, level("blowRecharge")),
      };
    }
    if (vehicleId === "vacuum") {
      const power = Math.pow(1.2, level("suckPower"));
      return {
        range: base.range * Math.pow(1.3, level("suckRange")),
        accel: base.accel * power,
        speed: base.speed * power,
        duration: base.duration * Math.pow(1.25, level("suckDuration")),
        recharge: base.recharge * Math.pow(0.75, level("suckRecharge")),
        capture: base.capture,
      };
    }
    return {
      range: base.range * Math.pow(1.25, level("launchRange")),
      recharge: base.recharge * Math.pow(0.7, level("launchRecharge")),
      capacity: base.capacity + level("capacity"),
    };
  }

  // ---------------------------------------------------------------------------
  // Saved progress
  // ---------------------------------------------------------------------------

  function sanitizeLevel(value) {
    return Math.max(0, Math.min(500, Math.floor(number(value))));
  }

  function sanitizeSavedGame(value) {
    if (!value || typeof value !== "object") return null;
    const day = Math.max(1, Math.min(9999, Math.floor(number(value.day, 1))));
    const stash = Math.max(0, Math.min(1_000_000_000, Math.floor(number(value.stash))));

    // A v1 save is a flat list of car upgrade ids, with the magnet among them.
    if (Array.isArray(value.taken) && !value.vehicles) {
      const shared = {};
      for (const skill of SHARED_SKILLS) shared[skill.id] = 0;
      const vehicles = {};
      for (const vehicle of VEHICLES) {
        vehicles[vehicle.id] = {};
        for (const skill of vehicle.skills) vehicles[vehicle.id][skill.id] = 0;
      }
      for (const id of value.taken.slice(0, 500)) {
        if (shared[id] !== undefined) shared[id]++;
        else if (vehicles.car[id] !== undefined) vehicles.car[id]++;
      }
      return { version: 2, day, stash, vehicle: DEFAULT_VEHICLE_ID, shared, vehicles };
    }

    const shared = {};
    for (const skill of SHARED_SKILLS) shared[skill.id] = sanitizeLevel(value.shared?.[skill.id]);
    const vehicles = {};
    for (const vehicle of VEHICLES) {
      vehicles[vehicle.id] = {};
      for (const skill of vehicle.skills) {
        vehicles[vehicle.id][skill.id] = sanitizeLevel(value.vehicles?.[vehicle.id]?.[skill.id]);
      }
    }
    const requested = VEHICLES_BY_ID.get(value.vehicle);
    const vehicle = requested && day >= requested.unlockDay ? requested.id : DEFAULT_VEHICLE_ID;
    return { version: 2, day, stash, vehicle, shared, vehicles };
  }

  function readSavedGame() {
    for (const key of [SAVE_KEY, LEGACY_SAVE_KEY]) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return sanitizeSavedGame(JSON.parse(raw));
      } catch (_) {
        // Fall through to the next key, then to a fresh game.
      }
    }
    return null;
  }

  function currentSavedGame() {
    const game = globalThis.CARBOY;
    if (!game?.progress) return null;
    const atIntermission = Boolean(game.upgradeScreen?.open);
    return sanitizeSavedGame({
      version: 2,
      day: game.progress.day + (atIntermission ? 1 : 0),
      stash: game.progress.stash,
      vehicle: activeVehicleId,
      shared: skills.shared,
      vehicles: skills.vehicles,
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

  function startNewGame() {
    savingDisabled = true;
    for (const key of [SAVE_KEY, LEGACY_SAVE_KEY]) {
      try {
        localStorage.removeItem(key);
      } catch (_) {
        // Reloading still resets this in-memory run if storage is unavailable.
      }
    }
    location.reload();
  }

  // ---------------------------------------------------------------------------
  // Tuning: skill levels drive the production TUNING table
  // ---------------------------------------------------------------------------

  function visualScaleFor(vehicleId) {
    return vehicleId === "car" ? Math.pow(1.07, vehicleLevel("car", "size")) : 1;
  }

  function applyTuning() {
    const game = globalThis.CARBOY;
    const progress = game?.progress;
    if (!progress?.base) return;
    const tuning = game.TUNING;
    const base = progress.base;
    const vehicleId = activeVehicleId;
    const level = (id) => vehicleLevel(vehicleId, id);

    tuning.player.maxSpeed = base.maxSpeed * Math.pow(1.18, level("speed"));
    if (vehicleId === "car") {
      tuning.player.mass = base.mass * Math.pow(1.16, level("size"));
      tuning.player.grip = base.grip * Math.pow(1.3, level("grip"));
      tuning.collision.transferRatio = base.transfer * Math.pow(1.22, level("power"));
      tuning.collision.playerRecoilFactor = base.recoil * Math.pow(0.82, level("size"));
      tuning.charge.impulseMax = base.ramImpulse * Math.pow(1.25, level("ram"));
      tuning.charge.timeToFull = base.chargeTime * Math.pow(0.82, level("charge"));
    } else {
      tuning.player.mass = base.mass;
      tuning.player.grip = base.grip;
      tuning.collision.transferRatio = base.transfer;
      tuning.collision.playerRecoilFactor = base.recoil;
      tuning.charge.impulseMax = base.ramImpulse;
      tuning.charge.timeToFull = base.chargeTime;
    }

    // Keep the production `taken` list coherent for anything that still reads it.
    const taken = [];
    for (let i = 0; i < sharedLevel("magnet"); i++) taken.push("magnet");
    for (const skill of VEHICLES_BY_ID.get("car").skills) {
      for (let i = 0; i < vehicleLevel("car", skill.id); i++) taken.push(skill.id);
    }
    progress.taken = taken;

    if (game.player?.vehicle) game.player.vehicle.setMass(tuning.player.mass);
    if (game.player?.rig?.setScale) game.player.rig.setScale(visualScaleFor(vehicleId));
  }

  function installProgressOverrides(progress) {
    Object.defineProperty(progress, "magnetRadius", {
      configurable: true,
      get: () => 5.5 * Math.pow(1.35, sharedLevel("magnet")),
    });
    Object.defineProperty(progress, "visualScale", {
      configurable: true,
      get: () => visualScaleFor(activeVehicleId),
    });
    progress.apply = applyTuning;
    progress.take = () => undefined;
    progress.bankCarried = function bankCarried() {
      this.stash += Math.round(this.carried * coinMultiplier());
      this.carried = 0;
    };
  }

  // ---------------------------------------------------------------------------
  // Vehicle runtime: hover, blow, suck, capture, and launch
  // ---------------------------------------------------------------------------

  const runtime = {
    installed: false,
    meter: 1,
    cooldown: 0,
    rawCharging: false,
    rawReleased: false,
    pressLatched: false,
    releaseLatched: false,
    held: [],
    flying: [],
    scratch: null,
    visuals: new Map(),
    lastAction: "RAM",
  };

  const usesStockCharge = () => activeVehicleId === "car";

  function vec(x, y, z) {
    const scratch = runtime.scratch;
    if (!scratch) return null;
    scratch.set(x, y, z);
    return scratch;
  }

  function newVec(source, x, y, z) {
    const out = source.clone();
    out.set(x, y, z);
    return out;
  }

  // The arena is several islands joined by bridges, so the nearest cliff is not
  // simply the rim of the disc underneath: straight out from the middle of an
  // island often runs along a bridge deck. Sweep every heading instead and take
  // the closest one that opens onto a usable stretch of air, which is what a
  // player reads as "the nearest edge". Returns a null distance when nothing
  // within `limit` opens up, so the shot can fall short instead.
  const CLIFF_HEADINGS = 24;
  const CLIFF_STEP = 0.5;
  const CLIFF_CLEAR_RUN = 3;

  function nearestCliff(position, limit) {
    const arena = globalThis.CARBOY?.arena;
    if (typeof arena?.marginAt !== "function") return null;

    const openAt = (dirX, dirZ, reach) => {
      for (let along = 0; along <= CLIFF_CLEAR_RUN; along += CLIFF_STEP * 1.5) {
        if (arena.marginAt(position.x + dirX * (reach + along), position.z + dirZ * (reach + along)) >= 0) {
          return false;
        }
      }
      return true;
    };

    let best = null;
    for (let index = 0; index < CLIFF_HEADINGS; index++) {
      const angle = (index / CLIFF_HEADINGS) * Math.PI * 2;
      const dirX = Math.sin(angle);
      const dirZ = Math.cos(angle);
      for (let reach = CLIFF_STEP; reach <= limit; reach += CLIFF_STEP) {
        if (arena.marginAt(position.x + dirX * reach, position.z + dirZ * reach) >= 0) continue;
        if (!openAt(dirX, dirZ, reach)) continue;
        if (!best || reach < best.distance) best = { x: dirX, z: dirZ, distance: reach };
        break;
      }
    }
    if (best) return { x: best.x, z: best.z, distance: Math.min(limit, best.distance + 1.5) };

    // Nothing clear in range: keep the heading pointing away from the island so
    // the load at least travels outward before landing short.
    const islands = arena.world?.islands || [];
    let host = null;
    for (const island of islands) {
      const dx = position.x - island.x;
      const dz = position.z - island.z;
      const margin = island.radius - Math.hypot(dx, dz);
      if (!host || margin > host.margin) host = { dx, dz, margin, distance: Math.hypot(dx, dz) };
    }
    if (!host || host.distance < 0.001) return { x: 0, z: 1, distance: null };
    return { x: host.dx / host.distance, z: host.dz / host.distance, distance: null };
  }

  function consumeEnemy(enemy) {
    // Dropping the body below the knockout plane reuses the production fall
    // handler, so coins, knockout counting, and cleanup all behave normally.
    const world = globalThis.CARBOY?.world;
    const position = enemy.vehicle.position;
    const target = newVec(position, position.x, globalThis.CARBOY.TUNING.world.knockoutY - 3, position.z);
    if (world?.teleport) world.teleport(enemy.vehicle.body, target);
    else position.y = globalThis.CARBOY.TUNING.world.knockoutY - 3;
  }

  // Drives a rival's velocity along a radial direction. Rivals accelerate back
  // toward the player far harder than a plain impulse can answer, so the wash
  // and the nozzle both take authority over the radial component: any inward
  // drive is cancelled first, then the speed ramps up to the ability's cap.
  function driveRadial(enemy, dirX, dirZ, ramp, cap, dt, lift = 0) {
    const body = enemy.vehicle.body;
    const velocity = body.getLinearVelocity();
    const radial = velocity.x * dirX + velocity.z * dirZ;
    const next = Math.min(Math.max(radial, 0) + ramp * dt, cap);
    const delta = next - radial;
    if (delta <= 0 && lift <= 0) return;
    body.setLinearVelocity(newVec(
      velocity,
      velocity.x + dirX * Math.max(0, delta),
      lift > 0 ? Math.max(velocity.y, lift) : velocity.y,
      velocity.z + dirZ * Math.max(0, delta),
    ));
  }

  function tickHelicopter(game, dt, params) {
    const vehicle = game.player.vehicle;
    const body = vehicle.body;

    // Hold altitude. Gravity is already switched off for this vehicle, so this
    // only has to damp toward the hover height.
    const velocity = body.getLinearVelocity();
    const targetRise = clamp((HOVER_HEIGHT - vehicle.position.y) * 4.5, -9, 9);
    body.setLinearVelocity(newVec(velocity, velocity.x, targetRise, velocity.z));

    const firing = runtime.rawCharging && runtime.cooldown <= 0 && runtime.meter > 0;
    if (firing) {
      runtime.meter = Math.max(0, runtime.meter - dt / params.duration);
      if (runtime.meter <= 0) runtime.cooldown = params.recharge;
      for (const enemy of game.enemies) {
        const dx = enemy.vehicle.position.x - vehicle.position.x;
        const dz = enemy.vehicle.position.z - vehicle.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > params.range || distance < 0.001) continue;
        const falloff = 1 - distance / params.range;
        driveRadial(enemy, dx / distance, dz / distance, params.accel * falloff, params.speed * falloff, dt, 3.5 * falloff);
      }
      if (game.effects?.puff && Math.random() < 0.25) {
        game.effects.puff(vehicle.position.clone(), 1.4);
      }
    } else if (runtime.cooldown > 0) {
      runtime.cooldown = Math.max(0, runtime.cooldown - dt);
      runtime.meter = 1 - runtime.cooldown / params.recharge;
    } else if (runtime.meter < 1) {
      runtime.meter = Math.min(1, runtime.meter + dt / params.recharge);
    }
  }

  function tickVacuum(game, dt, params) {
    const vehicle = game.player.vehicle;
    const sucking = runtime.rawCharging && runtime.cooldown <= 0 && runtime.meter > 0;
    if (sucking) {
      runtime.meter = Math.max(0, runtime.meter - dt / params.duration);
      if (runtime.meter <= 0) runtime.cooldown = params.recharge;
      for (let index = game.enemies.length - 1; index >= 0; index--) {
        const enemy = game.enemies[index];
        const dx = vehicle.position.x - enemy.vehicle.position.x;
        const dz = vehicle.position.z - enemy.vehicle.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > params.range || distance < 0.001) continue;
        if (distance <= params.capture) {
          consumeEnemy(enemy);
          continue;
        }
        const falloff = 1 - distance / params.range;
        driveRadial(enemy, dx / distance, dz / distance, params.accel * falloff, params.speed * falloff, dt);
      }
      if (game.effects?.puff && Math.random() < 0.2) {
        game.effects.puff(vehicle.position.clone(), 1);
      }
    } else if (runtime.cooldown > 0) {
      runtime.cooldown = Math.max(0, runtime.cooldown - dt);
      runtime.meter = 1 - runtime.cooldown / params.recharge;
    } else if (runtime.meter < 1) {
      runtime.meter = Math.min(1, runtime.meter + dt / params.recharge);
    }
  }

  function launchToaster(game, params) {
    const vehicle = game.player.vehicle;
    const gravity = Math.abs(game.TUNING.world.gravity) || 38;
    const cliff = nearestCliff(vehicle.position, params.range);
    const dirX = cliff ? cliff.x : Math.sin(vehicle.yaw);
    const dirZ = cliff ? cliff.z : Math.cos(vehicle.yaw);

    // Clear the lip by a couple of metres when there is a cliff in range;
    // otherwise the spring fires flat out and the load simply lands short.
    const cleared = cliff && cliff.distance !== null;
    const reach = Math.min(params.range, cleared ? cliff.distance : params.range);
    // A 45° launch covers v²/g, so this is the flight the spring pays for.
    const speed = Math.sqrt(Math.max(1, reach * gravity));
    const component = speed * Math.SQRT1_2;

    // A launched car still runs its own steering and grip, which cancels the
    // shot within a few frames, so the arc is held for the flight instead. The
    // hold covers one ballistic arc (2·v/g at 45°) plus the drop that follows,
    // so a car cannot steer back onto a bridge deck on the way down. It is
    // released early once the car is clearly below the deck (see tickLaunched).
    const flightTime = Math.min(2.5, (2 * component) / gravity + 0.6);
    const slotGap = game.TUNING.enemy.size.h + 0.4;
    runtime.held.forEach((enemy, index) => {
      // Fire from the slots. The stack is spring-held and can trail the toaster
      // after a fast move, and a shot that starts metres behind the muzzle
      // lands short of the cliff it was aimed at.
      const position = enemy.vehicle.position;
      const muzzle = newVec(
        position,
        vehicle.position.x + dirX * 1.2,
        vehicle.position.y + 2 + index * slotGap,
        vehicle.position.z + dirZ * 1.2,
      );
      if (game.world?.teleport) game.world.teleport(enemy.vehicle.body, muzzle);
      enemy.vehicle.body.setLinearVelocity(newVec(position, dirX * component, component, dirZ * component));
      runtime.flying.push({ enemy, vx: dirX * component, vz: dirZ * component, time: flightTime });
    });
    if (runtime.held.length && game.audio?.knockout) game.audio.knockout();
    runtime.held.length = 0;
    runtime.cooldown = params.recharge;
    runtime.meter = 0;
    return cleared;
  }

  function tickLaunched(game, dt) {
    const committed = game.TUNING.world.islandTop - 1.5;
    for (let index = runtime.flying.length - 1; index >= 0; index--) {
      const flight = runtime.flying[index];
      flight.time -= dt;
      const past = flight.enemy.vehicle.position.y < committed;
      if (flight.time <= 0 || past || !game.enemies.includes(flight.enemy)) {
        runtime.flying.splice(index, 1);
        continue;
      }
      const body = flight.enemy.vehicle.body;
      const velocity = body.getLinearVelocity();
      body.setLinearVelocity(newVec(velocity, flight.vx, velocity.y, flight.vz));
    }
  }

  function tickToaster(game, dt, params) {
    const vehicle = game.player.vehicle;

    // Drop anything that the production fall handler already cleaned up.
    runtime.held = runtime.held.filter((enemy) => game.enemies.includes(enemy));
    runtime.held.length = Math.min(runtime.held.length, params.capacity);

    // Held cars ride the slots on a velocity spring rather than a per-frame
    // teleport: teleporting hands the body to the physics pre-step, which stops
    // the simulation driving it and leaves it stranded once it is launched.
    // Rivals are 1.5 tall, so the slots have to clear that or the overlapping
    // bodies resolve explosively and fling the whole stack into the sky.
    const slotGap = game.TUNING.enemy.size.h + 0.4;
    runtime.held.forEach((enemy, index) => {
      const position = enemy.vehicle.position;
      const dx = vehicle.position.x - position.x;
      const dy = vehicle.position.y + 2 + index * slotGap - position.y;
      const dz = vehicle.position.z - position.z;
      const body = enemy.vehicle.body;
      const velocity = body.getLinearVelocity();
      body.setLinearVelocity(newVec(
        velocity,
        clamp(dx * 12, -25, 25),
        clamp(dy * 12, -25, 25),
        clamp(dz * 12, -25, 25),
      ));
    });

    if (runtime.cooldown > 0) {
      runtime.cooldown = Math.max(0, runtime.cooldown - dt);
      runtime.meter = 1 - runtime.cooldown / params.recharge;
    } else {
      runtime.meter = 1;
      if (runtime.pressLatched && runtime.held.length) launchToaster(game, params);
    }
  }

  function updateAbilityButton(game) {
    const button = document.getElementById("chargeBtn");
    if (!button) return;
    const core = button.querySelector(".core");
    const vehicle = activeVehicle();
    if (core && core.textContent !== vehicle.action) core.textContent = vehicle.action;
    if (usesStockCharge()) return;

    const params = abilityParams();
    if (vehicle.id === "toaster") {
      const ready = runtime.cooldown <= 0;
      button.classList.toggle("cooling", !ready);
      button.style.setProperty("--charge", ready ? String(runtime.held.length / Math.max(1, params.capacity)) : "0");
      button.style.setProperty("--cooldown", String(1 - runtime.meter));
      return;
    }
    const empty = runtime.cooldown > 0;
    button.classList.toggle("cooling", empty);
    button.style.setProperty("--charge", empty ? "0" : String(runtime.meter));
    button.style.setProperty("--cooldown", String(1 - runtime.meter));
  }

  function tickVehicle(dt) {
    const game = globalThis.CARBOY;
    if (!game?.player?.vehicle) return;
    updateAbilityButton(game);
    if (usesStockCharge() || game.titleScreen?.open || game.upgradeScreen?.open || dt <= 0) {
      runtime.pressLatched = false;
      runtime.releaseLatched = false;
      return;
    }

    tickLaunched(game, dt);
    const params = abilityParams();
    if (params) {
      if (activeVehicleId === "helicopter") tickHelicopter(game, dt, params);
      else if (activeVehicleId === "vacuum") tickVacuum(game, dt, params);
      else if (activeVehicleId === "toaster") tickToaster(game, dt, params);
    }
    runtime.pressLatched = false;
    runtime.releaseLatched = false;
  }

  // --- visuals ---------------------------------------------------------------

  function buildVehicleVisual(vehicleId) {
    const game = globalThis.CARBOY;
    const parts = game?.player?.rig?.parts;
    const scene = game?.app?.scene;
    if (!parts || !scene || vehicleId === "car") return null;

    // The production rig meshes give us both the Babylon constructors and the
    // game's own materials, so the new bodies match the existing art style.
    const Mesh = game.player.vehicle.mesh.constructor;
    const TransformNode = parts.root.constructor;
    if (typeof Mesh?.CreateBox !== "function" || typeof TransformNode !== "function") return null;
    const materials = parts.materials || [];
    const body = materials[0];
    const dark = materials[2] || body;
    const glass = materials[3] || body;
    const chrome = materials[4] || body;

    const root = new TransformNode(`foldable-${vehicleId}`, scene);
    root.parent = game.player.vehicle.mesh;
    const pieces = [];

    const add = (name, w, h, d, material, x, y, z, parent = root) => {
      const mesh = Mesh.CreateBox(`foldable-${vehicleId}-${name}`, 1, scene);
      mesh.scaling.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.parent = parent;
      mesh.isPickable = false;
      if (material) mesh.material = material;
      pieces.push(mesh);
      return mesh;
    };
    const addTube = (name, diameter, height, material, x, y, z, parent = root) => {
      if (typeof Mesh.CreateCylinder !== "function") return add(name, diameter, height, diameter, material, x, y, z, parent);
      const mesh = Mesh.CreateCylinder(`foldable-${vehicleId}-${name}`, height, diameter, diameter, 10, 1, scene);
      mesh.position.set(x, y, z);
      mesh.parent = parent;
      mesh.isPickable = false;
      if (material) mesh.material = material;
      pieces.push(mesh);
      return mesh;
    };

    let rotor = null;
    if (vehicleId === "helicopter") {
      add("cabin", 1.3, 1.1, 1.9, body, 0, 0.25, 0.15);
      add("glass", 1.08, 0.68, 0.68, glass, 0, 0.35, 1.02);
      add("boom", 0.32, 0.3, 1.7, body, 0, 0.4, -1.5);
      add("fin", 0.12, 0.8, 0.5, dark, 0, 0.8, -2.2);
      add("skidL", 0.11, 0.11, 1.9, chrome, -0.55, -0.5, 0.1);
      add("skidR", 0.11, 0.11, 1.9, chrome, 0.55, -0.5, 0.1);
      add("strutL", 0.09, 0.45, 0.09, chrome, -0.45, -0.3, 0.1);
      add("strutR", 0.09, 0.45, 0.09, chrome, 0.45, -0.3, 0.1);
      addTube("mast", 0.18, 0.5, chrome, 0, 0.95, 0.15);
      rotor = new TransformNode(`foldable-${vehicleId}-rotor`, scene);
      rotor.parent = root;
      rotor.position.set(0, 1.2, 0.15);
      addTube("hub", 0.3, 0.14, dark, 0, 0, 0, rotor);
      add("bladeA", 5, 0.06, 0.28, dark, 0, 0, 0, rotor);
      add("bladeB", 0.28, 0.06, 5, dark, 0, 0, 0, rotor);
      add("tailRotor", 0.05, 1, 1, dark, 0.2, 0.8, -2.25);
    } else if (vehicleId === "vacuum") {
      addTube("tank", 1.35, 1.5, body, 0, 0.3, -0.25);
      addTube("lid", 1.2, 0.22, chrome, 0, 1.1, -0.25);
      add("hose", 0.45, 0.45, 1, dark, 0, -0.05, 0.75);
      add("nozzle", 1.2, 0.7, 0.5, chrome, 0, -0.12, 1.45);
      add("gauge", 0.38, 0.38, 0.1, glass, 0, 0.55, 0.48);
      addTube("wheelL", 0.55, 0.16, dark, -0.72, -0.4, -0.7);
      addTube("wheelR", 0.55, 0.16, dark, 0.72, -0.4, -0.7);
      const wheels = pieces.slice(-2);
      for (const wheel of wheels) wheel.rotation.z = Math.PI / 2;
    } else if (vehicleId === "toaster") {
      // The camera looks straight down, so the slots stay narrow: wide ones
      // cover the shell and the toaster reads as just another dark car.
      add("shell", 1.5, 1.3, 2, body, 0, 0.2, 0);
      add("slotL", 0.3, 0.12, 1.25, dark, -0.34, 0.85, 0);
      add("slotR", 0.3, 0.12, 1.25, dark, 0.34, 0.85, 0);
      add("rim", 1.32, 0.08, 1.75, chrome, 0, 0.8, 0);
      add("lever", 0.16, 0.5, 0.16, chrome, 0.84, 0.62, 0.62);
      addTube("dial", 0.45, 0.12, chrome, 0, 0.15, 1.02);
      add("feetL", 0.15, 0.3, 0.15, dark, -0.55, -0.6, 0.7);
      add("feetR", 0.15, 0.3, 0.15, dark, 0.55, -0.6, 0.7);
      add("feetBL", 0.15, 0.3, 0.15, dark, -0.55, -0.6, -0.7);
      add("feetBR", 0.15, 0.3, 0.15, dark, 0.55, -0.6, -0.7);
      const dial = pieces[pieces.length - 5];
      if (dial) dial.rotation.x = Math.PI / 2;
    }

    return { root, pieces, rotor };
  }

  function setRigVisible(visible) {
    const parts = globalThis.CARBOY?.player?.rig?.parts;
    if (!parts) return;
    for (const key of ["body", "antenna", "headlights"]) {
      const node = parts[key];
      if (node?.setEnabled) node.setEnabled(visible);
    }
    const wheels = parts.wheels;
    if (Array.isArray(wheels)) {
      for (const wheel of wheels) wheel?.setEnabled?.(visible);
    } else if (wheels?.setEnabled) {
      wheels.setEnabled(visible);
    }
  }

  function showVehicleVisual(vehicleId) {
    for (const [id, visual] of runtime.visuals) {
      visual.root?.setEnabled?.(id === vehicleId);
    }
    if (vehicleId !== "car" && !runtime.visuals.has(vehicleId)) {
      const visual = buildVehicleVisual(vehicleId);
      if (visual) {
        runtime.visuals.set(vehicleId, visual);
        visual.root.setEnabled(true);
      }
    }
    setRigVisible(vehicleId === "car");
  }

  function spinRotors(dt) {
    const visual = runtime.visuals.get(activeVehicleId);
    if (visual?.rotor) visual.rotor.rotation.y += dt * 26;
  }

  // --- activation ------------------------------------------------------------

  function releaseHeldCars() {
    runtime.held.length = 0;
    runtime.flying.length = 0;
  }

  function setActiveVehicle(vehicleId, { save = true } = {}) {
    const vehicle = VEHICLES_BY_ID.get(vehicleId);
    if (!vehicle) return false;
    const game = globalThis.CARBOY;
    releaseHeldCars();
    activeVehicleId = vehicle.id;
    runtime.meter = 1;
    runtime.cooldown = 0;
    runtime.rawCharging = false;
    runtime.rawReleased = false;

    const body = game?.player?.vehicle?.body;
    if (body?.setGravityFactor) {
      try {
        body.setGravityFactor(vehicle.id === "helicopter" ? 0 : 1);
      } catch (_) {
        // Without gravity control the helicopter still flies on its hover damping.
      }
    }
    if (vehicle.id === "helicopter" && game?.world?.teleport && game.player) {
      const position = game.player.vehicle.position;
      game.world.teleport(game.player.vehicle.body, newVec(position, position.x, HOVER_HEIGHT, position.z));
    }

    showVehicleVisual(vehicle.id);
    applyTuning();
    updateAbilityButton(game);
    if (save) {
      sessionHasProgress = true;
      saveProgress(true);
    }
    return true;
  }

  function installVehicleRuntime() {
    const game = globalThis.CARBOY;
    if (runtime.installed || !game?.controls || !game?.app?.scene || !game?.player?.vehicle) return;
    runtime.installed = true;
    runtime.scratch = game.player.vehicle.position.clone();

    // The ability button and Shift key still write `charging`/`released`, but the
    // production charge-and-ram path only sees them while the car is active.
    const controls = game.controls;
    runtime.rawCharging = controls.charging;
    runtime.rawReleased = controls.released;
    // The production frame clears `released` before our post-update hook runs,
    // so both edges are latched here and consumed by the ability tick instead.
    Object.defineProperty(controls, "charging", {
      configurable: true,
      get: () => usesStockCharge() ? runtime.rawCharging : false,
      set: (value) => {
        const next = Boolean(value);
        if (next && !runtime.rawCharging) runtime.pressLatched = true;
        runtime.rawCharging = next;
      },
    });
    Object.defineProperty(controls, "released", {
      configurable: true,
      get: () => usesStockCharge() ? runtime.rawReleased : false,
      set: (value) => {
        const next = Boolean(value);
        if (next) runtime.releaseLatched = true;
        runtime.rawReleased = next;
      },
    });

    // The helicopter neither takes nor deals collision damage; the toaster
    // swallows whatever it touches until its slots are full.
    const combat = game.combat;
    if (combat?.resolve) {
      const originalResolve = combat.resolve.bind(combat);
      combat.resolve = (enemy, point) => {
        if (activeVehicleId === "helicopter") return;
        if (runtime.held.includes(enemy)) return;
        if (activeVehicleId === "toaster") {
          const params = abilityParams("toaster");
          const inFlight = runtime.flying.some((flight) => flight.enemy === enemy);
          if (!inFlight && runtime.cooldown <= 0 && runtime.held.length < params.capacity) {
            runtime.held.push(enemy);
            game.audio?.coinPickup?.(0);
            return;
          }
        }
        originalResolve(enemy, point);
      };
    }

    // In normal play the production loop runs `Nr(dt)` and then `scene.render()`,
    // so the scene observable is the frame hook that lands right after the game
    // has updated. `CARBOY.step()` advances the simulation without rendering,
    // so it needs the same hook to keep abilities in step with physics.
    const scene = game.app.scene;
    const engine = game.app.engine;
    scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min((engine.getDeltaTime?.() ?? 16.67) / 1000, 0.05);
      spinRotors(dt);
      tickVehicle(dt);
    });

    const originalStep = game.step;
    if (typeof originalStep === "function") {
      game.step = (dt, count = 1) => {
        for (let index = 0; index < count; index++) {
          originalStep(dt, 1);
          spinRotors(dt);
          tickVehicle(dt);
        }
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Autosave, New Game, and the intermission shop
  // ---------------------------------------------------------------------------

  function resetNewGameButton(button) {
    button.dataset.confirmNewGame = "false";
    button.textContent = button.dataset.defaultLabel || "NEW GAME";
    button.classList.remove("is-confirming");
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
      const vehicleName = VEHICLES_BY_ID.get(saved.vehicle)?.name || "CAR BOY";
      saveSummary.textContent = `AUTO-SAVE FOUND · DAY ${saved.day} · STASH ${saved.stash} · ${vehicleName}`;
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

    installProgressOverrides(game.progress);
    installVehicleRuntime();

    const saved = readSavedGame();
    if (saved) {
      game.progress.day = saved.day;
      game.progress.stash = saved.stash;
      game.progress.carried = 0;
      for (const skill of SHARED_SKILLS) skills.shared[skill.id] = saved.shared[skill.id];
      for (const vehicle of VEHICLES) {
        for (const skill of vehicle.skills) {
          skills.vehicles[vehicle.id][skill.id] = saved.vehicles[vehicle.id][skill.id];
        }
      }
      setActiveVehicle(saved.vehicle, { save: false });
      sessionHasProgress = true;
      lastSavedPayload = JSON.stringify(saved);
    } else {
      setActiveVehicle(DEFAULT_VEHICLE_ID, { save: false });
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

  function buildSkillCard(skill, level, stash, onBuy) {
    const cost = upgradeCost(level);
    const affordable = stash >= cost;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "carboy-upgrade-card";
    button.dataset.upgradeId = skill.id;
    button.disabled = !affordable;
    button.setAttribute("aria-label", `${skill.name}, level ${level}, upgrade to level ${level + 1} for ${cost} coins`);

    const heading = document.createElement("div");
    heading.className = "carboy-upgrade-heading";
    const name = document.createElement("span");
    name.className = "carboy-upgrade-name";
    name.textContent = skill.name;
    const levelText = document.createElement("span");
    levelText.className = "carboy-upgrade-level";
    levelText.textContent = `LEVEL ${level}`;
    heading.append(name, levelText);

    const blurb = document.createElement("div");
    blurb.className = "carboy-upgrade-blurb";
    blurb.textContent = skill.blurb;

    const footer = document.createElement("div");
    footer.className = "carboy-upgrade-footer";
    const effect = document.createElement("span");
    effect.className = "carboy-upgrade-effect";
    effect.textContent = skill.effect;
    const price = document.createElement("span");
    price.className = "carboy-upgrade-price";
    price.textContent = affordable ? `${cost} COINS → LEVEL ${level + 1}` : `NEED ${cost} COINS`;
    footer.append(effect, price);

    button.append(heading, blurb, footer);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onBuy();
    });
    return button;
  }

  function buildSection(title, subtitle) {
    const section = document.createElement("section");
    section.className = "carboy-shop-section";
    const heading = document.createElement("h3");
    heading.className = "carboy-section-title";
    heading.textContent = title;
    if (subtitle) {
      const note = document.createElement("span");
      note.className = "carboy-section-note";
      note.textContent = subtitle;
      heading.appendChild(note);
    }
    const grid = document.createElement("div");
    grid.className = "carboy-upgrade-grid";
    section.append(heading, grid);
    return { section, grid };
  }

  function installExpandedUpgradeShop() {
    const game = globalThis.CARBOY;
    if (upgradeShopInstalled || !game?.upgradeScreen || !game?.progress) return;
    upgradeShopInstalled = true;

    const screen = game.upgradeScreen;
    const progress = game.progress;

    screen.show = (day, summary) => {
      screen.title.textContent = `DAY ${day} CLEARED`;
      screen.root.classList.add("carboy-upgrade-shop");
      const shopLabel = screen.root.children[2];
      if (shopLabel) {
        shopLabel.classList.add("carboy-upgrade-label");
        shopLabel.textContent = "PICK A VEHICLE, THEN UPGRADE WHAT YOU CAN AFFORD";
      }
      screen.cards.classList.add("carboy-upgrade-cards");
      screen.root.style.display = "flex";

      const render = () => {
        const multiplier = coinMultiplier();
        const banked = Math.round(number(summary.coins) * multiplier);
        const bonus = banked - number(summary.coins);
        const bonusText = bonus > 0 ? ` <span style="color:#7fe0a0">+${bonus} bonus</span>` : "";
        screen.stats.innerHTML = `${summary.knockouts} knocked off &nbsp;·&nbsp; ${summary.coins} coins${bonusText} &nbsp;·&nbsp; best ×${summary.bestCombo}`
          + `<br><span style="color:#ffd23f">STASH ${progress.stash}</span>`;

        const fragment = document.createDocumentFragment();

        const garage = document.createElement("section");
        garage.className = "carboy-shop-section carboy-garage";
        const garageTitle = document.createElement("h3");
        garageTitle.className = "carboy-section-title";
        garageTitle.textContent = "GARAGE";
        const garageNote = document.createElement("span");
        garageNote.className = "carboy-section-note";
        garageNote.textContent = "switching is free";
        garageTitle.appendChild(garageNote);
        const garageRow = document.createElement("div");
        garageRow.className = "carboy-vehicle-row";

        for (const vehicle of VEHICLES) {
          const unlocked = isUnlocked(vehicle);
          const active = vehicle.id === activeVehicleId;
          const card = document.createElement("button");
          card.type = "button";
          card.className = "carboy-vehicle-card";
          card.dataset.vehicleId = vehicle.id;
          card.disabled = !unlocked || active;
          card.classList.toggle("is-active", active);
          card.classList.toggle("is-locked", !unlocked);
          card.setAttribute("aria-label", unlocked
            ? `${vehicle.name}${active ? ", currently selected" : ", select this vehicle"}`
            : `${vehicle.name}, locked until day ${vehicle.unlockDay}`);

          const name = document.createElement("span");
          name.className = "carboy-vehicle-name";
          name.textContent = vehicle.name;
          const state = document.createElement("span");
          state.className = "carboy-vehicle-state";
          state.textContent = !unlocked ? `DAY ${vehicle.unlockDay}` : active ? "ACTIVE" : "SELECT";
          const blurb = document.createElement("span");
          blurb.className = "carboy-vehicle-blurb";
          blurb.textContent = unlocked ? vehicle.blurb : `Unlocks on day ${vehicle.unlockDay}.`;
          card.append(name, state, blurb);

          card.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isUnlocked(vehicle) || vehicle.id === activeVehicleId) return;
            setActiveVehicle(vehicle.id);
            render();
          });
          garageRow.appendChild(card);
        }
        garage.append(garageTitle, garageRow);
        fragment.appendChild(garage);

        const shared = buildSection("SHARED SKILLS", "apply to every vehicle");
        for (const skill of SHARED_SKILLS) {
          shared.grid.appendChild(buildSkillCard(skill, sharedLevel(skill.id), progress.stash, () => {
            const cost = upgradeCost(sharedLevel(skill.id));
            if (progress.stash < cost) return;
            progress.stash -= cost;
            skills.shared[skill.id] = sharedLevel(skill.id) + 1;
            applyTuning();
            sessionHasProgress = true;
            saveProgress(true);
            render();
          }));
        }
        fragment.appendChild(shared.section);

        const vehicle = activeVehicle();
        const individual = buildSection(`${vehicle.name} SKILLS`, "this vehicle only");
        for (const skill of vehicle.skills) {
          const level = vehicleLevel(vehicle.id, skill.id);
          individual.grid.appendChild(buildSkillCard(skill, level, progress.stash, () => {
            const cost = upgradeCost(vehicleLevel(vehicle.id, skill.id));
            if (progress.stash < cost) return;
            progress.stash -= cost;
            skills.vehicles[vehicle.id][skill.id] = vehicleLevel(vehicle.id, skill.id) + 1;
            applyTuning();
            sessionHasProgress = true;
            saveProgress(true);
            render();
          }));
        }
        fragment.appendChild(individual.section);

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
        fragment.appendChild(nextButton);

        screen.cards.replaceChildren(fragment);
        addNewGameButton(screen.cards, "upgrade");
      };

      render();
      return new Promise((resolve) => {
        screen.resolve = resolve;
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Secondary segment panel
  // ---------------------------------------------------------------------------

  function updateSecondary() {
    installAutoSave();
    installExpandedUpgradeShop();
    const game = globalThis.CARBOY;
    const progress = game?.progress;
    const vehicle = activeVehicle();
    if (statElements.day) statElements.day.textContent = String(number(progress?.day, 1));
    if (statElements.coins) statElements.coins.textContent = String(Math.round(number(progress?.stash) + number(progress?.carried)));
    if (statElements.combo) {
      const combo = number(game?.combo?.combo);
      statElements.combo.textContent = combo > 1 ? `×${combo}` : "—";
    }
    if (statElements.speed) statElements.speed.textContent = String(Math.round(number(game?.player?.planarSpeed)));
    if (statElements.vehicle) statElements.vehicle.textContent = vehicle.name;
    if (statElements.ability) {
      statElements.ability.textContent = usesStockCharge()
        ? vehicle.action
        : `${vehicle.action} ${Math.round(clamp(runtime.meter, 0, 1) * 100)}%`;
    }
    if (helpElement) helpElement.textContent = `${vehicle.help} Press Esc to pause.`;
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

  document.addEventListener("visibilitychange", updateSecondary);

  // ---------------------------------------------------------------------------
  // Keyboard: Shift drives the ability button, Escape toggles pause
  // ---------------------------------------------------------------------------

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
    if (controls?.charging || runtime.rawCharging) {
      controls && (controls.charging = false);
      controls && (controls.released = true);
    }
    if (controls) controls.aiming = false;
    cancelAnimationFrame(aimAnimationFrame);
    aimAnimationFrame = 0;
  }

  function updateKeyboardAim() {
    const game = globalThis.CARBOY;
    const controls = game?.controls;
    if (!controls || ramKeys.size === 0 || !mouseAim.available) return false;
    // Only the car aims; the other vehicles act around themselves.
    if (!usesStockCharge()) {
      controls.aiming = false;
      return false;
    }

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
    if (controls && !runtime.rawCharging) controls.charging = true;
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
    version: 6,
    layout: scheduleLayout,
    getState: () => lastLayout,
    upgrades: {
      shared: SHARED_SKILLS,
      vehicles: VEHICLES,
      costForLevel: upgradeCost,
      coinMultiplier,
    },
    garage: {
      list: () => VEHICLES.map((vehicle) => ({
        id: vehicle.id,
        name: vehicle.name,
        action: vehicle.action,
        unlockDay: vehicle.unlockDay,
        unlocked: isUnlocked(vehicle),
        active: vehicle.id === activeVehicleId,
      })),
      get active() { return activeVehicleId; },
      select: (id) => setActiveVehicle(id),
      params: (id) => abilityParams(id || activeVehicleId),
      state: () => ({
        vehicle: activeVehicleId,
        meter: runtime.meter,
        cooldown: runtime.cooldown,
        held: runtime.held.length,
        heldIds: runtime.held.map((enemy) => enemy.vehicle.id),
      }),
      levels: () => JSON.parse(JSON.stringify(skills)),
    },
    save: {
      key: SAVE_KEY,
      legacyKey: LEGACY_SAVE_KEY,
      read: readSavedGame,
      saveNow: () => {
        sessionHasProgress = true;
        return saveProgress(true);
      },
      startNewGame,
    },
  };
})();
