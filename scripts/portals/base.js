const navigationEngine = require("../lib/navigation-engine");

function createPortal({ name, detect, extract, isLoggedIn, ...extensions }) {
  for (const [method, implementation] of Object.entries({ detect, extract, isLoggedIn })) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Portal ${name} must implement ${method}(page).`);
    }
  }

  return Object.freeze({ name, detect, extract, isLoggedIn, ...extensions });
}

async function firstVisibleText(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count() && await locator.isVisible()) {
        const text = (await locator.innerText()).trim();
        if (text) return text;
      }
    } catch {
      // Metadata is optional; a missing or changing element should not stop the job scan.
    }
  }
  return "";
}

const APPLICATION_CONTROLS = "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [aria-required='true'], [required]";
const APPLICATION_FORM_TIMEOUT_MS = 20000;
const FORM_SETTLE_DELAY_MS = 200;

async function hasApplicationForm(page) {
  for (const frame of page.frames()) {
    const controls = frame.locator(APPLICATION_CONTROLS);
    const count = await controls.count().catch(() => 0);
    const labels = [];
    let visibleCount = 0;
    for (let index = 0; index < count; index++) {
      const control = controls.nth(index);
      try {
        if (!await control.isVisible() || !await control.isEnabled()) continue;
        visibleCount++;
        labels.push(await control.evaluate(element => {
          const id = element.id;
          const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
          const labelledBy = (element.getAttribute("aria-labelledby") || "")
            .split(/\s+/).map(labelId => document.getElementById(labelId)?.innerText || "").join(" ");
          return [element.getAttribute("aria-label"), labelledBy, element.getAttribute("placeholder"),
            element.getAttribute("name"), id, element.labels ? Array.from(element.labels).map(label => label.innerText).join(" ") : "",
            forLabel?.innerText, element.closest("form")?.innerText].filter(Boolean).join(" ").toLowerCase();
        }));
      } catch {
        // Forms may rerender while their controls are inspected.
      }
    }
    const description = labels.join(" ");
    const hasEmail = /email|e-mail/.test(description);
    const hasResume = /resume|curriculum vitae|\bcv\b/.test(description)
      || await frame.locator("input[type=file]").count().catch(() => 0) > 0;
    const hasName = /first.?name|given.?name/.test(description)
      && /last.?name|family.?name|email|phone/.test(description);
    const hasApplicationCue = /resume|curriculum vitae|\bcv\b|first name|last name|phone|cover letter|application/i.test(description);
    const hasApplicationContext = /application|candidate|resume|personal information/i.test(description);
    if ((visibleCount >= 2 && hasEmail && hasResume) || hasName
        || (visibleCount >= 2 && hasApplicationContext)
        || (hasEmail && visibleCount >= 3 && hasApplicationCue)) {
      return true;
    }
  }
  return false;
}

async function waitForApplicationForm(page, timeoutMs = APPLICATION_FORM_TIMEOUT_MS) {
  await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeoutMs, 1000) }).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    if (await hasApplicationForm(page)) return true;
    await page.waitForTimeout(250);
  }
  return hasApplicationForm(page);
}

async function enterApplicationForm(page, {
  timeoutMs = APPLICATION_FORM_TIMEOUT_MS,
  settleDelayMs = FORM_SETTLE_DELAY_MS
} = {}) {
  if (await hasApplicationForm(page)) {
    return { page, applyClicked: false, formDetected: true, reason: "Application form is already visible." };
  }

  const navigation = await navigationEngine.navigate(page, "enter");
  if (navigation.finalSubmitReached) {
    return {
      page,
      applyClicked: false,
      formDetected: false,
      finalSubmitReached: true,
      finalSubmitLabel: navigation.label,
      reason: navigation.reason
    };
  }
  if (!navigation.clicked) {
    return { page, applyClicked: false, formDetected: false, reason: "Application form controls were not detected and no entry action was found." };
  }

  const applicationPage = navigation.page;
  await applicationPage.waitForTimeout(settleDelayMs);
  const formDetected = await waitForApplicationForm(applicationPage, timeoutMs);
  return {
    page: applicationPage,
    applyClicked: true,
    formDetected,
    reason: formDetected ? "" : `Application form controls did not appear within ${timeoutMs} ms after the entry action.`
  };
}

module.exports = {
  createPortal,
  enterApplicationForm,
  firstVisibleText,
  hasApplicationForm,
  waitForApplicationForm
};
