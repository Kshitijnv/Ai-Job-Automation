#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { loadBrowserConfig, launchEdge, isInstahyreLoginRequired, hasInstahyreSecurityCheck } = require("../lib/browser");

const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT = path.join(ROOT, "output");
const HISTORY_FILE = path.join(OUTPUT, "instahyre_application_history.json");
const CONFIG_FILE = path.join(ROOT, "config", "application.json");
const BROWSER_CONFIG_FILE = path.join(ROOT, "config", "browser.json");

const DEFAULT_URL = "https://www.instahyre.com/candidate/opportunities/?matching=true";
const RECOMMENDED_SECTION_NAME = "Recommended Jobs";
const VALID_SECTIONS = ["Recommended Jobs", "Applied Jobs", "Not interested", "Search result"];

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function loadHistory() {
  const history = readJson(HISTORY_FILE, { jobs: {} });
  return {
    jobs: history.jobs && typeof history.jobs === "object" ? history.jobs : {}
  };
}

function saveHistory(history) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const tempPath = `${HISTORY_FILE}.tmp`;
  const payload = { generatedAt: new Date().toISOString(), jobs: history.jobs || {} };
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, HISTORY_FILE);
}

function isTerminalHistoryStatus(status) {
  const s = String(status || "").toUpperCase();
  return s === "APPLIED" || s === "SKIPPED_EXTERNAL";
}

function createCurrentRunStats(selectedSection = RECOMMENDED_SECTION_NAME) {
  return {
    selectedSection,
    jobsDiscovered: 0,
    newJobsConsidered: 0,
    processed: 0,
    applied: 0,
    skippedExternal: 0,
    needsUserInput: 0,
    unverified: 0,
    failed: 0,
    alreadyProcessed: 0,
    totalTrackedBefore: 0,
    totalTrackedAfter: 0
  };
}

function formatAutomationSummary(stats) {
  const lines = [
    "==================================================",
    "Instahyre Job Automation Summary",
    "==================================================",
    "",
    `Selected section: ${stats.selectedSection || RECOMMENDED_SECTION_NAME}`,
    `Jobs discovered: ${stats.jobsDiscovered || 0}`,
    `New jobs considered: ${stats.newJobsConsidered || 0}`,
    "",
    "Current Run Results",
    "-------------------",
    `Processed: ${stats.processed || 0}`,
    `Applied: ${stats.applied || 0}`,
    `Skipped external: ${stats.skippedExternal || 0}`,
    `Needs user input: ${stats.needsUserInput || 0}`,
    `Unverified: ${stats.unverified || 0}`,
    `Failed: ${stats.failed || 0}`,
    `Already processed: ${stats.alreadyProcessed || 0}`,
    "",
    "History",
    "-------",
    `Already tracked before this run: ${stats.totalTrackedBefore || 0}`,
    `Total tracked after this run: ${stats.totalTrackedAfter || 0}`,
    "",
    "=================================================="
  ];
  return lines.join("\n");
}

function noteHistory(history, job, status, extra = {}) {
  const jobId = String(job.jobId || job.id || "").trim();
  if (!jobId) return;
  history.jobs[jobId] = {
    jobId,
    title: String(job.title || ""),
    company: String(job.company || ""),
    location: String(job.location || ""),
    experience: String(job.experience || ""),
    skills: Array.isArray(job.skills) ? job.skills : [],
    status,
    section: RECOMMENDED_SECTION_NAME,
    processedAt: new Date().toISOString(),
    ...extra
  };
}

/**
 * Extracts a clean Instahyre Job ID from DOM element attributes, IDs, or text.
 * Priority:
 * 1. Direct job ID attribute (data-job-id, data-id)
 * 2. Stable DOM attributes / IDs (job-skills-<ID>, expand-skills-<ID>, checkSkillsOverflow(<ID>))
 * 3. Fallback regex patterns
 */
