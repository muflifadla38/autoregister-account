// loops/xiaomi.js — Keeps re-running register.js xiaomi with proxy rotation & delays
// Keypress while a run is in progress:
//   s / n  → skip current run (kill child, rotate proxy)
//   d      → skip current step inside register script
//   r      → remove current proxy from rotation
//   b      → ban current proxy (blacklist 60min)
//   m      → move current proxy to end of rotation
//   q      → stop loop cleanly (print report and exit)
// Ctrl+C also stops cleanly.
const { spawn } = require("child_process");
const path = require("path");
const {
  isBlacklisted,
  cleanExpiredBlacklist,
  loadProxies,
  addToBlacklist,
} = require("../utils/proxy.js");
const { logger } = require("../utils/logger.js");

const ROOT = path.join(__dirname, "..");
const HEADLESS = process.env.HEADLESS === "true";

cleanExpiredBlacklist();
const PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(",").map((p) => ({ proxy: p.trim(), country: "" }))
  : loadProxies(path.join(ROOT, "proxies", "rechecked.csv"));
const available = PROXIES.filter((item) => !isBlacklisted(item.proxy));
console.log(
  `Loaded ${PROXIES.length} proxies (${available.length} available, ${PROXIES.length - available.length} blacklisted).`,
);
logger.info(`Loaded ${PROXIES.length} proxies (${available.length} available)`);

let count = 0;
let success = 0;
let failed = 0;
let currentChild = null;
let running = false;
let stopping = false;
let keypressEnabled = false;
let loopStartTime = Date.now();
let currentProxy = null;
let currentCountry = null;
let currentStep = "";
let runStartTime = 0;
let runStatus = "IDLE";
let lastError = "";

// ─── PROXY ──────────────────────────────────────────

function getProxyInfo(env) {
  if (env.USE_PROXY === "true") {
    if (available.length === 0) return { proxy: "", country: "" };
    const item = available[count % available.length];
    if (isBlacklisted(item.proxy)) return { proxy: "", country: "" };
    return item;
  }
  return { proxy: null, country: null };
}

// ─── FORMAT ──────────────────────────────────────────

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0) return `${h}h ${min}m ${sec}s`;
  return `${min}m ${sec}s`;
}

// ─── HEADLESS LIVE DISPLAY ──────────────────────────

function renderHeadlessStatus() {
  if (!HEADLESS) return;
  const elapsed = formatDuration(Date.now() - loopStartTime);
  const runElapsed = runStartTime ? formatDuration(Date.now() - runStartTime) : "0m 0s";
  const statusColor = runStatus === "RUNNING" ? "\x1b[33m" : runStatus === "SUCCESS" ? "\x1b[32m" : "\x1b[31m";
  const errLine = lastError ? `\n  \x1b[31m${lastError}\x1b[0m` : "";

  process.stdout.write(
    "\x1b[s" +
    "\x1b[1;1H\x1b[2K" +
    `\x1b[48;5;236m\x1b[38;5;15m LOOP │ ✓ ${success}  ✗ ${failed}  ⟳ ${count}  ⏱ ${elapsed} \x1b[0m` +
    "\x1b[2;1H\x1b[2K" +
    `\x1b[36m  Run #${count}\x1b[0m │ ${statusColor}${runStatus}\x1b[0m │ ⏱ ${runElapsed} │ ${currentStep || "idle"}${errLine}` +
    "\x1b[3;1H\x1b[2K" +
    (lastError ? `\x1b[31m  ${lastError}\x1b[0m` : "") +
    "\x1b[u"
  );
}

let headlessInterval = null;
function startHeadlessDisplay() {
  if (!HEADLESS) return;
  const rows = process.stdout.rows || 40;
  process.stdout.write(`\x1b[4;${rows}r`); // scroll region rows 4-end
  renderHeadlessStatus();
  headlessInterval = setInterval(renderHeadlessStatus, 1000);
}

function stopHeadlessDisplay() {
  if (headlessInterval) {
    clearInterval(headlessInterval);
    headlessInterval = null;
  }
  process.stdout.write("\x1b[r");
}

