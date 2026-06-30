const { loadEnv } = require("../utils/env.js");
loadEnv();

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth")();
chromium.use(StealthPlugin);

const TempMail = require("../tempmail.js");
const { solve: solveRecaptchaAudio } = require("recaptcha-solver");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const { findFfmpeg } = require("../utils/ffmpeg.js");
const {
  sleep,
  rand,
  typeHuman,
  handleCookies,
} = require("../utils/helpers.js");
const {
  solveRecaptchaWith2captcha,
  waitForCaptchaSolved,
} = require("../utils/captcha.js");
const { solveImageCaptcha } = require("../utils/captcha-solver.js");
const {
  loadProxies,
  isBlacklisted,
  addToBlacklist,
  cleanExpiredBlacklist,
} = require("../utils/proxy.js");
const { extractKeys } = require("../utils/extract-keys.js");
const { logger } = require("../utils/logger.js");

const ffmpegPath = findFfmpeg();
const HEADLESS = process.env.HEADLESS === "true";
const CAPTCHA_SOLVER_PROVIDER = process.env.CAPTCHA_SOLVER_PROVIDER || "manual";

let skipStep = false;
let keypressEnabled = false;

function enableStepKeypress() {
  if (keypressEnabled) return;
  if (!process.stdin || !process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    keypressEnabled = true;
    process.stdin.on("data", (chunk) => {
      const s = String(chunk);
      if (s === "d" || s === "D") {
        skipStep = true;
        logger.info("\n  [skip] Step skip requested...", true);
      }
    });
  } catch (_) {}
}

function disableStepKeypress() {
  if (!keypressEnabled) return;
  try {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  } catch (_) {}
  keypressEnabled = false;
}

function checkSkip() {
  if (skipStep) {
    skipStep = false;
    return true;
  }
  return false;
}

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
  outputFile: path.join(ROOT, "keys", "keys.csv"),
  // User config
  password: process.env.PLATFORM_PASSWORD || "NutrisariJeruk2026!",
  region: "Indonesia",
  // Timeouts (ms)
  emailTimeout: 600000,
  otpTimeout: 600000,
  navigateTimeout: 600000,
  // Reusable timeout for manual captcha solving (waitForCaptchaSolved)
  captchaSolveTimeout: 600000, // 10 min
  // Captcha mode: 'manual' | 'audio' | '2captcha'
  captchaMode: "audio",
  captchaApiKey: "",
  // CapMonster API key for Xiaomi custom text/image captcha (2nd captcha)
  capmonsterApiKey: process.env.CAPMONSTER_API_KEY || "",
  // Proxy (optional): 'http://host:port' or empty to disable
  proxy: null,
  // Blacklist duration in minutes for proxies flagged by Google
  blacklistDuration: 10,
};

// sleep, rand, and typeHuman functions are now imported from ./utils/helpers.js

