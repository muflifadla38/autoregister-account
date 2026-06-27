# Auto Register

Multi-platform automated account registration bot using Playwright + temporary email.

## Supported Platforms

| Platform                                           | Script              | Command                    |
| -------------------------------------------------- | ------------------- | -------------------------- |
| [Xiaomi MiMo API](https://platform.xiaomimimo.com) | `registers/xiaomi.js`   | `npm run xiaomi`       |
| [Alibaba Cloud](https://account.alibabacloud.com)  | `registers/alibaba.js`  | `npm run alibaba`      |
| [Qoder](https://qoder.com) (via llm-agent-trade)   | `registers/qoder.js`    | `npm run qoder`        |

## Features

- **Auto register** — fill form, handle captcha, verify OTP
- **Temp email** — generate disposable email + auto-extract OTP verification code
- **Terms & agreements** — auto-check + confirm
- **Cookie consent** — auto-accept on every page
- **Human-like typing** — character-by-character with randomized delays
- **Anti-bot detection** — stealth plugin, webdriver removal, fake browser properties, WebGL/Canvas/AudioContext fingerprint spoofing
- **Captcha solving** — auto (reCAPTCHA audio solver + CapMonster ImageToText) with manual fallback
- **Slider captcha** — Baxia (Alibaba) auto-slide with human-like drag pattern
- **Multi-tab support** — dashboard stays open, OAuth in new tab per run
- **Loop mode** — register multiple accounts in one session with proxy rotation
- **Proxy management** — CSV-based proxy list, CONNECT + TLS verify, SOCKS4/5 support, auto-rotation
- **API key validation** — sk-* format check with auto-retry on invalid keys
- **Auto extract keys** — keys automatically extracted to omniroute.txt after registration

## Prerequisites

- Node.js >= 18
- Chromium (auto-installed via Playwright)
- [FFmpeg](https://ffmpeg.org/download.html) — required for reCAPTCHA audio solver

### Installing FFmpeg

**Windows:**
```bash
winget install Gyan.FFmpeg
# Or download from https://github.com/BtbN/FFmpeg-Builds/releases
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt install ffmpeg    # Debian/Ubuntu
sudo pacman -S ffmpeg      # Arch
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
WINDOW_X=
WINDOW_Y=

# Other platforms (optional)
QODER_URL=https://your-platform-url.com/dashboard/providers/qoder
QODER_ACCOUNT_PASSWORD=your_account_password
ALIBABA_PASSWORD=your_alibaba_password

# Captcha (optional)
CAPMONSTER_API_KEY=your_capmonster_key

# Proxy
PROXY=http://user:pass@ip:port
PROXIES=http://ip1:port1,http://ip2:port2
USE_PROXY_CSV=true
```

## Usage

### Register

```bash
npm run xiaomi          # Xiaomi MiMo
npm run alibaba         # Alibaba Cloud
npm run qoder           # Qoder

# Or use dispatcher directly
node register.js xiaomi
node register.js alibaba
node register.js qoder
```

### Loop Mode (Xiaomi)

```bash
npm run loop-xiaomi
```

Keypress controls: `s`/`n` skip · `q` quit

### Proxy Management

```bash
npm run check-proxies       # Fetch from API + deep check → proxies/checked.csv
npm run recheck-proxies     # Re-validate → proxies/rechecked.csv
```

Advanced usage:
```bash
node utils/proxy.js --mode deep --dead-target 0 --fetch --output proxies/checked.csv
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
├── register.js              # Dispatcher (node register.js <mode>)
├── loop-xiaomi.js           # Xiaomi loop runner with proxy rotation
├── check-proxies.js         # Fetch + deep check proxies
├── recheck-proxies.js       # Re-validate existing proxies
├── extract-keys.js          # Extract API keys to omniroute.txt
│
├── registers/
│   ├── xiaomi.js            # Xiaomi MiMo registration bot
│   ├── alibaba.js           # Alibaba Cloud registration bot
│   └── qoder.js             # Qoder registration bot
│
├── utils/
│   ├── proxy.js             # Reusable proxy module (fetch, clean, check, recheck, dedup)
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
├── proxies/                 # Proxy CSV files (gitignored)
│   ├── free.csv             # Raw from API (hproxy.com)
│   ├── checked.csv          # Output of check-proxies
│   ├── rechecked.csv        # Output of recheck-proxies
│   └── worked.csv           # Proxies that successfully registered
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

## Proxy Flow

1. **Fetch** — `check-proxies.js` downloads from hproxy.com API → `proxies/free.csv`
2. **Clean** — parses protocols (http/https/socks4/socks5), defaults to http
3. **Check** — CONNECT + TLS verify to 3 targets (platform.xiaomimimo.com, account.xiaomi.com, global.account.xiaomi.com)
4. **Deep clean** — loops until dead=0, shows alive proxies sorted by speed
5. **Output** — `proxies/checked.csv` (one proxy URL per line, no header)
6. **Recheck** — `recheck-proxies.js` re-validates → `proxies/rechecked.csv`
7. **Use** — register scripts read from `proxies/rechecked.csv` when `USE_PROXY_CSV=true`
8. **Save** — working proxies auto-saved to `proxies/worked.csv`

## Flow

### Xiaomi MiMo (12 steps)

| Step | Description                                            |
| ---- | ------------------------------------------------------ |
| 1    | Launch Chromium browser                                |
| 2    | Generate temporary email                               |
| 3    | Open landing page + accept cookies + click Sign Up     |
| 4    | Region auto-detected                                   |
| 5    | Fill email, password, confirm password, agree checkbox |
| 6    | Submit form + captcha (manual/audio/2captcha)          |
| 7    | Wait for OTP email → auto-extract → auto-fill          |
| 8    | Wait for OAuth redirect to console                     |
| 9    | Terms & agreements (checklist + confirm)               |
| 10   | Navigate to API Keys → Create API Key                  |
| 11   | Extract API key → validate sk-* → save to keys.csv     |
| 12   | Redeem invite code + auto extract to omniroute.txt     |

### Alibaba Cloud (9 steps)

| Step | Description                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------- |
| 1/9  | Launch Chromium (stealth + anti-fingerprint)                                                      |
| 2/9  | Generate temporary email via Supabase                                                             |
| 3/9  | Navigate to account.alibabacloud.com                                                              |
| 4/9  | Select "Individual Account" (inside iframe)                                                       |
| 5/9  | Click "Next"                                                                                      |
| 6/9  | Fill email, password, confirm password (char-by-char typing)                                      |
| 7/9  | Click "Sign Up" → solve Baxia slider captcha (auto/manual)                                        |
| 8/9  | Select email tab → click "Send" → wait OTP → fill `#emailCaptcha`                                 |
| 9/9  | Check "I agree" → Sign Up → open Model Studio in new tab → create API key → save to alibaba.csv   |

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
- Working proxies are auto-saved to `proxies/worked.csv` after successful registration.
- API keys are validated for `sk-*` format before saving to prevent clipboard paste bugs.
- Keys are auto-extracted to `keys/omniroute.txt` after each registration.
