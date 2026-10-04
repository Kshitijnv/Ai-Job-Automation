const { createPortal, enterApplicationForm, firstVisibleText, hasApplicationForm, waitForApplicationForm } = require("./base");

const GREENHOUSE_HOST = /(^|\.)(greenhouse\.io|greenhouse\.com)$/i;
const LOGIN_PATH = /\/(login|sign-in|signin|candidate-login|users\/sign_in)(\/|$)/i;

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
  return /sign in to greenhouse|log in to your account|sign in to continue/.test(pageText);
}

async function classify(page) {
  if (!(await greenhouse.detect(page))) return "unknown";
  if (await isLoginPage(page)) return "login";

  const jobHeaderCount = await page.locator(
    "#app_body h1, .app-title, [data-qa='job-title']"
  ).count();
  let currentUrl;
  try {
    currentUrl = new URL(page.url());
  } catch {
    return "unknown";
  }
  const greenhouseEmbedCount = await page.locator(
    "iframe[src*='greenhouse.io'], iframe[src*='greenhouse.com']"
  ).count();

  if (jobHeaderCount
      || /\/jobs?\/\d+/i.test(currentUrl.pathname)
      || currentUrl.searchParams.has("gh_jid")
      || greenhouseEmbedCount) return "job";
  return "unknown";
}

async function pageTitle(page) {
  try {
    return await page.title();
  } catch {
    return "";
  }
}

async function isLoggedIn(page) {
  if (await isLoginPage(page)) return false;

  return page.locator(
    "[data-qa='user-menu'], [data-testid='user-menu'], a[href*='sign_out'], button[aria-label*='profile' i]"
  ).evaluateAll(elements => elements.some(element => element.getClientRects().length));
}

const greenhouse = createPortal({
  name: "greenhouse",

  async detect(page) {
    try {
      const currentUrl = new URL(page.url());
      if (GREENHOUSE_HOST.test(currentUrl.hostname) || currentUrl.searchParams.has("gh_jid")) {
        return true;
      }
    } catch {
      return false;
    }

    return page.locator("iframe[src*='greenhouse.io'], iframe[src*='greenhouse.com']")
      .count()
      .then(count => count > 0)
      .catch(() => false);
  },

  async extract(page) {
    const title = await firstVisibleText(page, [
      "#app_body h1",
      ".app-title",
      "[data-qa='job-title']",
      "h1"
    ]);
    const company = await firstVisibleText(page, [
      "[data-qa='company-name']",
      ".company-name",
      "#board_title",
      "header .company"
    ]);
    const pageTitleText = await pageTitle(page);
    const titleParts = pageTitleText.match(/^(.+?)\s+(?:at|\|)\s+(.+)$/i);

    return {
      company: company || titleParts?.[2] || "",
      title: title || titleParts?.[1] || "",
      location: await firstVisibleText(page, [
        "#app_body .location",
        ".job__location",
        "[data-qa='location']",
        ".location"
      ])
    };
  },

  isLoggedIn,
  async enterApplication(page, options = {}) {
    if (await waitForApplicationForm(page, Math.min(Number(options.timeoutMs) || 20000, 1000))) {
      return { page, applyClicked: false, formDetected: true, reason: "Embedded application form is already visible." };
    }
    return enterApplicationForm(page, options);
  },
  classify
});

module.exports = greenhouse;
