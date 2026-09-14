const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  "C:/Users/32328/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4173";
const outputDir = path.resolve(__dirname, "..", "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function inspectCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("gameCanvas");
    const context = canvas.getContext("2d");
    const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let min = 255;
    let max = 0;
    let total = 0;
    let samples = 0;
    const colors = new Set();
    const stepX = Math.max(1, Math.floor(canvas.width / 120));
    const stepY = Math.max(1, Math.floor(canvas.height / 80));

    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const index = (y * canvas.width + x) * 4;
        const red = image[index];
        const green = image[index + 1];
        const blue = image[index + 2];
        const luma = (red + green + blue) / 3;
        min = Math.min(min, luma);
        max = Math.max(max, luma);
        total += luma;
        colors.add(`${red >> 4}-${green >> 4}-${blue >> 4}`);
        samples += 1;
      }
    }

    return {
      min,
      max,
      average: total / samples,
      colorBuckets: colors.size,
      width: canvas.width,
      height: canvas.height,
    };
  });
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const selectors = [
      ".site-header",
      ".brand",
      ".header-actions",
      ".main-layout",
      ".stage-heading",
      ".canvas-frame",
      ".game-overlay",
      ".run-panel",
      ".site-footer",
    ];
    const rectangles = Object.fromEntries(
      selectors.map((selector) => {
        const element = document.querySelector(selector);
        const rect = element.getBoundingClientRect();
        return [
          selector,
          {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
        ];
      }),
    );

    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const outOfBounds = Object.entries(rectangles)
      .filter(([, rect]) => rect.left < -1 || rect.right > viewportWidth + 1)
      .map(([selector]) => selector);

    return {
      viewportWidth,
      viewportHeight,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > viewportWidth + 1,
      outOfBounds,
      rectangles,
    };
  });
}

async function runDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__SCUT_RUNNER_TEST__));

  const readyState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(readyState.mode === "ready", `Expected ready mode, got ${readyState.mode}`);
  assert(readyState.logoReady, "SCUT logo SVG should load as the player");
  assert(await page.locator("#gameOverlay").isVisible(), "Ready overlay should be visible");

  const layout = await inspectLayout(page);
  assert(!layout.horizontalOverflow, "Desktop page should not overflow horizontally");
  assert(layout.outOfBounds.length === 0, `Desktop elements overflow: ${layout.outOfBounds.join(", ")}`);

  const logoLoaded = await page.locator(".brand img").evaluate((image) => image.naturalWidth > 0);
  assert(logoLoaded, "Header SCUT logo should render");

  const readyCanvas = await inspectCanvas(page);
  assert(readyCanvas.colorBuckets > 8, "Ready canvas should render multiple colors");
  await page.screenshot({ path: path.join(outputDir, "desktop-ready.png"), fullPage: true });

  await page.locator("#startButton").click();
  await page.waitForTimeout(900);
  const runningState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(runningState.mode === "running", `Expected running mode, got ${runningState.mode}`);
  assert(runningState.score > 0, "Score should increase after starting");

  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  const jumpState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(!jumpState.player.grounded || jumpState.player.y < runningState.player.y, "Jump should move player");
  assert(jumpState.player.jumpCount === 1, "First jump should consume the first jump");

  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  const doubleJumpState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(doubleJumpState.player.jumpCount === 2, "Second jump should activate in midair");
  assert(
    doubleJumpState.player.y < jumpState.player.y,
    "Double jump should push the player higher",
  );

  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  const blockedJumpState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(blockedJumpState.player.jumpCount === 2, "A third jump should not be available");

  await page.waitForTimeout(750);
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(260);
  const duckState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(duckState.player.ducking, "Duck input should set ducking state");
  assert(duckState.player.h < 58, "Duck input should compress the player hitbox");
  await page.keyboard.up("ArrowDown");

  await page.locator("#pauseButton").click();
  const pausedState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(pausedState.mode === "paused", `Expected paused mode, got ${pausedState.mode}`);
  await page.locator("#pauseButton").click();
  const resumedState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(resumedState.mode === "running", `Expected resumed mode, got ${resumedState.mode}`);

  await page.screenshot({ path: path.join(outputDir, "desktop-running.png"), fullPage: true });
  await page.waitForTimeout(5200);

  const laterState = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(
    laterState.mode === "running" || laterState.mode === "gameover",
    `Unexpected later mode: ${laterState.mode}`,
  );
  assert(laterState.score > runningState.score, "Score should continue increasing");
  assert(laterState.obstacleCount > 0 || laterState.mode === "gameover", "Obstacles should spawn");

  const runningCanvas = await inspectCanvas(page);
  assert(runningCanvas.max - runningCanvas.min > 50, "Canvas should retain strong contrast");
  const serviceWorkerReady = await page
    .evaluate(() =>
      navigator.serviceWorker
        ? Promise.race([
            navigator.serviceWorker.ready.then(() => true),
            new Promise((resolve) => window.setTimeout(() => resolve(false), 2500)),
          ])
        : Promise.resolve(false),
    )
    .catch(() => false);
  assert(serviceWorkerReady, "Service worker should become ready for offline play");
  assert(errors.length === 0, errors.join("\n"));

  await context.close();
  return {
    readyState,
    runningState,
    jumpState,
    doubleJumpState,
    blockedJumpState,
    duckState,
    pausedState,
    resumedState,
    laterState,
    readyCanvas,
    runningCanvas,
    layout,
    serviceWorkerReady,
  };
}

