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
  ? process.env.PROXIES.split(",").map((p) => ({
      proxy: p.trim(),
      country: "",
    }))
  : loadProxies(path.join(ROOT, "proxies", "rechecked.csv"));
const available = PROXIES.filter((item) => !isBlacklisted(item.proxy));
logger.info(
  `Loaded ${PROXIES.length} proxies (${available.length} available, ${PROXIES.length - available.length} blacklisted).`,
  true,
);

let count = 0;
let success = 0;
let failed = 0;
let googleBlockedCount = 0;
let currentRunBlocked = false;
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
let paused = false;
let logLines = [];

function suspendTree(pid) {
  try {
    const ps = `Get-CimInstance Win32_Process | Where-Object {$_.ParentProcessId -eq ${pid}} | ForEach-Object { Suspend-Process -Id $_.ProcessId 2>$null }; Suspend-Process -Id ${pid} 2>$null`;
    require("child_process").execSync(
      `powershell -NoProfile -Command "${ps}"`,
      { stdio: "ignore" },
    );
  } catch (_) {}
}

function resumeTree(pid) {
  try {
    const ps = `Get-CimInstance Win32_Process | Where-Object {$_.ParentProcessId -eq ${pid}} | ForEach-Object { Resume-Process -Id $_.ProcessId 2>$null }; Resume-Process -Id ${pid} 2>$null`;
    require("child_process").execSync(
      `powershell -NoProfile -Command "${ps}"`,
      { stdio: "ignore" },
    );
  } catch (_) {}
}

// ─── PROXY ──────────────────────────────────────────

