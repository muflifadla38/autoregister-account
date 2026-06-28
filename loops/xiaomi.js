// loops/xiaomi.js — Keeps re-running register.js xiaomi with proxy rotation & delays
// Keypress while a run is in progress:
//   s / n  → skip current run (kill child, rotate proxy)
//   d      → skip current step inside register script
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

const ROOT = path.join(__dirname, "..");

cleanExpiredBlacklist();
const PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(",").map((p) => ({
      proxy: p.trim(),
      country: "",
    }))
  : loadProxies(path.join(ROOT, "proxies", "rechecked.csv"));
const available = PROXIES.filter((item) => !isBlacklisted(item.proxy));
console.log(
  `Loaded ${PROXIES.length} proxies (${available.length} available, ${PROXIES.length - available.length} blacklisted).`,
);

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

function getProxyInfo(env) {
  if (env.USE_PROXY) {
    if (available.length === 0) return { proxy: "", country: "" };
    const item = available[count % available.length];
    if (isBlacklisted(item.proxy)) return { proxy: "", country: "" };
    return item;
  }

  return { proxy: null, country: null };
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0) return `${h}h ${min}m ${sec}s`;
  return `${min}m ${sec}s`;
}

function printStatusBar() {
  const elapsed = formatDuration(Date.now() - loopStartTime);
  console.log(`\x1b[48;5;236m\x1b[38;5;15m LOOP │ ✓ ${success}  ✗ ${failed}  ⟳ ${count}  ⏱ ${elapsed} \x1b[0m`);
}

function printReport() {
  const elapsed = formatDuration(Date.now() - loopStartTime);
  console.log("\n=========== FINAL REPORT ===========");
  console.log(`  Successful : ${success}`);
  console.log(`  Failed     : ${failed}`);
  console.log(`  Total runs : ${count}`);
  console.log(`  Runtime    : ${elapsed}`);
  console.log("====================================\n");
}

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
  // Ctrl+C or q
  if (s === "\u0003" || s === "q" || s === "Q") {
    console.log("\n[loop] Stop requested.");
    stopping = true;
    if (!running) {
      disableKeypress();
      printReport();
      process.exit(0);
    }
    if (currentChild) currentChild.kill("SIGINT");
    return;
  }
  // Skip current run
  if (s === "s" || s === "S" || s === "n" || s === "N") {
    if (running && currentChild) {
      console.log("\n[loop] Skip requested — killing current run.");
      currentChild.kill("SIGINT");
    }
    return;
  }
  // Skip current step (forward to child as 'd' keypress)
  if (s === "d" || s === "D") {
    if (running && currentChild) {
      console.log("\n[loop] Step skip requested.");
    }
    return;
  }
  // Remove current proxy from rotation
  if (s === "r" || s === "R") {
    if (currentProxy) {
      const idx = available.findIndex((item) => item.proxy === currentProxy);
      if (idx !== -1) {
        available.splice(idx, 1);
        console.log(`\n[loop] Proxy removed from rotation: ${currentProxy}`);
        console.log(`  ${available.length} proxies remaining.`);
  // Move current proxy to end of rotation
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
    } else {
      console.log("\n[loop] No proxy to remove.");
    }
    return;
  }
  // Ban current proxy (blacklist)
  if (s === "b" || s === "B") {
    if (currentProxy) {
      addToBlacklist(currentProxy, "manual_ban", 60);
      const idx = available.findIndex((item) => item.proxy === currentProxy);
      if (idx !== -1) available.splice(idx, 1);
      console.log(`\n[loop] Proxy banned for 60min: ${currentProxy}`);
      if (running && currentChild) currentChild.kill("SIGINT");
    } else {
      console.log("\n[loop] No proxy to ban.");
    }
    return;
  }
}

function run() {
  count++;
  const { proxy, country } = getProxyInfo(process.env);
  currentProxy = proxy;
  currentCountry = country;
  const proxyLabel = proxy
    ? `proxy: ${proxy.includes("@") ? proxy.split("@").pop() : proxy} (Country: ${country || "N/A"})`
    : "no proxy";
  console.log(`\n=== RUN #${count} (${proxyLabel}) ===\n`);
  console.log("[loop] 's' skip · 'd' skip step · 'r' remove · 'b' ban · 'm' move last · 'q' quit");

  const env = { ...process.env, AUTO_SKIP_RATE_LIMIT: "1" };
  if (proxy) env.PROXY = proxy;
  if (country) env.PROXY_COUNTRY = country;

  running = true;
  enableKeypress();
  currentChild = spawn("node", ["register.js", "xiaomi"], {
    stdio: "inherit",
    cwd: ROOT,
    env,
  });

  currentChild.on("exit", (code, signal) => {
    running = false;
    currentChild = null;
    if (code === 0) {
      success++;
      console.log(`\nRun #${count} completed.`);
    } else {
      failed++;
      console.log(
        `\nRun #${count} stopped (code ${code}${signal ? `, signal ${signal}` : ""}).`,
      );
    }
    printStatusBar();
    if (stopping) {
      disableKeypress();
      printReport();
      process.exit(0);
    }
    const delay = 10000 + Math.floor(Math.random() * 10000);
    console.log(`Waiting ${Math.round(delay / 1000)}s before next run...\n`);
    setTimeout(run, delay);
  });
}

process.on("SIGINT", () => {
  console.log("\nStopped by user.");
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

run();
