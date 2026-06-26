const { loadEnv } = require("./utils/env.js");
loadEnv();

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth")();
chromium.use(StealthPlugin);

const TempMail = require("./tempmail.js");
const { solve: solveRecaptchaAudio } = require("recaptcha-solver");
const fs = require("fs");
const path = require("path");

const { findFfmpeg } = require("./utils/ffmpeg.js");
const { sleep, rand, typeHuman, handleCookies } = require("./utils/helpers.js");
const {
  solveRecaptchaWith2captcha,
  waitForCaptchaSolved,
} = require("./utils/captcha.js");
const { solveImageCaptcha } = require("./utils/capmonster.js");

const ffmpegPath = findFfmpeg();
console.log(`  ffmpeg: ${ffmpegPath}`);

const CONFIG = {
  // Landing page (referral link)
  landingUrl: `https://platform.xiaomimimo.com?ref=${process.env.REFERRAL_CODE || "6JWDPG"}`,
  // Registration URL (fallback, normally reached via landing → sign up)
  registerUrl:
    "https://global.account.xiaomi.com/fe/service/register?_group=DEFAULT&_locale=en&region=US&sid=api-platform&_uRegion=ID",
  // Console URL after login
  consoleUrl: "https://platform.xiaomimimo.com/console",
  // API key name
  apiKeyName: "auto-" + Date.now().toString(36),
  // Output file for API key
  outputFile: path.join(__dirname, "keys.csv"),
  // User config
  password: process.env.PLATFORM_PASSWORD || "NutrisariJeruk2026!",
  region: "Indonesia",
  // Timeouts (ms)
  emailTimeout: 6000000,
  otpTimeout: 6000000,
  navigateTimeout: 6000000,
  // Reusable timeout for manual captcha solving (waitForCaptchaSolved)
  captchaSolveTimeout: 6000000, // 10 min
  // Captcha mode: 'manual' | 'audio' | '2captcha'
  captchaMode: "audio",
  captchaApiKey: "",
  // CapMonster API key for Xiaomi custom text/image captcha (2nd captcha)
  capmonsterApiKey: process.env.CAPMONSTER_API_KEY || "",
  // Proxy (optional): 'http://host:port' or empty to disable
  proxy: process.env.PROXY || "",
};

// sleep, rand, and typeHuman functions are now imported from ./utils/helpers.js

function parseCsvLine(line) {
  const cols = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

function loadProxiesFromCsv(csvPath) {
  if (!fs.existsSync(csvPath)) {
    console.log(`  [proxy] CSV not found: ${csvPath}`);
    return [];
  }
  const content = fs.readFileSync(csvPath, "utf8").trim();
  const lines = content.split("\n");
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const proxyIdx = header.indexOf("proxy");
  if (proxyIdx === -1) {
    console.log("  [proxy] 'proxy' column not found in CSV header");
    return [];
  }
  const proxies = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const p = (cols[proxyIdx] || "").trim();
    if (p && p.startsWith("http")) {
      proxies.push(p);
    }
  }
  return proxies;
}

function saveWorkingProxy(proxy) {
  if (!proxy) return;
  const file = path.join(__dirname, "proxies_worked.csv");
  const existing = new Set();
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].trim();
      if (p) existing.add(p);
    }
  }
  if (existing.has(proxy)) return;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "proxy\n", "utf8");
  }
  fs.appendFileSync(file, proxy + "\n", "utf8");
  console.log(`  [proxy] Working proxy saved: ${proxy}`);
}

const FREE_PROXIES =
  process.env.USE_PROXY_CSV === "true"
    ? loadProxiesFromCsv(path.join(__dirname, "proxies_clean.csv"))
    : process.env.PROXIES
      ? process.env.PROXIES.split(",").map((p) => p.trim())
      : [];

async function getRandomProxy() {
  if (CONFIG.proxy) return CONFIG.proxy;
  if (FREE_PROXIES.length === 0) return "";
  return FREE_PROXIES[Math.floor(Math.random() * FREE_PROXIES.length)];
}

// solveRecaptchaWith2captcha and waitForCaptchaSolved functions are now imported from ./utils/captcha.js

