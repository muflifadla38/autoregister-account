const fs = require("fs");
const path = require("path");

const LOGS_DIR = path.join(__dirname, "..", "logs");

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

const logger = {
  info(msg) { appendLog("INFO", msg); },
  warn(msg) { appendLog("WARN", msg); },
  error(msg) { appendLog("ERROR", msg); },
  debug(msg) { appendLog("DEBUG", msg); },

  log(level, msg) { appendLog(level, msg); },

  getDateStr,
  getTimeStr,
  getLogPath,
  LOGS_DIR,
};

module.exports = { logger };
