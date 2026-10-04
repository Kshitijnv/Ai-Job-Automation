const LOGIN_PATH = /\/(login|log-in|signin|sign-in|candidate-login)(\/|$)/i;
const LOGIN_ACTION = /\b(sign in|log in|login|continue|next|submit)\b/i;

async function firstVisibleLocator(page, selectors) {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      try {
        if (await locator.count() && await locator.isVisible() && await locator.isEnabled()) return locator;
      } catch {
        // Login markup may be rerendering; try the remaining selectors.
      }
    }
  }
  return null;
}

async function isLoginPage(page) {
  let pathname = "";
  try {
    pathname = new URL(page.url()).pathname;
  } catch {
    return true;
  }
  if (LOGIN_PATH.test(pathname)) return true;
  const password = await firstVisibleLocator(page, ["input[type=password]"]);
  if (password) return true;
  const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const email = await firstVisibleLocator(page, [
    "input[type=email]", "input[autocomplete=username]", "input[name*=email i]", "input[name*=user i]"
  ]);
  return Boolean(email && /sign in|log in|welcome back|candidate account/.test(bodyText));
}

async function submitLoginStep(page) {
  for (const frame of page.frames()) {
    const buttons = frame.locator("button, input[type=submit], [role=button]");
    const index = await buttons.evaluateAll(elements => elements.findIndex(element => {
      if (!element.getClientRects().length || element.disabled) return false;
      const label = [element.innerText, element.value, element.getAttribute("aria-label"), element.getAttribute("title")]
        .filter(Boolean).join(" ").trim();
      return LOGIN_ACTION.test(label)
        && !/sign up|create account|apply|application|send|complete|finish/i.test(label);
    })).catch(() => -1);
    if (index < 0) continue;
    await buttons.nth(index).click({ timeout: 10000 });
    return true;
  }
  return false;
}

async function settlePage(page, waitMs) {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(waitMs);
}

async function loginWithCredentials(page, {
  portal,
  credentials,
  jobUrl,
  browserConfig,
  portalDetector
}) {
  if (!await isLoginPage(page)) return { success: true, loginRequired: false };

  for (let step = 0; step < 3 && await isLoginPage(page); step++) {
    const emailField = await firstVisibleLocator(page, [
      "input[type=email]", "input[autocomplete=username]", "input[name*=email i]",
      "input[name*=user i]", "input[id*=email i]", "input[type=text]"
    ]);
    const passwordField = await firstVisibleLocator(page, ["input[type=password]"]);
    if (emailField) await emailField.fill(credentials.email);
    if (passwordField) await passwordField.fill(credentials.password);

    if (!emailField && !passwordField) {
      return { success: false, loginRequired: true, reason: "Login form fields were not recognized." };
    }
    if (!await submitLoginStep(page)) {
      return { success: false, loginRequired: true, reason: "No safe sign-in or continue control was found." };
    }
    await settlePage(page, browserConfig.pageLoadWaitMs);
  }

  if (await isLoginPage(page)) {
    return { success: false, loginRequired: true, reason: "Login failed or requires additional verification." };
  }

  await page.goto(jobUrl, {
    waitUntil: "domcontentloaded",
    timeout: browserConfig.navigationTimeoutMs
  });
  await page.waitForTimeout(browserConfig.pageLoadWaitMs);

  const portalMatches = await portalDetector.detect(page);
  const pageType = portalMatches && portal.classify ? await portal.classify(page) : "unknown";
  if (!portalMatches || pageType === "login" || await isLoginPage(page)) {
    return { success: false, loginRequired: true, reason: "Login did not persist when the job page was reopened." };
  }

  return { success: true, loginRequired: true, pageType };
}

module.exports = { isLoginPage, loginWithCredentials };