async function handleTermsAgreement(page) {
  // Poll for terms page to fully load (max 15s)
  const deadline = Date.now() + 15000;
  let hasTerms = false;

  while (Date.now() < deadline) {
    for (const text of [
      "I agree to use the model",
      "Open Platform Agreement",
      "Privacy Policy",
      "terms and condition",
    ]) {
      const el = page.locator(`text="${text}"`).first();
      if (await el.isVisible({ timeout: 60000 }).catch(() => false)) {
        hasTerms = true;
        break;
      }
    }
    if (hasTerms) break;
    await sleep(1500);
  }

  if (!hasTerms) {
    console.log("  No terms agreement detected, skipping...");
    return;
  }

  console.log("  Terms agreement detected!");

  // Check the agreement checkbox
  const checkboxSelectors = [
    'input[type="checkbox"]',
    '[class*="checkbox"] input',
    '[class*="agree"] input',
    'input[name*="agree" i]',
  ];
  let checked = false;
  for (const selector of checkboxSelectors) {
    const cb = page.locator(selector).first();
    if (await cb.isVisible({ timeout: 60000 }).catch(() => false)) {
      if (!(await cb.isChecked().catch(() => false))) {
        await cb.check();
      }
      checked = true;
      console.log("  Agreement checkbox: checked");
      break;
    }
  }

  // Fallback: click the label/text directly
  if (!checked) {
    const labelEl = page
      .locator(
        'label:has-text("I agree"), label:has-text("Agree"), span:has-text("I agree")',
      )
      .first();
    if (await labelEl.isVisible({ timeout: 60000 }).catch(() => false)) {
      await labelEl.click();
      console.log("  Agreement label clicked");
      checked = true;
    }
  }

  await sleep(500);

  // Click Confirm/Agree/Submit button
  const confirmSelectors = [
    'button:has-text("Confirm")',
    'button:has-text("Agree")',
    'button:has-text("Accept")',
    'button:has-text("Submit")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button[type="submit"]',
  ];
  for (const selector of confirmSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 60000 }).catch(() => false)) {
      await btn.click();
      console.log("  Terms confirmed");
      await sleep(2000);
      return;
    }
  }

  console.log("  [WARN] Confirm button not found, proceeding anyway...");
}

// solveRecaptchaWith2captcha and waitForCaptchaSolved functions are now imported from ./utils/captcha.js

function parseProxy(proxyString) {
  try {
    const url = new URL(proxyString);
    const server = `${url.protocol}//${url.hostname}${url.port ? ":" + url.port : ""}`;
    const proxyConfig = { server };
    if (url.username) {
      proxyConfig.username = decodeURIComponent(url.username);
    }
    if (url.password) {
      proxyConfig.password = decodeURIComponent(url.password);
    }
    return proxyConfig;
  } catch (_) {
    return { server: proxyString };
  }
}

const SOUNDS = {
  manualCaptcha: path.join(__dirname, "sounds", "manual-captcha.wav"),
  manualError: path.join(__dirname, "sounds", "error.wav"),
  success: path.join(__dirname, "sounds", "success.wav"),
};

