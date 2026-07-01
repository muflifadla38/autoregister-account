const { spawn } = require("child_process");
const path = require("path");
const { loadEnv } = require("./utils/env.js");
const { logger } = require("./utils/logger.js");
const {
  loadProxies,
  getNextProxy,
  cleanExpiredBlacklist,
} = require("./utils/proxy.js");

loadEnv();
const ROOT = __dirname;

const modes = {
  xiaomi: path.join(__dirname, "loops", "xiaomi.js"),
};

const mode = process.argv[2] || "xiaomi";

if (!modes[mode]) {
  logger.info("Usage: node loop.js [mode]", true);
  logger.info("\nAvailable modes:", true);
  for (const key of Object.keys(modes)) {
    logger.info(`  ${key}${key === "xiaomi" ? " (default)" : ""}`, true);
  }
  process.exit(1);
}

cleanExpiredBlacklist();

const env = { ...process.env };

if (env.USE_PROXY === "true") {
  const proxies = env.PROXIES
    ? env.PROXIES.split(",").map((p) => ({ proxy: p.trim(), country: "" }))
    : loadProxies(path.join(ROOT, "proxies", "rechecked.csv"));

  logger.info(`[loop] Loaded ${proxies.length} proxies`, true);

  const { proxy, country } = getNextProxy(proxies);

  if (proxy) {
    env.PROXY = proxy;
    env.PROXY_COUNTRY = country;
  } else {
    logger.info("[loop] No available proxy.", true);
  }
}

const child = spawn("node", [modes[mode]], {
  stdio: "inherit",
  cwd: __dirname,
  env,
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