async function runMobile(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__SCUT_RUNNER_TEST__));
  await page.locator("#jumpButton").tap();
  await page.waitForTimeout(900);

  const state = await page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(state.mode === "running", `Expected mobile running mode, got ${state.mode}`);
  assert(state.score > 0, "Mobile score should increase");
  assert(state.logoReady, "Mobile SCUT logo should load");

  const touchControlsVisible = await page.locator(".touch-controls").isVisible();
  assert(touchControlsVisible, "Touch controls should be visible on mobile");
  const fullscreenControlVisible = await page.locator("#fullscreenButton").isVisible();
  assert(fullscreenControlVisible, "Fullscreen control should be visible on mobile");

  const layout = await inspectLayout(page);
  assert(!layout.horizontalOverflow, "Mobile page should not overflow horizontally");
  assert(layout.outOfBounds.length === 0, `Mobile elements overflow: ${layout.outOfBounds.join(", ")}`);
  assert(layout.rectangles[".canvas-frame"].width >= 388, "Mobile game should use the full screen width");
  assert(layout.rectangles[".canvas-frame"].height >= 240, "Mobile game should be taller than the old layout");

  const canvas = await inspectCanvas(page);
  assert(canvas.colorBuckets > 8, "Mobile canvas should render multiple colors");
  await page.screenshot({ path: path.join(outputDir, "mobile-running.png"), fullPage: true });
  assert(errors.length === 0, errors.join("\n"));

  await context.close();
  return { state, canvas, touchControlsVisible, fullscreenControlVisible, layout };
}

async function runMobileLandscape(browser) {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const layout = await inspectLayout(page);
  assert(!layout.horizontalOverflow, "Landscape mobile page should not overflow horizontally");
  assert(layout.rectangles[".canvas-frame"].height >= 220, "Landscape game view should be large");
  assert(await page.locator(".touch-controls").isVisible(), "Landscape touch controls should remain usable");
  assert(await page.locator(".run-panel").isHidden(), "Landscape layout should prioritize the game");
  assert(errors.length === 0, errors.join("\n"));
  await page.screenshot({ path: path.join(outputDir, "mobile-landscape.png"), fullPage: true });

  await context.close();
  return { layout };
}