// Plays a wav file via PowerShell SoundPlayer (blocks until playback finishes).
// Returns a Promise; errors from PowerShell are surfaced instead of swallowed.
// Not detached/unref'd so the child is tracked by the event loop and is not
// killed when the parent exits prematurely.
function playSound(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  [sound] File not found: ${filePath}`);
    return Promise.resolve();
  }
  const esc = String(filePath).replace(/'/g, "''");
  const psScript = `(New-Object Media.SoundPlayer '${esc}').PlaySync()`;
  return new Promise((resolve) => {
    let ps;
    try {
      ps = require("child_process").spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
    } catch (e) {
      console.log(`  [sound] spawn failed: ${e.message}`);
      return resolve();
    }
    let errBuf = "";
    ps.stderr.on("data", (d) => (errBuf += d.toString()));
    ps.on("error", (e) => {
      console.log(`  [sound] spawn error: ${e.message}`);
      resolve();
    });
    ps.on("exit", (code) => {
      if (code !== 0 || errBuf.trim()) {
        console.log(`  [sound] exit=${code} err=${errBuf.trim()}`);
      } else {
        console.log(`  [sound] played: ${path.basename(filePath)}`);
      }
      resolve();
    });
  });
}

// Navigates and tolerates net::ERR_ABORTED, which happens when the page
// performs a client-side redirect before "domcontentloaded" fires — the page
// still loads, so this is a false-positive error we must ignore.
async function gotoTolerant(page, url, opts = {}) {
  const {
    waitUntil = "domcontentloaded",
    timeout = 6000000,
    settleAfter = 1500,
  } = opts;
  try {
    await page.goto(url, { waitUntil, timeout });
  } catch (e) {
    const aborted = /ERR_ABORTED/.test(e?.message || "");
    if (!aborted) throw e;
    console.log(`  [nav] redirect aborted (ERR_ABORTED), waiting to settle...`);
    await page
      .waitForLoadState("domcontentloaded", { timeout })
      .catch(() => {});
    await sleep(settleAfter);
  }
}

async function register() {
  CONFIG.proxy = await getRandomProxy();
  console.log("[1/12] Launching browser...");
  const launchOpts = {
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
      "--disable-infobars",
      "--disable-dev-shm-usage",
      "--disable-popup-blocking",
      "--disable-notifications",
      "--disable-extensions",
      "--start-maximized",
    ],
  };

  const wx = process.env.WINDOW_X;
  const wy = process.env.WINDOW_Y;
  if (wx !== undefined && wy !== undefined) {
    launchOpts.args.push(`--window-position=${wx},${wy}`);
  }

  const ww = process.env.WINDOW_WIDTH;
  const wh = process.env.WINDOW_HEIGHT;
  if (ww !== undefined && wh !== undefined) {
    launchOpts.args.push(`--window-size=${ww},${wh}`);
  }

  if (CONFIG.proxy) {
    launchOpts.proxy = parseProxy(CONFIG.proxy);
    console.log(
      `  Using proxy: ${CONFIG.proxy.includes("@") ? CONFIG.proxy.split("@").pop() : CONFIG.proxy}`,
    );
  }
  const browser = await chromium.launch(launchOpts);
  const REALISTIC_UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  ];
  const TIMEZONES = [
    "Asia/Jakarta",
    "Asia/Singapore",
    "Asia/Tokyo",
    "America/New_York",
    "Europe/London",
    "Asia/Hong_Kong",
  ];
  const LOCALES = ["en-US", "en-GB", "id-ID", "ja-JP"];
  const contextOpts = {
    ignoreHTTPSErrors: true,
    userAgent: REALISTIC_UAS[Math.floor(Math.random() * REALISTIC_UAS.length)],
    viewport: {
      width: 1280 + Math.floor(Math.random() * 240),
      height: 720 + Math.floor(Math.random() * 240),
    },
    locale: LOCALES[Math.floor(Math.random() * LOCALES.length)],
    timezoneId: TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)],
    colorScheme: "light",
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "sec-ch-ua":
        '"Chromium";v="126", "Not/A)Brand";v="8", "Google Chrome";v="126"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
  };
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  try {
    // Step 1: Create temp email
    console.log("[2/12] Creating temporary email...");
    const tempmail = new TempMail();
    const inbox = await tempmail.createInbox();
    const email = inbox.address;
    console.log(`  Email: ${email}`);

    // Step 2: Navigate to landing page → click Sign Up → redirect to registration
    console.log("[3/12] Opening landing page...");
    console.log(`  Landing URL: ${CONFIG.landingUrl}`);
    await gotoTolerant(page, CONFIG.landingUrl);
    console.log("  Waiting for cookie...");
    await handleCookies(page);
    await sleep(rand(2000, 3000));
    console.log(`  Proxy: ${CONFIG.proxy}`);
    console.log(`  Register URL: ${CONFIG.registerUrl}`);
    await gotoTolerant(page, CONFIG.registerUrl);

    // Wait for Xiaomi registration page to load
    await page
      .waitForURL(/account\.xiaomi\.com/, { timeout: 6000000 })
      .catch(() => {});
    await sleep(rand(2000, 3000));
    await handleCookies(page);

    // Step 3: Select region (skipped - auto-detected from _uRegion param)
    console.log(
      "[4/12] Region auto-detected (via URL param), skipping manual selection...",
    );

    // Step 4: Fill email
    console.log("[5/12] Filling registration form...");
    // Type email with human-like delays
    const emailInput = page
      .locator('input[type="text"]')
      .first()
      .or(
        page
          .locator(
            'input[name*="email" i], input[name*="account" i], input[placeholder*="email" i], input[placeholder*="Email" i], input[placeholder*="account" i], input[type="email"]',
          )
          .first(),
      );
    await emailInput.click({ timeout: 300000 });
    await sleep(rand(300, 800));
    await emailInput.fill(email, { timeout: 300000 });
    await sleep(rand(400, 900));

    // Fill password
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(CONFIG.password);
    await sleep(rand(200, 500));

    // Fill confirm password
    if ((await passwordInputs.count()) > 1) {
      await passwordInputs.nth(1).fill(CONFIG.password);
      await sleep(rand(200, 500));
    }

    // Agree to terms checkbox
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible()) {
      const isChecked = await checkbox.isChecked();
      if (!isChecked) {
        await checkbox.check();
      }
      console.log("  Terms checkbox: checked");
    }

    // Take screenshot for debugging
    // await page.screenshot({ path: 'before_submit.png' });
    console.log("  Screenshot saved: before_submit.png");

    // Step 5: Submit and handle captcha
    console.log("[6/12] Submitting form (captcha may appear)...");
    await sleep(rand(1500, 4000));
    const submitBtn = page
      .locator(
        'button[type="submit"], button:has-text("Register"), button:has-text("Next"), button:has-text("Create"), a:has-text("Register")',
      )
      .first();
    await submitBtn.click();
    await sleep(rand(2000, 4000));

    // Handle captcha
    if (CONFIG.captchaMode === "audio") {
      // Pre-check: detect if Google already flagged this network/IP
      try {
        await page
          .waitForLoadState("domcontentloaded", { timeout: 6000000 })
          .catch(() => {});
        const blocked = await page
          .locator(
            "text=/automated queries|unusual traffic from your computer|automated requests/i",
          )
          .first();
        if (await blocked.isVisible({ timeout: 6000000 }).catch(() => false)) {
          throw new Error("GOOGLE_RATE_LIMITED");
        }
      } catch (_) {}

      console.log("  Auto-solving captcha with audio (offline, free)...");

      // Wait for reCAPTCHA checkbox to load (with retry)
      console.log("  Waiting for reCAPTCHA to load...");
      let checkboxClicked = false;
      for (let attempt = 0; attempt < 5 && !checkboxClicked; attempt++) {
        try {
          await page.waitForSelector('iframe[title="reCAPTCHA"]', {
            state: "attached",
            timeout: 6000000,
          });
          await sleep(rand(1000, 2000)); // let iframe fully render

          const recaptchaFrame = await page.$('iframe[title="reCAPTCHA"]');
          if (recaptchaFrame) {
            const frame = await recaptchaFrame.contentFrame();
            if (frame) {
              await frame.waitForSelector(".recaptcha-checkbox-border", {
                state: "visible",
                timeout: 6000000,
              });
              const checkbox = await frame.$(".recaptcha-checkbox-border");
              if (checkbox) {
                await checkbox.click();
                console.log("  Checkbox clicked, waiting for challenge...");
                await sleep(rand(2000, 3000));
                checkboxClicked = true;
              }
            }
          }
        } catch (_) {
          if (attempt < 4) {
            console.log(
              `  Checkbox not ready (attempt ${attempt + 1}/5), retrying...`,
            );
            await sleep(1000);
          }
        }
      }
      if (!checkboxClicked) {
        console.log(
          "  [WARN] Could not click checkbox, trying solve anyway...",
        );
      }

      try {
        process.env.VERBOSE = "1";
        console.log("  Solving reCAPTCHA via audio...");
        await solveRecaptchaAudio(page, {
          wait: 15000,
          retry: 5,
          ffmpeg: ffmpegPath,
        });
        console.log("  reCAPTCHA solved via audio!");

        // Check for Xiaomi custom 2nd captcha (text/image)
        console.log(
          "  Waiting for next step (custom captcha modal or OTP screen)...",
        );
        let captchaVisible = false;
        let otpVisible = false;
        const checkDeadline = Date.now() + 15000;

        while (Date.now() < checkDeadline) {
          const customImg = page
            .locator(
              '.mi-captcha-field__image, img[src*="getCode"], img[src*="icodeType"]',
            )
            .first();
          if (
            await customImg.isVisible({ timeout: 60000 }).catch(() => false)
          ) {
            captchaVisible = true;
            break;
          }
          const otpInput = page
            .locator(
              'input[maxlength="6"], input[maxlength="4"], input[type="number"], input[placeholder*="code" i], input[placeholder*="OTP" i], input[placeholder*="verif" i]',
            )
            .first();
          if (await otpInput.isVisible({ timeout: 60000 }).catch(() => false)) {
            otpVisible = true;
            break;
          }
          await sleep(500);
        }

        if (captchaVisible) {
          const customImg = page
            .locator(
              '.mi-captcha-field__image, img[src*="getCode"], img[src*="icodeType"]',
            )
            .first();
          console.log(
            "  >>> XIAOMI CUSTOM CAPTCHA DETECTED — solving with CapMonster ImageToText...",
          );
          // await page.screenshot({ path: 'custom_captcha.png' });

          const solved = await solveImageCaptcha(customImg, page, {
            apiKey: CONFIG.capmonsterApiKey,
          });
          if (solved) {
            console.log("  Custom captcha solved!");
          } else {
            console.log(
              "  >>> CapMonster failed — solve manually within 20s or browser closes",
            );
            const manualSolved = await waitForCaptchaSolved(
              page,
              CONFIG.captchaSolveTimeout,
            );
            if (!manualSolved) {
              console.log("  Timeout, closing browser");
              await browser.close();
              process.exit(1);
            } else {
              console.log("  >>> Manual captcha solved, continuing...");
            }
          }
        } else if (otpVisible) {
          console.log(
            "  Directly advanced to OTP screen, no custom captcha needed.",
          );
        } else {
          console.log(
            "  [WARN] Neither custom captcha nor OTP screen detected after 15s.",
          );
        }
      } catch (e) {
        if (e.message === "GOOGLE_RATE_LIMITED") {
          console.log(
            "  >>> Google blocked this IP/network ('automated queries').",
          );
          console.log(
            "  >>> Auto audio solve will NOT work — IP is rate-limited.",
          );
          console.log(
            "  >>> Fix: use a residential/mobile proxy (PROXY env), or solve manually below.",
          );
          // When running under loop_xiaomi.js with AUTO_SKIP_RATE_LIMIT, bail out
          // immediately so loop can rotate to the next proxy instead of
          // hanging on manual solve for a flagged IP.
          if (process.env.AUTO_SKIP_RATE_LIMIT === "1") {
            console.log(
              "  >>> AUTO_SKIP_RATE_LIMIT=1 — aborting run, loop will skip.",
            );
            process.exitCode = 1;
            return;
          }
        } else {
          console.log(`  Audio solver failed: ${e.message}`);
          console.log("  Falling back to manual solve...");
        }
        console.log("  >>> Playing manual-captcha sound alert");
        await playSound(SOUNDS.manualCaptcha);
        await waitForCaptchaSolved(page, CONFIG.captchaSolveTimeout);
      }
    } else if (CONFIG.captchaMode === "2captcha" && CONFIG.captchaApiKey) {
      console.log("  Auto-solving captcha with 2captcha...");
      await solveRecaptchaWith2captcha(page, CONFIG.captchaApiKey);
    } else {
      console.log(
        "  >>> CAPTCHA: Please solve the captcha manually in the browser.",
      );
      console.log("  >>> Auto-detecting when solved...");
      console.log("  >>> Playing manual-captcha sound alert");
      await playSound(SOUNDS.manualCaptcha);
      const captchaSolved = await waitForCaptchaSolved(
        page,
        CONFIG.captchaSolveTimeout,
      );
      if (captchaSolved) {
        console.log("  Captcha solved! Continuing...");
      } else {
        console.log("  [WARN] Captcha detection timeout, proceeding anyway...");
      }
    }

    // Step 7: Wait for OTP email
    console.log("[7/12] Waiting for OTP email...");
    const otp = await tempmail.waitForOtp(email, CONFIG.otpTimeout, 3000);

    if (!otp) {
      console.log("  >>> Playing error sound alert");
      await playSound(SOUNDS.manualError);
      console.log("  TIMEOUT: No OTP received. Check browser manually.");
      console.log("  Browser stays open for manual intervention.");
      // await page.screenshot({ path: 'timeout.png' });
      // Don't close browser so user can intervene
      await new Promise(() => {}); // Keep alive
      return;
    }

    console.log(`  OTP received: ${otp}`);

    // Fill OTP
    const otpInputs = page.locator(
      'input[maxlength="6"], input[maxlength="4"], input[type="number"], input[placeholder*="code" i], input[placeholder*="OTP" i], input[placeholder*="verif" i]',
    );
    if ((await otpInputs.count()) >= 6) {
      // Split OTP across 6 inputs
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(otp[i]);
        await sleep(100);
      }
    } else {
      // Single OTP input
      const otpInput = otpInputs.first();
      if (await otpInput.isVisible()) {
        await otpInput.fill(otp);
      }
    }
    await sleep(500);

    // Submit OTP
    const otpSubmit = page
      .locator(
        'button[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Confirm")',
      )
      .first();
    await otpSubmit.click();

    // Step 8: Wait for OAuth redirect chain to platform console
    console.log("[8/12] Waiting for OAuth redirect to platform console...");
    await page
      .waitForURL(/platform\.xiaomimimo\.com\/console/, { timeout: 60000 })
      .catch(async () => {
        console.log("  Redirect not detected, navigating manually...");
        await page.goto(CONFIG.consoleUrl, {
          waitUntil: "domcontentloaded",
          timeout: CONFIG.navigateTimeout,
        });
      });

    // Step 9: Handle terms & agreements (appears after redirect)
    console.log("[9/12] Checking terms & agreements...");
    await handleTermsAgreement(page);

    await handleCookies(page);
    await sleep(2000);

    // await page.screenshot({ path: 'registered.png' });
    console.log("  Landed on platform console");

    // Step 10: Create API Key
    console.log("[10/12] Creating API Key...");

    // Try common API key page URLs
    const apiKeyPaths = [
      "/apikey",
      "/developer/apikey",
      "/settings/apikey",
      "/developer",
      "/keys",
      "/settings",
    ];
    let foundApiPage = false;

    // First try: find sidebar/header link
    const apiTabSelectors = [
      'a:has-text("API")',
      'button:has-text("API")',
      'a:has-text("Key")',
      'a:has-text("Developer")',
      'a:has-text("Settings")',
      '[href*="apikey" i]',
      '[href*="api-key" i]',
      '[href*="developer" i]',
      '[href*="settings" i]',
    ];
    for (const selector of apiTabSelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 60000 }).catch(() => false)) {
        await el.click();
        await sleep(2000);
        foundApiPage = true;
        console.log(`  Found nav link via: ${selector}`);
        break;
      }
    }

    // Fallback: try direct URLs
    if (!foundApiPage) {
      for (const p of apiKeyPaths) {
        const url = CONFIG.consoleUrl + p;
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 6000000,
          });
          await handleCookies(page);
          await sleep(1500);
          foundApiPage = true;
          console.log(`  Navigated to: ${url}`);
          break;
        } catch (_) {}
      }
    }

    // await page.screenshot({ path: 'api_keys_page.png' });
    await sleep(1000);

    // Click "Create" or "New" button
    const createBtnSelectors = [
      'button:has-text("Create API Key")',
      'button:has-text("Create")',
      'button:has-text("New API")',
      'button:has-text("New")',
      'button:has-text("Add")',
      'a:has-text("Create")',
      'a:has-text("New")',
      'span:has-text("Create")',
      '[class*="create" i]',
      '[class*="add" i]',
      "button",
    ];
    let createBtn = null;
    for (const selector of createBtnSelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 60000 }).catch(() => false)) {
        createBtn = el;
        break;
      }
    }
    if (createBtn) {
      await createBtn.click();
      await sleep(1500);
      console.log("  Create API Key dialog opened");
    } else {
      console.log("  [WARN] Create button not found");
      // await page.screenshot({ path: 'no_create_btn.png' });
    }

    // Fill API key name in modal/input
    const nameInputSelectors = [
      'input[placeholder*="name" i]',
      'input[placeholder*="Name" i]',
      'input[placeholder*="key" i]',
      'input[placeholder*="label" i]',
      'input[name*="name" i]',
      'input[name*="label" i]',
      'input[type="text"]',
    ];
    let nameInput = null;
    for (const selector of nameInputSelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 60000 }).catch(() => false)) {
        nameInput = el;
        break;
      }
    }
    if (nameInput) {
      await nameInput.fill("");
      await nameInput.fill(CONFIG.apiKeyName);
      console.log(`  API Key name: ${CONFIG.apiKeyName}`);
      await sleep(500);
    } else {
      console.log("  [WARN] Name input not found");
    }

    // Confirm via modal button
    const confirmSelectors = [
      'button:has-text("Confirm")',
      'button:has-text("OK")',
      'button:has-text("Create")',
      'button:has-text("Submit")',
      'button:has-text("Save")',
      'button[type="submit"]',
      '.modal button:has-text("OK")',
      '.dialog button:has-text("Confirm")',
      'button:has-text("Yes")',
    ];
    let confirmBtn = null;
    for (const selector of confirmSelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 60000 }).catch(() => false)) {
        confirmBtn = el;
        break;
      }
    }
    if (confirmBtn) {
      await confirmBtn.click();
      await sleep(2000);
      console.log("  API Key creation confirmed");
    }
    // await page.screenshot({ path: 'api_key_created.png' });

    // Step 10: Extract and save the API key
    console.log("[11/12] Extracting API Key...");
    let apiKey = "";

    // Try to find the API key value on the page
    const keySelectors = [
      "code",
      "pre",
      '[class*="key"] code',
      '[class*="secret"]',
      '[class*="token"]',
      "input[readonly]",
      'input:has-text("sk-")',
      'input[value*="sk-"]',
      '[class*="apikey"] code',
      ".copyable",
    ];
    for (const selector of keySelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 60000 }).catch(() => false)) {
        const text = await el.textContent().catch(() => "");
        if (text && text.trim().length > 10) {
          apiKey = text.trim();
          break;
        }
      }
    }

    // Fallback: try to read from input value
    if (!apiKey) {
      const readonlyInput = page.locator("input[readonly]").first();
      if (
        await readonlyInput.isVisible({ timeout: 60000 }).catch(() => false)
      ) {
        apiKey = await readonlyInput.inputValue().catch(() => "");
      }
    }

    // Fallback: try clipboard (some sites auto-copy)
    if (!apiKey) {
      try {
        apiKey = await page.evaluate(() => navigator.clipboard.readText());
      } catch (_) {}
    }

    // Save to CSV
    const csvHeaders = "timestamp,email,password,api_key_name,api_key";
    const csvRow = [
      new Date().toISOString(),
      email,
      CONFIG.password,
      CONFIG.apiKeyName,
      apiKey || "NOT_FOUND",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");

    const csvPath = CONFIG.outputFile;
    const exists = fs.existsSync(csvPath);
    if (!exists) {
      fs.writeFileSync(csvPath, csvHeaders + "\n", "utf8");
    }
    fs.appendFileSync(csvPath, csvRow + "\n", "utf8");
    console.log(`  Saved to: ${csvPath}`);

    saveWorkingProxy(CONFIG.proxy);

    // Close the "API Key Successfully Created" modal before proceeding
    try {
      const titleModal = page
        .locator('.ant-modal-title:has-text("API Key Successfully Created")')
        .first();
      const modalVisible = await titleModal
        .isVisible({ timeout: 60000 })
        .catch(() => false);
      if (modalVisible) {
        const closeBtn = page
          .locator('button.ant-modal-close[aria-label="Close"]')
          .first();
        if (await closeBtn.isVisible({ timeout: 60000 }).catch(() => false)) {
          await closeBtn.click();
        } else {
          await page
            .locator('button:has-text("Close")')
            .first()
            .click()
            .catch(() => {});
        }
        await sleep(500);
        console.log("  API Key modal closed");
      }
    } catch (e) {
      console.log(`  [WARN] Failed to close API Key modal: ${e.message}`);
    }

    // Step 12: Redeem invite code (if configured)
    if (process.env.REFERRAL_CODE) {
      console.log("[12/12] Redeeming invite code...");

      const browseDelay = rand(12000, 18000);
      console.log(`  [human] Browsing dashboard for ${Math.round(browseDelay / 1000)}s to avoid risk control...`);
      await sleep(browseDelay);

      for (let i = 0; i < rand(2, 4); i++) {
        await page.mouse.wheel(0, rand(100, 300));
        await sleep(rand(800, 1500));
      }
      await page.mouse.move(rand(200, 600), rand(200, 400));
      await sleep(rand(1000, 2000));

      async function attemptRedeem(attempt) {
        const inviteBtn = page
          .locator('button:has-text("Enter invite code")')
          .first();
        if (!(await inviteBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
          console.log("  [INFO] 'Enter invite code' button not visible, skipping.");
          return false;
        }

        await inviteBtn.click();
        console.log(`  Invite code modal opened (attempt ${attempt})`);
        await sleep(rand(1500, 3000));

        const otpCodeInputs = page.locator('input[aria-label^="OTP Input"]');
        const code = process.env.REFERRAL_CODE;
        for (let i = 0; i < code.length && i < 6; i++) {
          await otpCodeInputs.nth(i).fill(code[i]);
          await sleep(rand(200, 500));
        }
        await sleep(rand(1000, 2000));

        const redeemBtn = page.locator('button:has-text("Redeem")').first();
        if (!(await redeemBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
          console.log("  [WARN] Redeem button not found");
          return false;
        }

        await redeemBtn.click();
        console.log(`  Invite code submitted: ${code}`);
        await sleep(rand(3000, 5000));

        const riskError = await page
          .locator("text=/risk control|restrictions|contact customer/i")
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (!riskError) {
          console.log(`  Invite code redeemed successfully`);
          await sleep(rand(2000, 3000));
          return true;
        }

        console.log(`  [WARN] Risk control detected on attempt ${attempt}`);
        await page
          .locator('button:has-text("OK"), button:has-text("Close"), button:has-text("Confirm")')
          .first()
          .click()
          .catch(() => {});
        await sleep(rand(2000, 3000));
        return false;
      }

      try {
        let success = await attemptRedeem(1);
        if (!success) {
          const retryDelay = rand(20000, 30000);
          console.log(`  [human] Waiting ${Math.round(retryDelay / 1000)}s before retry...`);
          await sleep(retryDelay);

          for (let i = 0; i < rand(3, 5); i++) {
            await page.mouse.wheel(0, rand(100, 400));
            await sleep(rand(600, 1200));
          }
          await page.mouse.move(rand(100, 800), rand(100, 500));
          await sleep(rand(1000, 2000));

          success = await attemptRedeem(2);
          if (!success) {
            console.log("  [WARN] Risk control still active after retry, skipping referral.");
          }
        }
      } catch (e) {
        console.log(`  Invite code redemption failed: ${e.message}`);
      }
    }

    console.log("  >>> Playing success sound alert");
    await playSound(SOUNDS.success);

    console.log("\n========================================");
    console.log("  REGISTRATION SUMMARY");
    console.log("========================================");
    console.log(`  Email:      ${email}`);
    console.log(`  Password:   ${CONFIG.password}`);
    console.log(`  API Key:    ${apiKey || "check api_key_created.png"}`);
    console.log(`  Saved to:   ${CONFIG.outputFile}`);
    console.log("========================================\n");
    console.log("Browser will close in 30 seconds...");
    await sleep(5000);
  } catch (err) {
    console.error("ERROR:", err.message);
    process.exitCode = 1;
    console.log("  >>> Playing error sound alert");
    await playSound(SOUNDS.manualError);
    // await page.screenshot({ path: 'error.png' });
    console.log("Error screenshot saved: error.png");
    await sleep(10000);
  } finally {
    await browser.close();
  }
}

// CLI
if (require.main === module) {
  register().catch(console.error);
}

module.exports = { register, CONFIG };
