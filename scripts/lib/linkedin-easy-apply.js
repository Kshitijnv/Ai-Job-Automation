const fs = require("fs");
const formMapper = require("./form-mapper");
const uploader = require("./uploader");
const { hasLinkedInSecurityCheck, isLinkedInLoginRequired } = require("./browser");

const MAX_STEPS = 10;
const DIALOG_WAIT_MS = 3000;
const DIALOG_POLL_MS = 250;
const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i;

function isLinkedInUrl(url) {
  try { return LINKEDIN_HOST.test(new URL(url).hostname); } catch { return false; }
}

async function findDialog(page) {
  for (const frame of page.frames()) {
    const nativeDialogs = frame.locator("dialog[open]");
    const nativeItems = await nativeDialogs.evaluateAll(elements => elements.map((element, index) => {
      const headingIds = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
      const heading = headingIds.map(id => document.getElementById(id)?.innerText || "").join(" ").trim();
      const visible = Boolean(element.getClientRects().length) && !element.closest("[inert],[aria-hidden='true']");
      const screen = element.querySelector("[data-sdui-screen]")?.getAttribute("data-sdui-screen") || "";
      return { index, heading, screen, text: (element.innerText || "").toLowerCase(), visible };
    })).catch(() => []);
    const nativeMatch = nativeItems.find(item => item.visible
      && /^apply to\b/i.test(item.heading)
      && (/easyapply/i.test(item.screen) || /contact info|pages/.test(item.text)));
    if (nativeMatch) return nativeDialogs.nth(nativeMatch.index);

    const dialogs = frame.locator("[role='dialog'], [aria-modal='true']");
    const items = await dialogs.evaluateAll(elements => elements
      .map((element, index) => ({ index, visible: Boolean(element.getClientRects().length) && !element.closest("[inert],[aria-hidden='true']"), text: (element.innerText || "").toLowerCase() }))
      .filter(item => item.visible)).catch(() => []);
    const match = items.reverse().find(item => /easy apply|application|resume|submit|contact info/.test(item.text));
    if (match) return dialogs.nth(match.index);
  }
  return null;
}

async function inspectEasyApplyUI(page, redactions = []) {
  const frames = [];
  for (const frame of page.frames()) {
    const state = await frame.evaluate(secrets => {
      const redact = value => {
        let result = String(value || "");
        for (const secret of secrets) if (secret) result = result.split(secret).join("[REDACTED]");
        return result.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
      };
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
          && style.opacity !== "0" && !element.closest("[inert],[aria-hidden='true']");
      };
      const details = element => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || (element instanceof HTMLDialogElement ? "dialog (native)" : ""),
        ariaLabel: redact(element.getAttribute("aria-label") || ""),
        ariaLabelledBy: element.getAttribute("aria-labelledby") || "",
        heading: redact(element.matches("h1,h2,h3,[role=heading]")
          ? (element.innerText || "").trim()
          : (element.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ").trim()),
        text: redact((element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 450)),
        html: redact(element.outerHTML.slice(0, 4500))
      });
      const dialogs = [...document.querySelectorAll("dialog[open],[role=dialog],[aria-modal=true]")].filter(visible);
      const headings = [...document.querySelectorAll("h1,h2,h3,[role=heading]")].filter(visible).slice(0, 20).map(element => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        ariaLabel: redact(element.getAttribute("aria-label") || ""),
        text: (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300)
      }));
      const buttons = [...document.querySelectorAll("button,[role=button],input[type=submit]")].filter(visible).slice(0, 30).map(element => ({
        label: [element.innerText, element.value, element.getAttribute("aria-label"), element.getAttribute("title")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
        disabled: Boolean(element.disabled),
        href: element.getAttribute("href") || ""
      }));
      const mentions = [...document.querySelectorAll("button,[role=button],h1,h2,h3,[role=heading],[aria-label]")]
        .filter(element => visible(element) && /easy apply|application|contact info|resume|review your/i.test(`${element.innerText || ""} ${element.getAttribute("aria-label") || ""}`))
        .slice(0, 12).map(element => ({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          ariaLabel: element.getAttribute("aria-label") || "",
          text: (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300)
        }));
      const relevant = new Set(dialogs);
      for (const element of [...document.querySelectorAll("body *")].filter(item => visible(item) && item.children.length <= 2 && /easy apply|application|contact info|resume|review your/i.test(item.innerText || "")).slice(0, 6)) {
        let parent = element;
        for (let level = 0; parent && parent !== document.body && level < 7; level++, parent = parent.parentElement) {
          const rect = parent.getBoundingClientRect();
          const style = getComputedStyle(parent);
          const text = parent.innerText || "";
          if (/dialog|modal/i.test(`${parent.getAttribute("role")} ${parent.getAttribute("aria-label")} ${parent.getAttribute("data-test-modal")}`)
              || ((style.position === "fixed" || style.position === "absolute") && rect.width > 250 && rect.height > 120 && text.length < 12000)) {
            relevant.add(parent);
            break;
          }
        }
      }
      const result = {
        url: location.href,
        visibleDialogCount: dialogs.length,
        dialogs: dialogs.slice(0, 5).map(details),
        headings,
        buttons,
        easyApplyMentions: mentions,
        relevantContainers: [...relevant].slice(0, 2).map(details)
      };
      return result;
    }, redactions).catch(error => ({ url: frame.url(), error: error.message }));
    if (frame === page.mainFrame() || state.visibleDialogCount || state.headings?.length || state.easyApplyMentions?.length) {
      frames.push({ isMainFrame: frame === page.mainFrame(), url: frame.url(), ...state });
    }
  }
  return { currentUrl: page.url(), framesInspected: page.frames().length, relevantFrames: frames.length, frames };
}

