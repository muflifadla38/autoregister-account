const fs = require("fs");
const net = require("net");
const tls = require("tls");
const https = require("https");
const path = require("path");
const readline = require("readline");

const PROXIES_DIR = path.join(__dirname, "..", "proxies");
const KEYS_DIR = path.join(__dirname, "..", "keys");

const TARGETS = [
  { host: "platform.xiaomimimo.com", port: 443 },
  { host: "account.xiaomi.com", port: 443 },
  { host: "global.account.xiaomi.com", port: 443 },
];

const API_URL =
  "https://hproxy.com/api/proxy-list?format=csv&recent=true&protocol=http,https";

const DEFAULTS = { timeout: 10000, concurrency: 50, roundDelay: 10000 };

function ensureProtocol(proxyUrl) {
  if (/^(http|https|socks4|socks5):\/\//i.test(proxyUrl)) return proxyUrl;
  return "http://" + proxyUrl;
}

function parseProxyUrl(proxyUrl) {
  try {
    const u = new URL(ensureProtocol(proxyUrl));
    return {
      protocol: u.protocol.replace(":", "").toLowerCase(),
      host: u.hostname,
      port: parseInt(u.port, 10) || 80,
    };
  } catch {
    return null;
  }
}

function testHttpConnect(proxyHost, proxyPort, targetHost, targetPort, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    let timer, settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, ms: Date.now() - start });
    };
    const sock = net.connect(proxyPort, proxyHost, () => {
      sock.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`,
      );
    });
    let data = "";
    sock.on("data", (chunk) => {
      data += chunk.toString();
      if (data.includes("\r\n\r\n")) {
        if (!/HTTP\/1\.[01] 200/.test(data)) {
          sock.destroy();
          return done(false);
        }
        const tlsSock = tls.connect(
          {
            host: targetHost,
            port: targetPort,
            socket: sock,
            servername: targetHost,
            timeout,
          },
          () => {
            tlsSock.destroy();
            done(true);
          },
        );
        tlsSock.on("error", () => {
          sock.destroy();
          done(false);
        });
        tlsSock.on("timeout", () => {
          tlsSock.destroy();
          done(false);
        });
      }
    });
    timer = setTimeout(() => {
      sock.destroy();
      done(false);
    }, timeout);
    sock.on("error", () => {
      sock.destroy();
      done(false);
    });
    sock.on("close", () => done(false));
  });
}

function testSocks5(proxyHost, proxyPort, targetHost, targetPort, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    let timer, settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, ms: Date.now() - start });
    };
    let step = 0;
    const sock = net.connect(proxyPort, proxyHost, () => {
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    sock.on("data", (chunk) => {
      if (step === 0) {
        if (chunk.length >= 2 && chunk[0] === 0x05 && chunk[1] === 0x00) {
          step = 1;
          const hostBuf = Buffer.from(targetHost);
          const buf = Buffer.alloc(7 + hostBuf.length);
          buf[0] = 0x05;
          buf[1] = 0x01;
          buf[2] = 0x00;
          buf[3] = 0x03;
          buf[4] = hostBuf.length;
          hostBuf.copy(buf, 5);
          buf.writeUInt16BE(targetPort, 5 + hostBuf.length);
          sock.write(buf);
        } else {
          sock.destroy();
          done(false);
        }
      } else if (step === 1) {
        if (chunk.length >= 2 && chunk[0] === 0x05 && chunk[1] === 0x00) {
          const tlsSock = tls.connect(
            {
              host: targetHost,
              port: targetPort,
              socket: sock,
              servername: targetHost,
              timeout,
            },
            () => {
              tlsSock.destroy();
              done(true);
            },
          );
          tlsSock.on("error", () => {
            sock.destroy();
            done(false);
          });
          tlsSock.on("timeout", () => {
            tlsSock.destroy();
            done(false);
          });
        } else {
          sock.destroy();
          done(false);
        }
      }
    });
    timer = setTimeout(() => {
      sock.destroy();
      done(false);
    }, timeout);
    sock.on("error", () => {
      sock.destroy();
      done(false);
    });
    sock.on("close", () => done(false));
  });
}

function testSocks4(proxyHost, proxyPort, targetHost, targetPort, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    let timer, settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, ms: Date.now() - start });
    };
    const sock = net.connect(proxyPort, proxyHost, () => {
      const hostBuf = Buffer.from(targetHost);
      const buf = Buffer.alloc(9 + hostBuf.length + 1);
      buf[0] = 0x04;
      buf[1] = 0x01;
      buf.writeUInt16BE(targetPort, 2);
      buf[4] = 0x00;
      buf[5] = 0x00;
      buf[6] = 0x00;
      buf[7] = 0x01;
      buf[8] = 0x00;
      hostBuf.copy(buf, 9);
      buf[9 + hostBuf.length] = 0x00;
      sock.write(buf);
    });
    sock.on("data", (chunk) => {
      if (chunk.length >= 2 && chunk[0] === 0x00 && chunk[1] === 0x5a) {
        sock.destroy();
        done(true);
      } else {
        sock.destroy();
        done(false);
      }
    });
    timer = setTimeout(() => {
      sock.destroy();
      done(false);
    }, timeout);
    sock.on("error", () => {
      sock.destroy();
      done(false);
    });
    sock.on("close", () => done(false));
  });
}

async function testProxy(proxyUrl, timeout = DEFAULTS.timeout) {
  const parsed = parseProxyUrl(proxyUrl);
  if (!parsed) return { ok: false, ms: 0 };
  const { protocol, host, port } = parsed;
  let totalMs = 0;
  for (const t of TARGETS) {
    let r;
    if (protocol === "socks5") {
      r = await testSocks5(host, port, t.host, t.port, timeout);
    } else if (protocol === "socks4") {
      r = await testSocks4(host, port, t.host, t.port, timeout);
    } else {
      r = await testHttpConnect(host, port, t.host, t.port, timeout);
    }
    totalMs += r.ms;
    if (!r.ok) return { ok: false, ms: totalMs };
  }
  return { ok: true, ms: totalMs };
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
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function cleanFreeProxiesCsv(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8").trim();
  const lines = raw.split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const ipIdx = header.indexOf("ip");
  const portIdx = header.indexOf("port");
  const protoIdx = header.indexOf("protocols");
  if (ipIdx === -1 || portIdx === -1) return [];
  const proxies = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const ip = (cols[ipIdx] || "").trim();
    const port = (cols[portIdx] || "").trim();
    if (!ip || !port) continue;
    let protocol = "http";
    if (protoIdx !== -1 && cols[protoIdx]) {
      const protos = cols[protoIdx].trim().split("|");
      if (protos.length > 0 && protos[0]) protocol = protos[0];
    }
    proxies.push(`${protocol}://${ip}:${port}`);
  }
  return proxies;
}

