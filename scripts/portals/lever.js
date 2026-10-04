const { createPortal, enterApplicationForm, firstVisibleText } = require("./base");

const LEVER_HOST = /(^|\.)lever\.co$/i;
const LOGIN_PATH = /\/(login|signin|sign-in|candidate-login|account\/login)(\/|$)/i;

async function isLoginPage(page) {
  let currentUrl;
  try {
    currentUrl = new URL(page.url());
  } catch {
    return false;
  }

  if (LOGIN_PATH.test(currentUrl.pathname)) return true;

  const passwordField = await page.locator("input[type='password']")
    .evaluateAll(elements => elements.some(element => element.getClientRects().length));
  if (passwordField) return true;

  const pageText = (await page.locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ").toLowerCase();
  return /sign in to lever|log in to lever|sign in to your account/.test(pageText);
}

async function classify(page) {
  if (!(await lever.detect(page))) return "unknown";
  if (await isLoginPage(page)) return "login";

  const jobHeaderCount = await page.locator(
    ".posting-headline, .posting-name, [data-qa='job-title']"
  ).count();
  let pathSegments;
  try {
    pathSegments = new URL(page.url()).pathname.split("/").filter(Boolean);
  } catch {
    return "unknown";
  }

  if (jobHeaderCount || pathSegments.length >= 2) return "job";
  return "unknown";
}

async function isLoggedIn(page) {
  if (await isLoginPage(page)) return false;

  return page.locator(
    "[data-qa='user-menu'], [data-testid='user-menu'], a[href*='logout'], button[aria-label*='profile' i]"
  ).evaluateAll(elements => elements.some(element => element.getClientRects().length));
}

const lever = createPortal({
  name: "lever",

  async detect(page) {
    try {
      const hostname = new URL(page.url()).hostname;
      if (LEVER_HOST.test(hostname)) return true;
    } catch {
      return false;
    }

    return page.locator("iframe[src*='lever.co']")
      .count()
      .then(count => count > 0)
      .catch(() => false);
  },

  async extract(page) {
    return {
      company: await firstVisibleText(page, [
        "[data-qa='company-name']",
        ".company-name",
        ".main-header-text",
        "header .company"
      ]),
      title: await firstVisibleText(page, [
        ".posting-headline h2",
        ".posting-name",
        "[data-qa='job-title']",
        "h1"
      ]),
      location: await firstVisibleText(page, [
        ".posting-categories .location",
        ".posting-category.location",
        "[data-qa='location']",
        ".location"
      ])
    };
  },

  isLoggedIn,
  enterApplication(page, options) {
    return enterApplicationForm(page, options);
  },
  classify
});

module.exports = lever;