// ─── TERMINAL DISPLAY ───────────────────────────────

function printStatusBar() {
  if (HEADLESS) return;
  const elapsed = formatDuration(Date.now() - loopStartTime);
  console.log(
    `\x1b[48;5;236m\x1b[38;5;15m LOOP │ ✓ ${success}  ✗ ${failed}  ⟳ ${count}  ⏱ ${elapsed} \x1b[0m`,
  );
}

function printReport() {
  stopHeadlessDisplay();
  const elapsed = formatDuration(Date.now() - loopStartTime);
  console.log("\n=========== FINAL REPORT ===========");
  console.log(`  Successful : ${success}`);
  console.log(`  Failed     : ${failed}`);
  console.log(`  Total runs : ${count}`);
  console.log(`  Runtime    : ${elapsed}`);
  console.log("====================================\n");
  logger.info(`FINAL REPORT: success=${success} failed=${failed} total=${count} runtime=${elapsed}`);
}

// ─── KEYPRESS ───────────────────────────────────────

function enableKeypress() {
  if (keypressEnabled) return;
  if (!process.stdin || !process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    keypressEnabled = true;
  } catch (_) { return; }
  process.stdin.on("data", onKey);
}

function disableKeypress() {
  if (!keypressEnabled) return;
  try {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeListener("data", onKey);
  } catch (_) {}
  keypressEnabled = false;
}

function onKey(chunk) {
  const s = String(chunk);
  if (s === "\u0003" || s === "q" || s === "Q") {
    console.log("\n[loop] Stop requested.");
    logger.info("Stop requested by user");
    stopping = true;
    if (!running) { disableKeypress(); printReport(); process.exit(0); }
    if (currentChild) currentChild.kill("SIGINT");
    return;
  }
  if (s === "s" || s === "S" || s === "n" || s === "N") {
    if (running && currentChild) {
      console.log("\n[loop] Skip requested — killing current run.");
      logger.info(`Skip requested for run #${count}`);
      currentChild.kill("SIGINT");
    }
    return;
  }
  if (s === "d" || s === "D") {
    if (running && currentChild) console.log("\n[loop] Step skip requested.");
    return;
  }
  if (s === "r" || s === "R") {
    if (currentProxy) {
      const idx = available.findIndex((item) => item.proxy === currentProxy);
      if (idx !== -1) {
        available.splice(idx, 1);
        console.log(`\n[loop] Proxy removed: ${currentProxy} (${available.length} remaining)`);
        logger.info(`Proxy removed from rotation: ${currentProxy}`);
      }
    } else {
      console.log("\n[loop] No proxy to remove.");
    }
    return;
  }
  if (s === "b" || s === "B") {
    if (currentProxy) {
      addToBlacklist(currentProxy, "manual_ban", 60);
      const idx = available.findIndex((item) => item.proxy === currentProxy);
      if (idx !== -1) available.splice(idx, 1);
      console.log(`\n[loop] Proxy banned 60min: ${currentProxy}`);
      logger.info(`Proxy banned: ${currentProxy}`);
      if (running && currentChild) currentChild.kill("SIGINT");
    } else {
      console.log("\n[loop] No proxy to ban.");
    }
    return;
  }
  if (s === "m" || s === "M") {
    if (currentProxy) {
      const idx = available.findIndex((item) => item.proxy === currentProxy);
      if (idx !== -1 && available.length > 1) {
        const [item] = available.splice(idx, 1);
        available.push(item);
        console.log(`\n[loop] Proxy moved to last: ${currentProxy}`);
      }
    } else {
      console.log("\n[loop] No proxy to move.");
    }
    return;
  }
}

// ─── PARSE CHILD OUTPUT (headless) ──────────────────