async function waitForEasyApplyDialog(page, timeoutMs = DIALOG_WAIT_MS, redactions = []) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let dialog = null;
  while (Date.now() < deadline) {
    dialog = await findDialog(page);
    if (dialog) return { dialog, diagnostics: await inspectEasyApplyUI(page, redactions), selector: "dialog[open][aria-labelledby] with an 'Apply to' heading and Easy Apply step content", waitedMs: Date.now() - startedAt };
    await page.waitForTimeout(DIALOG_POLL_MS);
  }
  return { dialog: null, diagnostics: await inspectEasyApplyUI(page, redactions), selector: "dialog[open][aria-labelledby] with an 'Apply to' heading and Easy Apply step content", waitedMs: Date.now() - startedAt };
}

async function dialogActions(dialog) {
  return dialog.locator("button, [role='button'], input[type='submit']").evaluateAll(elements => elements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.getClientRects().length && !element.disabled && element.getAttribute("aria-disabled") !== "true")
    .map(({ element, index }) => ({
      index,
      label: [element.innerText, element.value, element.getAttribute("aria-label"), element.getAttribute("title")]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
      accessibleName: element.getAttribute("aria-label")
        || (element.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ").trim()
        || String(element.innerText || element.value || element.getAttribute("title") || "").replace(/\s+/g, " ").trim()
    })));
}

function actionStage(actions) {
  if (actions.some(action => /^(submit application|submit)$/i.test(action.accessibleName || action.label))) return "submit";
  if (actions.some(action => /^(review|review application|review your application)$/i.test(action.label))) return "review";
  if (actions.some(action => /^(next|continue|save and continue)$/i.test(action.label))) return "continue";
  return "unknown";
}

async function signature(dialog) {
  return dialog.evaluate(element => {
    const fields = [...element.querySelectorAll("input:not([type=hidden]),textarea,select,[role=textbox]")]
      .filter(field => field.getClientRects().length)
      .map(field => [field.tagName, field.type, field.name, field.id, field.value, field.checked].join(":"));
    const buttons = [...element.querySelectorAll("button,[role=button],input[type=submit]")]
      .filter(button => button.getClientRects().length)
      .map(button => `${button.innerText || button.value || ""}:${button.disabled}`);
    return `${(element.innerText || "").replace(/\s+/g, " ").trim()}#${fields.join("|")}#${buttons.join("|")}`;
  });
}