async function runBirdRegression(browser) {
  async function openBirdScenario() {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await page.goto(`${baseUrl}?qa=1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__SCUT_RUNNER_QA__));
    return { context, page, errors };
  }

  const hitScenario = await openBirdScenario();
  await hitScenario.page.locator("#startButton").click();
  await hitScenario.page.evaluate(() => window.__SCUT_RUNNER_QA__.clearObstacles());
  const speedBefore = await hitScenario.page.evaluate(
    () => window.__SCUT_RUNNER_TEST__.getState().speed,
  );
  await hitScenario.page.waitForTimeout(1700);
  const speedAfter = await hitScenario.page.evaluate(
    () => window.__SCUT_RUNNER_TEST__.getState().speed,
  );
  const speedBadgeText = await hitScenario.page.locator("#speedBadge").textContent();
  assert(speedAfter > speedBefore * 1.015, "Run speed should increase continuously");
  assert(speedBadgeText.includes("×"), "Speed badge should show the current multiplier");

  const forcedObstacle = await hitScenario.page.evaluate(() =>
    window.__SCUT_RUNNER_QA__.spawnRegularObstacles(4),
  );
  assert(
    forcedObstacle.type === "bird",
    `Fourth regular obstacle should be a blue magpie, got ${forcedObstacle.type}`,
  );
  const forcedTallTree = await hitScenario.page.evaluate(() =>
    window.__SCUT_RUNNER_QA__.spawnRegularObstacles(6),
  );
  assert(
    forcedTallTree.type === "tree" && forcedTallTree.variant === 3,
    "Sixth regular obstacle should be a tall kapok tree",
  );
  await hitScenario.page.evaluate(() => window.__SCUT_RUNNER_QA__.spawnBird(410));
  await hitScenario.page.waitForFunction(
    () => window.__SCUT_RUNNER_TEST__.getState().mode === "gameover",
    null,
    { timeout: 4000 },
  );
  const hitState = await hitScenario.page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  const birdHitTitle = await hitScenario.page.locator("#overlayTitle").textContent();
  assert(hitState.mode === "gameover", "Low blue magpie should hit a running player who does not duck");
  assert(birdHitTitle.includes("喜鹊"), `Bird collision title should name the magpie, got ${birdHitTitle}`);
  assert(hitScenario.errors.length === 0, hitScenario.errors.join("\n"));
  await hitScenario.context.close();

  const duckScenario = await openBirdScenario();
  await duckScenario.page.locator("#soundToggle").click();
  await duckScenario.page.locator("#startButton").click();
  await duckScenario.page.evaluate(() => window.__SCUT_RUNNER_QA__.spawnBird(410));
  await duckScenario.page.keyboard.down("ArrowDown");
  await duckScenario.page.waitForTimeout(120);
  const duckState = await duckScenario.page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  assert(duckState.player.ducking, "ArrowDown should work after a header button had focus");
  assert(duckState.player.h < 55, "Duck pose should shrink immediately");
  await duckScenario.page.waitForFunction(
    () => {
      const state = window.__SCUT_RUNNER_TEST__.getState();
      return state.mode === "gameover" || state.obstacleCount === 0;
    },
    null,
    { timeout: 3500 },
  );
  const clearState = await duckScenario.page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  await duckScenario.page.keyboard.up("ArrowDown");
  assert(clearState.mode === "running", "Ducked player should pass below the low blue magpie");
  assert(clearState.obstacleCount === 0, "Low blue magpie should pass behind a ducked player");
  assert(duckScenario.errors.length === 0, duckScenario.errors.join("\n"));
  await duckScenario.context.close();

  return {
    speedBefore,
    speedAfter,
    speedBadgeText,
    forcedObstacle,
    forcedTallTree,
    hitState,
    birdHitTitle,
    duckState,
    clearState,
  };
}

async function runTallTreeRegression(browser) {
  async function openScenario() {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await page.goto(`${baseUrl}?qa=1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__SCUT_RUNNER_QA__));
    await page.locator("#startButton").click();
    return { context, page, errors };
  }

  const noJumpScenario = await openScenario();
  await noJumpScenario.page.evaluate(() => window.__SCUT_RUNNER_QA__.spawnTallTree(560));
  await noJumpScenario.page.waitForFunction(
    () => window.__SCUT_RUNNER_TEST__.getState().mode === "gameover",
    null,
    { timeout: 4000 },
  );
  const noJumpState = await noJumpScenario.page.evaluate(() => window.__SCUT_RUNNER_TEST__.getState());
  const tallTreeHitTitle = await noJumpScenario.page.locator("#overlayTitle").textContent();
  assert(noJumpState.mode === "gameover", "Tall kapok should stop a player who does not jump");
  assert(tallTreeHitTitle.includes("高木棉"), `Tall tree title should name the tree, got ${tallTreeHitTitle}`);
  assert(noJumpScenario.errors.length === 0, noJumpScenario.errors.join("\n"));
  await noJumpScenario.context.close();

  const singleJumpScenario = await openScenario();
  await singleJumpScenario.page.evaluate(() => window.__SCUT_RUNNER_QA__.spawnTallTree(560));
  await singleJumpScenario.page.waitForTimeout(850);
  await singleJumpScenario.page.keyboard.press("Space");
  await singleJumpScenario.page.waitForFunction(
    () => {
      const state = window.__SCUT_RUNNER_TEST__.getState();
      return state.mode === "gameover" || state.obstacleCount === 0;
    },
    null,
    { timeout: 4000 },
  );
  const singleJumpState = await singleJumpScenario.page.evaluate(
    () => window.__SCUT_RUNNER_TEST__.getState(),
  );
  assert(singleJumpState.mode === "gameover", "A single jump should not clear a tall kapok");
  assert(singleJumpScenario.errors.length === 0, singleJumpScenario.errors.join("\n"));
  await singleJumpScenario.context.close();

  const doubleJumpScenario = await openScenario();
  await doubleJumpScenario.page.evaluate(() => window.__SCUT_RUNNER_QA__.spawnTallTree(560));
  await doubleJumpScenario.page.waitForTimeout(680);
  await doubleJumpScenario.page.keyboard.press("Space");
  await doubleJumpScenario.page.waitForTimeout(260);
  await doubleJumpScenario.page.keyboard.press("Space");
  await doubleJumpScenario.page.waitForFunction(
    () => {
      const state = window.__SCUT_RUNNER_TEST__.getState();
      return state.mode === "gameover" || state.obstacleCount === 0;
    },
    null,
    { timeout: 4000 },
  );
  const doubleJumpState = await doubleJumpScenario.page.evaluate(
    () => window.__SCUT_RUNNER_TEST__.getState(),
  );
  assert(doubleJumpState.mode === "running", "A double jump should clear a tall kapok");
  assert(doubleJumpState.obstacleCount === 0, "Tall kapok should pass after a double jump");
  assert(doubleJumpScenario.errors.length === 0, doubleJumpScenario.errors.join("\n"));
  await doubleJumpScenario.context.close();

  return { noJumpState, tallTreeHitTitle, singleJumpState, doubleJumpState };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const candidates = [
    process.env.BROWSER_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  assert(executablePath, "No Chrome or Edge executable was found");

  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const desktop = await runDesktop(browser);
    const mobile = await runMobile(browser);
    const mobileLandscape = await runMobileLandscape(browser);
    const birdRegression = await runBirdRegression(browser);
    const tallTreeRegression = await runTallTreeRegression(browser);
    const result = {
      baseUrl,
      desktop,
      mobile,
      mobileLandscape,
      birdRegression,
      tallTreeRegression,
    };
    fs.writeFileSync(
      path.join(outputDir, "smoke-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
