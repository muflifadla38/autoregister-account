const fs = require("fs");
const net = require("net");
const path = require("path");

const INPUT_CSV = path.join(__dirname, "proxies_raw.csv");
const OUTPUT_CSV = path.join(__dirname, "proxies_clean.csv");
const TARGET_HOST = "platform.xiaomimimo.com";
const TARGET_PORT = 443;
const TIMEOUT_MS = 10000;
const CONCURRENCY = 50;

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

function loadExistingProxies(csvPath) {
  if (!fs.existsSync(csvPath)) return new Set();
  const content = fs.readFileSync(csvPath, "utf8").trim();
  const lines = content.split("\n");
  if (lines.length < 2) return new Set();
  const header = parseCsvLine(lines[0]);
  const proxyIdx = header.indexOf("proxy");
  if (proxyIdx === -1) return new Set();
  const proxies = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const p = (cols[proxyIdx] || "").trim();
    if (p && (p.startsWith("http") || p.startsWith("socks"))) {
      proxies.add(p);
    }
  }
  return proxies;
}

function testProxy(proxyUrl) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(proxyUrl);
    } catch {
      return resolve({ alive: false, reason: "bad_url" });
    }

    const proxyHost = parsed.hostname;
    const proxyPort = parseInt(parsed.port, 10) || 80;

    let timer;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const sock = net.connect(proxyPort, proxyHost, () => {
      sock.write(
        `CONNECT ${TARGET_HOST}:${TARGET_PORT} HTTP/1.1\r\nHost: ${TARGET_HOST}:${TARGET_PORT}\r\n\r\n`,
      );
    });

    let data = "";
    sock.on("data", (chunk) => {
      data += chunk.toString();
      if (data.includes("\r\n\r\n")) {
        const ok = /HTTP\/1\.[01] 200/.test(data);
        sock.destroy();
        done({ alive: ok, reason: ok ? "ok" : "connect_rejected" });
      }
    });

    timer = setTimeout(() => {
      sock.destroy();
      done({ alive: false, reason: "timeout" });
    }, TIMEOUT_MS);

    sock.on("error", (err) => {
      sock.destroy();
      done({ alive: false, reason: err.code || "error" });
    });
    sock.on("close", () => {
      done({ alive: false, reason: "closed" });
    });
  });
}

async function runBatch(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`File not found: ${INPUT_CSV}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT_CSV, "utf8").trim();
  const lines = raw.split("\n");
  if (lines.length < 2) {
    console.log("CSV has no data rows.");
    return;
  }

  const headerCols = parseCsvLine(lines[0]);
  const proxyIdx = headerCols.indexOf("proxy");
  if (proxyIdx === -1) {
    console.error("'proxy' column not found in CSV header");
    process.exit(1);
  }

  const dataLines = lines.slice(1);
  console.log(
    `Testing ${dataLines.length} proxies via CONNECT to ${TARGET_HOST}:${TARGET_PORT} (concurrency: ${CONCURRENCY})...`,
  );

  let aliveCount = 0;
  let deadRunning = 0;
  const reasonCounts = {};

  const results = await runBatch(dataLines, CONCURRENCY, async (line, i) => {
    const cols = parseCsvLine(line);
    const proxy = (cols[proxyIdx] || "").trim();
    if (!proxy) {
      deadRunning++;
      reasonCounts["empty"] = (reasonCounts["empty"] || 0) + 1;
      return { alive: false, proxy: "(empty)" };
    }

    const result = await testProxy(proxy);
    if (result.alive) aliveCount++;
    else {
      deadRunning++;
      reasonCounts[result.reason] = (reasonCounts[result.reason] || 0) + 1;
    }
    if ((i + 1) % 10 === 0 || i === dataLines.length - 1) {
      process.stdout.write(
        `  Checked ${i + 1}/${dataLines.length} | \x1b[32mAlive: ${aliveCount}\x1b[0m | \x1b[31mDead: ${deadRunning}\x1b[0m\r`,
      );
    }
    return { alive: result.alive, proxy };
  });

  console.log("\n  Dead reasons:", JSON.stringify(reasonCounts, null, 2));

  const existingProxies = loadExistingProxies(OUTPUT_CSV);
  const existingCount = existingProxies.size;

  for (const r of results) {
    if (r.alive && r.proxy && r.proxy !== "(empty)") {
      existingProxies.add(r.proxy);
    }
  }

  const proxyList = [...existingProxies];
  const output =
    "proxy\n" + (proxyList.length > 0 ? proxyList.join("\n") + "\n" : "");
  fs.writeFileSync(OUTPUT_CSV, output, "utf8");

  const newAdded = existingProxies.size - existingCount;
  console.log(`\nResults:`);
  console.log(`  Alive: \x1b[32m${aliveCount}\x1b[0m`);
  console.log(`  Dead:  \x1b[31m${deadRunning}\x1b[0m`);
  console.log(`  Total: ${dataLines.length}`);
  console.log(`  Existing in proxies_clean.csv: ${existingCount}`);
  console.log(`  New added: ${newAdded}`);
  console.log(`  Total in proxies_clean.csv: ${existingProxies.size}`);
  console.log(`Updated: ${OUTPUT_CSV}`);
}

main().catch(console.error);