function getProxyInfo(env) {
  if (env.PROXY) {
    return { proxy: env.PROXY, country: env.PROXY_COUNTRY || "" };
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
  const rows = process.stdout.rows || 40;
  const elapsed = formatDuration(Date.now() - loopStartTime);
  const runElapsed = runStartTime
    ? formatDuration(Date.now() - runStartTime)
    : "0m 0s";
  const statusColor = paused
    ? "\x1b[35m"
    : runStatus === "RUNNING"
      ? "\x1b[33m"
      : runStatus === "SUCCESS"
        ? "\x1b[32m"
        : "\x1b[31m";
  const displayStatus = paused ? "PAUSED" : runStatus;

  const row1 = rows - 2;
  const row2 = rows - 1;
  const row3 = rows;

  process.stdout.write(
    `\x1b[${row1};1H\x1b[2K` +
      `\x1b[48;5;236m\x1b[38;5;15m LOOP │ ✓ ${success}  ✗ ${failed}  ⟳ ${count}  ⏱ ${elapsed} \x1b[0m` +
      `\x1b[${row2};1H\x1b[2K` +
      `\x1b[36m  Run #${count}\x1b[0m │ ${statusColor}${displayStatus}\x1b[0m │ ⏱ ${runElapsed} │ ${currentStep || "idle"}` +
      `\x1b[${row3};1H\x1b[2K` +
      (lastError ? `\x1b[31m  ${lastError}\x1b[0m` : "") +
      `\x1b[0m`,
  );
}

function renderLogArea() {
  if (!HEADLESS) return;
  const rows = process.stdout.rows || 40;
  const cols = process.stdout.columns || 120;
  const areaHeight = rows - 3;
  if (areaHeight <= 0) return;

  const visible = logLines.slice(-areaHeight);
  const padCount = areaHeight - visible.length;
  let out = "";
  for (let i = 0; i < areaHeight; i++) {
    const row = i + 1;
    out += `\x1b[${row};1H\x1b[2K`;
    if (i >= padCount) {
      const text = visible[i - padCount];
      out += text.length > cols ? text.substring(0, cols) : text;
    }
  }
  process.stdout.write(out + "\x1b[0m");
}

let headlessInterval = null;
function startHeadlessDisplay() {
  if (!HEADLESS) return;
  process.stdout.write("\x1B[2J\x1B[0f"); // clear terminal
  renderHeadlessStatus();
  renderLogArea();
  headlessInterval = setInterval(() => {
    renderHeadlessStatus();
    renderLogArea();
  }, 1000);
}

function stopHeadlessDisplay() {
  if (headlessInterval) {
    clearInterval(headlessInterval);
    headlessInterval = null;
  }
  const rows = process.stdout.rows || 40;
  process.stdout.write(`\x1b[${rows};1H`);
  process.stdout.write("\x1b[0m");
}

// ─── TERMINAL DISPLAY ───────────────────────────────

function printStatusBar() {
  if (HEADLESS) return;
  const elapsed = formatDuration(Date.now() - loopStartTime);
  logger.info(
    `LOOP │ ✓ ${success}  ✗ ${failed}  ⟳ ${count}  ⏱ ${elapsed}`,
    true,
  );
}

function printReport() {
  stopHeadlessDisplay();
  const elapsed = formatDuration(Date.now() - loopStartTime);
  logger.info("=========== FINAL REPORT ===========", true);
  logger.info(`  Successful : ${success}`, true);
  logger.info(`  Failed     : ${failed}`, true);
  logger.info(`  Total runs : ${count}`, true);
  logger.info(`  Runtime    : ${elapsed}`, true);
  logger.info("====================================", true);
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
  } catch (_) {
    return;
  }
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
    logger.info("[loop] Stop requested.", true);
    stopping = true;
    if (!running) {
      disableKeypress();
      printReport();
      process.exit(0);
    }
    if (currentChild) currentChild.kill("SIGINT");
    return;
  }
  if (s === "s" || s === "S" || s === "n" || s === "N") {
    if (running && currentChild) {
      logger.info("[loop] Skip requested — killing current run.", true);
      currentChild.kill("SIGINT");
    }
    return;
  }
  if (s === "d" || s === "D") {
    if (running && currentChild)
      logger.info("[loop] Step skip requested.", true);
    return;
  }
  // Pause / Resume
  if (s === "p" || s === "P") {
    paused = !paused;
    if (paused) {
      logger.info("[loop] PAUSED — process frozen.", true);
      if (running && currentChild) suspendTree(currentChild.pid);
    } else {
      logger.info("[loop] RESUMED.", true);
      if (running && currentChild) resumeTree(currentChild.pid);
    }
    return;
  }
  if (s === "r" || s === "R") {
    if (currentProxy) {
      const idx = available.findIndex((item) => item.proxy === currentProxy);
      if (idx !== -1) {
        available.splice(idx, 1);
        logger.info(
          `[loop] Proxy removed: ${currentProxy} (${available.length} remaining)`,
          true,
        );
      }
    } else {
      logger.info("[loop] No proxy to remove.", true);
    }
    return;
  }
  if (s === "b" || s === "B") {
    if (currentProxy) {
      addToBlacklist(currentProxy, "manual_ban", 60);
      const idx = available.findIndex((item) => item.proxy === currentProxy);
      if (idx !== -1) available.splice(idx, 1);
      logger.info(`[loop] Proxy banned 60min: ${currentProxy}`, true);
      if (running && currentChild) currentChild.kill("SIGINT");
    } else {
      logger.info("[loop] No proxy to ban.", true);
    }
    return;
  }
  if (s === "m" || s === "M") {
    if (currentProxy) {
      const idx = available.findIndex((item) => item.proxy === currentProxy);
      if (idx !== -1 && available.length > 1) {
        const [item] = available.splice(idx, 1);
        available.push(item);
        logger.info(`[loop] Proxy moved to last: ${currentProxy}`, true);
      }
    } else {
      logger.info("[loop] No proxy to move.", true);
    }
    return;
  }
}

// ─── PARSE CHILD OUTPUT (headless) ──────────────────

function parseChildLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const stepMatch = trimmed.match(/\[(\d+\/\d+)\]\s*(.*)/);
  if (stepMatch) {
    currentStep = `[${stepMatch[1]}] ${stepMatch[2].trim()}`;
    runStatus = "RUNNING";
    lastError = "";
    return;
  }
  if (trimmed.includes("ERROR:") || trimmed.includes("[proxy] Proxy error")) {
    lastError = trimmed.substring(0, 80);
    runStatus = "FAILED";
    return;
  }
  if (trimmed.includes("REGISTRATION SUMMARY")) {
    runStatus = "SUCCESS";
    lastError = "";
    return;
  }
  if (trimmed.includes("Playing manual-captcha sound alert")) {
    lastError = "Manual captcha required — skipping";
    runStatus = "FAILED";
    return;
  }
  if (trimmed.includes("TIMEOUT:")) {
    lastError = trimmed.substring(0, 80);
    runStatus = "FAILED";
    return;
  }
  if (trimmed.includes("Google blocked this IP/network")) {
    currentRunBlocked = true;
    return;
  }
}