function formatIndonesianDate(date) {
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  const d = date.getDate();
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${d} ${m} ${y} ${h}:${min}`;
}

function saveWorkingProxy(proxy, country) {
  if (!proxy) return;
  const file = path.join(ROOT, "proxies", "worked.csv");
  const existing = new Set();
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols[0]) existing.add(cols[0].trim());
    }
  }
  if (existing.has(proxy)) return;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "proxy,country,timestamp\n", "utf8");
  }
  const timestamp = formatIndonesianDate(new Date());
  fs.appendFileSync(file, `${proxy},${country || ""},${timestamp}\n`, "utf8");
  console.log(
    `  [proxy] Working proxy saved: ${proxy} [${country || "-"}] (${timestamp})`,
  );
}

const FREE_PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(",").map((p) => ({
      proxy: p.trim(),
      country: "",
    }))
  : loadProxies(path.join(ROOT, "proxies", "rechecked.csv"));

cleanExpiredBlacklist();
logger.info(`  Loaded ${FREE_PROXIES.length} free proxies from CSV/env`, true);

const COUNTRY_PROFILES = {
  US: {
    locale: "en-US",
    timezone: "America/New_York",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  GB: {
    locale: "en-GB",
    timezone: "Europe/London",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  DE: {
    locale: "de-DE",
    timezone: "Europe/Berlin",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  FR: {
    locale: "fr-FR",
    timezone: "Europe/Paris",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  JP: {
    locale: "ja-JP",
    timezone: "Asia/Tokyo",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "macOS",
  },
  KR: {
    locale: "ko-KR",
    timezone: "Asia/Seoul",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  SG: {
    locale: "en-SG",
    timezone: "Asia/Singapore",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  ID: {
    locale: "id-ID",
    timezone: "Asia/Jakarta",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  BR: {
    locale: "pt-BR",
    timezone: "America/Sao_Paulo",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  AU: {
    locale: "en-AU",
    timezone: "Australia/Sydney",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "macOS",
  },
  NL: {
    locale: "nl-NL",
    timezone: "Europe/Amsterdam",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  IN: {
    locale: "en-IN",
    timezone: "Asia/Kolkata",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  HK: {
    locale: "en-HK",
    timezone: "Asia/Hong_Kong",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "macOS",
  },
  TH: {
    locale: "th-TH",
    timezone: "Asia/Bangkok",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  VN: {
    locale: "vi-VN",
    timezone: "Asia/Ho_Chi_Minh",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  MY: {
    locale: "ms-MY",
    timezone: "Asia/Kuala_Lumpur",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  PH: {
    locale: "en-PH",
    timezone: "Asia/Manila",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  TW: {
    locale: "zh-TW",
    timezone: "Asia/Taipei",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  CN: {
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  RU: {
    locale: "ru-RU",
    timezone: "Europe/Moscow",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  TR: {
    locale: "tr-TR",
    timezone: "Europe/Istanbul",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  PL: {
    locale: "pl-PL",
    timezone: "Europe/Warsaw",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  IT: {
    locale: "it-IT",
    timezone: "Europe/Rome",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  ES: {
    locale: "es-ES",
    timezone: "Europe/Madrid",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
  CA: {
    locale: "en-CA",
    timezone: "America/Toronto",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "macOS",
  },
  _default: {
    locale: "en-US",
    timezone: "America/New_York",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Windows",
  },
};

function getCountryProfile(country) {
  const c = (country || "").toUpperCase();
  return COUNTRY_PROFILES[c] || COUNTRY_PROFILES._default;
}

let SELECTED_PROXY = "";
let SELECTED_COUNTRY = "";

async function getNextProxy() {
  if (CONFIG.proxy) {
    if (isBlacklisted(CONFIG.proxy)) {
      logger.info(
        `  [blacklist] Configured proxy is blacklisted, skipping.`,
        true,
      );
      return "";
    }
    SELECTED_PROXY = CONFIG.proxy;
    SELECTED_COUNTRY = process.env.PROXY_COUNTRY || "";
    return CONFIG.proxy;
  }
  if (FREE_PROXIES.length === 0) return "";
  const available = FREE_PROXIES.filter((item) => !isBlacklisted(item.proxy));
  if (available.length === 0) {
    logger.info(`  [blacklist] All proxies are blacklisted!`, true);
    return "";
  }
  const picked = available[0];
  SELECTED_PROXY = picked.proxy;
  SELECTED_COUNTRY = picked.country || "";
  logger.info(
    `  [proxy] Using first available: ${picked.proxy} (${available.length} remaining)`,
    true,
  );
  return picked.proxy;
}

// Alias for backward compat
const getRandomProxy = getNextProxy;

// solveRecaptchaWith2captcha and waitForCaptchaSolved functions are now imported from ./utils/captcha.js

async function handleTermsAgreement(page) {
  // Poll for terms page to fully load (max 60s)
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
    logger.info("  No terms agreement detected, looping...", true);
    return await handleTermsAgreement(page);
  }

  logger.info("  Terms agreement detected!", true);

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
      logger.info("  Agreement checkbox: checked", true);
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
      logger.info("  Agreement label clicked", true);
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
      logger.info("  Terms confirmed", true);
      await sleep(2000);
      return;
    }
  }

  logger.info("  [WARN] Confirm button not found, proceeding anyway...", true);
}

// solveRecaptchaWith2captcha and waitForCaptchaSolved functions are now imported from ./utils/captcha.js

function parseProxy(proxyString) {
  const supported = ["http:", "https:", "socks4:", "socks5:"];
  try {
    const url = new URL(proxyString);
    if (!supported.includes(url.protocol)) {
      return { server: `http://${proxyString}` };
    }
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
    if (/^\d+\.\d+\.\d+\.\d+:\d+/.test(proxyString)) {
      return { server: `http://${proxyString}` };
    }
    return { server: proxyString };
  }
}

