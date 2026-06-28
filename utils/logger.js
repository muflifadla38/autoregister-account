const fs = require("fs");
const path = require("path");

const LOGS_DIR = path.join(__dirname, "..", "logs");
const HEADLESS = process.env.HEADLESS === "true";

function getDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getTimeStr() {
  const d = new Date();
  return `${d.getFullYear()}-${getDateStr().slice(5)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function getLogPath() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  return path.join(LOGS_DIR, `${getDateStr()}.log`);
}

function formatMsg(level, msg) {
  return `[${getTimeStr()}] [${level}] ${msg}`;
}

function appendLog(level, msg) {
  const line = formatMsg(level, msg) + "\n";
  try {
    fs.appendFileSync(getLogPath(), line, "utf8");
  } catch (_) {}
}

function printConsole(msg) {
  return !HEADLESS;
}

const logger = {
  info(msg, print = false) {
    appendLog("INFO", msg);
    if (print) console.log(msg);
  },
  warn(msg, print = false) {
    appendLog("WARN", msg);
    if (print) console.log(msg);
  },
  error(msg, print = false) {
    appendLog("ERROR", msg);
    if (print) console.error(msg);
  },
  debug(msg, print = false) {
    appendLog("DEBUG", msg);
    if (print) console.log(msg);
  },

  log(level, msg, print = false) {
    appendLog(level, msg);
    if (print) console.log(msg);
  },

  getDateStr,
  getTimeStr,
  getLogPath,
  LOGS_DIR,
};

module.exports = { logger };