function loadProxies(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const raw = fs.readFileSync(csvPath, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split("\n");
  const proxies = [];
  for (const line of lines) {
    const p = line.trim();
    if (!p) continue;
    if (
      p.startsWith("http") ||
      p.startsWith("socks") ||
      /^\d+\.\d+\.\d+\.\d+:\d+/.test(p)
    ) {
      proxies.push(ensureProtocol(p));
    }
  }
  return [...new Set(proxies)];
}

function saveProxies(proxies, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const content = proxies.length > 0 ? proxies.join("\n") + "\n" : "";
  fs.writeFileSync(outputPath, content, "utf8");
}

function dedup(csvPath) {
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    return { before: 0, removed: 0, after: 0 };
  }
  const raw = fs.readFileSync(csvPath, "utf8").trim();
  if (!raw) return { before: 0, removed: 0, after: 0 };
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const unique = [...new Set(lines)];
  const removed = lines.length - unique.length;
  saveProxies(unique, csvPath);
  return { before: lines.length, removed, after: unique.length };
}

async function checkOnce(proxies, opts = {}) {
  const { concurrency = DEFAULTS.concurrency, timeout = DEFAULTS.timeout } = opts;
  let aliveCount = 0,
    deadCount = 0;
  const timings = [];
  console.log(`Checking ${proxies.length} proxies (concurrency: ${concurrency})...`);
  console.log(`  Targets: ${TARGETS.map((t) => t.host).join(", ")}`);

  const results = await runBatch(proxies, concurrency, async (proxy, i) => {
    const r = await testProxy(proxy, timeout);
    if (r.ok) {
      aliveCount++;
      timings.push({ proxy, ms: r.ms });
    } else {
      deadCount++;
    }
    if ((i + 1) % 10 === 0 || i === proxies.length - 1) {
      process.stdout.write(
        `  Checked ${i + 1}/${proxies.length} | \x1b[32mAlive: ${aliveCount}\x1b[0m | \x1b[31mDead: ${deadCount}\x1b[0m\r`,
      );
    }
    return r.ok;
  });

  const aliveProxies = proxies.filter((_, i) => results[i]);
  console.log(`\n  Alive: \x1b[32m${aliveCount}\x1b[0m`);
  console.log(`  Dead:  \x1b[31m${deadCount}\x1b[0m`);
  console.log(`  Total: ${proxies.length}`);
  return { alive: aliveCount, dead: deadCount, total: proxies.length, timings, aliveProxies };
}

