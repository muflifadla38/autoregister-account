const { spawn } = require("child_process");
const path = require("path");

const modes = {
  xiaomi: path.join(__dirname, "loops", "xiaomi.js"),
};

const mode = process.argv[2] || "xiaomi";

if (!modes[mode]) {
  console.log("Usage: node loop.js [mode]");
  console.log("\nAvailable modes:");
  for (const key of Object.keys(modes)) {
    console.log(`  ${key}${key === "xiaomi" ? " (default)" : ""}`);
  }
  process.exit(1);
}

const child = spawn("node", [modes[mode]], {
  stdio: "inherit",
  cwd: __dirname,
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
