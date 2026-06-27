const { spawn } = require("child_process");
const path = require("path");

const modes = {
  xiaomi: path.join(__dirname, "registers", "xiaomi.js"),
  alibaba: path.join(__dirname, "registers", "alibaba.js"),
  qoder: path.join(__dirname, "registers", "qoder.js"),
};

const mode = process.argv[2];

if (!mode || !modes[mode]) {
  console.log("Usage: node register.js <mode>");
  console.log("\nAvailable modes:");
  for (const key of Object.keys(modes)) {
    console.log(`  ${key}`);
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
