/**
 * VisionForge — Local Auto-Demo Capture
 * ------------------------------------------------------------
 * Spins up a tiny static server for ../frontend, drives the real
 * UI with Playwright, and captures the full screenshot set used in
 * the README — plus a walkthrough video for the demo GIF.
 *
 * The image API is MOCKED with bundled sample art (scripts/samples),
 * so this runs fully offline: no backend, no OpenAI key, no cost,
 * and the output is deterministic.
 *
 * Usage:
 *   npm run screenshots                # local frontend + mocked API (default)
 *   node scripts/capture-screenshots.js --url https://your-site/   # capture a live URL
 *   node scripts/capture-screenshots.js --live                     # use the real backend (needs network)
 *
 * Output: ../screenshots/{home,studio,result,gallery,mobile}.png
 *         ../screenshots/.demo/walkthrough.webm  (source for demo.gif)
 */

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const SAMPLES_DIR = path.join(__dirname, "samples");
const OUT_DIR = path.join(ROOT, "screenshots");
const DEMO_DIR = path.join(OUT_DIR, ".demo");

const args = process.argv.slice(2);
const getFlag = (name) => args.includes(`--${name}`);
const getOpt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const USE_LIVE_BACKEND = getFlag("live");
const CUSTOM_URL = getOpt("url");
const PORT = 8123;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

/* ── Minimal static server (no deps) ──────────────────────── */
function startStaticServer(dir, port) {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = path.join(dir, urlPath);
    if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/* ── Demo prompts + sample rotation for the mock ──────────── */
const PROMPTS = [
  "A lone astronaut on a crimson Mars plateau at dawn, dust swirling, distant twin suns casting long shadows, hyper-detailed, cinematic",
  "A futuristic megacity at midnight, rain-soaked streets reflecting neon signs, flying vehicles, cinematic fog, ultra detailed",
  "A crystalline forest where trees are made of translucent quartz, soft bioluminescent glow, mist, fantasy concept art",
  "Deep-ocean research station, bioluminescent creatures, a beam of light from the surface, hyper-realistic 3D render",
];

const SAMPLES = [
  "sample-cyber.png",
  "sample-deepsea.png",
  "sample-crystal.png",
  "sample-neural.png",
  "sample-mars.png",
];

function dataUrl(file) {
  const b64 = fs.readFileSync(path.join(SAMPLES_DIR, file)).toString("base64");
  return `data:image/png;base64,${b64}`;
}

async function installMock(page, holdRef) {
  const urls = SAMPLES.map(dataUrl);
  let i = 0;
  await page.route("**/api/generate-image", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    if (holdRef.ms) await new Promise((r) => setTimeout(r, holdRef.ms));
    const image = urls[i % urls.length];
    i += 1;
    return route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ image, prompt: "demo" }),
    });
  });
}

async function clipOf(page, selector, maxHeight) {
  const box = await page.locator(selector).boundingBox();
  return {
    x: 0,
    y: Math.max(0, box.y),
    width: 1440,
    height: Math.min(maxHeight, box.height),
  };
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(DEMO_DIR);

  let server = null;
  let baseUrl = CUSTOM_URL;
  if (!baseUrl) {
    server = await startStaticServer(FRONTEND_DIR, PORT);
    baseUrl = `http://127.0.0.1:${PORT}/index.html`;
    console.log(`▸ Serving ${FRONTEND_DIR}\n▸ ${baseUrl}`);
  } else {
    console.log(`▸ Capturing live URL: ${baseUrl}`);
  }

  const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
  const hold = { ms: 0 };

  // Desktop context with video recording for the walkthrough → demo.gif
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    recordVideo: { dir: DEMO_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();
  if (!USE_LIVE_BACKEND) await installMock(page, hold);

  // 1) HOME / hero
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400); // let the neural canvas breathe
  await page.screenshot({ path: path.join(OUT_DIR, "home.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });
  console.log("✓ home.png");

  // 2) Configure the studio
  await page.fill("#prompt", PROMPTS[0]);
  await page.click('.style-card:has(input[value="3D render"])');
  await page.click('.size-btn:has(input[value="1536x1024"])');
  await page.click('.quality-btn:has(input[value="high"])');
  await page.locator("#workspace").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // 3) Generate (hold the loader visible long enough to be filmed)
  hold.ms = USE_LIVE_BACKEND ? 0 : 1100;
  await page.click("#generateBtn");
  await page.waitForSelector("#generatedImage:not(.hidden)", { timeout: 90000 });
  await page.waitForTimeout(900);
  hold.ms = 0;

  // 4) STUDIO (controls + generated result)
  await page.screenshot({ path: path.join(OUT_DIR, "studio.png"), clip: await clipOf(page, "#workspace", 940) });
  console.log("✓ studio.png");

  // 5) RESULT (preview panel close-up)
  const panel = await page.locator(".canvas-panel").boundingBox();
  await page.screenshot({
    path: path.join(OUT_DIR, "result.png"),
    clip: { x: panel.x - 12, y: panel.y - 12, width: panel.width + 24, height: panel.height + 24 },
  });
  console.log("✓ result.png");

  // 6) Fill the gallery with a few more creations
  for (const prompt of PROMPTS.slice(1)) {
    await page.fill("#prompt", prompt);
    await page.click("#generateBtn");
    await page.waitForSelector("#generatedImage:not(.hidden)", { timeout: 90000 });
    await page.waitForTimeout(600);
  }
  await page.locator("#gallery-section").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT_DIR, "gallery.png"), clip: await clipOf(page, "#gallery-section", 700) });
  console.log("✓ gallery.png");

  // Flush the walkthrough video
  await ctx.close();
  const videoFiles = fs.readdirSync(DEMO_DIR).filter((f) => f.endsWith(".webm"));
  if (videoFiles.length) {
    const finalVideo = path.join(DEMO_DIR, "walkthrough.webm");
    fs.renameSync(path.join(DEMO_DIR, videoFiles[0]), finalVideo);
    console.log(`✓ walkthrough.webm  →  build the GIF with:  npm run demo:gif`);
  }

  // 7) MOBILE
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mpage = await mctx.newPage();
  if (!USE_LIVE_BACKEND) await installMock(mpage, hold);
  await mpage.goto(baseUrl, { waitUntil: "networkidle" });
  await mpage.waitForTimeout(1000);
  await mpage.fill("#prompt", PROMPTS[0]);
  await mpage.click("#generateBtn");
  await mpage.waitForSelector("#generatedImage:not(.hidden)", { timeout: 90000 });
  await mpage.waitForTimeout(700);
  await mpage.screenshot({ path: path.join(OUT_DIR, "mobile.png"), fullPage: true });
  console.log("✓ mobile.png");
  await mctx.close();

  await browser.close();
  if (server) server.close();
  console.log("\nAll screenshots written to /screenshots ✨");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
