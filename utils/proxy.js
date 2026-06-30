const fs = require("fs");
const net = require("net");
const tls = require("tls");
const https = require("https");
const http = require("http");
const path = require("path");
const readline = require("readline");

const PROXIES_DIR = path.join(__dirname, "..", "proxies");
const KEYS_DIR = path.join(__dirname, "..", "keys");

const TARGETS = [
  { host: "platform.xiaomimimo.com", port: 443 },
  { host: "account.xiaomi.com", port: 443 },
  { host: "global.account.xiaomi.com", port: 443 },
];

const DEFAULTS = { timeout: 10000, concurrency: 50, roundDelay: 10000 };

// ─── PROVIDERS ────────────────────────────────────────────

const PROVIDERS = {
  hproxy: {
    name: "hproxy",
    url: "https://hproxy.com/api/proxy-list?format=csv&recent=true&protocol=http,https",
    parse(raw) {
      const lines = raw.split("\n");
      if (lines.length < 2) return [];
      const header = lines[0].split(",");
      const ipIdx = header.indexOf("ip");
      const portIdx = header.indexOf("port");
      const protoIdx = header.indexOf("protocols");
      const countryIdx = header.indexOf("country_code");
      const latencyIdx = header.indexOf("latency_ms");
      const lastAliveIdx = header.indexOf("last_alive_at");
      if (ipIdx === -1 || portIdx === -1) return [];
      const items = [];
      const stats = {
        total: 0,
        countries: {},
        latencySum: 0,
        latencyCount: 0,
        oldest: null,
        newest: null,
      };
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
        const country =
          countryIdx !== -1 && cols[countryIdx] ? cols[countryIdx].trim() : "";
        items.push({ proxy: `${protocol}://${ip}:${port}`, country });
        stats.total++;
        if (country)
          stats.countries[country] = (stats.countries[country] || 0) + 1;
        if (latencyIdx !== -1 && cols[latencyIdx]) {
          const lat = parseFloat(cols[latencyIdx].trim());
          if (!isNaN(lat) && lat > 0) {
            stats.latencySum += lat;
            stats.latencyCount++;
          }
        }
        if (lastAliveIdx !== -1 && cols[lastAliveIdx]) {
          const ts = cols[lastAliveIdx].trim();
          if (ts) {
            if (!stats.oldest || ts < stats.oldest) stats.oldest = ts;
            if (!stats.newest || ts > stats.newest) stats.newest = ts;
          }
        }
      }
      printProviderStats(stats);
      return items;
    },
  },
  proxyscrape: {
    name: "proxyscrape",
    url: "https://raw.githubusercontent.com/ProxyScrape/free-proxy-list/refs/heads/main/proxies/all/data.csv",
    parse(raw) {
      const lines = raw.split("\n");
      if (lines.length < 2) return [];
      const header = lines[0].split(",");
      const protoIdx = header.indexOf("protocol");
      const ipIdx = header.indexOf("ip");
      const portIdx = header.indexOf("port");
      const countryIdx = header.indexOf("country_code");
      const latencyIdx = header.indexOf("latency_ms");
      if (ipIdx === -1 || portIdx === -1) return [];
      const items = [];
      const stats = {
        total: 0,
        countries: {},
        latencySum: 0,
        latencyCount: 0,
        oldest: null,
        newest: null,
      };
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const ip = (cols[ipIdx] || "").trim();
        const port = (cols[portIdx] || "").trim();
        if (!ip || !port) continue;
        const protocol =
          protoIdx !== -1 && cols[protoIdx] ? cols[protoIdx].trim() : "http";
        const country =
          countryIdx !== -1 && cols[countryIdx] ? cols[countryIdx].trim() : "";
        items.push({ proxy: `${protocol}://${ip}:${port}`, country });
        stats.total++;
        if (country)
          stats.countries[country] = (stats.countries[country] || 0) + 1;
        if (latencyIdx !== -1 && cols[latencyIdx]) {
          const lat = parseFloat(cols[latencyIdx].trim());
          if (!isNaN(lat) && lat > 0) {
            stats.latencySum += lat;
            stats.latencyCount++;
          }
        }
      }
      printProviderStats(stats);
      return items;
    },
  },
};

const DEFAULT_PROVIDER = "hproxy";