async function clickDialogAction(dialog, intent, page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const actions = await dialogActions(dialog);
    const stage = actionStage(actions);
    const chosen = intent === "continue"
      ? actions.find(action => /^(next|continue|save and continue)$/i.test(action.label))
      : intent === "review"
        ? actions.find(action => /^(review|review application|review your application)$/i.test(action.label))
        : actions.find(action => /^(submit application|submit)$/i.test(action.accessibleName || action.label));
    if (!chosen || (intent === "continue" && stage !== "continue")
        || (intent === "review" && !["review", "continue"].includes(stage))
        || (intent === "submit" && stage !== "submit")) {
      return { clicked: false, stage };
    }
    const before = await signature(dialog);
    const control = dialog.locator("button, [role='button'], input[type='submit']").nth(chosen.index);
    let semanticControl = control;
    let semanticSelector = "";
    if (intent === "submit") {
      if (!chosen.accessibleName) return { clicked: false, stage, reason: "Submit control has no accessible name; submission was not attempted." };
      semanticSelector = `dialog[open] >> getByRole('button', { name: ${JSON.stringify(chosen.accessibleName)}, exact: true })`;
      semanticControl = dialog.getByRole("button", { name: chosen.accessibleName, exact: true });
      if (await semanticControl.count() !== 1
          || !await semanticControl.isVisible().catch(() => false)
          || !await semanticControl.isEnabled().catch(() => false)) {
        return { clicked: false, stage, reason: "Submit button was not unique, visible, and enabled by accessible name." };
      }
    }
    const exposedTarget = await control.evaluate(element => element.getAttribute("href") || element.getAttribute("formaction") || "")
      .catch(() => "");
    if (exposedTarget) {
      let internalTarget = false;
      try { internalTarget = isLinkedInUrl(new URL(exposedTarget, page.url()).href); } catch {}
      if (!internalTarget) return { clicked: false, stage, reason: "Blocked an Easy Apply control exposing an external target." };
    }
    try {
      await semanticControl.click({ timeout: 4000 });
    } catch (error) {
      if (intent === "submit") {
        return { clicked: false, clickAttempted: true, stage, semanticSelector, accessibleName: chosen.accessibleName, reason: error.message };
      }
      const details = await control.evaluate(element => ({
        href: element.getAttribute("href") || "",
        formAction: element.getAttribute("formaction") || "",
        action: element.getAttribute("data-control-name") || element.getAttribute("data-action") || ""
      })).catch(() => ({ href: "", formAction: "", action: "" }));
      let safeTarget = false;
      const exposedFallbackTarget = details.href || details.formAction;
      try { safeTarget = Boolean(exposedFallbackTarget && isLinkedInUrl(new URL(exposedFallbackTarget, page.url()).href)); } catch {}
      const safeAction = /easy.?apply|application|continue|review|submit/i.test(details.action);
      if ((exposedFallbackTarget && !safeTarget) || (!exposedFallbackTarget && !safeAction)) return { clicked: false, stage, reason: error.message };
      await control.evaluate(element => element.click());
    }
    const semanticDetails = intent === "submit"
      ? { semanticSelector, accessibleName: chosen.accessibleName }
      : {};
    const transitionDeadline = Date.now() + 12000;
    while (Date.now() < transitionDeadline) {
      await page.waitForTimeout(400);
      if (!isLinkedInUrl(page.url())) return { clicked: true, stage, leftLinkedIn: true, transitioned: true, ...semanticDetails };
      const current = await findDialog(page);
      if (!current) return { clicked: true, stage, dialogClosed: true, transitioned: true, ...semanticDetails };
      dialog = current;
      if (await signature(dialog) !== before) return { clicked: true, stage, dialog, transitioned: true, ...semanticDetails };
    }
    return { clicked: true, stage, dialog, transitioned: false, ...(intent === "submit" ? { semanticSelector, accessibleName: chosen.accessibleName } : {}) };
  }
  return { clicked: false, reason: "Timed out waiting for an Easy Apply action." };
}

async function inspectDialogFields(dialog, secrets = []) {
  return dialog.evaluate((root, privateValues) => {
    const redact = value => {
      let text = String(value ?? "");
      for (const secret of privateValues) if (secret) text = text.split(secret).join("[REDACTED]");
      return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
        .replace(/\+?\d[\d ()-]{7,}\d/g, "[REDACTED_PHONE]");
    };
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return [...root.querySelectorAll("input:not([type=hidden]),textarea,select,[role=combobox],[role=radio],[role=checkbox],[contenteditable=true]")]
      .filter(visible).map(element => {
        const ids = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
        const label = [...(element.labels || [])].map(item => item.innerText).join(" ");
        const labelledBy = ids.map(id => document.getElementById(id)?.innerText || "").join(" ");
        let nearby = element.parentElement;
        let nearbyText = "";
        for (let depth = 0; nearby && nearby !== root && depth < 5; depth++, nearby = nearby.parentElement) {
          if (nearby.querySelectorAll("input:not([type=hidden]),textarea,select").length === 1) {
            nearbyText = nearby.innerText || "";
            if (nearbyText.trim()) break;
          }
        }
        const fieldLabel = label || element.getAttribute("aria-label") || labelledBy || element.closest("fieldset")?.querySelector("legend")?.innerText || nearbyText;
        const value = element.matches("select") ? element.selectedOptions?.[0]?.textContent?.trim() || element.value
          : element.type === "checkbox" || element.type === "radio" ? (element.checked ? "checked" : "unchecked")
          : element.isContentEditable ? element.innerText : element.value;
        return {
          label: redact(fieldLabel.replace(/\s+/g, " ").trim()),
          name: element.getAttribute("name") || "",
          id: element.id || "",
          type: element.getAttribute("type") || element.getAttribute("role") || element.tagName.toLowerCase(),
          required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
          currentValue: redact(value || "")
        };
      });
  }, secrets);
}