// ─── RUN ────────────────────────────────────────────

function run() {
  count++;
  const { proxy, country } = getProxyInfo(process.env);

  if (process.env.USE_PROXY === "true" && !proxy) {
    logger.info(
      "[loop] No proxy available. Restarting with npm run auto-xiaomi...",
      true,
    );
    stopHeadlessDisplay();
    disableKeypress();
    const child = spawn("npm", ["run", "auto-xiaomi"], {
      stdio: "inherit",
      cwd: ROOT,
      env: process.env,
      shell: true,
      detached: true,
    });
    child.unref();
    process.exit(0);
  }

  currentProxy = proxy;
  currentCountry = country;
  currentStep = "";
  currentRunBlocked = false;
  runStatus = "RUNNING";
  runStartTime = Date.now();
  lastError = "";
  logLines = [];

  const proxyLabel = proxy
    ? `proxy: ${proxy.includes("@") ? proxy.split("@").pop() : proxy} (Country: ${country || "N/A"})`
    : "no proxy";
  logLines.push(`\x1b[36m=== RUN #${count} (${proxyLabel}) ===\x1b[0m`);

  if (!HEADLESS) {
    logger.info(`\n=== RUN #${count} (${proxyLabel}) ===`, true);
    logger.info(
      "[loop] 's' skip · 'd' step · 'r' remove · 'b' ban · 'm' move · 'p' pause · 'q' quit",
      true,
    );
  }
  logger.info(`RUN #${count} started — ${proxyLabel}`);

  const env = { ...process.env, AUTO_SKIP_RATE_LIMIT: "true" };
  if (proxy) env.PROXY = proxy;
  if (country) env.PROXY_COUNTRY = country;

  running = true;
  enableKeypress();

  if (HEADLESS) {
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
        const trimmed = line.trim();
        if (trimmed) logLines.push(trimmed);
      }
      renderLogArea();
    });
    currentChild.stderr.on("data", (data) => {
      const line = data.toString().trim();
      if (line) {
        parseChildLine(line);
        logLines.push(`\x1b[31m${line}\x1b[0m`);
        renderLogArea();
      }
    });
  } else {
    currentChild = spawn("node", ["register.js", "xiaomi"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: ROOT,
      env,
    });
    let bufNl = "";
    currentChild.stdout.on("data", (data) => {
      process.stdout.write(data);
      bufNl += data.toString();
      const lines = bufNl.split("\n");
      bufNl = lines.pop();
      for (const line of lines) {
        parseChildLine(line);
      }
    });
    currentChild.stderr.on("data", (data) => {
      process.stderr.write(data);
      parseChildLine(data.toString());
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
      googleBlockedCount = 0;
      logger.info(`Run #${count} completed (${runElapsed}).`, true);
    } else {
      failed++;
      runStatus = "FAILED";
      logger.info(
        `Run #${count} stopped (code ${code}${signal ? `, signal ${signal}` : ""}) (${runElapsed}).`,
        true,
      );
    }

    if (currentRunBlocked) {
      googleBlockedCount++;
      logger.info(`[loop] Google blocked count: ${googleBlockedCount}/6`, true);
    }

    if (googleBlockedCount >= 6 && process.env.USE_PROXY !== "true") {
      logger.info(
        "[loop] IP blocked 6x consecutive. Switching to proxy mode and restarting...",
        true,
      );
      stopHeadlessDisplay();
      disableKeypress();
      process.env.USE_PROXY = "true";
      const child = spawn("npm", ["run", "auto-xiaomi"], {
        stdio: "inherit",
        cwd: ROOT,
        env: process.env,
        shell: true,
        detached: true,
      });
      child.unref();
      process.exit(0);
    }

    if (HEADLESS) renderHeadlessStatus();
    else printStatusBar();

    if (stopping) {
      disableKeypress();
      printReport();
      process.exit(0);
    }
    const delay = 30000 + Math.floor(Math.random() * 30000);
    logger.info(
      `Waiting ${Math.round(delay / 1000)}s before next run...`,
      true,
    );
    setTimeout(run, delay);
  });
}

process.on("SIGINT", () => {
  stopHeadlessDisplay();
  logger.info("Stopped by user.", true);
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
  startHeadlessDisplay();
}
run();
