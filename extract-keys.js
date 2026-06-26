const fs = require("fs");
const path = require("path");

const csvPath = path.join(__dirname, "keys.csv");
const outPath = path.join(__dirname, "omniroute-keys.txt");

if (!fs.existsSync(csvPath)) {
  console.error("keys.csv not found");
  process.exit(1);
}

// Load existing keys from output file to avoid duplicates
const existingKeys = new Set();
let nextNum = 1;
if (fs.existsSync(outPath)) {
  const existingLines = fs.readFileSync(outPath, "utf8").trim().split("\n");
  for (const line of existingLines) {
    const idx = line.indexOf("|");
    if (idx === -1) continue;
    const name = line.substring(0, idx);
    const key = line.substring(idx + 1).trim();
    existingKeys.add(key);
    const num = parseInt(name.replace("akun-", ""), 10);
    if (!isNaN(num) && num >= nextNum) nextNum = num + 1;
  }
  console.log(`Found ${existingKeys.size} existing keys in omniroute-keys.txt`);
}

// Parse CSV and extract new unique keys
const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
const newEntries = [];

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].match(/(".*?"|[^,]+)/g);
  if (!cols || cols.length < 5) continue;
  const key = cols[4].replace(/^"|"$/g, "").trim();
  if (!key || key === "NOT_FOUND" || key === "api_key") continue;
  if (existingKeys.has(key)) continue;
  existingKeys.add(key);
  newEntries.push(`akun-${nextNum++}|${key}`);
}

if (newEntries.length === 0) {
  console.log("No new keys to add.");
  process.exit(0);
}

fs.appendFileSync(outPath, newEntries.join("\n") + "\n", "utf8");
console.log(`Added ${newEntries.length} new keys → ${outPath}`);
