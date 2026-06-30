const fs = require("fs");
const os = require("os");
const path = require("path");
const { sleep } = require("./helpers");

const LOCAL_SOLVER_API = "http://127.0.0.1:5010";

async function solveCaptcha(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");

  return solveCaptchaBase64(base64);
}

async function solveCaptchaBase64(base64) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${LOCAL_SOLVER_API}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: base64 }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        status: "failed",
        latency_ms: null,
        message: `HTTP ${res.status}: ${res.statusText}`,
        captcha_text: null,
      };
    }

    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") {
      return {
        status: "failed",
        latency_ms: null,
        message: "Request timeout (120s)",
        captcha_text: null,
      };
    }
    return {
      status: "failed",
      latency_ms: null,
      message: `Connection error: ${e.message}`,
      captcha_text: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function extractImageBase64(imgLocator) {
  return await imgLocator.evaluate((img) => {
    function applyGrayscaleThreshold(canvas) {
      const ctx = canvas.getContext("2d");
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = gray < 128 ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(imageData, 0, 0);
    }

    return new Promise((resolve, reject) => {
      try {
        if (!img.complete || img.naturalWidth === 0) {
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            applyGrayscaleThreshold(canvas);
            resolve(canvas.toDataURL("image/png").split(",")[1]);
          };
          img.onerror = () => reject(new Error("Image load error"));
        } else {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          applyGrayscaleThreshold(canvas);
          resolve(canvas.toDataURL("image/png").split(",")[1]);
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function solveImageCaptcha(imgLocator, page, options) {
  const {
    retries = 10,
    inputSelector = '.mi-captcha-field input, input[name*="icode"]',
    submitSelector = 'button[type="submit"], button:has-text("Submit"), button:has-text("Verify"), button:has-text("Confirm")',
  } = options;

  for (let i = 0; i < retries; i++) {
    console.log(`  Local captcha solver attempt ${i + 1}/${retries}...`);
    await sleep(10000);

    const debugPath = path.join(os.tmpdir(), `captcha_${Date.now()}.png`);
    try {
      let bodyBase64;
      try {
        bodyBase64 = await extractImageBase64(imgLocator);
      } catch (e) {
        console.log(
          "  Canvas extraction failed, falling back to screenshot...",
        );
        const buf = await imgLocator.screenshot();
        bodyBase64 = buf.toString("base64");
      }

      fs.writeFileSync(debugPath, Buffer.from(bodyBase64, "base64"));

      const result = await solveCaptchaBase64(bodyBase64);
      if (result.status !== "success" || !result.captcha_text) {
        console.log(`  Local solver failed: ${result.message}`);
        continue;
      }

      const answer = String(result.captcha_text).trim();
      const latency = (result.latency_ms / 1000).toFixed(2);
      console.log(`  Captcha answer: "${answer}" [${latency}s]`);

      const input = page.locator(inputSelector).first();
      if (!(await input.isVisible({ timeout: 3000 }).catch(() => false))) {
        console.log("  [WARN] Input field not visible, skipping...");
        continue;
      }

      await input.click();
      await input.fill("");
      await input.type(answer, { delay: 50 });

      let submitClicked = false;
      const selectors = submitSelector.split(",").map((s) => s.trim());
      for (const sel of selectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          const disabled = await btn.getAttribute("disabled").catch(() => null);
          if (disabled !== null && disabled !== false) {
            continue;
          }
          await btn.click();
          submitClicked = true;
          break;
        }
      }

      if (!submitClicked) {
        console.log(
          "  No enabled submit button found, pressing Enter on input...",
        );
        await input.press("Enter");
        submitClicked = true;
      }

      if (submitClicked) {
        await sleep(2000);
        if (
          !(await imgLocator.isVisible({ timeout: 1000 }).catch(() => false))
        ) {
          try {
            await fetch(`${LOCAL_SOLVER_API}/api/accept`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image_base64: bodyBase64, text: answer }),
            });
            console.log(`  Captcha accepted for training dataset.`);
          } catch (_) {}
          return true;
        }
        console.log("  Wrong answer, retrying...");
      }
    } catch (e) {
      console.log(`  Local captcha solver error: ${e.message}`);
    } finally {
      try {
        fs.unlinkSync(debugPath);
      } catch (_) {}
    }
  }
  return false;
}

module.exports = { solveCaptcha, solveCaptchaBase64, solveImageCaptcha };
