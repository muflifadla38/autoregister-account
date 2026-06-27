const { run, PROXIES_DIR } = require("./utils/proxy");
const path = require("path");

run({
  fetch: true,
  mode: "deep",
  deadTarget: 0,
  input: path.join(PROXIES_DIR, "free.csv"),
  output: path.join(PROXIES_DIR, "checked.csv"),
});