async function deepClean(proxies, outputPath, opts = {}) {
  const {
    deadTarget = 0,
    concurrency = DEFAULTS.concurrency,
    timeout = DEFAULTS.timeout,
    roundDelay = DEFAULTS.roundDelay,
  } = opts;
  console.log(`\n=== DEEP CLEAN MODE (dead target: ${deadTarget}) ===`);
  const rounds = [];
  let round = 1;
  let current = proxies;

  while (true) {
    console.log(`\n--- Round ${round} ---`);
    const result = await checkOnce(current, { concurrency, timeout });
    rounds.push({ round, dead: result.dead, alive: result.alive, total: result.total });

    if (result.total === 0) {
      console.log("\n  No proxies left. Stopping.");
      saveProxies([], outputPath);
      break;
    }
    if (result.dead <= deadTarget) {
      console.log(`\n  Dead (${result.dead}) <= target (${deadTarget}). Deep clean complete.`);
      if (result.timings.length > 0) {
        result.timings.sort((a, b) => a.ms - b.ms);
        console.log("\n  --- Alive Proxies (sorted by speed) ---");
        for (const t of result.timings) {
          console.log(`    ${t.ms}ms  ${t.proxy}`);
        }
      }
      saveProxies(result.aliveProxies, outputPath);
      console.log(`\nUpdated: ${outputPath}`);
      break;
    }

    saveProxies(result.aliveProxies, outputPath);
    console.log(`  ${result.dead} dead removed. ${result.alive} remaining. Waiting ${Math.round(roundDelay / 1000)}s...`);
    current = result.aliveProxies;
    round++;
    await new Promise((r) => setTimeout(r, roundDelay));
  }

  console.log("\n=========== DEEP CLEAN REPORT ===========");
  console.log(`  Total rounds : ${rounds.length}`);
  console.log(`  Final alive  : ${rounds[rounds.length - 1].alive}`);
  console.log("------------------------------------------");
  for (const r of rounds) {
    console.log(`  Round ${r.round}  |  Dead: ${r.dead}  |  Alive: ${r.alive}  |  Total: ${r.total}`);
  }
  console.log("==========================================\n");
  return rounds;
}

function fetchProxies(apiUrl = API_URL, outputPath) {
  outputPath = outputPath || path.join(PROXIES_DIR, "free.csv");
  return new Promise((resolve, reject) => {
    console.log(`  Fetching proxies from API...`);
    https
      .get(apiUrl, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, data, "utf8");
          const lines = data.trim().split("\n");
          console.log(`  Fetched ${lines.length - 1} proxies → ${outputPath}`);
          resolve(outputPath);
        });
      })
      .on("error", reject);
  });
}

