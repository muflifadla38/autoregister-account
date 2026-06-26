// loop_xiaomi.js — Keeps re-running register_xiaomi.js with proxy rotation & delays
// Keypress while a run is in progress:
//   s / n  → skip current run (kill child, rotate proxy)
//   q      → stop loop cleanly (print report and exit)
// Ctrl+C also stops cleanly.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

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
    console.log(`[loop] CSV not found: ${csvPath}`);
    return [];
  }
  const content = fs.readFileSync(csvPath, "utf8").trim();
  const lines = content.split("\n");
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const proxyIdx = header.indexOf("proxy");
  if (proxyIdx === -1) {
    console.log("[loop] 'proxy' column not found in CSV header");
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

const PROXIES =
  process.env.USE_PROXY_CSV === "true"
    ? loadProxiesFromCsv(path.join(__dirname, "proxies_clean.csv"))
    : process.env.PROXIES
      ? process.env.PROXIES.split(",").map((p) => p.trim())
      : [];
console.log(
  `Loaded ${PROXIES.length} proxies from ${process.env.USE_PROXY_CSV === "true" ? "proxies_clean.csv" : "environment variable"}.`,
);

let count = 0;
let success = 0;
let failed = 0;
let currentChild = null;
let running = false;
let stopping = false;
let keypressEnabled = false;

function getProxy() {
  if (PROXIES.length === 0) return "";
  return PROXIES[count % PROXIES.length];
}

function printReport() {
  console.log("\n=========== FINAL REPORT ===========");
  console.log(`  Successful : ${success}`);
  console.log(`  Failed     : ${failed}`);
  console.log(`  Total runs : ${count}`);
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
  // Ctrl+C
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
      // Mark as a manual skip; child exit will count as failed and rotate.
      currentChild.kill("SIGINT");
    }
    return;
  }
}

function run() {
  count++;
  const proxy = getProxy();
  console.log(
    `\n=== RUN #${count} ${proxy ? `(proxy: ${proxy.includes("@") ? proxy.split("@").pop() : proxy})` : ""} ===\n`,
  );
  console.log("[loop] Press 's' to skip this run · 'q' to quit");

  const env = { ...process.env, AUTO_SKIP_RATE_LIMIT: "1" };
  if (proxy) env.PROXY = proxy;

  running = true;
  enableKeypress();
  currentChild = spawn("node", ["register_xiaomi.js"], {
    stdio: "inherit",
    cwd: __dirname,
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
