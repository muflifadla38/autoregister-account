const fs = require("fs");
const net = require("net");
const path = require("path");
const readline = require("readline");

const CSV_PATH = path.join(__dirname, "proxies_clean.csv");
const TARGET_HOST = "platform.xiaomimimo.com";
const TARGET_PORT = 443;
const TIMEOUT_MS = 10000;
const CONCURRENCY = 50;
const ROUND_DELAY_MS = 10000;

function askMode() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("\nSelect mode:");
    console.log("  1) normal     — single pass, remove dead proxies");
    console.log("  2) deep-clean — loop until 0 dead or 0 proxies left\n");
    rl.question("Enter 1 or 2: ", (answer) => {
      rl.close();
      resolve(answer.trim() === "2" ? "deep" : "normal");
    });
  });
}

function testProxy(proxyUrl) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(proxyUrl);
    } catch {
      return resolve(false);
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
        done(ok);
      }
    });

    timer = setTimeout(() => {
      sock.destroy();
      done(false);
    }, TIMEOUT_MS);

    sock.on("error", () => {
      sock.destroy();
      done(false);
    });
    sock.on("close", () => done(false));
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

async function checkOnce() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`File not found: ${CSV_PATH}`);
    return { alive: 0, dead: 0, total: 0 };
  }

  const raw = fs.readFileSync(CSV_PATH, "utf8").trim();
  const lines = raw.split("\n");
  if (lines.length < 2) {
    console.log("No proxies to check.");
    return { alive: 0, dead: 0, total: 0 };
  }

  const header = lines[0];
  const rawProxies = lines
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
  const proxies = [...new Set(rawProxies)];
  const duplicates = rawProxies.length - proxies.length;
  if (duplicates > 0) {
    console.log(`  Removed ${duplicates} duplicate(s)`);
  }
  console.log(
    `Checking ${proxies.length} proxies via CONNECT to ${TARGET_HOST}:${TARGET_PORT} (concurrency: ${CONCURRENCY})...`,
  );

  let aliveCount = 0;
  let deadCount = 0;

  const results = await runBatch(proxies, CONCURRENCY, async (proxy, i) => {
    const alive = await testProxy(proxy);
    if (alive) aliveCount++;
    else deadCount++;
    if ((i + 1) % 10 === 0 || i === proxies.length - 1) {
      process.stdout.write(
        `  Checked ${i + 1}/${proxies.length} | \x1b[32mAlive: ${aliveCount}\x1b[0m | \x1b[31mDead: ${deadCount}\x1b[0m\r`,
      );
    }
    return alive;
  });

  const aliveProxies = proxies.filter((_, i) => results[i]);
  const output =
    header +
    "\n" +
    (aliveProxies.length > 0 ? aliveProxies.join("\n") + "\n" : "");
  fs.writeFileSync(CSV_PATH, output, "utf8");

  console.log(`\n  Alive: \x1b[32m${aliveCount}\x1b[0m`);
  console.log(`  Dead:  \x1b[31m${deadCount}\x1b[0m`);
  console.log(`  Total: ${proxies.length}`);
  console.log(`Updated: ${CSV_PATH}`);
  return { alive: aliveCount, dead: deadCount, total: proxies.length };
}

async function main() {
  const mode = await askMode();

  if (mode === "normal") {
    await checkOnce();
  } else {
    console.log("\n=== DEEP CLEAN MODE ===");
    const rounds = [];
    let round = 1;
    while (true) {
      console.log(`\n--- Round ${round} ---`);
      const { alive, dead, total } = await checkOnce();
      rounds.push({ round, dead, alive, total });
      if (total === 0) {
        console.log("\n  No proxies left. Stopping.");
        break;
      }
      if (dead === 0) {
        console.log(`\n  All ${alive} proxies alive. Deep clean complete.`);
        break;
      }
      console.log(`  ${dead} dead removed. ${alive} remaining. Waiting ${Math.round(ROUND_DELAY_MS / 1000)}s...`);
      round++;
      await new Promise((r) => setTimeout(r, ROUND_DELAY_MS));
    }

    console.log("\n=========== DEEP CLEAN REPORT ===========");
    console.log(`  Total rounds : ${rounds.length}`);
    console.log(`  Final alive  : ${rounds[rounds.length - 1].alive}`);
    console.log("------------------------------------------");
    for (const r of rounds) {
      console.log(`  Round ${r.round}  |  Dead: ${r.dead}  |  Alive: ${r.alive}  |  Total: ${r.total}`);
    }
    console.log("==========================================\n");
  }
}

main().catch(console.error);
