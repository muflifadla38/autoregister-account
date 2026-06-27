const { extractKeys, KEYS_DIR } = require("./utils/extract-keys");
const path = require("path");

const csvPath = process.argv[2] || path.join(KEYS_DIR, "keys.csv");
const outPath = process.argv[3] || path.join(KEYS_DIR, "omniroute.txt");
const result = extractKeys(csvPath, outPath);
if (result.added === 0 && result.total === 0) process.exit(1);
