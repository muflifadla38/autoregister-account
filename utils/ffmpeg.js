const { execSync } = require("child_process");

function findFfmpeg() {
  const paths = ["C:\\ffmpeg\\bin\\ffmpeg.exe", "ffmpeg"];
  for (const p of paths) {
    try {
      execSync(`"${p}" -version`, { stdio: "ignore" });
      return p;
    } catch (_) {}
  }
  return "ffmpeg"; // fallback
}

module.exports = { findFfmpeg };
