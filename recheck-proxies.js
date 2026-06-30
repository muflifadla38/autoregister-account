const fs = require("fs");
const { run, PROXIES_DIR, parseArgs } = require("./utils/proxy");
const path = require("path");

const args = parseArgs();
const rechecked = path.join(PROXIES_DIR, "rechecked.csv");
const checked = path.join(PROXIES_DIR, "checked.csv");

run({
  fetch: false,
  mode: args.mode || "deep",
  deadTarget: args.deadTarget || 0,
  input: checked,
  output: rechecked,
});
