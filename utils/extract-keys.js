const fs = require("fs");
const path = require("path");

const KEYS_DIR = path.join(__dirname, "..", "keys");

function extractKeys(keysCsvPath, outputPath) {
  keysCsvPath = keysCsvPath || path.join(KEYS_DIR, "keys.csv");
  outputPath = outputPath || path.join(KEYS_DIR, "omniroute.txt");

  if (!fs.existsSync(keysCsvPath)) {
    console.error(`  [extract] keys.csv not found: ${keysCsvPath}`);
    return { added: 0, total: 0 };
  }

  const existingKeys = new Set();
  let nextNum = 1;

  if (fs.existsSync(outputPath)) {
    const lines = fs.readFileSync(outputPath, "utf8").trim().split("\n");
    for (const line of lines) {
      const idx = line.indexOf("|");
      if (idx === -1) continue;
      const name = line.substring(0, idx);
      const key = line.substring(idx + 1).trim();
      existingKeys.add(key);
      const num = parseInt(name.replace("akun-", ""), 10);
      if (!isNaN(num) && num >= nextNum) nextNum = num + 1;
    }
  }

  const csvLines = fs.readFileSync(keysCsvPath, "utf8").trim().split("\n");
  const newEntries = [];

  for (let i = 1; i < csvLines.length; i++) {
    const cols = csvLines[i].match(/(".*?"|[^,]+)/g);
    if (!cols || cols.length < 5) continue;
    const key = cols[4].replace(/^"|"$/g, "").trim();
    if (!key || key === "NOT_FOUND" || key === "api_key") continue;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    newEntries.push(`akun-${nextNum++}|${key}`);
  }

  if (newEntries.length === 0) {
    console.log("  [extract] No new keys to add.");
    return { added: 0, total: existingKeys.size };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.appendFileSync(outputPath, newEntries.join("\n") + "\n", "utf8");
  console.log(`  [extract] Added ${newEntries.length} new keys → ${outputPath}`);
  return { added: newEntries.length, total: existingKeys.size };
}

if (require.main === module) {
  const csvPath = process.argv[2] || path.join(KEYS_DIR, "keys.csv");
  const outPath = process.argv[3] || path.join(KEYS_DIR, "omniroute.txt");
  const result = extractKeys(csvPath, outPath);
  if (result.added === 0 && result.total === 0) process.exit(1);
}

module.exports = { extractKeys, KEYS_DIR };