async function inspectResumeChoices(dialog, secrets = []) {
  const locatorRadioCount = await dialog.getByRole("radio").count().catch(() => null);
  const domRadioStates = await dialog.locator("input[type='radio'],[role='radio']").evaluateAll((radios, privateValues) => {
    const redact = value => {
      let text = String(value || "");
      for (const secret of privateValues || []) {
        if (!secret) continue;
        const parts = String(secret).trim().split(/\s+/).filter(Boolean);
        if (parts.length > 1) text = text.replace(new RegExp(parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_-]+"), "gi"), "[REDACTED_NAME]");
        text = text.split(secret).join("[REDACTED]");
      }
      return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
    };
    return radios.map(radio => {
      const rect = radio.getBoundingClientRect();
      const style = getComputedStyle(radio);
      return {
        tag: radio.tagName.toLowerCase(), role: radio.getAttribute("role") || "",
        ariaLabel: redact(radio.getAttribute("aria-label") || ""),
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        selected: radio instanceof HTMLInputElement ? radio.checked : radio.getAttribute("aria-checked") === "true"
      };
    });
  }, secrets).catch(() => []);
  const details = await dialog.evaluate((root, privateValues) => {
    const redact = value => {
      let text = String(value || "");
      for (const secret of privateValues) {
        if (!secret) continue;
        const parts = String(secret).trim().split(/\s+/).filter(Boolean);
        if (parts.length > 1) {
          const pattern = new RegExp(parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_-]+"), "gi");
          text = text.replace(pattern, "[REDACTED_NAME]");
        }
        text = text.split(secret).join("[REDACTED]");
      }
      return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
        .replace(/\+?\d[\d ()-]{7,}\d/g, "[REDACTED_PHONE]");
    };
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const radios = [...root.querySelectorAll("input[type='radio'],[role='radio']")].filter(visible);
    const options = radios.map(radio => {
      let row = radio.closest("label") || radio;
      if (row === radio) {
        let parent = radio.parentElement;
        for (let depth = 0; parent && parent !== root && depth < 7; depth++, parent = parent.parentElement) {
          if (parent.querySelectorAll("input[type='radio'],[role='radio']").length === 1
              && (parent.innerText || "").trim().length > 0) { row = parent; break; }
        }
      }
      const labelledBy = (radio.getAttribute("aria-labelledby") || "").split(/\s+/)
        .map(id => document.getElementById(id)?.innerText || "").join(" ").trim();
      const labels = radio.labels ? [...radio.labels].map(label => label.innerText).join(" ").trim() : "";
      const text = (row.innerText || "").replace(/\s+/g, " ").trim();
      const accessibleName = [radio.getAttribute("aria-label"), labelledBy, labels].find(Boolean) || text;
      const attrs = element => ({
        tag: element.tagName.toLowerCase(), role: element.getAttribute("role") || "",
        ariaLabel: redact(element.getAttribute("aria-label") || ""),
        ariaLabelledBy: element.getAttribute("aria-labelledby") || "",
        dataTestId: element.getAttribute("data-testid") || ""
      });
      const ancestors = [];
      const relatedControls = new Map();
      let parent = radio;
      for (let depth = 0; parent && parent !== root && depth < 7; depth++, parent = parent.parentElement) {
        const actionables = [...parent.querySelectorAll("button,a,[role='button']")].filter(visible).map(control => ({
          label: redact([control.innerText, control.getAttribute("aria-label"), control.getAttribute("title")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()),
          ...attrs(control)
        }));
        for (const control of actionables) relatedControls.set(`${control.tag}:${control.ariaLabel}:${control.label}`, control);
        ancestors.push({ ...attrs(parent), visibleText: redact((parent.innerText || "").replace(/\s+/g, " ").trim()).slice(0, 300), actionables });
      }
      const controls = [...row.querySelectorAll("button,a,[role='button']")].filter(visible).map(control => ({
        label: [control.innerText, control.getAttribute("aria-label"), control.getAttribute("title")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
        ...attrs(control)
      }));
      return {
        visibleLabel: redact(text || accessibleName),
        accessibleName: redact(accessibleName),
        selected: radio instanceof HTMLInputElement ? radio.checked : radio.getAttribute("aria-checked") === "true",
        appearsStoredResume: /\.pdf\b|\bresume\b|\bcv\b/i.test(`${text} ${accessibleName}`),
        associatedFilename: redact(`${text} ${accessibleName}`.match(/[^\\/\s]+\.pdf\b/i)?.[0] || ""),
        associatedDate: text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/)?.[0] || "",
        radio: { ...attrs(radio), name: radio.getAttribute("name") || "", value: radio.getAttribute("value") || "" },
        ancestors,
        controls: [...relatedControls.values()],
        deleteRemoveControls: [...relatedControls.values()].filter(control => /delete|remove/i.test(`${control.label} ${control.ariaLabel}`))
      };
    });
    const uploadControls = [...root.querySelectorAll("button,[role='button'],a")].filter(visible).map(control => ({
      label: redact([control.innerText, control.getAttribute("aria-label"), control.getAttribute("title")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()),
      role: control.getAttribute("role") || "button",
      dataTestId: control.getAttribute("data-testid") || ""
    })).filter(control => /upload resume/i.test(control.label));
    const names = options.map(option => option.associatedFilename.toLowerCase()).filter(Boolean);
    return {
      choices: options,
      appearsToBeDistinctFilenames: names.length === options.length && new Set(names).size === names.length,
      uploadControls
    };
  }, secrets);
  return { ...details, locatorRadioCount, domRadioStates };
}

async function inspectQuestionRadioGroups(dialog, secrets = []) {
  return dialog.evaluate((root, privateValues) => {
    const redact = value => {
      let text = String(value || "");
      for (const secret of privateValues || []) if (secret) text = text.split(secret).join("[REDACTED]");
      return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
        .replace(/\+?\d[\d ()-]{7,}\d/g, "[REDACTED_PHONE]");
    };
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return [...root.querySelectorAll("[role='radiogroup'],fieldset")].filter(visible).map(group => {
      const labelledBy = (group.getAttribute("aria-labelledby") || "").split(/\s+/)
        .map(id => document.getElementById(id)?.innerText || "").join(" ").trim();
      const legend = group.querySelector("legend")?.innerText || "";
      const radios = [...group.querySelectorAll("[role='radio'],input[type='radio']")].filter(visible).map(radio => ({
        tag: radio.tagName.toLowerCase(),
        role: radio.getAttribute("role") || "radio (native)",
        accessibleLabel: redact(radio.getAttribute("aria-label")
          || (radio.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ")
          || [...(radio.labels || [])].map(label => label.innerText).join(" ") || radio.innerText || ""),
        ariaLabelledBy: radio.getAttribute("aria-labelledby") || "",
        text: redact((radio.innerText || "").replace(/\s+/g, " ").trim()),
        html: radio.outerHTML.slice(0, 1800),
        value: redact(radio.value || radio.getAttribute("data-value") || ""),
        selected: radio instanceof HTMLInputElement ? radio.checked : radio.getAttribute("aria-checked") === "true",
        required: Boolean(radio.required || radio.getAttribute("aria-required") === "true")
      }));
      return {
        tag: group.tagName.toLowerCase(),
        role: group.getAttribute("role") || "",
        dataTestId: group.getAttribute("data-testid") || "",
        ariaLabel: redact(group.getAttribute("aria-label") || ""),
        question: redact(group.getAttribute("aria-label") || labelledBy || legend),
        html: group.outerHTML.slice(0, 5000),
        required: group.getAttribute("aria-required") === "true" || radios.some(radio => radio.required),
        options: radios
      };
    }).filter(group => group.options.length);
  }, secrets);
}

async function inspectOnlyFlow(page, initial, job, candidate, profile, applicationConfig, redactions) {
  const result = {
    status: "UNVERIFIED", fieldsDetected: [], knownFieldsFilled: [], configuredFieldsFilled: [],
    semanticQuestionsResolved: [], missingQuestions: [], stepsCompleted: 0, submitted: false,
    submitClicked: false, submissionVerified: false, reviewReached: false, resumeStatus: "NOT_INSPECTED",
    dialogDetected: true,
    diagnostics: null, dialogSelector: initial.selector, dialogWaitMs: initial.waitedMs,
    stepsInspected: [], nextButtonSelector: "dialog[open] >> getByRole('button', { name: 'Next', exact: true })"
  };
  let dialog = initial.dialog;
  for (let index = 0; index < 4; index++) {
    if (!isLinkedInUrl(page.url())) return { ...result, reason: "LinkedIn navigation changed; stopped safely." };
    if (await hasLinkedInSecurityCheck(page) || await isLinkedInLoginRequired(page)) {
      return { ...result, status: "SECURITY_STOP", reason: "LinkedIn security or login state appeared; stopped without submitting." };
    }
    const stepText = (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const counter = stepText.match(/\b(\d+)\s*\/\s*(\d+)\s+pages?\b/i);
    const stepName = stepText.match(/\b(Contact info|Resume|Additional questions|Review)\b/i)?.[0] || "Unknown step";
    const beforeFields = await inspectDialogFields(dialog, redactions);
    result.fieldsDetected.push(...await formMapper.collectFieldMetadata(page, dialog, { experienceYearsRule: true }));
    if (/^resume$/i.test(stepName)) {
      result.resumeChoices = await inspectResumeChoices(dialog, redactions);
      result.resumeStatus = result.resumeChoices.choices.length === 1
        ? "SINGLE_LINKEDIN_RESUME_AVAILABLE"
        : result.resumeChoices.choices.length > 1 ? "MULTIPLE_RESUME_CHOICES" : "NO_RESUME_CHOICES_FOUND";
    }
    if (/additional questions/i.test(stepName)) {
      const radioGroups = await inspectQuestionRadioGroups(dialog, redactions);
      const fields = await inspectDialogFields(dialog, redactions);
      result.stepsInspected.push({
        step: counter ? `${counter[1]}/${counter[2]} pages` : stepName,
        heading: stepName,
        fields,
        radioGroups
      });
      result.stepsCompleted++;
      return { ...result, status: "ADDITIONAL_QUESTIONS_INSPECTED", questionRadioGroups: radioGroups, reason: "Question controls inspected read-only; no answers were changed and no submission was attempted." };
    }
    const afterFields = await inspectDialogFields(dialog, redactions);
    const required = await formMapper.collectHumanRequiredFields(page, result.semanticQuestionsResolved, dialog, { experienceYearsRule: true });
    result.missingQuestions.push(...required.map(item => ({ ...item, status: "NEEDS_USER_INPUT" })));
    const actions = await dialogActions(dialog);
    const next = dialog.getByRole("button", { name: "Next", exact: true });
    const nextCount = await next.count().catch(() => 0);
    const nextVisible = nextCount === 1 && await next.isVisible().catch(() => false);
    result.stepsInspected.push({
      step: counter ? `${counter[1]}/${counter[2]} pages` : stepName,
      heading: stepName,
      fields: afterFields,
      fieldsBeforeFill: beforeFields,
      actions,
      nextButton: { selector: "dialog[open] >> getByRole('button', { name: 'Next', exact: true })", count: nextCount, visible: nextVisible }
    });
    result.stepsCompleted++;
    if (result.missingQuestions.length) {
      return { ...result, status: "NEEDS_USER_INPUT", reason: "Required field has no matching configured answer; stopped without advancing or submitting." };
    }
    const stage = actionStage(actions);
    if (stage === "submit" || stage === "review") {
      return { ...result, status: "REVIEW_READY", reason: "Reached the review boundary; submission was not attempted." };
    }
    if (stage !== "continue" || !nextVisible || nextCount !== 1) {
      return { ...result, status: "UNVERIFIED", reason: "No unique, visible semantic Next button was verified; stopped safely." };
    }
    const oldStep = counter?.[1] || "";
    // The accessible locator above verifies the unique Next control; reuse the
    // existing guarded dialog action path for LinkedIn's event handling.
    const moved = await clickDialogAction(dialog, "continue", page);
    if (!moved.clicked || moved.leftLinkedIn || !moved.transitioned) {
      return { ...result, status: "UNVERIFIED", reason: moved.reason || "Next did not produce a verified in-dialog step transition." };
    }
    dialog = moved.dialog || await findDialog(page);
    if (!dialog) return { ...result, status: "UNVERIFIED", reason: "Dialog closed during step inspection; no submission was made." };
    const newText = await dialog.innerText().catch(() => "");
    const newCounter = newText.match(/\b(\d+)\s*\/\s*(\d+)\s+pages?\b/i)?.[1] || "";
    if (oldStep && newCounter && oldStep === newCounter) return { ...result, status: "UNVERIFIED", reason: "Next click did not change the detected page counter." };
  }
  return { ...result, status: "INSPECTION_LIMIT", reason: "Stopped after inspecting four form pages without submitting." };
}

async function automate(page, job, candidate, profile, applicationConfig, options = {}) {
  const result = {
    status: "UNVERIFIED",
    fieldsDetected: [],
    knownFieldsFilled: [],
    configuredFieldsFilled: [],
    semanticQuestionsResolved: [],
    missingQuestions: [],
    stepsCompleted: 0,
    submitted: false,
    submitClicked: false,
    submitClickAttempted: false,
    submissionVerified: false,
    submissionControl: null,
    reviewReached: false,
    resumeStatus: "NOT_INSPECTED",
    dialogDetected: false,
    dialogSelector: "",
    dialogWaitMs: null,
    stepsInspected: [],
    reason: ""
  };
  if (!isLinkedInUrl(page.url())) return { ...result, reason: "Easy Apply page is not on LinkedIn." };
  const candidateData = profile.candidate || profile;
  const contact = candidateData.contact || {};
  const redactions = [candidateData.name, contact.email || candidateData.email, contact.phone || candidateData.phone]
    .filter(Boolean).map(String);
  const initial = await waitForEasyApplyDialog(page, DIALOG_WAIT_MS, redactions);
  let dialog = initial.dialog;
  if (!dialog) return { ...result, status: "ERROR", diagnostics: initial.diagnostics, dialogWaitMs: initial.waitedMs, reason: "LinkedIn Easy Apply dialog was not found after the UI wait." };
  result.dialogDetected = true;
  result.dialogSelector = initial.selector;
  result.dialogWaitMs = initial.waitedMs;
  result.diagnostics = initial.diagnostics;
  if (options.inspectOnly) {
    return inspectOnlyFlow(page, initial, job, candidate, profile, applicationConfig, redactions);
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    if (await hasLinkedInSecurityCheck(page)) {
      return { ...result, status: "SECURITY_STOP", reason: "LinkedIn security verification appeared during Easy Apply." };
    }
    if (await isLinkedInLoginRequired(page)) {
      return { ...result, status: "LOGIN_REQUIRED", reason: "LinkedIn login is required during Easy Apply." };
    }
    if (!isLinkedInUrl(page.url())) return { ...result, status: "UNVERIFIED", reason: "Easy Apply left LinkedIn; stopped." };
    dialog = await findDialog(page);
    const stepText = (await dialog?.innerText().catch(() => "") || "").replace(/\s+/g, " ");
    if (!dialog) {
      const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
      if (/application (?:sent|submitted)|your application was sent/.test(body)) return { ...result, status: "APPLIED", submitted: true, reason: "LinkedIn confirmed the application was sent." };
      return { ...result, status: "ERROR", reason: "Easy Apply dialog closed before submission without a verifiable completion state." };
    }

    result.stepsCompleted++;
    result.stepsInspected.push({
      step: stepText.match(/\b\d+\s*\/\s*\d+\s+pages?\b/i)?.[0] || "",
      heading: stepText.match(/\b(Contact info|Resume|Additional questions|Review)\b/i)?.[0] || "Unknown step",
      fields: await formMapper.collectFieldMetadata(page, dialog, { experienceYearsRule: true })
    });
    if (/\bResume\b/i.test(stepText)) {
      const choices = dialog.getByRole("radio");
      const choiceLocators = [];
      for (let index = 0; index < await choices.count(); index++) {
        const choice = choices.nth(index);
        if (await choice.isVisible().catch(() => false)) choiceLocators.push(choice);
      }
      if (choiceLocators.length === 1) {
        const choice = choiceLocators[0];
        if (!await choice.isChecked().catch(() => false)) await choice.check({ timeout: 3000 });
        result.resumeStatus = "SINGLE_LINKEDIN_RESUME_SELECTED";
      } else if (choiceLocators.length > 1) {
        result.resumeStatus = "MULTIPLE_RESUME_CHOICES";
        result.missingQuestions.push({ label: "Resume selection", type: "radio", reason: "More than one LinkedIn resume choice is visible; automation will not choose between them." });
      } else {
        result.resumeStatus = "NO_RESUME_RADIO_CHOICE";
      }
    }
    result.fieldsDetected.push(...await formMapper.collectFieldMetadata(page));
    result.knownFieldsFilled.push(...await formMapper.fillKnownFields(page, profile, null, { skipExperience: true }));
    result.configuredFieldsFilled.push(...await formMapper.fillConfiguredFields(page, applicationConfig));
    result.semanticQuestionsResolved.push(...await formMapper.fillSemanticQuestions(page, {
      applicationConfig, profile, job, resumeData: profile.resume || profile.candidate?.resume || {},
      experienceYearsRule: true
    }));

    const resumeRequired = await dialog.locator("input[type='file'][required], input[type='file'][aria-required='true']").count().catch(() => 0);
    const resumeNeeded = resumeRequired > 0 && await uploader.resumeRequested(page);
    if (resumeNeeded) {
      const resumePath = candidate.resumePdf ? require("path").resolve(__dirname, "..", "..", candidate.resumePdf) : "";
      if (!resumePath || !fs.existsSync(resumePath)) {
        result.missingQuestions.push({ label: "Resume upload", type: "file", reason: "No existing tailored resume is available." });
      } else {
        const uploaded = await uploader.uploadResume(page, resumePath);
        if (!uploaded.uploaded || !uploaded.verified) {
          result.missingQuestions.push({ label: "Resume upload", type: "file", reason: uploaded.reason || "Resume upload could not be verified." });
        }
      }
    }

    const resolved = result.semanticQuestionsResolved;
    const required = await formMapper.collectHumanRequiredFields(page, resolved, dialog, { experienceYearsRule: true });
    result.missingQuestions.push(...required);
    if (result.missingQuestions.length) {
      return { ...result, status: "NEEDS_USER_INPUT", reason: "Required Easy Apply information is not available in the configured user data." };
    }

    const actions = await dialogActions(dialog);
    result.stepsInspected[result.stepsInspected.length - 1].actions = actions;
    const stage = actionStage(actions);
    if (stage === "submit") {
      if (!/\breview\b/i.test(await dialog.innerText().catch(() => ""))) {
        return { ...result, status: "UNVERIFIED", reason: "Submit control appeared outside a verified Review step; submission was not attempted." };
      }
      result.reviewReached = true;
      let submitted;
      try {
        submitted = await clickDialogAction(dialog, "submit", page);
      } catch (error) {
        return { ...result, status: "UNVERIFIED", submitted: true, submitClickAttempted: true, reason: `Submit action may have been triggered but could not be verified: ${error.message}` };
      }
      if (!submitted.clicked || submitted.leftLinkedIn) return { ...result, status: "UNVERIFIED", submitted: Boolean(submitted.clickAttempted || submitted.clicked), submitClickAttempted: Boolean(submitted.clickAttempted || submitted.clicked), submitClicked: Boolean(submitted.clicked), submissionControl: { accessibleName: submitted.accessibleName || "", selector: submitted.semanticSelector || "" }, reason: submitted.reason || "Submit action could not be verified on LinkedIn." };
      result.submitClicked = true;
      result.submitClickAttempted = true;
      result.submissionControl = { accessibleName: submitted.accessibleName || "", selector: submitted.semanticSelector || "" };
      const confirmationDeadline = Date.now() + 12000;
      while (Date.now() < confirmationDeadline) {
        const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
        if (/application (?:sent|submitted)|your application was sent|\byou applied\b/.test(text)) {
          return { ...result, status: "APPLIED", submitted: true, submitClicked: true, submitClickAttempted: true, submissionVerified: true, reviewReached: true, reason: "LinkedIn confirmed the application was sent." };
        }
        if (await hasLinkedInSecurityCheck(page)) return { ...result, status: "UNVERIFIED", submitted: true, submitClicked: true, submitClickAttempted: true, reviewReached: true, reason: "Submission was attempted but LinkedIn presented a security state before confirmation." };
        await page.waitForTimeout(500);
      }
      return { ...result, status: "UNVERIFIED", submitted: true, submitClicked: true, submitClickAttempted: true, reviewReached: true, reason: "Submission was attempted but LinkedIn did not show a confirmation; automatic retry is disabled." };
    }
    if (stage === "review" || stage === "continue") {
      const moved = await clickDialogAction(dialog, stage === "review" ? "review" : "continue", page);
      if (!moved.clicked) return { ...result, status: "ERROR", reason: moved.reason || "Could not advance the LinkedIn Easy Apply dialog." };
      if (moved.leftLinkedIn) return { ...result, status: "ERROR", reason: "A form step navigated away from LinkedIn before submission; stopped." };
      if (!moved.transitioned) return { ...result, status: "ERROR", reason: "LinkedIn did not confirm the step transition." };
      dialog = moved.dialog || await findDialog(page);
      continue;
    }
    return { ...result, status: "ERROR", reason: "No recognized Next, Review, or Submit Application control was present before submission." };
  }
  return { ...result, status: "ERROR", reason: `Easy Apply stopped after ${MAX_STEPS} steps to prevent an uncontrolled loop before submission.` };
}

module.exports = { automate, findDialog, inspectEasyApplyUI, isLinkedInUrl, waitForEasyApplyDialog };
