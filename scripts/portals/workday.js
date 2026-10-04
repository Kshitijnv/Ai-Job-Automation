const { createPortal, firstVisibleText, waitForApplicationForm } = require("./base");
const navigationEngine = require("../lib/navigation-engine");

const WORKDAY_HOST = /(^|\.)((myworkdayjobs|myworkday|workdayjobs)\.com)$/i;
const LOGIN_PATH = /\/(login|signin|sign-in|candidate-login)(\/|$)/i;

function isWorkdayHost(hostname) {
  return WORKDAY_HOST.test(hostname);
}

async function isLoginPage(page) {
  let currentUrl;
  try {
    currentUrl = new URL(page.url());
  } catch {
    return false;
  }

  if (LOGIN_PATH.test(currentUrl.pathname)) return true;

  const authFieldCount = await page.locator(
    "input[type='password'], input[name*='username' i], input[name*='email' i]"
  ).evaluateAll(elements => elements.some(element => element.getClientRects().length));
  if (authFieldCount) return true;

  const pageText = (await page.locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ").toLowerCase();
  return /sign in to workday|sign in to your account|enter your password/.test(pageText);
}

async function classify(page) {
  if (!(await workday.detect(page))) return "unknown";
  if (await isLoginPage(page)) return "login";

  const jobHeaderCount = await page.locator(
    "[data-automation-id='jobPostingHeader'], [data-automation-id='jobTitle']"
  ).count();
  let pathname = "";
  try {
    pathname = new URL(page.url()).pathname;
  } catch {
    return "unknown";
  }

  if (jobHeaderCount || /\/(job|jobs)\//i.test(pathname)) return "job";
  return "unknown";
}

async function isLoggedIn(page) {
  if (await isLoginPage(page)) return false;

  return page.locator(
    "[data-automation-id='userMenu'], [data-automation-id='userNameLabel'], [data-automation-id='signOutButton']"
  ).evaluateAll(elements => elements.some(element => element.getClientRects().length));
}

const START_APPLICATION_TITLE = /start your application|begin your application/i;
const MANUAL_APPLICATION_ACTION = /^(?:apply manually|manual application|continue application)$/i;

async function findManualApplicationAction(page) {
  for (const frame of page.frames()) {
    const hasStartTitle = await frame.locator("body").innerText().then(text => START_APPLICATION_TITLE.test(text)).catch(() => false);
    if (!hasStartTitle) continue;
    const controls = frame.locator("button, [role=button], a, input[type=button]");
    for (let index = 0; index < await controls.count(); index++) {
      const control = controls.nth(index);
      try {
        if (!await control.isVisible() || !await control.isEnabled()) continue;
        const label = await control.evaluate(element => [element.innerText, element.value,
          element.getAttribute("aria-label"), element.getAttribute("title")].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim());
        if (MANUAL_APPLICATION_ACTION.test(label)) return { frame, control, title: true };
      } catch {
        // The modal can rerender between its title and action being inspected.
      }
    }
    return { frame, title: true, control: null };
  }
  return null;
}

async function waitForStartApplicationModal(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return null;
    const modal = await findManualApplicationAction(page);
    if (modal) return modal;
    await page.waitForTimeout(200);
  }
  return null;
}

async function enterWorkdayApplication(page, { timeoutMs = 20000 } = {}) {
  const initialForm = await waitForApplicationForm(page, Math.min(timeoutMs, 1000));
  if (initialForm) return { page, applyClicked: false, formDetected: true, reason: "Workday application form is already visible." };

  const action = await navigationEngine.navigate(page, "enter", { timeoutMs });
  if (action.finalSubmitReached) return { ...action, formDetected: false, applyClicked: false };
  if (!action.clicked) return { page, applyClicked: false, formDetected: false, reason: "Workday Apply button not found." };

  let applicationPage = action.page || page;
  const modal = await waitForStartApplicationModal(applicationPage, Math.min(timeoutMs, 8000));
  if (modal?.title) {
    if (!modal.control) {
      return {
        page: applicationPage,
        applyClicked: true,
        formDetected: false,
        reason: "Workday application modal detected but Apply Manually action was not found."
      };
    }
    const popupPromise = applicationPage.waitForEvent("popup", { timeout: 1200 }).catch(() => null);
    await modal.control.click({ noWaitAfter: true, timeout: 10000 });
    applicationPage = await popupPromise || applicationPage;
    const formDetected = await waitForApplicationForm(applicationPage, timeoutMs);
    if (formDetected && await isLoginPage(applicationPage)) {
      return {
        page: applicationPage,
        applyClicked: true,
        formDetected: false,
        reason: "Workday Apply Manually opened an account or login page; portal login is required before application entry."
      };
    }
    return {
      page: applicationPage,
      applyClicked: true,
      formDetected,
      reason: formDetected ? "" : "Workday application modal detected but Apply Manually transition did not produce an application form."
    };
  }

  const formDetected = await waitForApplicationForm(applicationPage, timeoutMs);
  if (formDetected && await isLoginPage(applicationPage)) {
    return {
      page: applicationPage,
      applyClicked: true,
      formDetected: false,
      reason: "Workday Apply action opened an account or login page; portal login is required before application entry."
    };
  }
  return {
    page: applicationPage,
    applyClicked: true,
    formDetected,
    reason: formDetected ? "" : "Workday Apply action did not produce an application form or Start Your Application modal."
  };
}

const workday = createPortal({
  name: "workday",

  async detect(page) {
    try {
      return isWorkdayHost(new URL(page.url()).hostname);
    } catch {
      return false;
    }
  },

  async extract(page) {
    return {
      company: await firstVisibleText(page, [
        "[data-automation-id='jobPostingCompanyName']",
        "[data-automation-id='companyName']",
        "[data-automation-id='company']"
      ]),
      title: await firstVisibleText(page, [
        "[data-automation-id='jobPostingHeader']",
        "[data-automation-id='jobTitle']",
        "h1"
      ]),
      location: await firstVisibleText(page, [
        "[data-automation-id='locations']",
        "[data-automation-id='jobPostingLocation']",
        "[data-automation-id='location']"
      ])
    };
  },

  isLoggedIn,
  enterApplication(page, options = {}) {
    return enterWorkdayApplication(page, options);
  },
  classify
});

module.exports = workday;
