const { solveImageCaptcha: solveImageCaptchaCapmonster } = require('./capmonster');
const { solveImageCaptcha: solveImageCaptchaLocal } = require('./local-captcha');

function getProvider() {
  return (process.env.CAPTCHA_SOLVER_PROVIDER || 'local').toLowerCase();
}

async function solveImageCaptcha(imgLocator, page, options = {}) {
  const provider = getProvider();

  if (provider === 'capmonster') {
    const apiKey = options.apiKey || process.env.CAPMONSTER_API_KEY;
    if (!apiKey) {
      console.log('  [WARN] CAPTCHA_SOLVER_PROVIDER=capmonster but no CAPMONSTER_API_KEY set.');
      return false;
    }
    return solveImageCaptchaCapmonster(imgLocator, page, { ...options, apiKey });
  }

  return solveImageCaptchaLocal(imgLocator, page, options);
}

module.exports = { solveImageCaptcha, getProvider };