function askMode() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const opts = {};
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--input" && args[i + 1]) opts.input = args[++i];
      else if (a === "--output" && args[i + 1]) opts.output = args[++i];
      else if (a === "--mode" && args[i + 1]) opts.mode = args[++i];
      else if (a === "--dead-target" && args[i + 1]) opts.deadTarget = parseInt(args[++i], 10);
      else if (a === "--fetch") opts.fetch = true;
      else if (a === "--concurrency" && args[i + 1]) opts.concurrency = parseInt(args[++i], 10);
      else if (a === "--timeout" && args[i + 1]) opts.timeout = parseInt(args[++i], 10);
      else if (!a.startsWith("-") && !opts.mode) {
        const m = a.toLowerCase();
        opts.mode = m === "2" || m === "deep" ? "deep" : m === "3" || m === "dedup" ? "dedup" : "normal";
      }
    }
    return Promise.resolve(opts);
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    console.log("\nUsage: node <script> [normal|deep|dedup] [dead_target] [--fetch] [--input path] [--output path]");
    console.log("\nSelect mode:");
    console.log("  1) normal     — single pass, remove dead proxies");
    console.log("  2) deep-clean — loop until dead <= target or 0 proxies left");
    console.log("  3) dedup      — remove duplicates only\n");
    rl.question("Enter 1, 2, or 3: ", (answer) => {
      rl.close();
      const a = answer.trim();
      const mode = a === "2" ? "deep" : a === "3" ? "dedup" : "normal";
      resolve({ mode, deadTarget: 0 });
    });
  });
}

async function run(opts = {}) {
  process.stdout.write("\x1B[2J\x1B[0f");

  if (!opts.mode) {
    const asked = await askMode();
    opts = { ...asked, ...opts };
  }

  const {
    input,
    output,
    mode = "deep",
    deadTarget = 0,
    fetch: shouldFetch = false,
    concurrency = DEFAULTS.concurrency,
    timeout = DEFAULTS.timeout,
    roundDelay = DEFAULTS.roundDelay,
  } = opts;

  if (shouldFetch) {
    await fetchProxies(API_URL, path.join(PROXIES_DIR, "free.csv"));
  }

  if (mode === "dedup") {
    const target = output || input;
    if (!target) {
      console.error("No input/output file specified for dedup.");
      return;
    }
    const result = dedup(target);
    console.log(`  Before: ${result.before}`);
    console.log(`  Duplicates removed: ${result.removed}`);
    console.log(`  After:  ${result.after}`);
    console.log(`Updated: ${target}`);
    return;
  }

  let proxies;
  const inputPath = input || path.join(PROXIES_DIR, "free.csv");
  const outputPath = output || path.join(PROXIES_DIR, "checked.csv");

  if (path.basename(inputPath) === "free.csv") {
    proxies = cleanFreeProxiesCsv(inputPath);
    console.log(`  Cleaned ${proxies.length} proxies from free.csv`);
  } else {
    proxies = loadProxies(inputPath);
  }

  if (proxies.length === 0) {
    console.log("No proxies to check.");
    return;
  }

  if (mode === "normal") {
    const result = await checkOnce(proxies, { concurrency, timeout });
    saveProxies(result.aliveProxies, outputPath);
    console.log(`Updated: ${outputPath}`);
  } else {
    await deepClean(proxies, outputPath, {
      deadTarget,
      concurrency,
      timeout,
      roundDelay,
    });
  }
}

module.exports = {
  ensureProtocol,
  parseProxyUrl,
  testProxy,
  testHttpConnect,
  testSocks5,
  testSocks4,
  runBatch,
  cleanFreeProxiesCsv,
  loadProxies,
  saveProxies,
  dedup,
  checkOnce,
  deepClean,
  fetchProxies,
  askMode,
  run,
  PROXIES_DIR,
  KEYS_DIR,
  TARGETS,
  API_URL,
  DEFAULTS,
};