function getProvider(name) {
  const key = (name || DEFAULT_PROVIDER).toLowerCase();
  if (!PROVIDERS[key]) {
    console.error(
      `  [provider] Unknown provider: "${key}". Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
    process.exit(1);
  }
  return PROVIDERS[key];
}

function printProviderStats(stats) {
  const topCountries = Object.entries(stats.countries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([c, n]) => `${c}:${n}`)
    .join(", ");
  const avgLatency =
    stats.latencyCount > 0
      ? Math.round(stats.latencySum / stats.latencyCount)
      : 0;
  console.log(`\n  --- Raw Proxy Data ---`);
  console.log(`  Total proxies  : ${stats.total}`);
  console.log(`  Avg latency    : ${avgLatency}ms`);
  if (stats.oldest)
    console.log(`  Oldest alive   : ${formatIsoToLocal(stats.oldest)}`);
  if (stats.newest)
    console.log(`  Newest alive   : ${formatIsoToLocal(stats.newest)}`);
  if (topCountries) console.log(`  Top countries  : ${topCountries}`);
  console.log(`  Fetched at     : ${formatIndonesianDate(new Date())}`);
  console.log();
}

// ─── NETWORK TESTS ────────────────────────────────────────

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

function testHttpConnect(
  proxyHost,
  proxyPort,
  targetHost,
  targetPort,
  timeout,
) {
  return new Promise((resolve) => {
    const start = Date.now();
    let timer,
      settled = false;
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
    let timer,
      settled = false;
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
    let timer,
      settled = false;
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
    if (protocol === "socks5")
      r = await testSocks5(host, port, t.host, t.port, timeout);
    else if (protocol === "socks4")
      r = await testSocks4(host, port, t.host, t.port, timeout);
    else r = await testHttpConnect(host, port, t.host, t.port, timeout);
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

// ─── DATE FORMATTING ──────────────────────────────────────

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
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatIsoToLocal(isoStr) {
  try {
    return formatIndonesianDate(new Date(isoStr));
  } catch {
    return isoStr;
  }
}

// ─── PROXY FILE OPERATIONS ────────────────────────────────

function loadProxies(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const raw = fs.readFileSync(csvPath, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split("\n");
  const items = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i === 0 && line.startsWith("proxy")) continue;
    const commaIdx = line.indexOf(",");
    let proxy, country;
    if (commaIdx !== -1) {
      proxy = line.substring(0, commaIdx).trim();
      country = line.substring(commaIdx + 1).trim();
    } else {
      proxy = line.trim();
      country = "";
    }
    if (
      proxy &&
      (proxy.startsWith("http") ||
        proxy.startsWith("socks") ||
        /^\d+\.\d+\.\d+\.\d+:\d+/.test(proxy)) &&
      !seen.has(proxy)
    ) {
      seen.add(proxy);
      items.push({ proxy: ensureProtocol(proxy), country });
    }
  }
  return items;
}

function saveProxies(items, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const lines = ["proxy,country"];
  for (const item of items) {
    if (typeof item === "string") lines.push(`${item},`);
    else lines.push(`${item.proxy},${item.country || ""}`);
  }
  fs.writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
}

function dedup(csvPath) {
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    return { before: 0, removed: 0, after: 0 };
  }
  const items = loadProxies(csvPath);
  const before = items.length;
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = typeof item === "string" ? item : item.proxy;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  const removed = before - unique.length;
  saveProxies(unique, csvPath);
  return { before, removed, after: unique.length };
}

// ─── CHECK / DEEP CLEAN ───────────────────────────────────

async function checkOnce(items, opts = {}) {
  const { concurrency = DEFAULTS.concurrency, timeout = DEFAULTS.timeout } =
    opts;
  let aliveCount = 0,
    deadCount = 0;
  const timings = [];
  console.log(
    `Checking ${items.length} proxies (concurrency: ${concurrency})...`,
  );
  console.log(`  Targets: ${TARGETS.map((t) => t.host).join(", ")}`);

  const results = await runBatch(items, concurrency, async (item, i) => {
    const proxyUrl = typeof item === "string" ? item : item.proxy;
    const r = await testProxy(proxyUrl, timeout);
    if (r.ok) {
      aliveCount++;
      timings.push({
        proxy: proxyUrl,
        country: typeof item === "object" ? item.country : "",
        ms: r.ms,
      });
    } else deadCount++;
    if ((i + 1) % 10 === 0 || i === items.length - 1) {
      process.stdout.write(
        `  Checked ${i + 1}/${items.length} | \x1b[32mAlive: ${aliveCount}\x1b[0m | \x1b[31mDead: ${deadCount}\x1b[0m\r`,
      );
    }
    return r.ok;
  });

  const aliveItems = items.filter((_, i) => results[i]);
  console.log(`\n  Alive: \x1b[32m${aliveCount}\x1b[0m`);
  console.log(`  Dead:  \x1b[31m${deadCount}\x1b[0m`);
  console.log(`  Total: ${items.length}`);
  return {
    alive: aliveCount,
    dead: deadCount,
    total: items.length,
    timings,
    aliveItems,
  };
}

async function deepClean(items, outputPath, opts = {}) {
  const {
    deadTarget = 0,
    concurrency = DEFAULTS.concurrency,
    timeout = DEFAULTS.timeout,
    roundDelay = DEFAULTS.roundDelay,
  } = opts;
  console.log(`\n=== DEEP CLEAN MODE (dead target: ${deadTarget}) ===`);
  const rounds = [];
  let round = 1;
  let current = items;

  while (true) {
    console.log(`\n--- Round ${round} ---`);
    const result = await checkOnce(current, { concurrency, timeout });
    rounds.push({
      round,
      dead: result.dead,
      alive: result.alive,
      total: result.total,
    });

    if (result.total === 0) {
      console.log("\n  No proxies left. Stopping.");
      saveProxies([], outputPath);
      break;
    }
    if (result.dead <= deadTarget) {
      console.log(
        `\n  Dead (${result.dead}) <= target (${deadTarget}). Deep clean complete.`,
      );
      if (result.timings.length > 0) {
        result.timings.sort((a, b) => a.ms - b.ms);
        console.log("\n  --- Alive Proxies (sorted by speed) ---");
        for (const t of result.timings)
          console.log(`    ${t.ms}ms  ${t.proxy}  [${t.country || "-"}]`);
      }
      saveProxies(result.aliveItems, outputPath);
      console.log(`\nUpdated: ${outputPath}`);
      break;
    }

    saveProxies(result.aliveItems, outputPath);
    console.log(
      `  ${result.dead} dead removed. ${result.alive} remaining. Waiting ${Math.round(roundDelay / 1000)}s...`,
    );
    current = result.aliveItems;
    round++;
    await new Promise((r) => setTimeout(r, roundDelay));
  }

  console.log("\n=========== DEEP CLEAN REPORT ===========");
  console.log(`  Total rounds : ${rounds.length}`);
  console.log(`  Final alive  : ${rounds[rounds.length - 1].alive}`);
  console.log("------------------------------------------");
  for (const r of rounds)
    console.log(
      `  Round ${r.round}  |  Dead: ${r.dead}  |  Alive: ${r.alive}  |  Total: ${r.total}`,
    );
  console.log("==========================================\n");
  return rounds;
}

// ─── FETCH ────────────────────────────────────────────────

function fetchFromUrl(url) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const mod = url.startsWith("https") ? https : http;
    mod
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ data, elapsed: Date.now() - start }));
      })
      .on("error", reject);
  });
}

async function fetchProxies(providerName, outputPath) {
  const provider = getProvider(providerName);
  outputPath = outputPath || path.join(PROXIES_DIR, "raw.csv");
  console.log(`  Fetching proxies from ${provider.name}...`);
  console.log(`  URL: ${provider.url}`);
  const { data, elapsed } = await fetchFromUrl(provider.url);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, data, "utf8");
  const lines = data.trim().split("\n");
  console.log(
    `  Fetched ${lines.length - 1} rows in ${elapsed}ms → ${outputPath}`,
  );
  const items = provider.parse(data);
  console.log(`  Parsed ${items.length} proxies from ${provider.name}`);
  return items;
}

// ─── CLI ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--input" && args[i + 1]) opts.input = args[++i];
    else if (a === "--output" && args[i + 1]) opts.output = args[++i];
    else if (a === "--mode" && args[i + 1]) opts.mode = args[++i];
    else if (a === "--dead-target" && args[i + 1])
      opts.deadTarget = parseInt(args[++i], 10);
    else if (a === "--fetch") opts.fetch = true;
    else if (a === "--provider" && args[i + 1]) opts.provider = args[++i];
    else if (a === "--concurrency" && args[i + 1])
      opts.concurrency = parseInt(args[++i], 10);
    else if (a === "--timeout" && args[i + 1])
      opts.timeout = parseInt(args[++i], 10);
    else if (!a.startsWith("-") && !opts.mode) {
      const m = a.toLowerCase();
      opts.mode =
        m === "2" || m === "deep"
          ? "deep"
          : m === "3" || m === "dedup"
            ? "dedup"
            : "normal";
    }
  }
  return opts;
}

function askMode() {
  const args = process.argv.slice(2);
  if (args.length > 0) return Promise.resolve(parseArgs());
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    console.log(
      "\nUsage: node <script> [normal|deep|dedup] [--fetch] [--provider hproxy|proxyscrape] [--input path] [--output path]",
    );
    console.log("\nSelect mode:");
    console.log("  1) normal     — single pass, remove dead proxies");
    console.log(
      "  2) deep-clean — loop until dead <= target or 0 proxies left",
    );
    console.log("  3) dedup      — remove duplicates only\n");
    rl.question("Enter 1, 2, or 3: ", (answer) => {
      rl.close();
      const a = answer.trim();
      resolve({
        mode: a === "2" ? "deep" : a === "3" ? "dedup" : "normal",
        deadTarget: 0,
      });
    });
  });
}

// ─── MAIN RUN ─────────────────────────────────────────────

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
    provider = DEFAULT_PROVIDER,
    concurrency = DEFAULTS.concurrency,
    timeout = DEFAULTS.timeout,
    roundDelay = DEFAULTS.roundDelay,
  } = opts;

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
  const inputPath = input || path.join(PROXIES_DIR, "raw.csv");
  const outputPath = output || path.join(PROXIES_DIR, "checked.csv");

  if (shouldFetch) {
    proxies = await fetchProxies(provider, inputPath);
  } else {
    if (path.basename(inputPath) === "raw.csv") {
      const rawContent = fs.readFileSync(inputPath, "utf8");
      const providerObj = getProvider(provider);
      proxies = providerObj.parse(rawContent);
      console.log(
        `  Parsed ${proxies.length} proxies from ${providerObj.name} (${inputPath})`,
      );
    } else {
      proxies = loadProxies(inputPath);
    }
  }

  if (proxies.length === 0) {
    console.log("No proxies to check.");
    return;
  }

  if (mode === "normal") {
    const result = await checkOnce(proxies, { concurrency, timeout });
    saveProxies(result.aliveItems, outputPath);
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

// ─── BLACKLIST ────────────────────────────────────────────

const BLACKLIST_PATH = path.join(PROXIES_DIR, "blacklist.csv");
const BLACKLIST_HEADER = "proxy,timestamp,banned_until,reason";

function loadBlacklist() {
  if (!fs.existsSync(BLACKLIST_PATH)) return [];
  const raw = fs.readFileSync(BLACKLIST_PATH, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split("\n");
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === BLACKLIST_HEADER) continue;
    const cols = line.split(",");
    if (cols.length >= 3)
      entries.push({
        proxy: cols[0].trim(),
        timestamp: cols[1].trim(),
        banned_until: cols[2].trim(),
        reason: (cols[3] || "").trim(),
      });
  }
  return entries;
}

function saveBlacklist(entries) {
  fs.mkdirSync(PROXIES_DIR, { recursive: true });
  const lines = [BLACKLIST_HEADER];
  for (const e of entries)
    lines.push(`${e.proxy},${e.timestamp},${e.banned_until},${e.reason}`);
  fs.writeFileSync(BLACKLIST_PATH, lines.join("\n") + "\n", "utf8");
}

function isBlacklisted(proxy) {
  const now = new Date();
  const entries = loadBlacklist();
  const active = [];
  let found = false;
  for (const e of entries) {
    const until = new Date(e.banned_until);
    if (until > now) {
      active.push(e);
      if (e.proxy === proxy) found = true;
    }
  }
  if (active.length !== entries.length) saveBlacklist(active);
  return found;
}

function addToBlacklist(
  proxy,
  reason = "automated_queries",
  durationMinutes = 10,
) {
  const now = new Date();
  const until = new Date(now.getTime() + durationMinutes * 60000);
  const entries = loadBlacklist();
  const existing = entries.findIndex((e) => e.proxy === proxy);
  if (existing !== -1) {
    entries[existing].timestamp = now.toISOString();
    entries[existing].banned_until = until.toISOString();
    entries[existing].reason = reason;
  } else {
    entries.push({
      proxy,
      timestamp: now.toISOString(),
      banned_until: until.toISOString(),
      reason,
    });
  }
  saveBlacklist(entries);
  console.log(
    `  [blacklist] Proxy blacklisted for ${durationMinutes}min: ${proxy}`,
  );
}

function cleanExpiredBlacklist() {
  const now = new Date();
  const entries = loadBlacklist();
  const before = entries.length;
  const active = entries.filter((e) => new Date(e.banned_until) > now);
  if (active.length !== before) {
    saveBlacklist(active);
    console.log(
      `  [blacklist] Cleaned ${before - active.length} expired entries`,
    );
  }
  return before - active.length;
}

module.exports = {
  ensureProtocol,
  parseProxyUrl,
  testProxy,
  testHttpConnect,
  testSocks5,
  testSocks4,
  runBatch,
  loadProxies,
  saveProxies,
  dedup,
  checkOnce,
  deepClean,
  fetchProxies,
  fetchFromUrl,
  getProvider,
  parseArgs,
  askMode,
  run,
  loadBlacklist,
  saveBlacklist,
  isBlacklisted,
  addToBlacklist,
  cleanExpiredBlacklist,
  formatIndonesianDate,
  formatIsoToLocal,
  printProviderStats,
  PROVIDERS,
  DEFAULT_PROVIDER,
  BLACKLIST_PATH,
  PROXIES_DIR,
  KEYS_DIR,
  TARGETS,
  DEFAULTS,
};
