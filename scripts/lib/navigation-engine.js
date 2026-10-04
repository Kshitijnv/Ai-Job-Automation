const ACTION_BUTTONS = Object.freeze({
  enter: [
    /^(?:apply|apply now|apply for (?:this )?(?:job|role)|apply to (?:this )?(?:job|role))$/i,
    /^(?:start|begin) (?:your )?application$/i,
    /^(?:continue|resume) (?:your )?application$/i,
    /^continue (?:to|with) (?:the )?application$/i
  ],
  continue: [
    /^next(?:\s+(?:step|section))?$/i,
    /^continue(?:\s+(?:to\s+)?(?:the\s+)?(?:next\s+)?(?:step|section))?$/i,
    /^save\s*(?:&|and)\s*continue(?:\s+to\s+(?:the\s+)?next\s+step)?$/i,
    /^review(?:\s+application)?(?:\s+and\s+continue)?$/i,
    /^proceed(?:\s+to\s+(?:the\s+)?next\s+step)?$/i
  ],
  submit: [
    /\bsubmit(?:\s+(?:your\s+)?application)?\b/i,
    /\bsend\s+(?:your\s+)?application\b/i,
    /\bcomplete\s+(?:your\s+)?application\b/i,
    /^finish(?:\s+(?:your\s+)?application)?$/i
  ]
});

const ACTION_CONTROL_SELECTOR = "button, a, input[type=button], input[type=submit], [role=button]";
const STEP_WAIT_MS = 1200;
const STEP_TIMEOUT_MS = 20000;

function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function matchesIntent(label, intent) {
  const normalized = normalizeLabel(label);
  if (!normalized || /easy\s*apply|already applied/i.test(normalized)) return false;
  if (intent !== "submit" && ACTION_BUTTONS.submit.some(pattern => pattern.test(normalized))) return false;
  return ACTION_BUTTONS[intent].some(pattern => pattern.test(normalized));
}

async function visibleActions(page) {
  const actions = [];
  for (const frame of page.frames()) {
    const controls = frame.locator(ACTION_CONTROL_SELECTOR);
    const frameActions = await controls.evaluateAll(elements => elements.flatMap((element, index) => {
      if (!element.getClientRects().length || element.disabled || element.getAttribute("aria-disabled") === "true") return [];
      const labelledBy = (element.getAttribute("aria-labelledby") || "")
        .split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ");
      const labels = [element.innerText, element.value, element.getAttribute("aria-label"),
        element.getAttribute("title"), labelledBy].filter(Boolean).map(label => label.replace(/\s+/g, " ").trim());
      return [{ index, labels, label: labels.join(" ") }];
    })).catch(() => []);
    actions.push(...frameActions.map(action => ({ ...action, frame })));
  }
  return actions;
}

async function findAction(page, intent) {
  const action = (await visibleActions(page)).find(candidate => candidate.labels.some(label => matchesIntent(label, intent)));
  return action ? { ...action, locator: action.frame.locator(ACTION_CONTROL_SELECTOR).nth(action.index) } : null;
}

async function inspectNavigation(page) {
  const submit = await findAction(page, "submit");
  if (submit) return { stage: "submit", label: submit.label };
  const next = await findAction(page, "continue");
  if (next) return { stage: "continue", label: next.label };
  const enter = await findAction(page, "enter");
  if (enter) return { stage: "enter", label: enter.label };
  return { stage: "none", label: "" };
}

async function visibleFieldSignature(page) {
  const signature = [];
  for (const frame of page.frames()) {
    const fields = frame.locator("input:not([type=hidden]), textarea, select, [role=textbox]");
    const values = await fields.evaluateAll(elements => elements.filter(element => element.getClientRects().length)
      .map(element => [element.tagName, element.type, element.name, element.id,
        element.getAttribute("aria-label"), element.getAttribute("aria-labelledby"),
        element.getAttribute("placeholder"), element.value, element.checked].join(":"))).catch(() => []);
    signature.push(...values);
  }
  return signature.join("|");
}

async function waitForStep(page, previousUrl, previousSignature, timeoutMs = STEP_TIMEOUT_MS) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForLoadState("domcontentloaded", { timeout: 250 }).catch(() => {});
    const currentUrl = page.url();
    const currentSignature = await visibleFieldSignature(page);
    if ((currentUrl && currentUrl !== previousUrl) || (currentSignature && currentSignature !== previousSignature)) return true;
    if (Date.now() - startedAt >= STEP_WAIT_MS) return false;
    await page.waitForTimeout(250);
  }
  return false;
}

async function navigate(page, intent, { timeoutMs = STEP_TIMEOUT_MS } = {}) {
  if (!Object.hasOwn(ACTION_BUTTONS, intent) || intent === "submit") {
    throw new Error("Only enter and continue navigation actions can be clicked.");
  }

  const finalAction = await findAction(page, "submit");
  if (finalAction) {
    return {
      page,
      clicked: false,
      finalSubmitReached: true,
      label: finalAction.label,
      reason: "Final submit action detected and left for human review."
    };
  }

  const action = await findAction(page, intent);
  if (!action) {
    return { page, clicked: false, finalSubmitReached: false, label: "", reason: `${intent} action not found.` };
  }

  const previousUrl = page.url();
  const previousSignature = await visibleFieldSignature(page);
  const popupPromise = page.waitForEvent("popup", { timeout: 1200 }).catch(() => null);
  await action.locator.click({ noWaitAfter: true, timeout: 10000 });
  const popup = await popupPromise;
  const destinationPage = popup || page;
  await destinationPage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  const transitioned = await waitForStep(destinationPage, previousUrl, previousSignature, timeoutMs);
  return { page: destinationPage, clicked: true, transitioned, finalSubmitReached: false, label: action.label, reason: "" };
}

module.exports = { ACTION_BUTTONS, inspectNavigation, navigate };
