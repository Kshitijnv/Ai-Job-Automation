const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BROWSER_CONFIG = path.join(ROOT, "config", "browser.json");

function loadBrowserConfig() {
  const config = JSON.parse(fs.readFileSync(BROWSER_CONFIG, "utf8"));
  if (config.browser !== "edge") {
    throw new Error('config/browser.json must set "browser" to "edge".');
  }

  const configuredPath = process.env.EDGE_PROFILE_PATH || config.profilePath;
  const resolvedPath = configuredPath.includes("<User>")
    ? configuredPath.replace("<User>", path.basename(os.homedir()))
    : configuredPath;
  const profilePath = path.isAbsolute(resolvedPath)
    ? resolvedPath
    : path.resolve(ROOT, resolvedPath);

  return { ...config, profilePath, profile: config.profile || "Default" };
}

async function launchEdge(config) {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    throw new Error(
      "Playwright is not installed. From the project directory run: npm install --save-dev playwright"
    );
  }

  fs.mkdirSync(config.profilePath, { recursive: true });
  return chromium.launchPersistentContext(config.profilePath, {
    channel: "msedge",
    headless: false,
    acceptDownloads: false,
    args: [`--profile-directory=${config.profile}`]
  });
}

async function isLinkedInLoginRequired(page) {
  let currentUrl;
  try {
    currentUrl = new URL(page.url());
  } catch {
    return true;
  }

  if (/\/(login|signup|checkpoint|authwall|uas\/login)(\/|$)/i.test(currentUrl.pathname)) {
    return true;
  }

  const authInputs = await page.locator(
    "input[type='email'], input[type='password'], input[name='session_key'], input[name='session_password']"
  ).evaluateAll(elements => elements.some(element => element.getClientRects().length));
  if (authInputs) return true;

  const signInControls = await page.locator("button, a, [role='button'], input[type='submit']")
    .evaluateAll(elements => elements
      .filter(element => element.getClientRects().length)
      .map(element => [
        element.innerText,
        element.getAttribute("aria-label"),
        element.value
      ].filter(Boolean).join(" ").trim().toLowerCase()));
  if (signInControls.some(label => /^(sign in|join now|sign up)$/.test(label))) {
    return true;
  }

  const bodyText = (await page.locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ").toLowerCase();
  return /sign in to apply|sign in to view|to continue, sign in|join linkedin to apply|welcome back to linkedin/.test(bodyText);
}

async function hasLinkedInSecurityCheck(page) {
  const currentUrl = page.url();
  if (/\/checkpoint|\/challenge/i.test(currentUrl)) return true;
  const bodyText = (await page.locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ").toLowerCase();
  return /security verification|verify your identity|unusual activity|captcha|confirm you are not a robot/.test(bodyText);
}

function classifyLinkedInApply(labels, lowerText) {
  if (labels.some(label => /easy\s*apply/.test(label))) return "EASY_APPLY";
  if (labels.some(label => /\bapply\b/.test(label)) || /\bapply on company website\b/.test(lowerText)) return "MANUAL_APPLY";
  return "UNKNOWN";
}

async function inspectLinkedInJob(page, job, config) {
  const result = {
    id: String(job.id ?? ""),
    company: job.company ?? "",
    title: job.title ?? "",
    url: job.url ?? "",
    action: job.action,
    portal: "linkedin",
    button: "Unknown",
    status: "unknown"
  };

  if (!/^https?:\/\/(www\.|[a-z]{2}\.)?linkedin\.com\//i.test(result.url)) {
    result.status = "Unknown";
    result.classification = "UNKNOWN";
    result.reason = "The job result does not contain a valid LinkedIn URL.";
    return result;
  }

  await page.goto(result.url, {
    waitUntil: "domcontentloaded",
    timeout: config.navigationTimeoutMs
  });
  await page.waitForTimeout(config.pageLoadWaitMs);

  if (await hasLinkedInSecurityCheck(page)) {
    result.button = "Security Check";
    result.status = "SecurityCheck";
    result.reason = "LinkedIn presented a security or verification state.";
    return result;
  }

  if (await isLinkedInLoginRequired(page)) {
    result.button = "Login Required";
    result.status = "LoginRequired";
    return result;
  }

  const bodyText = (await page.locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ");
  const lowerText = bodyText.toLowerCase();

  if (/\b(already applied|application submitted|application sent)\b/.test(lowerText)) {
    result.button = "Already Applied";
    result.status = "AlreadyApplied";
    return result;
  }

  const buttons = await page.locator("button, a, [role='button']").evaluateAll(elements =>
    elements
      .filter(element => element.getClientRects().length)
      .map(element => ({
        text: (element.innerText || element.getAttribute("aria-label") || "").trim(),
        label: (element.getAttribute("aria-label") || "").trim(),
        href: element.href || ""
      }))
  );
  const labels = buttons.map(button => `${button.text} ${button.label}`.trim().toLowerCase());
  const externalAnchors = await page.locator("a[href]").evaluateAll(elements => elements
    .filter(element => element.getClientRects().length)
    .map(element => ({
      href: element.href,
      label: `${element.innerText || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase()
    }))
    .filter(item => /apply|application|career|company website/.test(item.label)));
  const externalUrl = buttons.map(button => button.href).find(href => href && !/linkedin\.com/i.test(href)) || "";
  result.externalUrl = externalUrl || externalAnchors.find(item => !/linkedin\.com/i.test(item.href))?.href || "";
  const postedTime = job.postedTime || job.postedAt || job.posted || job.datePosted || "";
  result.postedTime = String(postedTime);

  const classification = classifyLinkedInApply(labels, lowerText);
  if (classification === "EASY_APPLY") {
    result.button = "Easy Apply";
    result.status = "Ready";
    result.classification = "EASY_APPLY";
  } else if (classification === "MANUAL_APPLY") {
    result.button = "External Apply";
    result.status = "ManualApply";
    result.classification = "MANUAL_APPLY";
    result.reason = "NO_EASY_APPLY";
  } else if (/\b(applied|application submitted)\b/.test(lowerText)) {
    result.button = "Already Applied";
    result.status = "AlreadyApplied";
  } else {
    result.status = "Unknown";
    result.classification = "UNKNOWN";
    result.reason = "No reliable Easy Apply or external Apply control was detected.";
  }

  return result;
}

async function clickEasyApplyEntry(page) {
  const controls = page.locator("button, a, [role='button']");
  const count = await controls.count();
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index);
    if (!(await control.isVisible().catch(() => false))) continue;
    const label = `${await control.innerText().catch(() => "")} ${await control.getAttribute("aria-label").catch(() => "")}`;
    if (/easy\s*apply/i.test(label)) {
      const targetHref = await control.getAttribute("href").catch(() => "")
        || await control.getAttribute("formaction").catch(() => "");
      if (targetHref) {
        let internalHref = false;
        try { internalHref = /(^|\.)linkedin\.com$/i.test(new URL(targetHref, page.url()).hostname); } catch {}
        if (!internalHref) return { clicked: false, label: label.trim(), href: targetHref, action: "external-href-blocked", fallbackUsed: false };
      }
      try {
        await control.click({ timeout: 5000 });
        return { clicked: true, label: label.trim(), href: targetHref, action: "playwright-click", fallbackUsed: false };
      } catch (error) {
        const action = await control.evaluate(element => ({
          href: element.getAttribute("href") || "",
          formAction: element.getAttribute("formaction") || "",
          name: element.getAttribute("data-control-name") || element.getAttribute("data-action") || ""
        })).catch(() => ({ href: "", formAction: "", name: "" }));
        const exposedTarget = action.href || action.formAction;
        let internalHref = false;
        try { internalHref = Boolean(exposedTarget && /(^|\.)linkedin\.com$/i.test(new URL(exposedTarget, page.url()).hostname)); } catch {}
        if ((exposedTarget && !internalHref) || (!exposedTarget && !/easy.?apply/i.test(action.name))) throw error;
        await control.evaluate(element => element.click());
        return { clicked: true, label: label.trim(), href: exposedTarget || targetHref, action: action.name, fallbackUsed: true };
      }
    }
  }
  return { clicked: false, label: "", href: "", action: "not-found", fallbackUsed: false };
}

module.exports = {
  isLinkedInLoginRequired,
  hasLinkedInSecurityCheck,
  clickEasyApplyEntry,
  launchEdge,
  loadBrowserConfig,
  inspectLinkedInJob,
  classifyLinkedInApply
};