const SOUNDS = {
  manualCaptcha: path.join(ROOT, "sounds", "manual-captcha.wav"),
  error: path.join(ROOT, "sounds", "error.wav"),
  success: path.join(ROOT, "sounds", "success.wav"),
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
    timeout = 600000,
    settleAfter = 1500,
    retries = 1,
  } = opts;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil, timeout });
      return;
    } catch (e) {
      const aborted = /ERR_ABORTED/.test(e?.message || "");
      if (!aborted) throw e;
      logger.info(
        `  [nav] redirect aborted (ERR_ABORTED), waiting to settle... (attempt ${attempt}/${retries})`,
        true,
      );
      await page
        .waitForLoadState("domcontentloaded", { timeout })
        .catch(() => {});
      await sleep(settleAfter);
    }
  }
}

async function isRequiredManualCaptcha(page) {
  const verificationCode = await page
    .locator("text=/Enter verification code/i")
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (verificationCode) {
    let solverType = process.env.CAPTCHA_SOLVER_PROVIDER || "manual";
    logger.info(
      `  [INFO] Manual Captcha detected — direct to ${solverType} solve.`,
      true,
    );

    return true;
  }

  return false;
}

async function register() {
  const startTime = Date.now();
  const TOTAL_STEPS = process.env.USE_REFERRAL_CODE === "true" ? 12 : 11;
  enableStepKeypress();
  if (process.env.USE_PROXY === "true") {
    CONFIG.proxy = await getRandomProxy();
  }

  logger.info(`[1/${TOTAL_STEPS}] Launching browser...`, true);
  const launchOpts = {
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-popup-blocking",
      "--start-minimized",
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
    logger.info(
      `  Using proxy: ${CONFIG.proxy.includes("@") ? CONFIG.proxy.split("@").pop() : CONFIG.proxy} (Country: ${SELECTED_COUNTRY || "N/A"})`,
      true,
    );
  }
  const browser = await chromium.launch(launchOpts);
  const profile = getCountryProfile(SELECTED_COUNTRY);
  logger.info(
    `  [fingerprint] Country: ${SELECTED_COUNTRY || "N/A"} → locale=${profile.locale}, tz=${profile.timezone}, platform=${profile.platform}`,
    true,
  );

  const contextOpts = {
    ignoreHTTPSErrors: true,
    userAgent: profile.ua,
    viewport: {
      width: profile.platform === "macOS" ? 1440 : 1366,
      height: profile.platform === "macOS" ? 900 : 768,
    },
    locale: profile.locale,
    timezoneId: profile.timezone,
    colorScheme: "light",
    isMobile: false,
    hasTouch: false,
    extraHTTPHeaders: {
      "Accept-Language": `${profile.locale},en;q=0.9`,
    },
  };
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  try {
    // Step 1: Create temp email
    logger.info(`[2/${TOTAL_STEPS}] Creating temporary email...`, true);
    const tempmail = new TempMail();
    const inbox = await tempmail.createInbox();
    const email = inbox.address;
    logger.info(`  Email: ${email}`, true);

    // Step 2: Navigate to landing page → click Sign Up → redirect to registration
    logger.info(`[3/${TOTAL_STEPS}] Opening landing page...`, true);
    logger.info(`  Landing URL: ${CONFIG.landingUrl}`, true);
    await gotoTolerant(page, CONFIG.landingUrl);
    logger.info("  Waiting for cookie...", true);
    await handleCookies(page);
    await sleep(rand(2000, 3000));
    logger.info(`  Register URL: ${CONFIG.registerUrl}`, true);
    await gotoTolerant(page, CONFIG.registerUrl, { retries: 3 });

    // Wait for Xiaomi registration page to load
    await page
      .waitForURL(/account\.xiaomi\.com/, { timeout: 600000 })
      .catch(() => {});
    await sleep(rand(2000, 3000));
    await handleCookies(page);

    // Step 3: Select region (skipped - auto-detected from _uRegion param)
    logger.info(
      `[4/${TOTAL_STEPS}] Region auto-detected (via URL param), skipping manual selection...`,
      true,
    );
    logger.info(`[4/${TOTAL_STEPS}] Region auto-detected`);

    // Step 4: Fill email
    logger.info(`[5/${TOTAL_STEPS}] Filling registration form...`, true);
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
    const termsCheckbox = page
      .locator('.mi-accept-terms input[type="checkbox"]')
      .first();
    if (await termsCheckbox.isVisible()) {
      const isChecked = await termsCheckbox.isChecked();
      if (!isChecked) {
        await termsCheckbox.check();
      }
      logger.info("  Terms checkbox: checked", true);
    }

    // Take screenshot for debugging
    // await page.screenshot({ path: 'before_submit.png' });
    logger.info("  Screenshot saved: before_submit.png", true);

    // Step 5: Submit and handle captcha
    logger.info(`[6/${TOTAL_STEPS}] Submitting form`, true);
    await sleep(rand(1500, 4000));
    const submitBtn = page
      .locator(
        'button[type="submit"], button:has-text("Register"), button:has-text("Next"), button:has-text("Create"), a:has-text("Register")',
      )
      .first();
    await submitBtn.click();
    await sleep(rand(5000, 10000));

    // Handle captcha
    if (CONFIG.captchaMode === "audio") {
      logger.info("  Auto-solving captcha with audio (offline, free)...", true);

      // Wait for reCAPTCHA checkbox to load (with retry)
      logger.info("  Waiting for reCAPTCHA to load...", true);
      const recaptchaFrame = page.frameLocator("iframe[title*='reCAPTCHA']");
      const recaptchaCheckbox = recaptchaFrame.locator("#recaptcha-anchor");
      let checkboxClicked = false;
      let captchaHandled = false;
      let requiredManualCaptcha = false;

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          requiredManualCaptcha = await isRequiredManualCaptcha(page);
          if (!requiredManualCaptcha) {
            await recaptchaCheckbox.click({ timeout: 5000 });
          } else {
            captchaHandled = true;
          }

          checkboxClicked = true;

          break;
        } catch (e) {
          if (attempt < 5) {
            logger.info(
              `  Checkbox not ready (attempt ${attempt}/5), retrying.`,
              true,
            );
          } else {
            logger.info("  Checkbox not found after 5 attempts.", true);
          }
        }
      }

      if (captchaHandled) {
        if (process.env.AUTO_SKIP_MANUAL_CAPTCHA === "true") {
          logger.info(
            "  [SKIP] Manual captcha required but AUTO_SKIP_MANUAL_CAPTCHA enabled, aborting...",
            true,
          );
          process.exitCode = 1;
          return;
        }

        let solved = false;
        if (CAPTCHA_SOLVER_PROVIDER === "manual") {
          logger.info(
            "  >>> Please solve the captcha manually in the browser.",
            true,
          );
          logger.info("  >>> Playing manual-captcha sound alert", true);
          await playSound(SOUNDS.manualCaptcha);
          solved = await waitForCaptchaSolved(
            page,
            CONFIG.captchaSolveTimeout,
          );
        } else {
          const customImg = page
            .locator(
              '.mi-captcha-field__image, img[src*="getCode"], img[src*="icodeType"]',
            )
            .first();

          solved = await solveImageCaptcha(customImg, page, {
            retries: 10,
          });
        }

        if (solved) logger.info("  Captcha solved! Continuing...", true);
        else
          logger.info(
            "  [WARN] Captcha solver timeout, proceeding anyway...",
            true,
          );
      } else if (!checkboxClicked) {
        if (process.env.AUTO_SKIP_MANUAL_CAPTCHA === "true") {
          logger.info(
            "  [SKIP] Manual captcha required but AUTO_SKIP_MANUAL_CAPTCHA enabled, aborting...",
            true,
          );
          process.exitCode = 1;
          return;
        }
        logger.info("  [WARN] Could not click reCAPTCHA checkbox.", true);
        logger.info(
          "  >>> Please solve the captcha manually in the browser.",
          true,
        );
        logger.info("  >>> Playing manual-captcha sound alert.", true);
        await playSound(SOUNDS.manualCaptcha);
        const captchaSolved = await waitForCaptchaSolved(
          page,
          CONFIG.captchaSolveTimeout,
        );
        if (captchaSolved) {
          logger.info("  Captcha solved! Continuing...", true);
        } else {
          logger.info(
            "  [WARN] Captcha detection timeout, proceeding anyway...",
            true,
          );
        }
      } else {
        try {
          process.env.VERBOSE = "1";
          logger.info("  Solving reCAPTCHA via audio...", true);
          await solveRecaptchaAudio(page, {
            wait: 5000,
            retry: 5,
            ffmpeg: ffmpegPath,
          });
          logger.info("  reCAPTCHA solved via audio!", true);

          // Check for Xiaomi custom 2nd captcha (text/image)
          logger.info(
            "  Waiting for next step (custom captcha modal or OTP screen)...",
            true,
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
            if (
              await otpInput.isVisible({ timeout: 60000 }).catch(() => false)
            ) {
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
            logger.info(
              "  >>> XIAOMI CUSTOM CAPTCHA DETECTED — solving...",
              true,
            );

            if (CAPTCHA_SOLVER_PROVIDER !== "manual") {
              const solved = await solveImageCaptcha(customImg, page, {
                retries: 10,
              });

              if (solved) {
                logger.info("  Custom captcha solved!", true);
              } else if (
                !HEADLESS &&
                process.env.AUTO_SKIP_MANUAL_CAPTCHA !== "true"
              ) {
                logger.info(
                  "  Local solver failed. Waiting for manual captcha solving...",
                  true,
                );
                logger.info("  >>>Playing manual-captcha sound alert", true);
                await playSound(SOUNDS.manualCaptcha);
                await waitForCaptchaSolved(page, CONFIG.captchaSolveTimeout);
              } else {
                logger.info(
                  "  [SKIP] Captcha Solver failed, aborting...",
                  true,
                );
                process.exitCode = 1;
                return;
              }
            } else {
              logger.info("  >>> Playing manual-captcha sound alert!", true);
              await playSound(SOUNDS.manualCaptcha);
              const manualSolved = await waitForCaptchaSolved(
                page,
                CONFIG.captchaSolveTimeout,
              );

              if (!manualSolved) {
                logger.info("  Timeout, closing browser", true);
                await browser.close();
                process.exit(1);
              } else {
                logger.info("  >>> Manual captcha solved, continuing...", true);
              }
            }
          } else if (otpVisible) {
            logger.info(
              "  Directly advanced to OTP screen, no custom captcha needed.",
              true,
            );
          } else {
            logger.info(
              "  [WARN] Neither custom captcha nor OTP screen detected after 15s.",
              true,
            );
          }
        } catch (e) {
          // detect if Google already flagged this network/IP
          try {
            let isBlocked = false;
            for (const frame of page.frames()) {
              const count = await frame
                .locator(".rc-doscaptcha-body-text, .rc-doscaptcha-header-text")
                .count();

              if (count > 0) {
                isBlocked = true;
                break;
              }
            }
            if (isBlocked) {
              logger.info(
                "  >>> Google blocked this IP/network ('automated queries').",
                true,
              );
              if (CONFIG.proxy) {
                addToBlacklist(
                  CONFIG.proxy,
                  "automated_queries",
                  CONFIG.blacklistDuration,
                );
              }
              logger.info(
                "  >>> Auto audio solve will NOT work — IP is rate-limited.",
                true,
              );

              if (process.env.AUTO_SKIP_RATE_LIMIT === "true") {
                logger.info(
                  "  >>> AUTO_SKIP_RATE_LIMIT=true — aborting run, loop will skip.",
                  true,
                );
                process.exitCode = 1;
                return;
              }
            }
          } catch (_) {}

          logger.info(
            `  Audio solver failed: ${e.message}. Falling back to manual solve...`,
            true,
          );
          if (process.env.AUTO_SKIP_MANUAL_CAPTCHA === "true") {
            logger.info(
              "  [SKIP] Audio solver failed and AUTO_SKIP_MANUAL_CAPTCHA enabled, aborting...",
              true,
            );
            process.exitCode = 1;
            return;
          }
          logger.info("  >>>Playing manual-captcha sound alert", true);
          await playSound(SOUNDS.manualCaptcha);
          await waitForCaptchaSolved(page, CONFIG.captchaSolveTimeout);
        }
      }
    } else if (CONFIG.captchaMode === "2captcha" && CONFIG.captchaApiKey) {
      logger.info("  Auto-solving captcha with 2captcha...", true);
      await solveRecaptchaWith2captcha(page, CONFIG.captchaApiKey);
    } else {
      if (process.env.AUTO_SKIP_MANUAL_CAPTCHA === "true") {
        logger.info(
          "  [SKIP] Manual captcha mode but AUTO_SKIP_MANUAL_CAPTCHA enabled, aborting...",
          true,
        );
        process.exitCode = 1;
        return;
      }
      logger.info(
        "  >>> CAPTCHA: Please solve the captcha manually in the browser.",
        true,
      );
      logger.info("  >>>Playing manual-captcha sound alert.", true);
      logger.info("  >>> Auto-detecting when solved...", true);
      const captchaSolved = await waitForCaptchaSolved(
        page,
        CONFIG.captchaSolveTimeout,
      );
      if (captchaSolved) {
        logger.info("  Captcha solved! Continuing...", true);
      } else {
        logger.info(
          "  [WARN] Captcha detection timeout, proceeding anyway...",
          true,
        );
      }
    }

    // Step 7: Wait for OTP email
    logger.info(`[7/${TOTAL_STEPS}] Waiting for OTP email...`, true);
    const otp = await tempmail.waitForOtp(email, CONFIG.otpTimeout, 3000);

    if (!otp) {
      logger.info("  >>> Playing error sound alert", true);
      await playSound(SOUNDS.error);
      logger.info(
        "  TIMEOUT: No OTP received. aborting run, loop will skip.",
        true,
      );
      logger.error("TIMEOUT: No OTP received. aborting run, loop will skip.");

      process.exitCode = 1;
      return;
    }

    logger.info(`  OTP received: ${otp}`, true);

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
    logger.info(
      `[8/${TOTAL_STEPS}] Waiting for OAuth redirect to platform console...`,
      true,
    );
    logger.info(`[8/${TOTAL_STEPS}] Waiting for OAuth redirect...`);
    await page
      .waitForURL(/platform\.xiaomimimo\.com\/console/, { timeout: 30000 })
      .catch(async () => {
        logger.info("  Redirect not detected, navigating manually...", true);
        await page.goto(CONFIG.consoleUrl, {
          waitUntil: "domcontentloaded",
          timeout: CONFIG.navigateTimeout,
        });
      });

    // Step 9: Handle terms & agreements (appears after redirect)
    logger.info(`[9/${TOTAL_STEPS}] Checking terms & agreements...`, true);
    await handleTermsAgreement(page);

    await handleCookies(page);
    await sleep(2000);

    // await page.screenshot({ path: 'registered.png' });
    logger.info("  Landed on platform console", true);

    // Step 10: Create API Key
    logger.info(`[10/${TOTAL_STEPS}] Creating API Key...`, true);

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
        logger.info(`  Found nav link via: ${selector}`, true);
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
            timeout: 600000,
          });
          await handleCookies(page);
          await sleep(1500);
          foundApiPage = true;
          logger.info(`  Navigated to: ${url}`, true);
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
      logger.info("  Create API Key dialog opened", true);
    } else {
      logger.info("  [WARN] Create button not found", true);
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
      logger.info(`  API Key name: ${CONFIG.apiKeyName}`, true);
      await sleep(500);
    } else {
      logger.info("  [WARN] Name input not found", true);
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
      logger.info("  API Key creation confirmed", true);
    }
    // await page.screenshot({ path: 'api_key_created.png' });

    // Step 10: Extract and save the API key
    logger.info(`[11/${TOTAL_STEPS}] Extracting API Key...`, true);
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

    // Validate API key format (sk-*) to prevent clipboard paste bugs
    if (apiKey && !apiKey.startsWith("sk-")) {
      logger.info(
        `  [WARN] Key format invalid (not sk-*): "${apiKey.substring(0, 20)}..."`,
        true,
      );
      logger.info(
        "  [WARN] Creating new API key to replace invalid one...",
        true,
      );
      apiKey = "";
    }

    // If key is missing or invalid, retry extraction
    if (!apiKey || apiKey === "-") {
      logger.info(
        "  [WARN] Valid API key not found, attempting to create new one...",
        true,
      );
      // Re-navigate to API key page and create
      for (const p of ["/apikey", "/developer/apikey", "/developer"]) {
        try {
          await page.goto(CONFIG.consoleUrl + p, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await sleep(2000);
          break;
        } catch (_) {}
      }
      // Try create button
      const retryCreateBtn = page
        .locator('button:has-text("Create API Key"), button:has-text("Create")')
        .first();
      if (
        await retryCreateBtn.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await retryCreateBtn.click();
        await sleep(1500);
        const retryNameInput = page
          .locator(
            'input[placeholder*="name" i], input[placeholder*="Name" i], input[type="text"]',
          )
          .first();
        if (
          await retryNameInput.isVisible({ timeout: 3000 }).catch(() => false)
        ) {
          await retryNameInput.fill("");
          await retryNameInput.fill(CONFIG.apiKeyName);
          await sleep(500);
        }
        const retryConfirm = page
          .locator(
            'button:has-text("Confirm"), button:has-text("OK"), button:has-text("Create")',
          )
          .first();
        if (
          await retryConfirm.isVisible({ timeout: 3000 }).catch(() => false)
        ) {
          await retryConfirm.click();
          await sleep(3000);
        }
      }
      // Re-extract key
      for (const selector of keySelectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
          const text = await el.textContent().catch(() => "");
          if (
            text &&
            text.trim().length > 10 &&
            text.trim().startsWith("sk-")
          ) {
            apiKey = text.trim();
            break;
          }
        }
      }
      if (!apiKey || !apiKey.startsWith("sk-")) {
        logger.info("  [WARN] Could not get valid sk-* key after retry.", true);
        apiKey = apiKey || "-";
      }
    }

    if (apiKey !== "-") {
      // Save to CSV
      const csvHeaders = "timestamp,email,password,api_key_name,api_key";
      const csvRow = [
        new Date().toISOString(),
        email,
        CONFIG.password,
        CONFIG.apiKeyName,
        apiKey,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");

      const csvPath = CONFIG.outputFile;
      const exists = fs.existsSync(csvPath);
      if (!exists) {
        fs.writeFileSync(csvPath, csvHeaders + "\n", "utf8");
      }
      fs.appendFileSync(csvPath, csvRow + "\n", "utf8");
      logger.info(`  Saved to: ${csvPath}`, true);

      saveWorkingProxy(SELECTED_PROXY, SELECTED_COUNTRY);

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
          logger.info("  API Key modal closed", true);
        }
      } catch (e) {
        logger.info(
          `  [WARN] Failed to close API Key modal: ${e.message}`,
          true,
        );
      }

      // Step 12: Redeem invite code (if configured)
      if (
        process.env.USE_REFERRAL_CODE === "true" &&
        process.env.REFERRAL_CODE
      ) {
        logger.info("[12/12] Redeeming invite code...", true);
        try {
          const inviteBtn = page
            .locator('button:has-text("Enter invite code")')
            .first();
          if (
            !(await inviteBtn.isVisible({ timeout: 10000 }).catch(() => false))
          ) {
            logger.info(
              "  [INFO] 'Enter invite code' button not visible, skipping.",
              true,
            );
          } else {
            await inviteBtn.click();
            logger.info("  Invite code modal opened", true);
            await sleep(rand(1500, 3000));

            const otpCodeInputs = page.locator(
              'input[aria-label^="OTP Input"]',
            );
            const code = process.env.REFERRAL_CODE;
            for (let i = 0; i < code.length && i < 6; i++) {
              await otpCodeInputs.nth(i).fill(code[i]);
              await sleep(rand(200, 500));
            }
            await sleep(rand(1000, 2000));

            const redeemBtn = page.locator('button:has-text("Redeem")').first();
            if (
              await redeemBtn.isVisible({ timeout: 10000 }).catch(() => false)
            ) {
              await redeemBtn.click();
              logger.info(`  Invite code submitted: ${code}`, true);
              await sleep(rand(3000, 5000));

              const riskError = await page
                .locator("text=/risk control|restrictions|contact customer/i")
                .first()
                .isVisible({ timeout: 3000 })
                .catch(() => false);

              if (riskError) {
                logger.info(
                  "  [WARN] Risk control detected, skipping referral.",
                  true,
                );
              } else {
                logger.info("  Invite code redeemed successfully", true);
              }
            } else {
              logger.info("  [WARN] Redeem button not found", true);
            }
          }
        } catch (e) {
          logger.info(`  Invite code redemption failed: ${e.message}`, true);
        }
      }

      logger.info("  >>> Playing success sound alert", true);
      await playSound(SOUNDS.success);

      // Auto extract keys to omniroute.txt
      try {
        const extractResult = extractKeys(
          path.join(ROOT, "keys", "keys.csv"),
          path.join(ROOT, "keys", "omniroute.txt"),
        );
        if (extractResult.added > 0) {
          logger.info(
            `  [extract] ${extractResult.added} new key(s) added to omniroute.txt`,
            true,
          );
        }
      } catch (e) {
        logger.info(`  [extract] Failed: ${e.message}`, true);
      }
    }

    logger.info("\n========================================", true);
    logger.info("  REGISTRATION SUMMARY", true);
    logger.info("========================================", true);
    logger.info(`  Email:      ${email}`, true);
    logger.info(`  Password:   ${CONFIG.password}`, true);
    logger.info(`  API Key:    ${apiKey || "check api_key_created.png"}`, true);
    logger.info(`  Saved to:   ${CONFIG.outputFile}`, true);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    logger.info(`  Runtime:    ${mins}m ${secs}s`, true);
    logger.info("========================================\n", true);
    logger.info("Browser will close in 30 seconds...", true);
    await sleep(5000);
  } catch (err) {
    logger.error(`ERROR: ${err.message}`, true);
    logger.error(`Registration failed: ${err.message}`);
    process.exitCode = 1;
    const proxyErrors =
      /ERR_TIMED_OUT|ERR_CONNECTION_REFUSED|ERR_PROXY|ERR_TUNNEL|ERR_CERT|ECONNREFUSED|ECONNRESET|ETIMEDOUT/;
    if (proxyErrors.test(err.message)) {
      logger.info(
        "  [proxy] Proxy error detected, skipping to next proxy...",
        true,
      );
      logger.warn("Proxy error detected, skipping to next proxy...");
      if (
        process.env.USE_PROXY === "true" &&
        process.env.USE_PROXY_CSV === "true" &&
        SELECTED_PROXY
      ) {
        try {
          const csvPath = path.join(ROOT, "proxies", "rechecked.csv");
          if (fs.existsSync(csvPath)) {
            const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
            const filtered = lines.filter(
              (line) => !line.includes(SELECTED_PROXY),
            );
            fs.writeFileSync(csvPath, filtered.join("\n") + "\n", "utf8");
            logger.info(`  [proxy] Removed ${SELECTED_PROXY} from CSV`, true);
          }
        } catch (csvErr) {
          logger.info(
            `  [proxy] Failed to remove proxy from CSV: ${csvErr.message}`,
            true,
          );
        }
      }
      await sleep(1000);
    } else {
      logger.info("  >>> Playing error sound alert", true);
      await playSound(SOUNDS.error);
      logger.info("Error screenshot saved: error.png", true);
      await sleep(10000);
    }
  } finally {
    disableStepKeypress();
    await browser.close();
  }
}

// CLI
if (require.main === module) {
  register().catch((err) => logger.error(err.message, true));
}

module.exports = { register, CONFIG };
