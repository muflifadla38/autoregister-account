# Auto Register

Multi-platform automated account registration bot using Playwright + temporary email.

## Supported Platforms

| Platform                                           | Script                 | Command           |
| -------------------------------------------------- | ---------------------- | ----------------- |
| [Xiaomi MiMo API](https://platform.xiaomimimo.com) | `registers/xiaomi.js`  | `npm run xiaomi`  |
| [Alibaba Cloud](https://account.alibabacloud.com)  | `registers/alibaba.js` | `npm run alibaba` |
| [Qoder](https://qoder.com) (via llm-agent-trade)   | `registers/qoder.js`   | `npm run qoder`   |

## Features

- **Auto register** — fill form, handle captcha, verify OTP
- **Temp email** — generate disposable email + auto-extract OTP verification code
- **Country-aware fingerprint** — locale, timezone, UA, viewport matched to proxy country (26 country profiles)
- **Anti-bot detection** — stealth plugin, webdriver removal, fake browser properties, WebGL/Canvas/AudioContext fingerprint spoofing
- **Captcha solving** — auto (reCAPTCHA audio solver + CapMonster ImageToText) with manual fallback
- **Proxy management** — CSV-based proxy list, CONNECT + TLS verify, SOCKS4/5 support, auto-rotation, blacklist
- **API key validation** — sk-\* format check with auto-retry on invalid keys
- **Auto extract keys** — keys automatically extracted to omniroute.txt after registration
- **Loop mode** — register multiple accounts in one session with proxy rotation
- **Proxy blacklist** — auto-blacklist proxies flagged by Google (configurable duration)

## Prerequisites

- Node.js >= 18
- Chromium (auto-installed via Playwright)
- [FFmpeg](https://ffmpeg.org/download.html) — required for reCAPTCHA audio solver

### Installing FFmpeg

**Windows:**

```bash
winget install Gyan.FFmpeg
```

**macOS:**

```bash
brew install ffmpeg
```

**Linux:**

```bash
sudo apt install ffmpeg
```

Verify: `ffmpeg -version`

## Installation

```bash
npm install
npx playwright install chromium
```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```env
# Account
PLATFORM_PASSWORD=Nutrisari2026!
REFERRAL_CODE=6JWDPG

# Browser window (optional)
WINDOW_WIDTH=1366
WINDOW_HEIGHT=768

# Other platforms (optional)
QODER_URL=https://your-platform-url.com/dashboard/providers/qoder
QODER_ACCOUNT_PASSWORD=your_account_password
ALIBABA_PASSWORD=your_alibaba_password

# Captcha (optional)
CAPMONSTER_API_KEY=your_capmonster_key

# Proxy
PROXY=http://user:pass@ip:port          # Single proxy
PROXIES=http://ip1:port1,http://ip2:port2  # Comma-separated
USE_PROXY_CSV=true                       # Use proxies/rechecked.csv
```

## Usage

### Register

```bash
npm run xiaomi              # Xiaomi MiMo
npm run alibaba             # Alibaba Cloud
npm run qoder               # Qoder

# Or use dispatcher directly
node register.js xiaomi
node register.js alibaba
node register.js qoder
```

### Loop Mode

```bash
npm run loop                # Default: xiaomi
npm run loop-xiaomi         # Explicit xiaomi
node loop.js xiaomi         # Same

# Add new modes by creating loops/newmode.js + adding to loop.js
```

Keypress controls: `s`/`n` skip run · `d` skip step · `q` quit

### Full Automation

```bash
npm run auto-xiaomi           # hproxy + check + recheck + loop xiaomi
npm run auto-xiaomi-ps        # proxyscrape + check + recheck + loop xiaomi
```

One command to do everything: fetch fresh proxies from API, deep check → checked.csv, recheck → rechecked.csv, then start loop registration.

### Proxy Management

```bash
npm run check-proxies                     # Default (hproxy) + deep check → proxies/checked.csv
node check-proxies.js --provider proxyscrape  # Use proxyscrape provider
npm run recheck-proxies                   # Re-validate → proxies/rechecked.csv
npm run proxies                           # Both: check + recheck
```

**Providers:**

| Provider | Source | Default |
| ---------- | ------ | ------- |
| `hproxy` | hproxy.com API | Yes |
| `proxyscrape` | ProxyScrape GitHub | No |

```bash
node check-proxies.js --provider proxyscrape
node check-proxies.js --provider hproxy
```

Advanced:

```bash
node utils/proxy.js --mode deep --dead-target 0 --fetch --provider proxyscrape
node utils/proxy.js --mode normal --input proxies/rechecked.csv
node utils/proxy.js --mode dedup --input proxies/rechecked.csv
```

### Extract Keys

```bash
npm run extract-keys
```

Auto-extracts after each registration. Manual run for re-extraction.

## Project Structure

```
├── register.js              # Register dispatcher (node register.js <mode>)
├── loop.js                  # Loop dispatcher (node loop.js [mode])
├── check-proxies.js         # Fetch + deep check proxies
├── recheck-proxies.js       # Re-validate existing proxies
├── extract-keys.js          # Extract API keys to omniroute.txt
│
├── registers/
│   ├── xiaomi.js            # Xiaomi MiMo registration bot
│   ├── alibaba.js           # Alibaba Cloud registration bot
│   └── qoder.js             # Qoder registration bot
│
├── loops/
│   └── xiaomi.js            # Xiaomi loop runner with proxy rotation
│
├── utils/
│   ├── proxy.js             # Reusable proxy module (fetch, clean, check, recheck, dedup, blacklist)
│   ├── extract-keys.js      # Reusable extract keys module
│   ├── capmonster.js        # CapMonster solver (Aliyun + ImageToText)
│   ├── captcha.js           # 2captcha + manual captcha helpers
│   ├── env.js               # .env loader
│   ├── ffmpeg.js            # FFmpeg finder
│   ├── helpers.js           # sleep, rand, typeHuman, handleCookies
│   └── names.js             # Random name generator
│
├── steps/                   # Qoder modular steps
│   ├── navigate.js
│   ├── oauth.js
│   ├── registration.js
│   ├── captcha.js
│   └── otp.js
│
├── proxies/                 # Proxy files (gitignored)
│   ├── raw.csv              # Raw from provider API (hproxy/proxyscrape)
│   ├── checked.csv          # Output of check-proxies (proxy,country)
│   ├── rechecked.csv        # Output of recheck-proxies (proxy,country)
│   ├── worked.csv           # Proxies that registered successfully (proxy,country,timestamp)
│   └── blacklist.csv        # Blacklisted proxies (proxy,timestamp,banned_until,reason)
│
├── keys/                    # Output files (gitignored)
│   ├── keys.csv             # Xiaomi + Qoder API keys
│   ├── alibaba.csv          # Alibaba API keys
│   └── omniroute.txt        # Extracted keys for Omniroute
│
├── sounds/                  # WAV alerts
├── tempmail.js              # Temp email + OTP extractor
└── .env.example             # Environment variable template
```

## Proxy CSV Format

All proxy CSV files use `proxy,country` format with header:

```csv
proxy,country
http://1.2.3.4:80,US
socks5://5.6.7.8:1080,DE
```

## Country-Aware Fingerprinting

When a proxy has country data, the browser fingerprint automatically adapts:

| Country | Locale | Timezone          | Platform |
| ------- | ------ | ----------------- | -------- |
| US      | en-US  | America/New_York  | Windows  |
| GB      | en-GB  | Europe/London     | Windows  |
| DE      | de-DE  | Europe/Berlin     | Windows  |
| JP      | ja-JP  | Asia/Tokyo        | macOS    |
| KR      | ko-KR  | Asia/Seoul        | Windows  |
| SG      | en-SG  | Asia/Singapore    | Windows  |
| ID      | id-ID  | Asia/Jakarta      | Windows  |
| BR      | pt-BR  | America/Sao_Paulo | Windows  |
| AU      | en-AU  | Australia/Sydney  | macOS    |
| ...     | ...    | ...               | ...      |

26 country profiles defined in `registers/xiaomi.js`. Unmapped countries fall back to US profile.

## Proxy Blacklist

When Google flags a proxy with "automated queries", it's automatically blacklisted in `proxies/blacklist.csv`:

```csv
proxy,timestamp,banned_until,reason
http://1.2.3.4:80,2026-06-27T20:00:00.000Z,2026-06-27T20:10:00.000Z,automated_queries
```

- Default duration: 10 minutes (configurable via `CONFIG.blacklistDuration`)
- Expired entries auto-cleaned on startup
- Blacklisted proxies skipped in both register and loop scripts

## Proxy Flow

1. **Fetch** — `check-proxies.js` downloads from provider API (hproxy/proxyscrape) → `proxies/raw.csv`
2. **Parse** — provider-specific parser extracts `proxy,country` from raw CSV
3. **Check** — CONNECT + TLS verify to 3 targets (platform.xiaomimimo.com, account.xiaomi.com, global.account.xiaomi.com)
4. **Deep clean** — loops until dead=0, shows alive proxies sorted by speed with country
5. **Output** — `proxies/checked.csv` (`proxy,country` format)
6. **Recheck** — `recheck-proxies.js` re-validates → `proxies/rechecked.csv`
7. **Use** — register scripts read from `proxies/rechecked.csv`
8. **Save** — working proxies auto-saved to `proxies/worked.csv` with timestamp

## Registration Flow

### Xiaomi MiMo (12 steps)

| Step | Description                                            |
| ---- | ------------------------------------------------------ |
| 1    | Launch Chromium with country-aware fingerprint         |
| 2    | Generate temporary email                               |
| 3    | Open landing page + accept cookies + click Sign Up     |
| 4    | Region auto-detected                                   |
| 5    | Fill email, password, confirm password, agree checkbox |
| 6    | Submit form + captcha (manual/audio/2captcha)          |
| 7    | Wait for OTP email → auto-extract → auto-fill          |
| 8    | Wait for OAuth redirect to console                     |
| 9    | Terms & agreements (checklist + confirm)               |
| 10   | Navigate to API Keys → Create API Key                  |
| 11   | Extract API key → validate sk-\* → save to keys.csv    |
| 12   | Redeem invite code + auto extract to omniroute.txt     |

### Alibaba Cloud (9 steps)

| Step | Description                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------- |
| 1/9  | Launch Chromium (stealth + anti-fingerprint)                                                    |
| 2/9  | Generate temporary email via Supabase                                                           |
| 3/9  | Navigate to account.alibabacloud.com                                                            |
| 4/9  | Select "Individual Account" (inside iframe)                                                     |
| 5/9  | Click "Next"                                                                                    |
| 6/9  | Fill email, password, confirm password (char-by-char typing)                                    |
| 7/9  | Click "Sign Up" → solve Baxia slider captcha (auto/manual)                                      |
| 8/9  | Select email tab → click "Send" → wait OTP → fill `#emailCaptcha`                               |
| 9/9  | Check "I agree" → Sign Up → open Model Studio in new tab → create API key → save to alibaba.csv |

### Qoder (9 steps per loop)

| Step | Description                                                |
| ---- | ---------------------------------------------------------- |
| 1/9  | Navigate to platform → login (first time only)             |
| 2/9  | Navigate to Qoder provider page                            |
| 3/9  | Click "Add" → opens new tab                                |
| 4/9  | OAuth: Sign in with another account → Sign up              |
| 5/9  | Create temp email + generate random name                   |
| 6/9  | Fill form (First Name, Last Name, Email, Terms) + Continue |
| 7/9  | Enter password + Continue                                  |
| 8/9  | Click to verify → captcha (auto puzzle solver / manual)    |
| 9/9  | Wait OTP email → auto-fill (Ant Design OTP component)      |

## Output Format

### keys.csv / alibaba.csv

```csv
timestamp,email,password,api_key_name,api_key
"2026-06-19T12:00:00.000Z","user_xxx@domain.com","***","auto-xxx","sk-xxxxxxxxxxxxxxxxx"
```

### omniroute.txt

```
akun-1|sk-xxxxxxxxxxxxxxxxx
akun-2|sk-yyyyyyyyyyyyyyyyy
```

## Notes

- **FFmpeg** is required for the reCAPTCHA audio solver (`captchaMode: "audio"`).
- Xiaomi: captcha can be solved automatically via audio (free, offline) or 2captcha (paid).
- Alibaba: Baxia slider captcha auto-slided; second captcha after OTP waits for manual solve.
- Alibaba: use residential proxy — datacenter IPs are flagged.
- Qoder: captcha auto-solved via CapMonster (Aliyun slider), falls back to manual.
- Proxy CONNECT test verifies TLS handshake through tunnel (same as Playwright behavior).
- Working proxies auto-saved to `proxies/worked.csv` after successful registration.
- API keys validated for `sk-*` format before saving to prevent clipboard paste bugs.
- Keys auto-extracted to `keys/omniroute.txt` after each registration.
- Add new loop modes by creating `loops/newmode.js` and adding to `loop.js`.
