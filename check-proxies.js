const { run, PROXIES_DIR, parseArgs } = require("./utils/proxy");
const path = require("path");

const args = parseArgs();
const provider = args.provider || "hproxy";

run({
  fetch: true,
  provider,
  mode: args.mode || "deep",
  deadTarget: args.deadTarget || 0,
  input: path.join(PROXIES_DIR, "raw.csv"),
  output: path.join(PROXIES_DIR, "checked.csv"),
});