function parseChildLine(line) {
  const stepMatch = line.match(/\[(\d+\/\d+)\]\s*(.*)/);
  if (stepMatch) {
    currentStep = `[${stepMatch[1]}] ${stepMatch[2].trim()}`;
    runStatus = "RUNNING";
    lastError = "";
    return;
  }
  if (line.includes("ERROR:") || line.includes("[proxy] Proxy error")) {
    lastError = line.trim().substring(0, 80);
    runStatus = "FAILED";
  }
  if (line.includes("REGISTRATION SUMMARY")) {
    runStatus = "SUCCESS";
    lastError = "";
  }
  if (line.includes("Playing manual-captcha sound alert")) {
    lastError = "Manual captcha required — skipping";
    runStatus = "FAILED";
  }
  if (line.includes("TIMEOUT:")) {
    lastError = line.trim().substring(0, 80);
    runStatus = "FAILED";
  }
}

// ─── RUN ────────────────────────────────────────────

function run() {
  count++;
  const { proxy, country } = getProxyInfo(process.env);
  currentProxy = proxy;
  currentCountry = country;
  currentStep = "";
  runStatus = "RUNNING";
  runStartTime = Date.now();
  lastError = "";

  const proxyLabel = proxy
    ? `proxy: ${proxy.includes("@") ? proxy.split("@").pop() : proxy} (Country: ${country || "N/A"})`
    : "no proxy";

  if (!HEADLESS) {
    console.log(`\n=== RUN #${count} (${proxyLabel}) ===\n`);
    console.log("[loop] 's' skip · 'd' skip step · 'r' remove · 'b' ban · 'm' move last · 'q' quit");
  }
  logger.info(`RUN #${count} started — ${proxyLabel}`);

  const env = { ...process.env, AUTO_SKIP_RATE_LIMIT: "true" };
  if (proxy) env.PROXY = proxy;
  if (country) env.PROXY_COUNTRY = country;

  running = true;
  enableKeypress();

  if (HEADLESS) {
    // Capture output for parsing, don't show in terminal
    currentChild = spawn("node", ["register.js", "xiaomi"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: ROOT,
      env,
    });
    let buf = "";
    currentChild.stdout.on("data", (data) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        parseChildLine(line);
        logger.info(line.trim());
      }
    });
    currentChild.stderr.on("data", (data) => {
      const line = data.toString().trim();
      if (line) {
        parseChildLine(line);
        logger.error(line);
      }
    });
  } else {
    currentChild = spawn("node", ["register.js", "xiaomi"], {
      stdio: "inherit",
      cwd: ROOT,
      env,
    });
  }

  currentChild.on("exit", (code, signal) => {
    running = false;
    currentChild = null;
    const runElapsed = formatDuration(Date.now() - runStartTime);

    if (code === 0) {
      success++;
      runStatus = "SUCCESS";
      lastError = "";
      if (!HEADLESS) console.log(`\nRun #${count} completed (${runElapsed}).`);
      logger.info(`Run #${count} completed (${runElapsed})`);
    } else {
      failed++;
      runStatus = "FAILED";
      if (!HEADLESS) {
        console.log(`\nRun #${count} stopped (code ${code}${signal ? `, signal ${signal}` : ""}) (${runElapsed}).`);
      }
      logger.info(`Run #${count} stopped (code ${code}) (${runElapsed})`);
    }

    if (HEADLESS) renderHeadlessStatus();
    else printStatusBar();

    if (stopping) {
      disableKeypress();
      printReport();
      process.exit(0);
    }
    const delay = 10000 + Math.floor(Math.random() * 10000);
    if (!HEADLESS) console.log(`Waiting ${Math.round(delay / 1000)}s before next run...\n`);
    logger.info(`Waiting ${Math.round(delay / 1000)}s before next run`);
    setTimeout(run, delay);
  });
}

process.on("SIGINT", () => {
  console.log("\nStopped by user.");
  logger.info("Stopped by user (SIGINT)");
  stopping = true;
  if (!running) {
    disableKeypress();
    printReport();
    process.exit(0);
  }
  setTimeout(() => {
    if (currentChild) currentChild.kill("SIGKILL");
  }, 3000);
});

process.on("exit", stopHeadlessDisplay);

if (HEADLESS) {
  console.log("\x1B[2J\x1B[0f"); // clear terminal
  startHeadlessDisplay();
}
run();
