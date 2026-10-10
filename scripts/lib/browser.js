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

function extractLinkedInJobId(jobOrUrl) {
  if (!jobOrUrl) return "";
  if (typeof jobOrUrl === "object") {
    const id = jobOrUrl.id ?? jobOrUrl.jobId;
    if (id !== null && id !== undefined && String(id).trim() !== "") return String(id).trim();
    if (jobOrUrl.url) return extractLinkedInJobId(jobOrUrl.url);
    return "";
  }
  const str = String(jobOrUrl).trim();
  const currentJobIdMatch = str.match(/[?&]currentJobId=(\d+)/i);
  if (currentJobIdMatch) return currentJobIdMatch[1];
  const viewMatch = str.match(/\/jobs\/view\/(?:[^\/]*?-)?(\d+)/i);
  if (viewMatch) return viewMatch[1];
  const urnMatch = str.match(/(?:jobPosting|fsd_jobPosting):(\d+)/i);
  if (urnMatch) return urnMatch[1];
  if (/^\d+$/.test(str)) return str;
  return "";
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

  const targetJobId = extractLinkedInJobId(job) || extractLinkedInJobId(result.url) || extractLinkedInJobId(page.url());

  const targetDetailInfo = await page.evaluate(targetId => {
    const EXCLUDED_SELECTOR = [
      "aside",
      ".similar-jobs",
      ".jobs-similar-jobs",
      ".jobs-similar-jobs__content",
      ".jobs-recommendations",
      "[data-view-name*='similar-jobs']",
      "[data-view-name*='recommended-jobs']",
      "[data-view-name*='recommendation']",
      ".jobs-search-results-list",
      ".jobs-search-results",
      ".jobs-search__left-rail"
    ].join(",");

    const TARGET_DETAIL_SELECTOR = [
      ".jobs-details__main-content",
      ".job-details-jobs-unified-top-card__container--two-pane",
      ".jobs-unified-top-card",
      ".job-view-layout",
      ".scaffold-layout__detail",
      ".jobs-search__job-details",
      "article.jobs-details",
      ".jobs-details"
    ].join(",");

    function isInsideExcluded(el) {
      if (el.closest(EXCLUDED_SELECTOR)) return true;
      let parent = el.parentElement;
      for (let i = 0; parent && i < 6; i++, parent = parent.parentElement) {
        const heading = parent.querySelector("h1, h2, h3, h4, h5, [role='heading']");
        if (heading && /similar jobs|more jobs like this|people also viewed|recommended jobs|jobs you may be interested in/i.test(heading.innerText || "")) {
          return true;
        }
      }
      const anchor = el.closest("a");
      const href = (anchor && anchor.getAttribute("href")) || el.getAttribute("href") || "";
      if (href) {
        if (/origin=JobSearchOrigin_JOB_DETAILS_SIMILAR_JOBS_CARD/i.test(href)) return true;
        if (/originToLandingJobPostings=/i.test(href)) {
          const match = href.match(/originToLandingJobPostings=(\d+)/i);
          if (match && targetId && match[1] !== targetId) return true;
        }
        const currentJobIdMatch = href.match(/[?&]currentJobId=(\d+)/i);
        if (currentJobIdMatch && targetId && currentJobIdMatch[1] !== targetId) return true;
        const viewMatch = href.match(/\/jobs\/view\/(?:[^\/]*?-)?(\d+)/i);
        if (viewMatch && targetId && viewMatch[1] !== targetId) return true;
      }
      return false;
    }

    function getElementJobId(el) {
      let curr = el;
      for (let i = 0; curr && i < 10; i++, curr = curr.parentElement) {
        const dataJobId = curr.getAttribute("data-job-id") || curr.getAttribute("data-occludable-job-id");
        if (dataJobId && /^\d+$/.test(dataJobId.trim())) return dataJobId.trim();
        const entityUrn = curr.getAttribute("data-entity-urn") || curr.getAttribute("data-job-id-urn");
        if (entityUrn) {
          const match = entityUrn.match(/(?:jobPosting|fsd_jobPosting):(\d+)/i);
          if (match) return match[1];
        }
        const href = curr.getAttribute("href") || "";
        if (href) {
          const currentJobIdMatch = href.match(/[?&]currentJobId=(\d+)/i);
          if (currentJobIdMatch) return currentJobIdMatch[1];
          const viewMatch = href.match(/\/jobs\/view\/(?:[^\/]*?-)?(\d+)/i);
          if (viewMatch) return viewMatch[1];
        }
      }
      return "";
    }

    let detailEl = document.querySelector(TARGET_DETAIL_SELECTOR);
    if (!detailEl) {
      detailEl = document.querySelector("main, #main-content, body");
    }
    const detailText = (detailEl ? detailEl.innerText : document.body.innerText || "").replace(/\s+/g, " ");

    const elements = Array.from(document.querySelectorAll("button, a, [role='button'], .jobs-apply-button"));
    const targetControls = [];
    const externalLinks = [];

    for (const el of elements) {
      if (!el.getClientRects().length || el.closest("[inert],[aria-hidden='true']")) continue;
      if (isInsideExcluded(el)) continue;

      const detectedId = getElementJobId(el);
      if (detectedId && targetId && detectedId !== targetId) continue;

      const text = (el.innerText || "").trim();
      const ariaLabel = (el.getAttribute("aria-label") || "").trim();
      const label = `${text} ${ariaLabel}`.trim();
      const href = el.getAttribute("href") || (el.closest("a") && el.closest("a").getAttribute("href")) || "";

      if (href && !/linkedin\.com/i.test(href) && href.startsWith("http")) {
        externalLinks.push({ href, label });
      }

      const inDetail = Boolean(el.closest(TARGET_DETAIL_SELECTOR));
      targetControls.push({
        text,
        ariaLabel,
        label,
        href,
        inDetail,
        isButton: el.tagName.toLowerCase() === "button" || el.classList.contains("jobs-apply-button")
      });
    }

    return {
      detailText,
      targetControls,
      externalLinks
    };
  }, targetJobId || "").catch(() => ({ detailText: "", targetControls: [], externalLinks: [] }));

  const lowerText = (targetDetailInfo.detailText || "").toLowerCase();

  if (/\b(already applied|application submitted|application sent)\b/.test(lowerText)) {
    result.button = "Already Applied";
    result.status = "AlreadyApplied";
    return result;
  }

  const externalUrl = targetDetailInfo.externalLinks.find(link => /apply|career|job|company/i.test(link.label))?.href
    || targetDetailInfo.externalLinks[0]?.href || "";
  result.externalUrl = externalUrl;
  const postedTime = job.postedTime || job.postedAt || job.posted || job.datePosted || "";
  result.postedTime = String(postedTime);

  const hasTargetEasyApply = targetDetailInfo.targetControls.some(c => /easy\s*apply/i.test(c.label));
  const hasTargetExternalApply = targetDetailInfo.targetControls.some(c =>
    /\bapply\b/i.test(c.label) && !/easy\s*apply/i.test(c.label)
  ) || /\bapply on company website\b/i.test(lowerText);

  if (hasTargetEasyApply) {
    result.button = "Easy Apply";
    result.status = "Ready";
    result.classification = "EASY_APPLY";
  } else if (hasTargetExternalApply) {
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

async function clickEasyApplyEntry(page, targetJobOrId) {
  const targetJobId = extractLinkedInJobId(targetJobOrId) || extractLinkedInJobId(page.url());
  const evaluation = await page.evaluate(targetId => {
    const EXCLUDED_SELECTOR = [
      "aside",
      ".similar-jobs",
      ".jobs-similar-jobs",
      ".jobs-similar-jobs__content",
      ".jobs-recommendations",
      "[data-view-name*='similar-jobs']",
      "[data-view-name*='recommended-jobs']",
      "[data-view-name*='recommendation']",
      ".jobs-search-results-list",
      ".jobs-search-results",
      ".jobs-search__left-rail"
    ].join(",");

    const TARGET_DETAIL_SELECTOR = [
      ".jobs-details__main-content",
      ".job-details-jobs-unified-top-card__container--two-pane",
      ".jobs-unified-top-card",
      ".job-view-layout",
      ".scaffold-layout__detail",
      ".jobs-search__job-details",
      "article.jobs-details",
      ".jobs-details"
    ].join(",");

    function getElementJobId(el) {
      let curr = el;
      for (let i = 0; curr && i < 10; i++, curr = curr.parentElement) {
        const dataJobId = curr.getAttribute("data-job-id") || curr.getAttribute("data-occludable-job-id");
        if (dataJobId && /^\d+$/.test(dataJobId.trim())) return dataJobId.trim();

        const entityUrn = curr.getAttribute("data-entity-urn") || curr.getAttribute("data-job-id-urn");
        if (entityUrn) {
          const match = entityUrn.match(/(?:jobPosting|fsd_jobPosting):(\d+)/i);
          if (match) return match[1];
        }

        const href = curr.getAttribute("href") || "";
        if (href) {
          const currentJobIdMatch = href.match(/[?&]currentJobId=(\d+)/i);
          if (currentJobIdMatch) return currentJobIdMatch[1];
          const viewMatch = href.match(/\/jobs\/view\/(?:[^\/]*?-)?(\d+)/i);
          if (viewMatch) return viewMatch[1];
          const urnMatch = href.match(/(?:jobPosting|fsd_jobPosting):(\d+)/i);
          if (urnMatch) return urnMatch[1];
        }
      }
      return "";
    }

    function isInsideExcludedSection(el, targetId) {
      if (el.closest(EXCLUDED_SELECTOR)) return true;

      let parent = el.parentElement;
      for (let i = 0; parent && i < 6; i++, parent = parent.parentElement) {
        const heading = parent.querySelector("h1, h2, h3, h4, h5, [role='heading']");
        if (heading && /similar jobs|more jobs like this|people also viewed|recommended jobs|jobs you may be interested in/i.test(heading.innerText || "")) {
          return true;
        }
      }

      const anchor = el.closest("a");
      const href = (anchor && anchor.getAttribute("href")) || el.getAttribute("href") || "";
      if (href) {
        if (/origin=JobSearchOrigin_JOB_DETAILS_SIMILAR_JOBS_CARD/i.test(href)) return true;
        if (/originToLandingJobPostings=/i.test(href)) {
          const match = href.match(/originToLandingJobPostings=(\d+)/i);
          if (match && targetId && match[1] !== targetId) return true;
        }
        const currentJobIdMatch = href.match(/[?&]currentJobId=(\d+)/i);
        if (currentJobIdMatch && targetId && currentJobIdMatch[1] !== targetId) return true;
        const viewMatch = href.match(/\/jobs\/view\/(?:[^\/]*?-)?(\d+)/i);
        if (viewMatch && targetId && viewMatch[1] !== targetId) return true;
      }

      return false;
    }

    function isInsideTargetDetail(el, targetId) {
      if (el.closest(TARGET_DETAIL_SELECTOR)) return true;
      if (targetId && el.closest(`[data-job-id="${targetId}"], [data-entity-urn*="${targetId}"]`)) return true;
      return false;
    }

    const allControls = Array.from(document.querySelectorAll("button, a, [role='button'], .jobs-apply-button"));
    const visibleIndices = [];
    for (let i = 0; i < allControls.length; i++) {
      const el = allControls[i];
      if (el.getClientRects().length > 0 && !el.closest("[inert],[aria-hidden='true']")) {
        visibleIndices.push(i);
      }
    }

    const candidates = [];

    for (const originalIndex of visibleIndices) {
      const el = allControls[originalIndex];
      const text = (el.innerText || "").trim();
      const ariaLabel = (el.getAttribute("aria-label") || "").trim();
      const combinedLabel = `${text} ${ariaLabel}`.trim();

      if (!/easy\s*apply/i.test(combinedLabel)) continue;

      const detectedJobId = getElementJobId(el);
      const isExcluded = isInsideExcludedSection(el, targetId);
      const inTargetDetail = isInsideTargetDetail(el, targetId);
      const anchor = el.closest("a");
      const href = el.getAttribute("href") || (anchor && anchor.getAttribute("href")) || "";
      const formaction = el.getAttribute("formaction") || "";
      const controlName = el.getAttribute("data-control-name") || el.getAttribute("data-action") || "";
      const isDedicatedButton = el.tagName.toLowerCase() === "button"
        || el.classList.contains("jobs-apply-button")
        || /inapply|easy_apply|apply/i.test(controlName)
        || combinedLabel.length < 50;

      let rejectReason = null;

      if (isExcluded) {
        rejectReason = "Element is inside a recommendation or similar-jobs container.";
      } else if (detectedJobId && targetId && detectedJobId !== targetId) {
        rejectReason = `Detected Job ID (${detectedJobId}) does not match target Job ID (${targetId}).`;
      } else if (/JobSearchOrigin_JOB_DETAILS_SIMILAR_JOBS_CARD/i.test(href)) {
        rejectReason = "Link href indicates a similar-jobs search origin.";
      }

      let score = 0;
      if (!rejectReason) {
        if (inTargetDetail && (el.classList.contains("jobs-apply-button--top-card") || el.classList.contains("jobs-apply-button") || /inapply|topcard/i.test(controlName))) {
          score += 100;
        } else if (inTargetDetail && isDedicatedButton) {
          score += 80;
        } else if (inTargetDetail) {
          score += 60;
        } else if (isDedicatedButton) {
          score += 40;
        } else {
          score += 20;
        }

        if (detectedJobId && targetId && detectedJobId === targetId) {
          score += 50;
        }
      }

      candidates.push({
        domIndex: originalIndex,
        text,
        ariaLabel,
        combinedLabel,
        href: href || formaction,
        formaction,
        controlName,
        detectedJobId,
        isExcluded,
        inTargetDetail,
        isDedicatedButton,
        rejectReason,
        score
      });
    }

    return candidates;
  }, targetJobId || "").catch(() => []);

  const validCandidates = (evaluation || []).filter(c => !c.rejectReason && c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (validCandidates.length === 0) {
    const rejected = (evaluation || []).find(c => c.rejectReason);
    const diagnostic = rejected
      ? `Easy Apply control rejected: ${rejected.rejectReason}`
      : (targetJobId ? `No valid Easy Apply control found for target Job ID ${targetJobId}.` : "No valid Easy Apply control found on page.");
    return {
      clicked: false,
      label: rejected ? rejected.combinedLabel : "",
      href: rejected ? rejected.href : "",
      action: rejected ? "target-mismatch" : "not-found",
      diagnostic,
      targetJobId,
      detectedControlJobId: rejected ? rejected.detectedJobId : null,
      fallbackUsed: false
    };
  }

  const best = validCandidates[0];

  // Final safety validation immediately before clicking
  if (best.detectedJobId && targetJobId && best.detectedJobId !== targetJobId) {
    return {
      clicked: false,
      label: best.combinedLabel,
      href: best.href,
      action: "target-mismatch",
      targetJobId,
      detectedControlJobId: best.detectedJobId,
      diagnostic: `Safety validation failed: detected Job ID ${best.detectedJobId} does not match target Job ID ${targetJobId}.`,
      fallbackUsed: false
    };
  }

  const controls = page.locator("button, a, [role='button'], .jobs-apply-button");
  const control = controls.nth(best.domIndex);

  const targetHref = best.href;
  if (targetHref) {
    let internalHref = false;
    try { internalHref = /(^|\.)linkedin\.com$/i.test(new URL(targetHref, page.url()).hostname); } catch {}
    if (!internalHref && !targetHref.startsWith("/")) {
      return {
        clicked: false,
        label: best.combinedLabel,
        href: targetHref,
        action: "external-href-blocked",
        diagnostic: "Easy Apply control pointed to an external non-LinkedIn domain.",
        targetJobId,
        detectedControlJobId: best.detectedJobId,
        fallbackUsed: false
      };
    }
  }

  try {
    await control.click({ timeout: 5000 });
    return {
      clicked: true,
      label: best.combinedLabel,
      href: targetHref,
      action: "playwright-click",
      targetJobId,
      detectedControlJobId: best.detectedJobId || targetJobId,
      fallbackUsed: false
    };
  } catch (error) {
    const action = await control.evaluate(element => ({
      href: element.getAttribute("href") || "",
      formAction: element.getAttribute("formaction") || "",
      name: element.getAttribute("data-control-name") || element.getAttribute("data-action") || ""
    })).catch(() => ({ href: "", formAction: "", name: "" }));

    const exposedTarget = action.href || action.formAction;
    let internalHref = false;
    try { internalHref = Boolean(exposedTarget && /(^|\.)linkedin\.com$/i.test(new URL(exposedTarget, page.url()).hostname)); } catch {}
    if ((exposedTarget && !internalHref && !exposedTarget.startsWith("/")) || (!exposedTarget && !/easy.?apply/i.test(action.name || best.combinedLabel))) {
      throw error;
    }
    await control.evaluate(element => element.click());
    return {
      clicked: true,
      label: best.combinedLabel,
      href: exposedTarget || targetHref,
      action: action.name || "evaluate-click",
      targetJobId,
      detectedControlJobId: best.detectedJobId || targetJobId,
      fallbackUsed: true
    };
  }
}

async function isInstahyreLoginRequired(page) {
  let currentUrl;
  try {
    currentUrl = new URL(page.url());
  } catch {
    return true;
  }

  if (/\/(login|signup|auth|candidate-login)(\/|$)/i.test(currentUrl.pathname)) {
    return true;
  }

  const authInputs = await page.locator(
    "input[type='password'], input[name='email'], input[name='password']"
  ).evaluateAll(elements => elements.some(element => {
    const isVisible = element.getClientRects().length > 0;
    return isVisible;
  })).catch(() => false);
  if (authInputs) {
    const hasCandidateNav = await page.locator(".candidate-nav, .user-nav, [ng-click*='logout'], a[href*='/candidate/']").count().catch(() => 0);
    if (!hasCandidateNav) return true;
  }

  const signInControls = await page.locator("button, a, [role='button'], input[type='submit']")
    .evaluateAll(elements => elements
      .filter(element => element.getClientRects().length)
      .map(element => [
        element.innerText,
        element.getAttribute("aria-label"),
        element.value
      ].filter(Boolean).join(" ").trim().toLowerCase())).catch(() => []);
  if (signInControls.some(label => /^(sign in|log in|login|sign up)$/.test(label))) {
    const hasCandidateNav = await page.locator(".candidate-nav, .user-nav, [ng-click*='logout'], a[href*='/candidate/']").count().catch(() => 0);
    if (!hasCandidateNav) return true;
  }

  const bodyText = (await page.locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ").toLowerCase();
  return /sign in to continue|log in to instahyre|welcome back to instahyre|sign up with google|login with google/.test(bodyText);
}

async function hasInstahyreSecurityCheck(page) {
  const currentUrl = page.url();
  if (/\/checkpoint|\/challenge|\/captcha/i.test(currentUrl)) return true;
  const bodyText = (await page.locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ").toLowerCase();
  return /security verification|verify your identity|unusual activity|captcha|confirm you are not a robot|cloudflare|attention required/.test(bodyText);
}

module.exports = {
  isLinkedInLoginRequired,
  hasLinkedInSecurityCheck,
  isInstahyreLoginRequired,
  hasInstahyreSecurityCheck,
  clickEasyApplyEntry,
  launchEdge,
  loadBrowserConfig,
  inspectLinkedInJob,
  classifyLinkedInApply,
  extractLinkedInJobId
};