function extractInstahyreJobId(rawSource) {
  if (!rawSource) return "";
  if (typeof rawSource === "object" && rawSource.jobId) return String(rawSource.jobId).trim();
  if (typeof rawSource === "object" && rawSource.id && /^\d+$/.test(String(rawSource.id).trim())) return String(rawSource.id).trim();

  const str = typeof rawSource === "string" ? rawSource : JSON.stringify(rawSource);

  // 1. Direct data-job-id or data-id attribute
  const directMatch = str.match(/\bdata-job-id=["']?(\d+)["']?/i) || str.match(/\bdata-id=["']?(\d+)["']?/i);
  if (directMatch) return directMatch[1];

  // 2. Stable Angular ID / function attributes
  const skillsIdMatch = str.match(/\b(?:job-skills-|expand-skills-)(\d+)\b/i);
  if (skillsIdMatch) return skillsIdMatch[1];

  const checkSkillsMatch = str.match(/\bcheckSkillsOverflow\(\s*(?:opp\.job\.id|(\d+))\s*\)/i);
  if (checkSkillsMatch && checkSkillsMatch[1]) return checkSkillsMatch[1];

  const oppJobMatch = str.match(/\b(?:opp\.job\.id|job\.id)\s*[:=]\s*["']?(\d+)["']?/i);
  if (oppJobMatch) return oppJobMatch[1];

  const rowIdMatch = str.match(/\bid=["']?employer-row-(\d+)["']?/i);
  if (rowIdMatch) return rowIdMatch[1];

  // 3. Fallback numeric string if pure digits
  const trimmed = str.trim();
  if (/^\d{4,8}$/.test(trimmed)) return trimmed;

  return "";
}

/**
 * Extracts job information from a div.employer-row locator
 */
async function extractJobCardDetails(rowLocator) {
  return rowLocator.evaluate(el => {
    const normalize = v => String(v || "").replace(/\s+/g, " ").trim();
    
    // Extract Job ID
    let jobId = el.getAttribute("data-job-id") || el.getAttribute("data-id") || "";
    if (!jobId) {
      const skillsEl = el.querySelector("[id^='job-skills-'], [id^='expand-skills-']");
      if (skillsEl && skillsEl.id) {
        const m = skillsEl.id.match(/\b(?:job-skills-|expand-skills-)(\d+)\b/);
        if (m) jobId = m[1];
      }
    }
    if (!jobId) {
      const html = el.outerHTML || "";
      const m = html.match(/\b(?:job-skills-|expand-skills-|checkSkillsOverflow\()(\d+)\b/);
      if (m) jobId = m[1];
    }

    const titleEl = el.querySelector(".employer-job-name, .position-title, h2, h3, a.job-title, .job-title");
    const title = normalize(titleEl ? titleEl.innerText : "");

    const companyEl = el.querySelector(".employer-name, .company-name, a.company, .company");
    const company = normalize(companyEl ? companyEl.innerText : "");

    const locationEl = el.querySelector(".employer-locations, .locations, [ng-bind*='location']");
    const location = normalize(locationEl ? locationEl.innerText : "");

    const expEl = el.querySelector(".employer-experience, .experience, [ng-bind*='experience']");
    const experience = normalize(expEl ? expEl.innerText : "");

    const skillEls = el.querySelectorAll("[id^='job-skills-'] li, [id^='job-skills-'] span, .skills-list li, .skill-tag");
    const skills = Array.from(skillEls).map(s => normalize(s.innerText)).filter(Boolean);

    return {
      jobId,
      title,
      company,
      location,
      experience,
      skills
    };
  }).catch(() => ({ jobId: "", title: "", company: "", location: "", experience: "", skills: [] }));
}

/**
 * Extracts job information from the active .application-modal-wrap overlay
 */
async function extractOverlayJobDetails(modalWrapLocator) {
  return modalWrapLocator.evaluate(el => {
    const normalize = v => String(v || "").replace(/\s+/g, " ").trim();

    // Extract Job ID
    let jobId = el.getAttribute("data-job-id") || el.getAttribute("data-id") || "";
    if (!jobId) {
      const skillsEl = el.querySelector("[id^='job-skills-'], [id^='expand-skills-']");
      if (skillsEl && skillsEl.id) {
        const m = skillsEl.id.match(/\b(?:job-skills-|expand-skills-)(\d+)\b/);
        if (m) jobId = m[1];
      }
    }
    if (!jobId) {
      const html = el.outerHTML || "";
      const m = html.match(/\b(?:job-skills-|expand-skills-|checkSkillsOverflow\()(\d+)\b/);
      if (m) jobId = m[1];
    }
    if (!jobId) {
      const oppMatch = (el.outerHTML || "").match(/\b(?:opp\.job\.id|job\.id)\s*[:=]\s*["']?(\d+)["']?/i);
      if (oppMatch) jobId = oppMatch[1];
    }

    const titleEl = el.querySelector(".job-title, .position-title, .employer-job-name, h2, h3");
    let title = normalize(titleEl ? titleEl.innerText : "");
    if (/^hold on,\s*loading/i.test(title) || /^loading\b/i.test(title)) {
      title = "";
    }

    const companyEl = el.querySelector(".company-name, .employer-name, h4, .company");
    let company = normalize(companyEl ? companyEl.innerText : "");
    if (/^hold on,\s*loading/i.test(company) || /^loading\b/i.test(company)) {
      company = "";
    }

    const locationEl = el.querySelector(".locations, .employer-locations, [ng-bind*='location']");
    const location = normalize(locationEl ? locationEl.innerText : "");

    const expEl = el.querySelector(".experience, .employer-experience, [ng-bind*='experience']");
    const experience = normalize(expEl ? expEl.innerText : "");

    const skillEls = el.querySelectorAll(".skills li, .skills span, .skill-tag, [id^='job-skills-'] li");
    const skills = Array.from(skillEls).map(s => normalize(s.innerText)).filter(Boolean);

    const fullText = normalize(el.innerText || "");
    const isLoading = /hold on,\s*loading/i.test(fullText) || (!jobId && !title);

    return {
      jobId,
      title,
      company,
      location,
      experience,
      skills,
      isLoading
    };
  }).catch(() => ({ jobId: "", title: "", company: "", location: "", experience: "", skills: [], isLoading: false }));
}

/**
 * Waits for the overlay to finish loading its content.
 * Verifies that 'Hold on, loading...' is gone and valid job details / ID are present.
 */
async function waitForOverlayContent(page, options = {}) {
  const { expectedJobId = null, timeoutMs = 8000 } = options;
  const startTime = Date.now();
  const modalWrap = page.locator(".application-modal-wrap").first();

  while (Date.now() - startTime < timeoutMs) {
    const isVisible = await modalWrap.isVisible().catch(() => false);
    if (!isVisible) {
      await page.waitForTimeout(200);
      continue;
    }

    const details = await extractOverlayJobDetails(modalWrap);
    const rawText = await modalWrap.innerText().catch(() => "");
    const isLoadingText = /hold on,\s*loading/i.test(rawText);

    if (!isLoadingText && !details.isLoading) {
      if (expectedJobId) {
        if (details.jobId === expectedJobId || (details.title && details.company)) {
          if (!details.jobId) details.jobId = expectedJobId;
          return { loaded: true, details };
        }
      } else if (details.jobId || (details.title && details.company)) {
        return { loaded: true, details };
      }
    }

    await page.waitForTimeout(200);
  }

  const fallbackDetails = await extractOverlayJobDetails(modalWrap);
  if (expectedJobId && !fallbackDetails.jobId) {
    fallbackDetails.jobId = expectedJobId;
  }
  return { loaded: Boolean(fallbackDetails.jobId || fallbackDetails.title), details: fallbackDetails };
}

/**
 * Checks if the application overlay modal is open and visible
 */
async function isOverlayOpen(page) {
  const modalWrap = page.locator(".application-modal-wrap, .application-modal-block").first();
  const count = await modalWrap.count().catch(() => 0);
  if (!count) return false;
  return modalWrap.isVisible().catch(() => false);
}

/**
 * Checks if the external application modal (#apply-external-modal) is visible.
 * Strictly checks visible modal elements, NEVER inspecting the full page body.
 */
async function isExternalModalVisible(page) {
  const extModal = page.locator("#apply-external-modal").first();
  if (await extModal.count().catch(() => 0)) {
    const isVis = await extModal.isVisible().catch(() => false);
    if (isVis) return true;
  }

  const modalWrap = page.locator(".application-modal-wrap").first();
  if (await modalWrap.count().catch(() => 0) && await modalWrap.isVisible().catch(() => false)) {
    const text = await modalWrap.innerText().catch(() => "");
    if (!/hold on,\s*loading/i.test(text)) {
      if (/this company requires you to apply for this job on their website|you will be redirected to the company's career page/i.test(text)) {
        return true;
      }
      const extBtn = modalWrap.locator("a.btn[href*='http']:has-text('Apply on company site'), button:has-text('Apply on company site')").first();
      if (await extBtn.count().catch(() => 0) && await extBtn.isVisible().catch(() => false)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Dedicated deterministic detector for the post-Apply "Similar Jobs" modal.
 * Matches:
 * - Heading: "Want to apply to other similar jobs..."
 * - Content: "Application sent to <Company>..."
 * - Generic button: /^Apply to \d+ jobs?$/i
 */
async function detectSimilarJobsOverlay(page) {
  const modalContainers = page.locator(".application-modal-wrap, .modal-dialog, div.similar-jobs-modal, #similar-jobs-modal, .modal");
  const count = await modalContainers.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const modal = modalContainers.nth(i);
    if (!await modal.isVisible().catch(() => false)) continue;

    const text = (await modal.innerText().catch(() => "")).replace(/\s+/g, " ");
    const isHeadingMatch = /want to apply to other similar jobs/i.test(text);
    const isAppSentMatch = /application sent to/i.test(text);

    // Find visible button matching /^Apply to \d+ jobs?$/i
    const buttons = modal.locator("button, a.btn, .btn");
    const btnCount = await buttons.count().catch(() => 0);
    let applyBtn = null;
    let jobCount = 1;

    for (let j = 0; j < btnCount; j++) {
      const b = buttons.nth(j);
      if (!await b.isVisible().catch(() => false)) continue;
      const bText = (await b.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const match = bText.match(/^apply to (\d+) jobs?$/i);
      if (match) {
        applyBtn = b;
        jobCount = parseInt(match[1], 10);
        break;
      }
    }

    if (isHeadingMatch || isAppSentMatch || applyBtn) {
      let company = "";
      const compMatch = text.match(/application sent to ([^.]+)/i) || text.match(/similar jobs at ([^?]+)\?/i);
      if (compMatch) {
        company = compMatch[1].trim();
      }

      return {
        detected: true,
        count: jobCount,
        company,
        applyButton: applyBtn,
        modal
      };
    }
  }

  return { detected: false, count: 0, company: "", applyButton: null, modal: null };
}

/**
 * Checks if the "Apply to N jobs" similar-jobs overlay is visible
 */
async function isSimilarJobsPopupVisible(page) {
  const info = await detectSimilarJobsOverlay(page);
  return info.detected;
}

/**
 * Handles the "Apply to N jobs" similar-jobs overlay by clicking the Apply button
 */
async function handleSimilarJobsPopup(page, detectedInfo = null) {
  const info = detectedInfo || await detectSimilarJobsOverlay(page);
  if (!info.detected) return false;

  console.log("Similar Jobs overlay detected.");
  if (info.company) {
    console.log(`Application sent to ${info.company}.`);
  }
  const jobLabel = info.count === 1 ? "1 job" : `${info.count} jobs`;
  console.log(`Found: Apply to ${jobLabel}.`);
  console.log(`Clicking "Apply to ${jobLabel}"...`);

  if (info.applyButton) {
    try {
      await info.applyButton.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      console.log("Similar Jobs application completed.");
      return true;
    } catch (err) {
      console.warn(`Click on Apply to N jobs failed: ${err.message}`);
    }
  } else {
    const fallbackBtn = page.locator("button, .btn").filter({ hasText: /^Apply to \d+ jobs?$/i }).first();
    if (await fallbackBtn.count().catch(() => 0) && await fallbackBtn.isVisible().catch(() => false)) {
      try {
        await fallbackBtn.click({ timeout: 5000 });
        await page.waitForTimeout(800);
        console.log("Similar Jobs application completed.");
        return true;
      } catch (err) {
        console.warn(`Click on Apply to N jobs fallback failed: ${err.message}`);
      }
    }
  }

  return false;
}

/**
 * Checks if the optional social or premium popup is visible
 */
async function isSocialPopupVisible(page) {
  const overlay = page.locator(".application-modal-wrap, .modal-dialog").first();
  if (!await overlay.count().catch(() => 0) || !await overlay.isVisible().catch(() => false)) {
    return false;
  }
  const text = await overlay.innerText().catch(() => "");
  return /share on social profile|want to move your application to the top|go premium/i.test(text);
}

/**
 * Dismisses the optional social/premium popup if present
 */
async function handleOptionalSocialPopup(page) {
  if (!await isSocialPopupVisible(page)) return false;

  console.log("Optional social/premium popup detected. Dismissing...");
  
  // Try closing via "No thanks, I want to continue as non-premium" link
  const noThanksLink = page.locator("a[ng-click*='closeGoPremiumModal'], a:has-text('No thanks'), a:has-text('continue as non-premium')").first();
  if (await noThanksLink.count().catch(() => 0) && await noThanksLink.isVisible().catch(() => false)) {
    try {
      await noThanksLink.click({ timeout: 4000 });
      await page.waitForTimeout(500);
      return true;
    } catch {}
  }

  // Try close button (.application-modal-close or .close)
  const closeBtn = page.locator(".application-modal-close, button.close, [data-dismiss='modal']").first();
  if (await closeBtn.count().catch(() => 0) && await closeBtn.isVisible().catch(() => false)) {
    try {
      await closeBtn.click({ timeout: 4000 });
      await page.waitForTimeout(500);
      return true;
    } catch {}
  }

  return false;
}

/**
 * Closes the external modal safely without clicking the external application link
 */
async function closeExternalModal(page) {
  const closeControls = page.locator("#apply-external-modal .close, #apply-external-modal [data-dismiss='modal'], #apply-external-modal button.btn-default, .application-modal-close");
  for (let i = 0; i < await closeControls.count().catch(() => 0); i++) {
    const btn = closeControls.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      try {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        return true;
      } catch {}
    }
  }
  return false;
}

/**
 * Safely closes the application overlay if it is open and waits until it is fully hidden
 */
async function closeOverlay(page) {
  const modalWrap = page.locator(".application-modal-wrap, .application-modal-block, .modal-dialog").first();
  if (!await modalWrap.count().catch(() => 0) || !await modalWrap.isVisible().catch(() => false)) {
    return true;
  }

  const closeControls = page.locator(
    ".application-modal-close, [ng-click*='closeApplyModal'], .modal-dialog button.close, [data-dismiss='modal'], button.close"
  );
  for (let i = 0; i < await closeControls.count().catch(() => 0); i++) {
    const btn = closeControls.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      try {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(300);
        if (!await isOverlayOpen(page)) return true;
      } catch {}
    }
  }
  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } catch {}

  return !await isOverlayOpen(page);
}

/**
 * Finds and validates the Instahyre Apply button scoped inside the overlay.
 * Scoped selector: .application-modal-wrap div.apply[ng-click="submitChoice(opp, true)"] > button
 * NEVER matches or clicks Not interested.
 */
async function findApplyButton(page) {
  const modalWrap = page.locator(".application-modal-wrap").first();
  if (!await modalWrap.count().catch(() => 0)) return null;

  // 1. Tightly scoped preferred selector
  const preferred = modalWrap.locator("div.apply[ng-click='submitChoice(opp, true)'] button, div.apply button.btn-primary");
  for (let i = 0; i < await preferred.count().catch(() => 0); i++) {
    const btn = preferred.nth(i);
    if (!await btn.isVisible().catch(() => false)) continue;
    const text = (await btn.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (/^apply$/i.test(text)) {
      return btn;
    }
  }

  // 2. Fallback scoped to .application-modal-wrap
  const candidates = modalWrap.locator("button.btn-primary, button.new-btn, button:has-text('Apply')");
  for (let i = 0; i < await candidates.count().catch(() => 0); i++) {
    const btn = candidates.nth(i);
    if (!await btn.isVisible().catch(() => false)) continue;
    const text = (await btn.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const parentClick = await btn.evaluate(e => e.parentElement?.getAttribute("ng-click") || "").catch(() => "");
    if (/^apply$/i.test(text) && !/false/.test(parentClick)) {
      return btn;
    }
  }

  return null;
}

/**
 * Ensures that the Recommended Jobs section/tab is active on Instahyre.
 */
async function ensureRecommendedJobsSection(page) {
  const tabs = page.locator("a, button, li, .btn, [role='tab']");
  
  for (let i = 0; i < await tabs.count().catch(() => 0); i++) {
    const tab = tabs.nth(i);
    if (!await tab.isVisible().catch(() => false)) continue;
    const text = (await tab.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (/^recommended jobs$/i.test(text) || /^recommended$/i.test(text)) {
      const isSelected = await tab.evaluate(e => {
        const cls = e.className || "";
        const parentCls = e.parentElement?.className || "";
        return cls.includes("active") || cls.includes("selected") || cls.includes("btn-primary")
          || parentCls.includes("active") || parentCls.includes("selected");
      }).catch(() => false);

      if (!isSelected) {
        await tab.click({ timeout: 8000 });
        await page.waitForTimeout(1000);
      }
      return true;
    }
  }

  return true;
}

/**
 * Fetches all applied jobs from the 'Applied Jobs' section (authoritative verification)
 */
async function fetchAppliedJobs(page) {
  if (await isOverlayOpen(page)) {
    await closeOverlay(page);
    await page.waitForTimeout(300);
  }

  console.log("Opening Applied section...");
  const tabs = page.locator("a, button, li, .btn, [role='tab']");
  let appliedTab = null;

  for (let i = 0; i < await tabs.count().catch(() => 0); i++) {
    const tab = tabs.nth(i);
    if (!await tab.isVisible().catch(() => false)) continue;
    const text = (await tab.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (/^applied jobs$/i.test(text) || /^applied$/i.test(text)) {
      appliedTab = tab;
      break;
    }
  }

  const appliedJobs = new Map();

  if (appliedTab) {
    try {
      await appliedTab.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      const rows = page.locator("div.employer-row");
      const count = await rows.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const details = await extractJobCardDetails(row);
        if (details.jobId) {
          appliedJobs.set(String(details.jobId), details);
        }
      }
    } catch (err) {
      console.warn(`Could not inspect Applied tab: ${err.message}`);
    }
  }

  return appliedJobs;
}

/**
 * Authoritatively verifies whether a job ID exists in the Applied Jobs section
 */
async function verifyJobInAppliedSection(page, jobId, history = null) {
  if (!jobId) return false;
  await closeOverlay(page);
  const appliedJobs = await fetchAppliedJobs(page);
  const found = appliedJobs.has(String(jobId));

  // If history is provided, also record any additional newly confirmed jobs from Applied section
  if (history && appliedJobs.size > 0) {
    for (const [id, details] of appliedJobs.entries()) {
      if (!history.jobs[id] || !isTerminalHistoryStatus(history.jobs[id].status)) {
        noteHistory(history, details, "APPLIED", { reason: "Confirmed in Applied Jobs section." });
      }
    }
    saveHistory(history);
  }

  console.log("Returning to Recommended Jobs...");
  await ensureRecommendedJobsSection(page);
  return found;
}

/**
 * Finds the first unprocessed job card in the Recommended Jobs list view
 */
async function findNextUnprocessedJobCard(page, history, seenJobIds = null) {
  const rows = page.locator("div.employer-row");
  const count = await rows.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if (!await row.isVisible().catch(() => false)) continue;

    const details = await extractJobCardDetails(row);
    if (!details.jobId) continue;

    if (history.jobs && history.jobs[details.jobId] && isTerminalHistoryStatus(history.jobs[details.jobId].status)) {
      continue;
    }

    if (seenJobIds && seenJobIds.has(details.jobId)) {
      continue;
    }

    return { row, details };
  }

  return null;
}

/**
 * Core state machine step to process one job.
 * Follows the strict lifecycle:
 * Recommended Jobs main page -> Select card -> Capture Job ID -> View Job -> Loaded Overlay
 * -> Apply -> Handle post-Apply UI -> Close overlay -> Applied section verification -> Return to Recommended.
 */
async function processSingleJob(page, history, stats, options = {}) {
  const { inspectOnly = false, dryRun = false, transitionTimeoutMs = 7000, knownJob = null, seenJobIds = null } = options;

  let candidateJob = knownJob;

  // 1. Select job card from Recommended Jobs main page and capture original Job ID
  if (!candidateJob) {
    const candidate = await findNextUnprocessedJobCard(page, history, seenJobIds);
    if (!candidate) {
      return { status: "NO_MORE_JOBS" };
    }

    const { row, details } = candidate;
    candidateJob = details;
    if (seenJobIds && details.jobId) {
      seenJobIds.add(details.jobId);
    }
    console.log(`\nOpening job from Recommended Jobs: ID ${details.jobId} | ${details.title} @ ${details.company}`);

    const viewJobButton = row.locator("button.btn-success.btn-md.btn-interested, .action-links button.btn-interested, button:has-text('View job')").first();
    if (!await viewJobButton.count().catch(() => 0) || !await viewJobButton.isVisible().catch(() => false)) {
      console.log(`"View job »" button not found for job ${details.jobId}.`);
      noteHistory(history, details, "FAILED", { reason: "View job button not found or visible on job card." });
      saveHistory(history);
      stats.failed += 1;
      stats.processed += 1;
      return { status: "FAILED", job: details, overlayStillOpen: false };
    }

    try {
      await viewJobButton.click({ timeout: 5000 });
    } catch (err) {
      console.error(`Failed to click View job for ${details.jobId}: ${err.message}`);
      noteHistory(history, details, "FAILED", { reason: `View job click failed: ${err.message}` });
      saveHistory(history);
      stats.failed += 1;
      stats.processed += 1;
      return { status: "FAILED", job: details, overlayStillOpen: false };
    }

    const modalWrap = page.locator(".application-modal-wrap").first();
    try {
      await modalWrap.waitFor({ state: "visible", timeout: 6000 });
    } catch {
      console.log(`Overlay did not appear after clicking View job for ${details.jobId}.`);
      noteHistory(history, details, "FAILED", { reason: "Overlay did not become visible after View job click." });
      saveHistory(history);
      stats.failed += 1;
      stats.processed += 1;
      return { status: "FAILED", job: details, overlayStillOpen: false };
    }
  }

  const modalWrap = page.locator(".application-modal-wrap").first();

  // 2. Wait until job overlay is fully loaded
  const { details: overlayDetails } = await waitForOverlayContent(page, {
    expectedJobId: candidateJob.jobId,
    timeoutMs: 8000
  });

  const targetJob = {
    ...candidateJob,
    title: overlayDetails.title || candidateJob.title,
    company: overlayDetails.company || candidateJob.company,
    location: overlayDetails.location || candidateJob.location,
    experience: overlayDetails.experience || candidateJob.experience,
    skills: (overlayDetails.skills && overlayDetails.skills.length) ? overlayDetails.skills : candidateJob.skills
  };

  const jobId = targetJob.jobId;
  console.log(`\nActive job: ID ${jobId} | ${targetJob.title} @ ${targetJob.company}`);

  // Check if external application modal is open
  if (await isExternalModalVisible(page)) {
    console.log(`Job ${jobId} requires external application on company website. Skipping...`);
    noteHistory(history, targetJob, "SKIPPED_EXTERNAL", { reason: "External company application required." });
    saveHistory(history);
    stats.skippedExternal += 1;
    stats.processed += 1;
    await closeExternalModal(page);
    await closeOverlay(page);
    await ensureRecommendedJobsSection(page);
    return { status: "SKIPPED_EXTERNAL", job: targetJob, overlayStillOpen: false };
  }

  if (inspectOnly || dryRun) {
    console.log(`[DRY-RUN] Inspecting job ${jobId} - Apply not clicked.`);
    noteHistory(history, targetJob, "UNVERIFIED", { reason: "Dry-run / inspect-only mode stopped before Apply." });
    saveHistory(history);
    stats.unverified += 1;
    stats.processed += 1;
    await closeOverlay(page);
    await ensureRecommendedJobsSection(page);
    return { status: "UNVERIFIED", job: targetJob, overlayStillOpen: false };
  }

  const applyButton = await findApplyButton(page);
  if (!applyButton) {
    console.log(`Apply button not found in overlay for job ${jobId}.`);
    noteHistory(history, targetJob, "FAILED", { reason: "Scoped Apply button was not found in overlay." });
    saveHistory(history);
    stats.failed += 1;
    stats.processed += 1;
    await closeOverlay(page);
    await ensureRecommendedJobsSection(page);
    return { status: "FAILED", job: targetJob, overlayStillOpen: false };
  }

  // 3. Click Apply
  console.log(`\nClicking Instahyre Apply for job ${jobId}...`);
  try {
    await applyButton.click({ timeout: 5000 });
  } catch (err) {
    console.error(`Apply button click failed: ${err.message}`);
    noteHistory(history, targetJob, "FAILED", { reason: `Apply click interaction failed: ${err.message}` });
    saveHistory(history);
    stats.failed += 1;
    stats.processed += 1;
    await closeOverlay(page);
    await ensureRecommendedJobsSection(page);
    return { status: "FAILED", job: targetJob, overlayStillOpen: false };
  }

  // 4. Bounded wait for resulting post-Apply UI state
  const postApplyStartTime = Date.now();
  let handledSimilarJobs = false;

  while (Date.now() - postApplyStartTime < 4000) {
    // Check for "Apply to N jobs" similar-jobs overlay -> Apply!
    const similarOverlayInfo = await detectSimilarJobsOverlay(page);
    if (similarOverlayInfo.detected) {
      await handleSimilarJobsPopup(page, similarOverlayInfo);
      handledSimilarJobs = true;
      break;
    }

    // Check for optional social/premium popup -> Dismiss!
    if (await isSocialPopupVisible(page)) {
      await handleOptionalSocialPopup(page);
      break;
    }

    // Check for external application modal that appeared after apply
    if (await isExternalModalVisible(page)) {
      console.log(`Job ${jobId} opened external application modal after Apply. Marked SKIPPED_EXTERNAL.`);
      noteHistory(history, targetJob, "SKIPPED_EXTERNAL", { reason: "External modal appeared on Apply." });
      saveHistory(history);
      stats.skippedExternal += 1;
      stats.processed += 1;
      await closeExternalModal(page);
      await closeOverlay(page);
      await ensureRecommendedJobsSection(page);
      return { status: "SKIPPED_EXTERNAL", job: targetJob, overlayStillOpen: false };
    }

    // If overlay already closed naturally
    if (!await isOverlayOpen(page)) {
      break;
    }

    await page.waitForTimeout(200);
  }

  // Double check if similar jobs appeared slightly delayed after social popup
  if (!handledSimilarJobs) {
    const similarOverlayInfo = await detectSimilarJobsOverlay(page);
    if (similarOverlayInfo.detected) {
      await handleSimilarJobsPopup(page, similarOverlayInfo);
    }
  }

  // 5. Close/finish the overlay and return to main Opportunities page BEFORE opening Applied section
  console.log("Closing job overlay...");
  await closeOverlay(page);
  console.log("Returned to Opportunities page.\n");

  // 6. Open Applied section & Authoritatively verify application
  console.log(`Verifying application for job ${jobId} in Applied section...`);
  let isApplied = await verifyJobInAppliedSection(page, jobId, history);

  if (!isApplied) {
    // Retry verification once after a brief stabilization wait
    await page.waitForTimeout(1500);
    isApplied = await verifyJobInAppliedSection(page, jobId, history);
  }

  if (isApplied) {
    console.log(`Job ${jobId} confirmed in Applied section.`);
    noteHistory(history, targetJob, "APPLIED", { reason: "Confirmed in Applied Jobs section." });
    saveHistory(history);
    stats.applied += 1;
    stats.processed += 1;
    return { status: "APPLIED", job: targetJob, overlayStillOpen: false };
  } else {
    console.log(`Warning: Job ${jobId} could not be confirmed in Applied section. Marking UNVERIFIED.`);
    noteHistory(history, targetJob, "UNVERIFIED", { reason: "Not confirmed in Applied section." });
    saveHistory(history);
    stats.unverified += 1;
    stats.processed += 1;
    return { status: "UNVERIFIED", job: targetJob, overlayStillOpen: false };
  }
}

function getLimit() {
  const flagIndex = process.argv.indexOf("--limit");
  if (flagIndex === -1) return Number.POSITIVE_INFINITY;
  const value = Number(process.argv[flagIndex + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error("--limit must be a positive integer.");
  return value;
}

function getFlag(name) {
  return process.argv.includes(`--${name}`) || process.argv.includes(`--${name}=true`);
}

async function main() {
  const inspectOnly = getFlag("inspect-only");
  const dryRun = getFlag("dry-run");
  const limit = getLimit();

  const history = loadHistory();
  const stats = createCurrentRunStats();
  stats.totalTrackedBefore = Object.keys(history.jobs || {}).length;

  console.log("==================================================");
  console.log("Starting Instahyre Automation Agent");
  console.log(`Limit: ${Number.isFinite(limit) ? limit : "Unlimited"} | Dry-run: ${dryRun || inspectOnly}`);
  console.log("==================================================");

  const browserConfig = loadBrowserConfig();
  const browserContext = await launchEdge(browserConfig);
  let page = null;

  try {
    const pages = browserContext.pages();
    page = pages.length > 0 ? pages[0] : await browserContext.newPage();

    console.log(`Navigating to Instahyre: ${DEFAULT_URL}`);
    await page.goto(DEFAULT_URL, {
      waitUntil: "domcontentloaded",
      timeout: browserConfig.navigationTimeoutMs || 45000
    });
    await page.waitForTimeout(browserConfig.pageLoadWaitMs || 1500);

    if (await hasInstahyreSecurityCheck(page)) {
      throw new Error("Instahyre security check or CAPTCHA detected. Stopping automation safely.");
    }

    if (await isInstahyreLoginRequired(page)) {
      throw new Error("Instahyre is not logged in. Please log in manually in the browser profile first.");
    }

    await ensureRecommendedJobsSection(page);

    // Count discovered jobs in Recommended Jobs
    const rows = page.locator("div.employer-row");
    stats.jobsDiscovered = await rows.count().catch(() => 0);
    console.log(`Found ${stats.jobsDiscovered} job cards in Recommended Jobs.`);

    const seenJobIds = new Set();
    let processedCount = 0;
    while (processedCount < limit) {
      const result = await processSingleJob(page, history, stats, {
        inspectOnly,
        dryRun,
        seenJobIds
      });

      if (result.status === "NO_MORE_JOBS") {
        console.log("\nNo more unprocessed jobs found in Recommended Jobs.");
        break;
      }

      processedCount += 1;
      await page.waitForTimeout(1000);
    }

    saveHistory(history);
    stats.totalTrackedAfter = Object.keys(history.jobs || {}).length;
    console.log("\n" + formatAutomationSummary(stats));
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserContext) await browserContext.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error("Instahyre Automation Error:", err.message || err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_URL,
  RECOMMENDED_SECTION_NAME,
  VALID_SECTIONS,
  HISTORY_FILE,
  loadHistory,
  saveHistory,
  isTerminalHistoryStatus,
  createCurrentRunStats,
  formatAutomationSummary,
  noteHistory,
  extractInstahyreJobId,
  extractJobCardDetails,
  extractOverlayJobDetails,
  waitForOverlayContent,
  isOverlayOpen,
  isExternalModalVisible,
  isSocialPopupVisible,
  handleOptionalSocialPopup,
  detectSimilarJobsOverlay,
  isSimilarJobsPopupVisible,
  handleSimilarJobsPopup,
  fetchAppliedJobs,
  verifyJobInAppliedSection,
  closeExternalModal,
  closeOverlay,
  findApplyButton,
  ensureRecommendedJobsSection,
  findNextUnprocessedJobCard,
  processSingleJob,
  main
};

