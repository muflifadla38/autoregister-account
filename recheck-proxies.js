const fs = require("fs");
const { run, PROXIES_DIR } = require("./utils/proxy");
const path = require("path");

const rechecked = path.join(PROXIES_DIR, "rechecked.csv");
const checked = path.join(PROXIES_DIR, "checked.csv");

run({
  fetch: false,
  mode: "deep",
  deadTarget: 0,
  input: fs.existsSync(rechecked) ? rechecked : checked,
  output: rechecked,
});
