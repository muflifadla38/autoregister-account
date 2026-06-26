# Auto Register

Multi-platform automated account registration bot using Playwright + temporary email.

## Supported Platforms

| Platform                                           | Script                | Command            |
| -------------------------------------------------- | --------------------- | ------------------ |
| [Xiaomi MiMo API](https://platform.xiaomimimo.com) | `register_xiaomi.js`  | `npm run xiaomi`   |
| [Alibaba Cloud](https://account.alibabacloud.com)  | `register_alibaba.js` | `npm run alibaba`  |
| [Qoder](https://qoder.com) (via llm-agent-trade)   | `register_qoder.js`   | `npm run qoder`    |

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
- **Proxy management** — CSV-based proxy list, CONNECT test to target, auto-rotation, working proxy auto-save
- **2captcha ready** — fill in API key, set `captchaMode: '2captcha'` (Xiaomi)
- **CapMonster ready** — set `CAPMONSTER_API_KEY` in `.env` for Xiaomi custom captcha (ImageToText) + Qoder Aliyun slider

## Prerequisites

- Node.js >= 18
- Chromium (auto-installed via Playwright)
- [FFmpeg](https://ffmpeg.org/download.html) — required for reCAPTCHA audio solver

### Installing FFmpeg

**Windows:**
```bash
# Using winget
winget install Gyan.FFmpeg

# Or download from https://github.com/BtbN/FFmpeg-Builds/releases
# Extract and add bin/ to PATH
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

Verify:
```bash
ffmpeg -version
```

## Installation

```bash
npm install
npx playwright install chromium
```

## Configuration

### Environment Variables (.env)

Copy `.env.example` to `.env` and fill in your values:

```env
# Account
PLATFORM_PASSWORD=Nutrisari2026!
REFERRAL_CODE=6JWDPG

# Browser window position/size (optional)
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

# Proxy — single proxy
PROXY=http://user:pass@ip:port

# Proxy — comma-separated list
PROXIES=http://ip1:port1,http://ip2:port2

# Proxy — CSV mode (reads from proxies_clean.csv)
USE_PROXY_CSV=true
```

### Xiaomi MiMo

Edit the `CONFIG` section in `register_xiaomi.js`:

```js
const CONFIG = {
  registerUrl: "https://...", // platform registration URL
  consoleUrl: "https://...",  // platform console URL
  password: "...",            // account password
  region: "Indonesia",        // region (auto-detected from URL)
  apiKeyName: "auto-xxx",     // API key name prefix
  outputFile: "keys.csv",     // CSV output file
  captchaMode: "audio",       // 'manual' | 'audio' | '2captcha'
  captchaApiKey: "",           // fill in if using 2captcha
};
```

### Alibaba Cloud

Edit the `CONFIG` section in `register_alibaba.js`:

```js
const CONFIG = {
  registerUrl: "https://account.alibabacloud.com/register/intl_register.htm",
  consoleUrl: "https://modelstudio.console.alibabacloud.com",
  password: process.env.ALIBABA_PASSWORD || "AlibabaAuto2025!",
  outputFile: "alibaba.csv",
};
```

### Qoder

Edit the `CONFIG` section in `register_qoder.js`:

```js
const CONFIG = {
  platformUrl: process.env.9ROUTER_URL,
  qoderUrl: process.env.QODER_URL,
  platformPassword: process.env.9ROUTER_PASSWORD,
  password: process.env.QODER_ACCOUNT_PASSWORD,
  outputFile: 'keys.csv',
  loops: 5,
  captchaMode: 'auto',  // 'manual' | 'auto'
};
```

## Proxy Management

### 1. Get Proxy List

Download free proxy CSV from [ProxyScrape](https://proxyscrape.com/free-proxy-list):

1. Go to https://proxyscrape.com/free-proxy-list
2. Select format: **CSV**
3. Click **Download**
4. Save as `proxies_raw.csv` in project root

The CSV has a `proxy` column with values like:
```
socks4://83.56.15.57:5678
http://45.153.4.154:3128
```

### 2. Check Proxies (from raw list → clean list)

Test proxies from `proxies_raw.csv` against the actual target via HTTP CONNECT tunnel. Alive proxies are merged into `proxies_clean.csv` (no duplicates, no replace):

```bash
npm run check-proxies
```

This uses HTTP CONNECT to `platform.xiaomimimo.com:443` — the same method Playwright uses internally. Only proxies that can actually tunnel to the target are kept.

**Output:**
```
Testing 736 proxies via CONNECT to platform.xiaomimimo.com:443 (concurrency: 50)...
  Checked 736/736 | Alive: 42 | Dead: 694
  Dead reasons: { "ECONNREFUSED": 312, "timeout": 280, "connect_rejected": 102 }

Results:
  Alive: 42
  Dead:  694
  Total: 736
  Existing in proxies_clean.csv: 0
  New added: 42
  Total in proxies_clean.csv: 42
Updated: proxies_clean.csv
```

### 3. Recheck Proxies (re-validate clean list)

Re-test proxies already in `proxies_clean.csv` and remove dead ones:

```bash
npm run recheck-proxies
```

### 4. Proxy CSV Files

| File                | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `proxies_raw.csv`   | Raw proxy list from ProxyScrape (input, don't edit)         |
| `proxies_clean.csv` | Clean working proxy list (used by register/loop scripts)     |
| `proxies_worked.csv`| Proxies that successfully registered an account (auto-saved) |

### 5. Using Proxy CSV Mode

Set `USE_PROXY_CSV=true` in `.env` or inline:

```bash
# Single run with proxy CSV
set USE_PROXY_CSV=true && npm run xiaomi

# Loop mode (auto-rotates proxy per run)
set USE_PROXY_CSV=true && npm run loop-xiaomi
```

The loop script rotates proxies sequentially. After successful registration, the working proxy is automatically saved to `proxies_worked.csv`.

## Usage

### Xiaomi MiMo

```bash
npm run xiaomi
```

### Alibaba Cloud

```bash
npm run alibaba
```

### Qoder

```bash
npm run qoder
```

### Loop Mode (Xiaomi)

```bash
npm run loop-xiaomi
```

Loop mode keypress controls:
- `s` / `n` — skip current run (kill child, rotate proxy)
- `q` — stop loop cleanly (print report and exit)

### Extract Keys

Extract API keys from `keys.csv` to `omniroute-keys.txt` (no duplicates):

```bash
npm run extract-keys
```

## Flow

### Xiaomi MiMo (12 steps)

| Step | Description                                            |
| ---- | ------------------------------------------------------ |
| 1    | Launch Chromium browser                                |
| 2    | Generate temporary email                               |
| 3    | Open registration page + accept cookies                |
| 4    | Region auto-detected                                   |
| 5    | Fill email, password, confirm password, agree checkbox |
| 6    | Submit form + captcha (manual/audio/2captcha)          |
| 7    | Wait for OTP email → auto-extract → auto-fill          |
| 8    | Wait for OAuth redirect to console                     |
| 9    | Terms & agreements (checklist + confirm)               |
| 10   | Navigate to API Keys → Create API Key                  |
| 11   | Extract API key → save to `keys.csv`                   |
| 12   | Redeem invite code (if REFERRAL_CODE set)              |

### Alibaba Cloud (9 steps)

| Step | Description                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------- |
| 1/9  | Launch Chromium (stealth + anti-fingerprint: WebGL, Canvas, Audio)                                |
| 2/9  | Generate temporary email via Supabase                                                             |
| 3/9  | Navigate to account.alibabacloud.com                                                              |
| 4/9  | Select "Individual Account" (inside iframe)                                                       |
| 5/9  | Click "Next"                                                                                      |
| 6/9  | Fill email, password, confirm password (char-by-char typing)                                      |
| 7/9  | Click "Sign Up" → solve Baxia slider captcha (auto/manual)                                        |
| 8/9  | Select email tab → click "Send" → wait OTP → fill `#emailCaptcha`                                 |
| 9/9  | Check "I agree" → Sign Up → open Model Studio in new tab → create API key → save to `alibaba.csv` |

**Notes:**

- Registration form is inside `#alibaba-register-box` iframe
- After Sign Up Step 1, Baxia slider captcha appears (auto-slided)
- After OTP, captcha may appear again (waits for manual solve)
- Verification form is in `passport.alibabacloud.com` frame
- API key is in `.keyText__qJgAI` div

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

After each loop, the OAuth tab stays open and the dashboard navigates back to Qoder page for the next registration.

## Output

### Xiaomi MiMo

```csv
timestamp,email,password,api_key_name,api_key
"2026-06-19T12:00:00.000Z","user_xxx@domain.com","***","auto-xxx","sk-xxxxxxxxxxxxxxxxx"
```

### Alibaba Cloud

```csv
timestamp,email,password,api_key
"2026-06-19T12:00:00.000Z","user_xxx@moymoy.me","***","sk-xxxxxxxxxxxxxxxxx"
```

### Qoder

```csv
timestamp,platform,first_name,last_name,email,password,status
"2026-06-19T12:00:00.000Z","qoder","John","Smith","user_xxx@moymoy.me","***","registered"
```

### Omniroute Keys

```bash
npm run extract-keys
```

```
akun-1|sk-xxxxxxxxxxxxxxxxx
akun-2|sk-yyyyyyyyyyyyyyyyy
```

## File Structure

| File                       | Description                                        |
| -------------------------- | -------------------------------------------------- |
| **Scripts**                |                                                    |
| `register_xiaomi.js`       | Xiaomi MiMo bot (Playwright)                       |
| `register_alibaba.js`      | Alibaba Cloud bot (Playwright + iframe)            |
| `register_qoder.js`        | Qoder bot (Playwright + multi-tab)                 |
| `loop_xiaomi.js`           | Xiaomi loop runner with proxy rotation             |
| `tempmail.js`              | Temp email + OTP extractor (Node)                  |
| `tempmail.py`              | Temp email + OTP extractor (Python)                |
| `captcha_puzzle_solver.py` | OpenCV puzzle captcha solver (Aliyun)              |
| `extract-keys.js`          | Extract API keys from `keys.csv` to text           |
| `check-proxies.js`         | Test proxies from raw list → `proxies_clean.csv`   |
| `recheck-proxies.js`       | Re-validate proxies in `proxies_clean.csv`         |
| **Proxy files**            |                                                    |
| `proxies_raw.csv`          | Raw proxy list from ProxyScrape (input)            |
| `proxies_clean.csv`        | Clean working proxy list (auto-managed)            |
| `proxies_worked.csv`       | Proxies that successfully registered accounts      |
| **Output**                 |                                                    |
| `keys.csv`                 | Xiaomi + Qoder output (gitignored)                 |
| `alibaba.csv`              | Alibaba output (gitignored)                        |
| `omniroute-keys.txt`       | Extracted API keys for Omniroute                   |
| **Config**                 |                                                    |
| `.env`                     | Credentials (gitignored)                           |
| `.env.example`             | Environment variable template                      |
| `utils/`                   | Shared helpers (captcha, ffmpeg, env, cookies)     |
| `sounds/`                  | WAV alerts for captcha/error/success               |

## Notes

- **FFmpeg** is required for the reCAPTCHA audio solver (`captchaMode: "audio"`). Install it and ensure it's in your PATH.
- Xiaomi: captcha can be solved automatically via audio (free, offline) or 2captcha (paid). Manual fallback always available.
- Alibaba: Baxia slider captcha auto-slided; second captcha after OTP waits for manual solve.
- Alibaba: form is nested in `#alibaba-register-box` iframe → `passport.alibabacloud.com` frame.
- Alibaba: use residential proxy — datacenter IPs are flagged by Alibaba.
- Qoder: captcha auto-solved via CapMonster (Aliyun slider), falls back to manual.
- Qoder: OTP uses Ant Design component (`input.ant-otp-input`, `size="1"`).
- Qoder: Aliyun captcha (`#aliyunCaptcha-*`) — puzzle slider type.
- Proxy CONNECT test checks if proxy can tunnel to the actual target (same as Playwright behavior), not just if the proxy port is open.
- Working proxies are auto-saved to `proxies_worked.csv` after successful registration.
- If selectors don't match, update them in the respective script.
- Supabase anon key in `tempmail.js` is public.
