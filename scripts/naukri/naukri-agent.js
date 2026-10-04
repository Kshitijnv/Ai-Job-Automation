#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { loadBrowserConfig, launchEdge, isLinkedInLoginRequired, hasLinkedInSecurityCheck } = require("../lib/browser");
const questionMapper = require("../shared/question-mapper");
const semanticResolver = require("../lib/semantic-resolver");
const reviewQueue = require("../lib/review-queue");
const questionResolver = require("../lib/llm/question-resolver");

const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT = path.join(ROOT, "output");
const HISTORY_FILE = path.join(OUTPUT, "naukri_application_history.json");
const CONFIG_FILE = path.join(ROOT, "config", "application.json");
const PROFILE_FILE = path.join(ROOT, "config", "profile.json");
const BROWSER_CONFIG_FILE = path.join(ROOT, "config", "browser.json");

const SECTION_ORDER = ["Applies", "Profile", "Preferences", "You might like"];
const DEFAULT_URL = "https://www.naukri.com/";
const JOBS_FALLBACK_URL = "https://www.naukri.com/mnjuser/recommendedjobs";
const MAX_CHATBOT_QUESTIONS = 20;
const terminalChatbotObservers = new WeakMap();
let terminalChatbotObserverId = 0;
const TERMINAL_CHATBOT_MESSAGES = new Set([
  "thank you for your responses",
  "thank you for your response",
  "your responses have been submitted",
  "your response has been submitted",
  "we have received your responses",
  "we have received your response",
  "thank you for showing interest",
  "thank you for showing interest kindly answer all the recruiter's questions to successfully apply for the job",
  "thank you for showing interest kindly answer all the recruiters questions to successfully apply for the job"
]);

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
  const payload = { generatedAt: new Date().toISOString(), jobs: history.jobs };
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, HISTORY_FILE);
}

function createCurrentRunStats(selectedSection = "") {
  return {
    selectedSection: selectedSection || "All",
    sectionsProcessed: 0,
    jobsDiscovered: 0,
    jobsWithSelectableCheckbox: 0,
    jobsWithoutCheckbox: 0,
    excludedByHistory: 0,
    skippedNoCheckbox: 0,
    newJobsConsidered: 0,
    processed: 0,
    applied: 0,
    needsUserInput: 0,
    failed: 0,
    unverified: 0,
    skippedExternal: 0,
    skippedUnknownRoute: 0,
    jobsNeedingUserInput: 0,
    unresolvedQuestions: 0,
    alreadyTrackedBefore: 0,
    totalTrackedAfter: 0
  };
}

function formatAutomationSummary(stats) {
  const lines = [
    "==================================================",
    "Naukri Job Automation Summary",
    "==================================================",
    "",
    "Section",
    "-------",
    `Selected section: ${stats.selectedSection || "All"}`,
    `Sections processed: ${stats.sectionsProcessed || 0}`,
    "",
    "Discovery",
    "---------",
    `Jobs discovered: ${stats.jobsDiscovered || 0}`,
    `Jobs with selectable checkbox: ${stats.jobsWithSelectableCheckbox || 0}`,
    `Jobs without checkbox: ${stats.jobsWithoutCheckbox || 0}`,
    `Excluded by persistent history: ${stats.excludedByHistory || 0}`,
    `New jobs considered: ${stats.newJobsConsidered || 0}`,
    "",
    "Current Run Results",
    "-------------------",
    `Processed: ${stats.processed || 0}`,
    `Applied: ${stats.applied || 0}`,
    `Needs user input: ${stats.needsUserInput || 0}`,
    `Failed: ${stats.failed || 0}`,
    `Unverified: ${stats.unverified || 0}`,
    `Skipped - external: ${stats.skippedExternal || 0}`,
    `Skipped - unknown route: ${stats.skippedUnknownRoute || 0}`,
    "",
    "User Input",
    "----------",
    `Jobs needing user input: ${stats.jobsNeedingUserInput || 0}`,
    `Unresolved questions: ${stats.unresolvedQuestions || 0}`,
    "",
    "History",
    "-------",
    `Already tracked before this run: ${stats.alreadyTrackedBefore || 0}`,
    `Total tracked after this run: ${stats.totalTrackedAfter || 0}`,
    "",
    "=================================================="
  ];
  return lines.join("\n");
}

function buildHistorySummary(history) {
  const counters = {
    sectionsProcessed: 0,
    jobsDiscovered: 0,
    newJobsConsidered: 0,
    applied: 0,
    skippedExternal: 0,
    skippedNoCheckbox: 0,
    needsUserInput: 0,
    failed: 0,
    unverified: 0,
    alreadyCompletedSkipped: 0
  };

  const entries = Object.values(history.jobs || {});
  for (const entry of entries) {
    const status = String(entry.status || "").toUpperCase();
    if (status === "APPLIED") counters.applied += 1;
    else if (status === "SKIPPED_EXTERNAL") counters.skippedExternal += 1;
    else if (status === "SKIPPED_NO_CHECKBOX") counters.skippedNoCheckbox += 1;
    else if (status === "NEEDS_USER_INPUT") counters.needsUserInput += 1;
    else if (status === "FAILED") counters.failed += 1;
    else if (status === "UNVERIFIED") counters.unverified += 1;
    else counters.alreadyCompletedSkipped += 1;
  }

  return counters;
}

function noteHistory(history, job, status, section, extra = {}) {
  const jobId = String(job.jobId || job.id || "").trim();
  if (!jobId) return;
  history.jobs[jobId] = {
    jobId,
    title: String(job.title || ""),
    company: String(job.company || ""),
    status,
    section: String(section || ""),
    processedAt: new Date().toISOString(),
    ...extra
  };
}

function filterJobsWithSelectableCheckbox(jobs, history, section) {
  const actionable = [];
  for (const job of jobs) {
    if (job.hasSelectableCheckbox) {
      actionable.push(job);
      continue;
    }
    noteHistory(history, job, "SKIPPED_NO_CHECKBOX", section, {
      reason: "The job article has no visible selectable checkbox control."
    });
  }
  return actionable;
}

function normalizeSectionName(value = "") {
  const plain = String(value).replace(/\s+/g, " ").trim();
  if (!plain) return "";
  const withoutDynamicCount = plain.replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim();
  const lowered = withoutDynamicCount.toLowerCase();
  const canonical = SECTION_ORDER.find(section => section.toLowerCase() === lowered);
  if (canonical) return canonical;
  return withoutDynamicCount || plain;
}

function matchesSectionName(text, section) {
  const normalized = normalizeSectionName(text);
  return normalized === section;
}

function textOf(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getFlag(name) {
  return process.argv.includes(`--${name}`) || process.argv.includes(`--${name}=true`);
}

function getLimit() {
  const flagIndex = process.argv.indexOf("--limit");
  if (flagIndex === -1) return Number.POSITIVE_INFINITY;
  const value = Number(process.argv[flagIndex + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error("--limit must be a positive integer.");
  return value;
}

function getRequestedSection(args = process.argv) {
  const equalsArg = args.find(argument => String(argument).startsWith("--section="));
  const sectionIndex = args.indexOf("--section");
  if (!equalsArg && sectionIndex === -1) return "";
  const rawValue = equalsArg
    ? String(equalsArg).slice("--section=".length).trim()
    : String(args[sectionIndex + 1] || "").trim();
  if (!rawValue || rawValue.startsWith("--")) {
    throw new Error(`Invalid Naukri section: "${rawValue}"\nValid sections:\n${SECTION_ORDER.map(section => `- ${section}`).join("\n")}`);
  }
  const normalized = normalizeSectionName(rawValue);
  if (!SECTION_ORDER.includes(normalized)) {
    throw new Error(`Invalid Naukri section: "${rawValue}"\nValid sections:\n${SECTION_ORDER.map(section => `- ${section}`).join("\n")}`);
  }
  return normalized;
}

function selectRequestedSections(sections, requestedSection) {
  if (!requestedSection) return sections;
  const selected = sections.find(section => section.name === requestedSection);
  if (!selected) {
    throw new Error(`Requested Naukri section "${requestedSection}" was not found on the Jobs page.`);
  }
  return [selected];
}

async function safeWait(page, ms = 1200) {
  await page.waitForTimeout(ms);
}

async function verifyNaukriPage(page, label = "Naukri") {
  const currentUrl = page.url();
  const pageText = await page.locator("body").innerText().catch(() => "");
  const lowerText = `${currentUrl} ${pageText}`.toLowerCase();
  const isNaukri = /naukri\.com|job search|jobs|recommended jobs/.test(lowerText);
  if (!isNaukri) {
    throw new Error(`The page does not appear to be Naukri while opening ${label}.`);
  }
  if (await isLinkedInLoginRequired(page) || await hasLinkedInSecurityCheck(page)) {
    throw new Error("Naukri is not ready due to a login or security challenge; automation stopped safely.");
  }
  return true;
}

async function clickJobsNavigation(page) {
  const selectors = [
    "a[title*='Jobs' i]",
    "a[title*='Recommended Jobs' i]",
    "a[href*='/mnjuser/']",
    "[role='link']",
    "li:has-text('Jobs')",
    "button:has-text('Jobs')"
  ];

  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    for (let index = 0; index < count; index++) {
      const control = page.locator(selector).nth(index);
      if (!(await control.isVisible().catch(() => false))) continue;
      const text = textOf(await control.innerText().catch(() => ""));
      const href = await control.getAttribute("href").catch(() => "");
      if (/jobs/i.test(text) || /recommended jobs/i.test(text) || /\/mnjuser\//i.test(href || "")) {
        try {
          await control.click({ timeout: 10000 });
          await safeWait(page, 1500);
          return true;
        } catch (error) {
          continue;
        }
      }
    }
  }

  try {
    await page.goto(JOBS_FALLBACK_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await safeWait(page, 1500);
    return true;
  } catch (error) {
    return false;
  }
}

async function discoverSections(page) {
  const sectionMatches = [];
  const candidateSelectors = ["[role='tab']", ".tab-list-item", "button", "a", "li"];

  for (const selector of candidateSelectors) {
    const count = await page.locator(selector).count();
    for (let index = 0; index < count; index++) {
      const item = page.locator(selector).nth(index);
      const text = textOf(await item.innerText().catch(() => ""));
      const label = normalizeSectionName(text);
      if (!label) continue;
      for (const known of SECTION_ORDER) {
        if (matchesSectionName(text, known)) {
          sectionMatches.push({ name: known, label: text, locator: item, normalizedLabel: label });
          break;
        }
      }
    }
  }

  return SECTION_ORDER.map(known => sectionMatches.find(section => section.name === known)).filter(Boolean);
}

async function getActiveSectionName(page) {
  return page.locator("[role='tab'], .tab-list-item, button, a, li").evaluateAll(elements => {
    const sectionName = value => {
      const label = String(value || "").replace(/\s+/g, " ").trim().replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim().toLowerCase();
      if (label.includes("applies")) return "Applies";
      if (label.includes("profile")) return "Profile";
      if (label.includes("preferences")) return "Preferences";
      if (label.includes("you might like") || label.includes("might like")) return "You might like";
      return "";
    };
    for (const element of elements) {
      const className = element.getAttribute("class") || "";
      const active = /(?:^|\s)(?:active|selected|is-active|is-selected|tab-active|tab-list-active|tabSelected|current)(?:\s|$)/i.test(className)
        || element.getAttribute("aria-selected") === "true"
        || element.getAttribute("aria-current") === "true"
        || element.getAttribute("aria-expanded") === "true";
      if (!active) continue;
      const name = sectionName(element.innerText || element.textContent);
      if (name) return name;
    }
    return "";
  });
}

async function activateSection(page, targetSection, tab) {
  const discoveredText = textOf(await tab.innerText().catch(() => ""));
  const normalized = normalizeSectionName(discoveredText);
  if (!normalized) {
    return { activated: false, label: discoveredText, reason: "No readable section text was available on the tab." };
  }

  if (normalized !== targetSection) {
    return { activated: false, label: discoveredText, reason: `Tab normalized label '${normalized}' did not match target section '${targetSection}'.` };
  }

  if (await getActiveSectionName(page) === targetSection) {
    await safeWait(page, 1000);
    return { activated: true, label: discoveredText, reason: "Requested section was already active and its content was refreshed." };
  }

  try {
    await tab.click({ timeout: 10000 });
  } catch (error) {
    try {
      await tab.evaluate(element => {
        const clickable = element.closest("button, a, [role='tab'], [data-tab], .tab-list-item") || element;
        if (clickable && typeof clickable.click === "function") clickable.click();
      });
    } catch (fallbackError) {
      return { activated: false, label: discoveredText, reason: `Tab click failed: ${error.message}; fallback click also failed: ${fallbackError.message}` };
    }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await safeWait(page, 250);
    if (await getActiveSectionName(page) === targetSection) {
      return { activated: true, label: discoveredText, reason: "Requested section became active; live jobs will be re-scanned." };
    }
  }
  return { activated: false, label: discoveredText, reason: "The requested section did not become active after its tab was clicked." };
}

function sectionContextError(message) {
  const error = new Error(message);
  error.code = "NAUKRI_SECTION_CONTEXT_ERROR";
  return error;
}

async function ensureSectionActive(page, targetSection) {
  if (!SECTION_ORDER.includes(targetSection)) {
    throw sectionContextError(`Unknown Naukri section '${targetSection}'. Expected one of: ${SECTION_ORDER.join(", ")}.`);
  }

  let sections = await discoverSections(page);
  if (!isNaukriHostname(page.url()) && !sections.length) {
    const returnedToJobs = await clickJobsNavigation(page);
    if (!returnedToJobs) throw sectionContextError(`Naukri section '${targetSection}' could not be reached after navigation.`);
    sections = await discoverSections(page);
  }

  let section = sections.find(item => item.name === targetSection);
  if (!section) {
    const returnedToJobs = await clickJobsNavigation(page);
    if (returnedToJobs) {
      sections = await discoverSections(page);
      section = sections.find(item => item.name === targetSection);
    }
  }
  if (!section) throw sectionContextError(`Requested Naukri section '${targetSection}' was not found after returning to the Jobs page.`);

  if (await getActiveSectionName(page) !== targetSection) {
    const activation = await activateSection(page, targetSection, section.locator);
    if (!activation.activated) {
      throw sectionContextError(`Requested Naukri section '${targetSection}' could not be activated: ${activation.reason}`);
    }
  }

  await safeWait(page, 1000);
  const activeSection = await getActiveSectionName(page);
  if (activeSection !== targetSection) {
    throw sectionContextError(`Requested Naukri section '${targetSection}' is not active; current section is '${activeSection || "unknown"}'.`);
  }
  const jobs = await discoverJobs(page);
  return { section, jobs };
}

function normalizeJobId(value) {
  return String(value || "").trim();
}

function escapeSelector(value) {
  return String(value || "").replace(/([\\"'\s:#.\[\]\(\)\+\>\~\^\=\*\|\@\$])/g, "\\$1");
}

function isTerminalHistoryStatus(status) {
  return ["APPLIED", "SKIPPED_EXTERNAL", "SKIPPED_NO_CHECKBOX"].includes(String(status || "").toUpperCase());
}

function isJobPermanentlyExcludedByHistory(history, jobId) {
  const id = normalizeJobId(jobId);
  if (!id || !history || !history.jobs) return false;
  const existing = history.jobs[id];
  if (!existing || typeof existing !== "object") return false;
  return isTerminalHistoryStatus(existing.status);
}

function isNaukriHostname(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "naukri.com" || hostname.endsWith(".naukri.com");
  } catch {
    return false;
  }
}

async function clearSelectedJobs(page) {
  const selected = page.locator(".naukicon-ot-Checked, .selected, [aria-checked='true'], input[type='checkbox']:checked");
  const count = await selected.count();
  for (let index = 0; index < count; index++) {
    await selected.nth(index).click({ force: true }).catch(() => {});
  }
}

async function captureSectionUrl(page) {
  const currentUrl = page.url();
  if (!currentUrl || !isNaukriHostname(currentUrl)) {
    return JOBS_FALLBACK_URL;
  }
  return currentUrl;
}

async function restoreSectionUrl(page, sectionUrl) {
  const targetUrl = sectionUrl && isNaukriHostname(sectionUrl) ? sectionUrl : JOBS_FALLBACK_URL;
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await safeWait(page, 1500);
    const liveStatus = `${page.url()} ${await page.locator("body").innerText().catch(() => "")}`.toLowerCase();
    if (!/naukri\.com|jobs|recommended jobs/.test(liveStatus)) {
      await page.goto(JOBS_FALLBACK_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await safeWait(page, 1500);
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function detectFormQuestions(page) {
  const values = await page.locator("label, textarea, input:not([type=hidden]):not([type=submit]):not([type=button]), select, [role='textbox'], [role='combobox']").evaluateAll(elements => {
    const seen = new Set();
    const results = [];
    for (const element of elements) {
      const text = [
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.closest("label")?.innerText || "",
        element.name,
        element.id
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      results.push(text);
    }
    return results;
  });
  return values.filter(Boolean);
}

async function resolveNaukriAnswerDetails(question, applicationConfig, profile, semanticOptions = {}) {
  const text = String(question || "").replace(/\s+/g, " ").trim();

  const semantic = await semanticResolver.resolveSemanticAnswer(text, {
    applicationConfig,
    profile,
    question: text,
    experienceYearsRule: true
  }, semanticOptions);

  if (semantic && semantic.status === "RESOLVED") {
    if (semantic.intent === "notice_period_with_lwd") {
      const noticePeriodDays = Number(semantic.values?.noticePeriodDays);
      const lastWorkingDay = String(semantic.values?.lastWorkingDay || "").trim();
      if (!Number.isFinite(noticePeriodDays) || !lastWorkingDay) return { semantic, answer: undefined };
      return { semantic, answer: `${noticePeriodDays} days, LWD: ${lastWorkingDay}` };
    }
    if (semantic.safeTextualAnswer) {
      return { semantic, answer: semantic.safeTextualAnswer };
    }
    if (semantic.displayValue !== undefined && semantic.displayValue !== null && semantic.displayValue !== "") {
      return { semantic, answer: semantic.displayValue };
    }
    if (semantic.answer !== undefined && semantic.answer !== null && semantic.answer !== "") {
      return { semantic, answer: semantic.answer };
    }
    return { semantic, answer: undefined };
  }

  if (semanticResolver.isSemanticFallbackCandidate(text)
      && semantic?.status !== "RESOLVED") return { semantic, answer: undefined };

  const canonical = questionMapper.canonicalQuestion(text, { experienceYearsRule: true });
  if (!canonical) return { semantic, answer: undefined };

  const answer = questionMapper.resolveConfiguredAnswer(canonical, {
    applicationConfig,
    profile,
    question: text,
    experienceYearsRule: true
  });

  if (answer !== undefined && answer !== null && answer !== "") {
    return { semantic, answer };
  }

  return { semantic, answer: undefined };
}

async function resolveNaukriAnswer(question, applicationConfig, profile, semanticOptions = {}) {
  const result = await resolveNaukriAnswerDetails(question, applicationConfig, profile, semanticOptions);
  return result.answer;
}

function classifyNaukriChatbotMessage(message) {
  const normalized = String(message || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return "AMBIGUOUS";

  const terminalCandidate = normalized.replace(/[.!]+$/g, "").trim();
  const cleanNormalized = normalized.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!/[?？]/u.test(normalized)) {
    if (TERMINAL_CHATBOT_MESSAGES.has(terminalCandidate) || TERMINAL_CHATBOT_MESSAGES.has(cleanNormalized)) {
      return "TERMINAL";
    }
    if (cleanNormalized.startsWith("thank you for your response")
        || cleanNormalized.startsWith("thank you for your responses")
        || cleanNormalized.startsWith("your response has been submitted")
        || cleanNormalized.startsWith("your responses have been submitted")
        || cleanNormalized.startsWith("we have received your response")
        || cleanNormalized.startsWith("we have received your responses")
        || cleanNormalized.startsWith("thank you for showing interest")) {
      return "TERMINAL";
    }
  }

  if (/[?？]/u.test(normalized)
      || /^(?:how many|how much|what|when|where|who|why|which|do|does|did|are|is|can|could|will|would|have|has|should)\b/.test(normalized)
      || /^notice period\s*\(/.test(normalized)
      || /^(?:please\s+)?(?:mention|provide|enter|select|specify|state|confirm)\b/.test(normalized)
      || /^(?:notice period|last working day|lwd|current location)\b/.test(normalized)) {
    return "QUESTION";
  }

  return "AMBIGUOUS";
}

function numericExperienceValue(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const match = String(value || "").match(/^\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?\s*$/i);
  return match ? Number(match[1]) : null;
}

function parseNumericRangeOption(label) {
  const text = String(label || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text) return null;
  if (/\bfresher\b/.test(text)) return { min: 0, max: 0, minInclusive: true, maxInclusive: true };

  const lessThan = text.match(/(?:less than|under|<)\s*(\d+(?:\.\d+)?)/);
  if (lessThan) return { min: 0, max: Number(lessThan[1]), minInclusive: true, maxInclusive: false };

  const moreThan = text.match(/(?:more than|over|>)\s*(\d+(?:\.\d+)?)/);
  if (moreThan) return { min: Number(moreThan[1]), max: Number.POSITIVE_INFINITY, minInclusive: false, maxInclusive: false };

  const plus = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*\+/);
  if (plus) return { min: Number(plus[1]), max: Number.POSITIVE_INFINITY, minInclusive: true, maxInclusive: false };

  const range = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(\d+(?:\.\d+)?)(?:\s|$)/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (max < min) return null;
    return { min, max, minInclusive: true, maxInclusive: true };
  }

  return null;
}

function findUniqueNumericRangeOption(value, options) {
  const numericValue = numericExperienceValue(value);
  if (numericValue === null || !Array.isArray(options)) return null;
  const matches = options.map((option, index) => {
    const label = typeof option === "string" ? option : option?.label;
    const range = parseNumericRangeOption(label);
    if (!range) return null;
    const aboveMin = range.minInclusive ? numericValue >= range.min : numericValue > range.min;
    const belowMax = range.maxInclusive ? numericValue <= range.max : numericValue < range.max;
    return aboveMin && belowMax ? { index, label: String(label).trim() } : null;
  }).filter(Boolean);
  return matches.length === 1 ? matches[0] : null;
}

function isLocationMatched(optionLabel, canonicalLocations = []) {
  const normLabel = normalizeOptionText(optionLabel).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  return canonicalLocations.some(location => {
    const normLoc = normalizeOptionText(location).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
    if (normLabel === normLoc) return true;
    if (normLoc.includes("remote") && normLabel.includes("remote")) return true;
    if (normLoc.includes("gurugram") && (normLabel.includes("gurugram") || normLabel.includes("gurgaon"))) return true;
    if (normLoc.includes("noida") && normLabel.includes("noida")) return true;
    if ((normLoc.includes("delhi") || normLoc.includes("ncr")) && (normLabel.includes("delhi") || normLabel.includes("ncr"))) return true;
    if (normLoc.includes("pune") && normLabel.includes("pune")) return true;
    if (normLoc.includes("mumbai") && normLabel.includes("mumbai")) return true;
    if (normLoc.includes("bangalore") && (normLabel.includes("bangalore") || normLabel.includes("bengaluru"))) return true;
    if (normLoc.includes("hyderabad") && normLabel.includes("hyderabad")) return true;
    return false;
  });
}

function findPriorityRelocationOption(configuredLocations = [], options = []) {
  const locList = Array.isArray(configuredLocations) ? configuredLocations : [configuredLocations];
  for (const loc of locList) {
    if (!loc) continue;
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      const label = typeof option === "string" ? option : (option?.label || "");
      if (isLocationMatched(label, [loc])) {
        return { index, label: String(label).trim(), matchedLocation: loc };
      }
    }
  }
  return null;
}

async function selectMultipleCheckboxLocations(group, canonicalLocations = []) {
  const { checkboxes, options } = await readExperienceRangeOptions(group);
  const labels = group.locator("label");
  const clickVisibleLabel = async (option, desiredChecked) => {
    if (!option.labelVisible || option.labelIndex < 0) return { clicked: false, unsupported: true };
    const label = labels.nth(option.labelIndex);
    if (!await label.isVisible().catch(() => false)) return { clicked: false, unsupported: true };
    try {
      await label.click({ timeout: 5000 });
      let checked = await checkboxes.nth(option.index).evaluate(element => Boolean(element.checked));
      if (checked !== desiredChecked) {
        await checkboxes.nth(option.index).click({ force: true, timeout: 3000 });
        checked = await checkboxes.nth(option.index).evaluate(element => Boolean(element.checked));
      }
      if (checked !== desiredChecked) return { clicked: false, interactionFailed: true, reason: `Could not set checkbox '${option.label}' to ${desiredChecked}` };
      return { clicked: true };
    } catch (error) {
      return { clicked: false, interactionFailed: true, reason: error.message };
    }
  };

  const selectedLabels = [];
  for (const option of options) {
    const shouldBeChecked = isLocationMatched(option.label, canonicalLocations);
    if (shouldBeChecked) selectedLabels.push(option.label);
    if (option.checked !== shouldBeChecked) {
      const result = await clickVisibleLabel(option, shouldBeChecked);
      if (!result.clicked) {
        return { selected: false, interactionFailed: Boolean(result.interactionFailed), reason: result.reason || `Checkbox for '${option.label}' could not be toggled.` };
      }
    }
  }

  for (const option of options) {
    const shouldBeChecked = isLocationMatched(option.label, canonicalLocations);
    const actualChecked = await checkboxes.nth(option.index).evaluate(element => Boolean(element.checked));
    if (actualChecked !== shouldBeChecked) {
      return { selected: false, reason: `Checkbox state verification failed for option '${option.label}'. Expected: ${shouldBeChecked}, Actual: ${actualChecked}` };
    }
  }

  return { selected: true, labels: selectedLabels };
}

async function selectMultipleCheckboxOptions(group, targetLabels = []) {
  const { checkboxes, options } = await readExperienceRangeOptions(group);
  const labels = group.locator("label");
  const normTargets = new Set(targetLabels.map(l => normalizeOptionText(l)));

  const clickVisibleLabel = async (option, desiredChecked) => {
    if (!option.labelVisible || option.labelIndex < 0) return { clicked: false, unsupported: true };
    const label = labels.nth(option.labelIndex);
    if (!await label.isVisible().catch(() => false)) return { clicked: false, unsupported: true };
    try {
      await label.click({ timeout: 5000 });
      let checked = await checkboxes.nth(option.index).evaluate(element => Boolean(element.checked));
      if (checked !== desiredChecked) {
        await checkboxes.nth(option.index).click({ force: true, timeout: 3000 });
        checked = await checkboxes.nth(option.index).evaluate(element => Boolean(element.checked));
      }
      if (checked !== desiredChecked) return { clicked: false, interactionFailed: true, reason: `Could not set checkbox '${option.label}' to ${desiredChecked}` };
      return { clicked: true };
    } catch (error) {
      return { clicked: false, interactionFailed: true, reason: error.message };
    }
  };

  const selectedLabels = [];
  for (const option of options) {
    const shouldBeChecked = normTargets.has(normalizeOptionText(option.label));
    if (shouldBeChecked) selectedLabels.push(option.label);
    if (option.checked !== shouldBeChecked) {
      const result = await clickVisibleLabel(option, shouldBeChecked);
      if (!result.clicked) {
        return { selected: false, interactionFailed: Boolean(result.interactionFailed), reason: result.reason || `Checkbox for '${option.label}' could not be toggled.` };
      }
    }
  }

  for (const option of options) {
    const shouldBeChecked = normTargets.has(normalizeOptionText(option.label));
    const actualChecked = await checkboxes.nth(option.index).evaluate(element => Boolean(element.checked));
    if (actualChecked !== shouldBeChecked) {
      return { selected: false, reason: `Checkbox state verification failed for option '${option.label}'. Expected: ${shouldBeChecked}, Actual: ${actualChecked}` };
    }
  }

  return { selected: true, labels: selectedLabels };
}

function isRorOrSafeNaSkill(semantic) {
  if (semantic?.safeTextualAnswer === "NA") return true;
  const skill = semantic?.entities?.skill || semantic?.skill;
  return Boolean(skill && questionMapper.normalizedSkillName(skill) === "ruby on rails");
}

function decideNaukriAnswerControl({ intent, answer, options = [], hasTextInput = false, semantic = null } = {}) {
  if (intent === "relocation_locations" || Array.isArray(answer) || semantic?.canonicalId === "willing_to_relocate" || intent === "willing_to_relocate") {
    if (options.length) {
      const locations = Array.isArray(answer) ? answer : (semantic?.entities?.locations || ["Remote", "Pune", "Gurugram", "Noida", "Delhi/NCR"]);
      const priorityMatch = findPriorityRelocationOption(locations, options);
      if (priorityMatch) {
        return { status: "SUPPORTED", control: "SINGLE_OPTION", ...priorityMatch, answer: priorityMatch.label };
      }
      return { status: "SUPPORTED", control: "MULTI_LOCATION_CHECKBOX", answer };
    }
    if (hasTextInput) {
      return { status: "SUPPORTED", control: "TEXT", answer: Array.isArray(answer) ? answer.join(", ") : String(answer) };
    }
    return { status: "NEEDS_USER_INPUT", reason: "No options or text control available for relocation locations." };
  }

  if (isRorOrSafeNaSkill(semantic)) {
    if (hasTextInput) {
      return { status: "SUPPORTED", control: "TEXT", answer: "NA" };
    }
    if (options.length) {
      const naOption = options.map((option, index) => {
        const label = typeof option === "string" ? option : option?.label;
        return EXPLICIT_NA_OPTIONS.has(normalizeOptionText(label)) ? { index, label: String(label).trim() } : null;
      }).find(Boolean);
      if (naOption) {
        return { status: "SUPPORTED", control: "EXPLICIT_NA", ...naOption };
      }
      if (["skill_experience_years", "total_experience_years"].includes(intent)) {
        const match = findUniqueNumericRangeOption(0, options);
        if (match) {
          return { status: "SUPPORTED", control: "SINGLE_EXPERIENCE_RANGE", ...match };
        }
      }
      return { status: "NEEDS_USER_INPUT", reason: "No explicit NA option or 0-experience range available for safe NA skill in options control." };
    }
    return { status: "NEEDS_USER_INPUT", reason: "No supported NA answer control was available." };
  }

  if (options.length) {
    if (["skill_experience_years", "total_experience_years"].includes(intent)) {
      const match = findUniqueNumericRangeOption(answer, options);
      return match
        ? { status: "SUPPORTED", control: "SINGLE_EXPERIENCE_RANGE", ...match }
        : { status: "NEEDS_USER_INPUT", reason: "No unique available experience range safely contains the configured answer." };
    }
    const match = findSemanticOption(answer, intent, options);
    return match
      ? { status: "SUPPORTED", control: "SINGLE_OPTION", ...match }
      : { status: "NEEDS_USER_INPUT", reason: "No unique option matched the resolved answer." };
  }

  if (hasTextInput && answer !== undefined && answer !== null && answer !== "") {
    return { status: "SUPPORTED", control: "TEXT", answer: String(answer) };
  }

  return { status: "NEEDS_USER_INPUT", reason: "No supported answer control was available." };
}

async function readExperienceRangeOptions(group) {
  const checkboxes = group.locator("input.mcc__checkbox[type='checkbox']");
  const count = await checkboxes.count();
  const options = [];
  for (let index = 0; index < count; index += 1) {
    const checkbox = checkboxes.nth(index);
    const option = await checkbox.evaluate(element => {
      const id = element.id;
      const relatedLabels = [...(element.labels || [])];
      const checkboxGroup = element.closest(".multiselectcheckboxes");
      const groupCheckboxes = [...(checkboxGroup?.querySelectorAll("input.mcc__checkbox[type='checkbox']") || [])];
      const groupLabels = [...(checkboxGroup?.querySelectorAll("label.mcc__label") || [])];
      const explicitLabel = [...(checkboxGroup?.querySelectorAll("label[for]") || [])]
        .find(label => label.getAttribute("for") === id);
      const positionalLabel = groupCheckboxes.length === groupLabels.length
        ? groupLabels[groupCheckboxes.indexOf(element)]
        : null;
      const associatedLabel = relatedLabels.find(label => label.htmlFor === id)
        || relatedLabels[0]
        || explicitLabel
        || positionalLabel;
      const allGroupLabels = [...(checkboxGroup?.querySelectorAll("label") || [])];
      const labelStyle = associatedLabel?.ownerDocument?.defaultView?.getComputedStyle(associatedLabel);
      const labelRect = associatedLabel?.getBoundingClientRect();
      return {
        id,
        value: element.value || "",
        label: (associatedLabel?.innerText || associatedLabel?.textContent || element.value || "").replace(/\s+/g, " ").trim(),
        labelIndex: associatedLabel ? allGroupLabels.indexOf(associatedLabel) : -1,
        labelVisible: Boolean(labelRect?.width && labelRect?.height
          && (!associatedLabel.getClientRects || associatedLabel.getClientRects().length > 0)
          && labelStyle?.display !== "none" && labelStyle?.visibility !== "hidden"),
        checked: Boolean(element.checked),
        disabled: Boolean(element.disabled)
      };
    });
    options.push({ ...option, index });
  }
  return { checkboxes, options };
}

async function selectSingleCheckboxOption(group, targetIndex) {
  const { checkboxes, options } = await readExperienceRangeOptions(group);
  const target = options.find(option => option.index === targetIndex);
  if (!target || target.disabled || !target.label || !target.labelVisible || target.labelIndex < 0) {
    return { selected: false, reason: "Target checkbox option has no visible associated label." };
  }
  const labels = group.locator("label");
  const clickVisibleLabel = async option => {
    if (!option.labelVisible || option.labelIndex < 0) return { clicked: false, unsupported: true };
    const label = labels.nth(option.labelIndex);
    if (!await label.isVisible().catch(() => false)) return { clicked: false, unsupported: true };
    const expectedChecked = option.index === targetIndex;
    try {
      await label.click({ timeout: 5000 });
      let checked = await checkboxes.nth(option.index).evaluate(element => Boolean(element.checked));
      if (checked !== expectedChecked) {
        await checkboxes.nth(option.index).click({ force: true, timeout: 3000 });
        checked = await checkboxes.nth(option.index).evaluate(element => Boolean(element.checked));
      }
      if (checked !== expectedChecked) return { clicked: false, interactionFailed: true, reason: "Visible label and intended checkbox interaction did not produce the expected checked state." };
      return { clicked: true };
    } catch (error) {
      return { clicked: false, interactionFailed: true, reason: error.message };
    }
  };

  for (const option of options) {
    if (option.index !== targetIndex && option.checked) {
      const result = await clickVisibleLabel(option);
      if (!result.clicked) {
        return { selected: false, interactionFailed: Boolean(result.interactionFailed), reason: result.reason || "A selected option could not be cleared through its visible label." };
      }
    }
  }
  const beforeTarget = await checkboxes.nth(targetIndex).evaluate(element => Boolean(element.checked));
  if (!beforeTarget) {
    const result = await clickVisibleLabel(target);
    if (!result.clicked) {
      return { selected: false, interactionFailed: Boolean(result.interactionFailed), reason: result.reason || "Target option could not be clicked through its visible label." };
    }
  }

  const checkedIndexes = await checkboxes.evaluateAll(elements => elements
    .map((element, index) => element.checked ? index : -1)
    .filter(index => index !== -1));
  if (checkedIndexes.length !== 1 || checkedIndexes[0] !== targetIndex) {
    return { selected: false, reason: "Could not verify exactly one checkbox option is selected." };
  }
  return { selected: true, label: target.label, index: targetIndex };
}

async function selectSingleExperienceRange(group, targetIndex) {
  const selection = await selectSingleCheckboxOption(group, targetIndex);
  return selection.selected || selection.interactionFailed
    ? selection
    : { ...selection, reason: selection.reason.replace("checkbox option", "experience option") };
}

async function getLatestChatbotMessageContext(drawer) {
  const ignoredMessage = text => /^type message here\.?$/i.test(text)
    || /^(?:hello|hi|hey|welcome|thank you|thanks|save|send)$/i.test(text)
    || /select experience|experiencedd|experience\s*dd|experience.*dropdown/i.test(text);
  const containers = drawer.locator(".chatbot_MessageContainer");
  const containerCount = await containers.count().catch(() => 0);
  for (let index = containerCount - 1; index >= 0; index -= 1) {
    const container = containers.nth(index);
    const messages = await container.locator(".botMsg.msg").evaluateAll(elements =>
      elements.map(element => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    ).catch(() => []);
    const visibleMessages = messages.filter(message => !ignoredMessage(message));
    if (visibleMessages.length) {
      return { question: visibleMessages[visibleMessages.length - 1], container };
    }
  }

  const messages = await drawer.locator(".botMsg.msg").evaluateAll(elements =>
    elements.map(element => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
  ).catch(() => []);
  const visibleMessages = messages.filter(message => !ignoredMessage(message));
  return visibleMessages.length
    ? { question: visibleMessages[visibleMessages.length - 1], container: drawer }
    : null;
}

function normalizeOptionText(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function findSemanticOption(answer, intent, options = []) {
  if (["skill_experience_years", "total_experience_years"].includes(intent)) {
    return findUniqueNumericRangeOption(answer, options);
  }
  const comparable = value => normalizeOptionText(value).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const desired = comparable(answer);
  if (!desired) return null;
  const matches = options.map((option, index) => {
    const label = typeof option === "string" ? option : option?.label;
    return comparable(label) === desired ? { index, label: String(label).trim() } : null;
  }).filter(Boolean);
  if (matches.length) return matches.length === 1 ? matches[0] : null;

  if (["current_location", "job_location", "preferred_location", "relocation_location"].includes(intent)) {
    const otherOptions = options.map((option, index) => {
      const label = typeof option === "string" ? option : option?.label;
      const norm = comparable(label);
      return (norm === "other" || norm === "others" || norm.startsWith("other ") || norm.endsWith(" other"))
        ? { index, label: String(label).trim() }
        : null;
    }).filter(Boolean);
    if (otherOptions.length === 1) return otherOptions[0];
  }
  return null;
}

async function discoverNaukriAnswerControls(container, semantic = {}) {
  const visible = locator => locator.isVisible().catch(() => false);
  const checkboxGroups = container.locator(".multiselectcheckboxes");
  for (let index = await checkboxGroups.count() - 1; index >= 0; index -= 1) {
    const group = checkboxGroups.nth(index);
    if (!await visible(group)) continue;
    const { options } = await readExperienceRangeOptions(group);
    const selectionMode = ["skill_experience_years", "total_experience_years"].includes(semantic.intent)
      ? "single"
      : ["relocation_locations", "multi_select_locations"].includes(semantic.intent)
        ? "multi"
        : "unknown";
    return { type: "checkbox_group", selectionMode, group, controls: options };
  }

  const radios = container.locator("input[type='radio'], [role='radio']");
  const radioControls = [];
  for (let index = 0; index < await radios.count(); index += 1) {
    const control = radios.nth(index);
    const details = await control.evaluate(element => {
      const root = element.closest(".chatbot_MessageContainer") || element.parentElement;
      const id = element.id;
      const labels = [...(element.labels || [])];
      const label = labels.find(candidate => candidate.htmlFor === id)
        || labels[0]
        || (id ? [...(root?.querySelectorAll("label[for]") || [])].find(candidate => candidate.htmlFor === id) : null)
        || element.closest("label");
      const groupLabels = [...(root?.querySelectorAll("label") || [])];
      const labelRect = label?.getBoundingClientRect();
      const labelStyle = label?.ownerDocument?.defaultView?.getComputedStyle(label);
      const selfRect = element.getBoundingClientRect();
      const selfStyle = element.ownerDocument.defaultView.getComputedStyle(element);
      const visibleLabel = Boolean(labelRect?.width && labelRect?.height && labelStyle?.display !== "none" && labelStyle?.visibility !== "hidden");
      const visibleSelf = Boolean(selfRect.width && selfRect.height && selfStyle.display !== "none" && selfStyle.visibility !== "hidden");
      const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/)
        .map(labelId => document.getElementById(labelId)?.innerText || "").join(" ");
      return {
        label: (label?.innerText || label?.textContent || labelledBy || element.getAttribute("aria-label") || element.value || element.innerText || "").replace(/\s+/g, " ").trim(),
        value: element.value || element.getAttribute("aria-label") || "",
        labelIndex: label ? groupLabels.indexOf(label) : -1,
        checked: Boolean(element.checked) || element.getAttribute("aria-checked") === "true",
        disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
        labelVisible: visibleLabel,
        visible: visibleSelf || visibleLabel
      };
    });
    if (details.visible && details.label && !details.disabled) radioControls.push({ ...details, locator: control, index });
  }
  if (radioControls.length) return { type: "radio_group", selectionMode: "single", container, controls: radioControls };

  const selects = container.locator("select");
  for (let index = 0; index < await selects.count(); index += 1) {
    const select = selects.nth(index);
    if (!await visible(select)) continue;
    const options = await select.locator("option").evaluateAll(items => items.map((option, optionIndex) => ({
      index: optionIndex,
      label: (option.label || option.textContent || "").replace(/\s+/g, " ").trim(),
      value: option.value,
      selected: option.selected,
      disabled: option.disabled
    })).filter(option => option.label && !option.disabled));
    return { type: "select", selectionMode: "single", container, control: select, controls: options };
  }

  const customDropdowns = container.locator("[role='combobox'][aria-haspopup='listbox'], [aria-haspopup='listbox']");
  for (let index = 0; index < await customDropdowns.count(); index += 1) {
    const trigger = customDropdowns.nth(index);
    if (await visible(trigger)) return { type: "custom_combobox", selectionMode: "single", container, control: trigger, controls: [] };
  }

  const textareas = container.locator("textarea");
  for (let index = 0; index < await textareas.count(); index += 1) {
    const control = textareas.nth(index);
    if (await visible(control)) return { type: "textarea", container, control, controls: [] };
  }

  const textInputs = container.locator("input[type='text'], input:not([type])");
  for (let index = 0; index < await textInputs.count(); index += 1) {
    const control = textInputs.nth(index);
    if (await visible(control)) return { type: "text_input", container, control, controls: [] };
  }

  const editables = container.locator(".textArea[contenteditable='true'], [contenteditable='true']");
  for (let index = 0; index < await editables.count(); index += 1) {
    const control = editables.nth(index);
    if (await visible(control)) return { type: "contenteditable", container, control, controls: [] };
  }

  const buttons = container.locator("button, [role='button']");
  const buttonOptions = [];
  for (let index = 0; index < await buttons.count(); index += 1) {
    const control = buttons.nth(index);
    if (!await visible(control)) continue;
    const label = (await control.getAttribute("aria-label").catch(() => "")
      || await control.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (!label || /^(?:save|send|close|back|cancel|next|submit|apply|menu)$/i.test(label)) continue;
    const selected = await control.getAttribute("aria-pressed").catch(() => "") === "true"
      || await control.getAttribute("aria-checked").catch(() => "") === "true";
    buttonOptions.push({ label, value: label, selected, locator: control, index });
  }
  if (buttonOptions.length >= 2) return { type: "button_options", selectionMode: "single", container, controls: buttonOptions };

  return { type: "unsupported", selectionMode: "unknown", container, controls: [] };
}

function semanticControlAnswer(semantic, answer) {
  return semantic?.displayValue ?? answer;
}

function findControlOption(answer, semantic, controls) {
  const choice = semanticControlAnswer(semantic, answer);
  const found = findSemanticOption(choice, semantic?.intent, controls);
  if (found) return found;
  return questionResolver.findMatchingOption(choice, controls);
}

async function applyNaukriAnswerControl(discovery, semantic, answer) {
  const controlType = discovery?.type;
  if (controlType === "unsupported") {
    return { status: "NEEDS_USER_INPUT", reason: "No supported answer control was discovered for the current question." };
  }

  const isRelocationLocationQuestion = semantic?.intent === "relocation_locations"
    || Array.isArray(answer)
    || (discovery.controls && discovery.controls.length > 0 && Boolean(findPriorityRelocationOption(semantic?.entities?.locations || ["Remote", "Pune", "Gurugram", "Noida", "Delhi/NCR"], discovery.controls)));

  if (isRelocationLocationQuestion) {
    const locations = Array.isArray(answer) ? answer : (semantic?.entities?.locations || ["Remote", "Pune", "Gurugram", "Noida", "Delhi/NCR"]);
    if (controlType === "checkbox_group") {
      const result = await selectMultipleCheckboxLocations(discovery.group, locations);
      if (!result.selected) {
        return { status: result.interactionFailed ? "FAILED" : "NEEDS_USER_INPUT", reason: result.reason };
      }
      return { status: "APPLIED", controlType, answer: result.labels.join(", ") };
    }
    if (controlType === "radio_group" || controlType === "button_options") {
      const priorityOption = findPriorityRelocationOption(locations, discovery.controls);
      if (priorityOption) {
        const target = discovery.controls[priorityOption.index];
        try {
          if (controlType === "radio_group" && target.labelVisible && target.labelIndex >= 0) {
            const label = discovery.container.locator("label").nth(target.labelIndex);
            if (!await label.isVisible()) return { status: "NEEDS_USER_INPUT", reason: "The associated radio label is not visible." };
            await label.click({ timeout: 5000 });
          } else if (await target.locator.isVisible()) {
            await target.locator.click({ timeout: 5000 });
          } else {
            return { status: "NEEDS_USER_INPUT", reason: "The answer option has no visible interaction target." };
          }
        } catch (error) {
          return { status: "FAILED", reason: `Answer option interaction failed: ${error.message}` };
        }

        const selected = await target.locator.evaluate(element => {
          const selectedClass = /(?:^|\s)(?:selected|active|checked|is-selected)(?:\s|$)/i.test(element.getAttribute("class") || "");
          return Boolean(element.checked) || element.getAttribute("aria-checked") === "true"
            || element.getAttribute("aria-pressed") === "true" || selectedClass;
        }).catch(() => false);
        if (!selected) return { status: "FAILED", reason: "The selected answer option could not be verified." };
        return { status: "APPLIED", controlType, answer: priorityOption.label };
      }
      if (semantic?.intent === "relocation_locations" || Array.isArray(answer)) {
        return { status: "NEEDS_USER_INPUT", reason: "No available radio option matched any configured relocation location." };
      }
    }
    if (controlType === "select") {
      const priorityOption = findPriorityRelocationOption(locations, discovery.controls);
      if (priorityOption) {
        const target = discovery.controls[priorityOption.index];
        try {
          await discovery.control.selectOption(target.value !== "" ? { value: target.value } : { label: target.label });
        } catch (error) {
          return { status: "FAILED", reason: `Native select interaction failed: ${error.message}` };
        }
        return { status: "APPLIED", controlType, answer: priorityOption.label };
      }
      if (semantic?.intent === "relocation_locations" || Array.isArray(answer)) {
        return { status: "NEEDS_USER_INPUT", reason: "No available native select option matched any configured relocation location." };
      }
    }
    if (["textarea", "contenteditable", "text_input"].includes(controlType)) {
      const text = Array.isArray(locations) ? locations.join(", ") : String(locations);
      try {
        await discovery.control.fill(text, { timeout: 5000 });
      } catch (error) {
        return { status: "FAILED", reason: `Text answer interaction failed: ${error.message}` };
      }
      return { status: "APPLIED", controlType, answer: text };
    }
    if (semantic?.intent === "relocation_locations" || Array.isArray(answer)) {
      return { status: "NEEDS_USER_INPUT", reason: `Unsupported control for relocation locations: ${controlType}` };
    }
  }

  if (isRorOrSafeNaSkill(semantic)) {
    if (["textarea", "contenteditable", "text_input"].includes(controlType)) {
      try {
        await discovery.control.fill("NA", { timeout: 5000 });
      } catch (error) {
        return { status: "FAILED", reason: `Text answer interaction failed: ${error.message}` };
      }
      const actual = controlType === "textarea" || controlType === "text_input"
        ? await discovery.control.inputValue().catch(() => "")
        : await discovery.control.textContent().catch(() => "");
      if (String(actual).replace(/\s+/g, " ").trim().toUpperCase() !== "NA") {
        return { status: "FAILED", reason: "The text answer could not be verified after entry." };
      }
      return { status: "APPLIED", controlType, answer: "NA" };
    }

    if (controlType === "checkbox_group") {
      const explicitOption = discovery.controls.find(option => EXPLICIT_NA_OPTIONS.has(normalizeOptionText(option.label)));
      if (explicitOption) {
        const selection = await selectSingleCheckboxOption(discovery.group, explicitOption.index);
        if (!selection.selected) {
          return { status: selection.interactionFailed ? "FAILED" : "NEEDS_USER_INPUT", reason: selection.reason };
        }
        return { status: "APPLIED", controlType: discovery.type, answer: selection.label };
      }
      const rangeOption = findUniqueNumericRangeOption(0, discovery.controls);
      if (rangeOption) {
        const selection = await selectSingleExperienceRange(discovery.group, rangeOption.index);
        if (!selection.selected) {
          return { status: selection.interactionFailed ? "FAILED" : "NEEDS_USER_INPUT", reason: selection.reason };
        }
        return { status: "APPLIED", controlType: discovery.type, answer: selection.label };
      }
      return { status: "NEEDS_USER_INPUT", reason: "No explicit NA option or 0-experience range was available for safe NA skill in numeric range options." };
    }

    if (controlType === "radio_group" || controlType === "button_options") {
      const explicitOption = discovery.controls.find(option => EXPLICIT_NA_OPTIONS.has(normalizeOptionText(option.label)));
      if (explicitOption) {
        const target = discovery.controls[explicitOption.index];
        try {
          if (controlType === "radio_group" && target.labelVisible && target.labelIndex >= 0) {
            const label = discovery.container.locator("label").nth(target.labelIndex);
            if (!await label.isVisible()) return { status: "NEEDS_USER_INPUT", reason: "The associated radio label is not visible." };
            await label.click({ timeout: 5000 });
          } else if (await target.locator.isVisible()) {
            await target.locator.click({ timeout: 5000 });
          } else {
            return { status: "NEEDS_USER_INPUT", reason: "The answer option has no visible interaction target." };
          }
        } catch (error) {
          return { status: "FAILED", reason: `Answer option interaction failed: ${error.message}` };
        }
        const selected = await target.locator.evaluate(element => {
          const selectedClass = /(?:^|\s)(?:selected|active|checked|is-selected)(?:\s|$)/i.test(element.getAttribute("class") || "");
          return Boolean(element.checked) || element.getAttribute("aria-checked") === "true"
            || element.getAttribute("aria-pressed") === "true" || selectedClass;
        }).catch(() => false);
        if (!selected) return { status: "FAILED", reason: "The selected answer option could not be verified." };
        return { status: "APPLIED", controlType, answer: explicitOption.label };
      }
      const rangeOption = findUniqueNumericRangeOption(0, discovery.controls);
      if (rangeOption) {
        const target = discovery.controls[rangeOption.index];
        try {
          if (controlType === "radio_group" && target.labelVisible && target.labelIndex >= 0) {
            const label = discovery.container.locator("label").nth(target.labelIndex);
            if (!await label.isVisible()) return { status: "NEEDS_USER_INPUT", reason: "The associated radio label is not visible." };
            await label.click({ timeout: 5000 });
          } else if (await target.locator.isVisible()) {
            await target.locator.click({ timeout: 5000 });
          }
        } catch (error) {
          return { status: "FAILED", reason: `Answer option interaction failed: ${error.message}` };
        }
        return { status: "APPLIED", controlType, answer: rangeOption.label };
      }
      return { status: "NEEDS_USER_INPUT", reason: "No explicit NA option or 0-experience range was available in the selection control for safe NA skill." };
    }

    if (controlType === "select") {
      const explicitOption = discovery.controls.find(option => EXPLICIT_NA_OPTIONS.has(normalizeOptionText(option.label)));
      if (explicitOption) {
        const target = discovery.controls[explicitOption.index];
        try {
          await discovery.control.selectOption(target.value !== "" ? { value: target.value } : { label: target.label });
        } catch (error) {
          return { status: "FAILED", reason: `Native select interaction failed: ${error.message}` };
        }
        return { status: "APPLIED", controlType, answer: explicitOption.label };
      }
      const rangeOption = findUniqueNumericRangeOption(0, discovery.controls);
      if (rangeOption) {
        const target = discovery.controls[rangeOption.index];
        try {
          await discovery.control.selectOption(target.value !== "" ? { value: target.value } : { label: target.label });
        } catch (error) {
          return { status: "FAILED", reason: `Native select interaction failed: ${error.message}` };
        }
        return { status: "APPLIED", controlType, answer: rangeOption.label };
      }
      return { status: "NEEDS_USER_INPUT", reason: "No explicit NA option or 0-experience range was available in the native select for safe NA skill." };
    }

    if (controlType === "custom_combobox") {
      try {
        await discovery.control.click({ timeout: 5000 });
      } catch (error) {
        return { status: "FAILED", reason: `Custom dropdown could not be opened: ${error.message}` };
      }
      const options = discovery.container.locator("[role='option']");
      const visibleOptions = [];
      for (let index = 0; index < await options.count(); index += 1) {
        const control = options.nth(index);
        if (!await control.isVisible().catch(() => false)) continue;
        const label = (await control.getAttribute("aria-label").catch(() => "") || await control.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        if (label && EXPLICIT_NA_OPTIONS.has(normalizeOptionText(label))) visibleOptions.push({ index, label, value: label, locator: control });
      }
      if (visibleOptions.length === 1) {
        const target = visibleOptions[0];
        try {
          await target.locator.click({ timeout: 5000 });
        } catch (error) {
          return { status: "FAILED", reason: `Custom dropdown option interaction failed: ${error.message}` };
        }
        return { status: "APPLIED", controlType, answer: target.label };
      }
      return { status: "NEEDS_USER_INPUT", reason: "No unique explicit NA option was available in the custom dropdown for safe NA skill." };
    }

    return { status: "NEEDS_USER_INPUT", reason: `Unsupported control type for safe NA skill: ${controlType}` };
  }

  if (controlType === "checkbox_group") {
    if (Array.isArray(answer)) {
      const result = await selectMultipleCheckboxOptions(discovery.group, answer);
      if (!result.selected) {
        return {
          status: result.interactionFailed ? "FAILED" : "NEEDS_USER_INPUT",
          reason: result.reason || "Checkbox selection could not be verified."
        };
      }
      return { status: "APPLIED", controlType, answer: result.labels.join(", ") };
    }
    if (["skill_experience_years", "total_experience_years"].includes(semantic?.intent)) {
      const option = findUniqueNumericRangeOption(answer, discovery.controls);
      if (!option) return { status: "NEEDS_USER_INPUT", reason: "No unique available experience range safely contains the configured answer." };
      const result = await selectSingleExperienceRange(discovery.group, option.index);
      if (!result.selected) {
        return {
          status: result.interactionFailed ? "FAILED" : "NEEDS_USER_INPUT",
          reason: result.reason || "Experience checkbox selection could not be verified."
        };
      }
      return { status: "APPLIED", controlType, answer: result.label };
    }
    const matched = questionResolver.findMatchingOption(answer, discovery.controls);
    if (matched) {
      const selection = await selectSingleCheckboxOption(discovery.group, matched.index);
      if (!selection.selected) {
        return { status: selection.interactionFailed ? "FAILED" : "NEEDS_USER_INPUT", reason: selection.reason };
      }
      return { status: "APPLIED", controlType, answer: selection.label };
    }
    return { status: "NEEDS_USER_INPUT", reason: "This checkbox group is not a supported single numeric experience answer." };
  }

  if (controlType === "radio_group" || controlType === "button_options") {
    const option = findControlOption(answer, semantic, discovery.controls);
    if (!option) return { status: "NEEDS_USER_INPUT", reason: "No unique answer option matched the resolved canonical answer." };
    const target = discovery.controls[option.index];
    try {
      if (controlType === "radio_group" && target.labelVisible && target.labelIndex >= 0) {
        const label = discovery.container.locator("label").nth(target.labelIndex);
        if (!await label.isVisible()) return { status: "NEEDS_USER_INPUT", reason: "The associated radio label is not visible." };
        await label.click({ timeout: 5000 });
      } else if (await target.locator.isVisible()) {
        await target.locator.click({ timeout: 5000 });
      } else {
        return { status: "NEEDS_USER_INPUT", reason: "The answer option has no visible interaction target." };
      }
    } catch (error) {
      return { status: "FAILED", reason: `Answer option interaction failed: ${error.message}` };
    }

    const selected = await target.locator.evaluate(element => {
      const selectedClass = /(?:^|\s)(?:selected|active|checked|is-selected)(?:\s|$)/i.test(element.getAttribute("class") || "");
      return Boolean(element.checked) || element.getAttribute("aria-checked") === "true"
        || element.getAttribute("aria-pressed") === "true" || selectedClass;
    }).catch(() => false);
    if (!selected) return { status: "FAILED", reason: "The selected answer option could not be verified." };
    return { status: "APPLIED", controlType, answer: option.label };
  }

  if (controlType === "select") {
    const option = findControlOption(answer, semantic, discovery.controls);
    if (!option) return { status: "NEEDS_USER_INPUT", reason: "No unique native select option matched the resolved canonical answer." };
    const target = discovery.controls[option.index];
    try {
      await discovery.control.selectOption(target.value !== "" ? { value: target.value } : { label: target.label });
    } catch (error) {
      return { status: "FAILED", reason: `Native select interaction failed: ${error.message}` };
    }
    const selected = await discovery.control.locator("option:checked").evaluate(element => ({
      value: element.value,
      label: (element.label || element.textContent || "").replace(/\s+/g, " ").trim()
    })).catch(() => null);
    if (!selected || (target.value !== "" ? selected.value !== target.value : normalizeOptionText(selected.label) !== normalizeOptionText(target.label))) {
      return { status: "FAILED", reason: "The native select value could not be verified." };
    }
    return { status: "APPLIED", controlType, answer: selected.label };
  }

  if (controlType === "custom_combobox") {
    try {
      await discovery.control.click({ timeout: 5000 });
    } catch (error) {
      return { status: "FAILED", reason: `Custom dropdown could not be opened: ${error.message}` };
    }
    const options = discovery.container.locator("[role='option']");
    const visibleOptions = [];
    for (let index = 0; index < await options.count(); index += 1) {
      const control = options.nth(index);
      if (!await control.isVisible().catch(() => false)) continue;
      const label = (await control.getAttribute("aria-label").catch(() => "") || await control.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (label) visibleOptions.push({ index, label, value: label, locator: control });
    }
    const option = findControlOption(answer, semantic, visibleOptions);
    if (!option) return { status: "NEEDS_USER_INPUT", reason: "No unique visible custom dropdown option matched the resolved answer." };
    const target = visibleOptions[option.index];
    try {
      await target.locator.click({ timeout: 5000 });
    } catch (error) {
      return { status: "FAILED", reason: `Custom dropdown option interaction failed: ${error.message}` };
    }
    const chosenText = (await discovery.control.getAttribute("aria-valuetext").catch(() => "")
      || await discovery.control.getAttribute("aria-label").catch(() => "")
      || await discovery.control.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (!normalizeOptionText(chosenText).includes(normalizeOptionText(target.label))) {
      return { status: "FAILED", reason: "The custom dropdown selection could not be verified." };
    }
    return { status: "APPLIED", controlType, answer: target.label };
  }

  if (controlType === "textarea" || controlType === "contenteditable" || controlType === "text_input") {
    const text = String(semanticControlAnswer(semantic, answer));
    try {
      await discovery.control.fill(text, { timeout: 5000 });
    } catch (error) {
      return { status: "FAILED", reason: `Text answer interaction failed: ${error.message}` };
    }
    const actual = controlType === "textarea" || controlType === "text_input"
      ? await discovery.control.inputValue().catch(() => "")
      : await discovery.control.textContent().catch(() => "");
    if (String(actual).replace(/\s+/g, " ").trim() !== text.replace(/\s+/g, " ").trim()) {
      return { status: "FAILED", reason: "The text answer could not be verified after entry." };
    }
    return { status: "APPLIED", controlType, answer: text };
  }

  return { status: "NEEDS_USER_INPUT", reason: `Unsupported Naukri answer control type: ${controlType || "unknown"}.` };
}

const EXPLICIT_NA_OPTIONS = new Set(["na", "n/a", "not applicable", "not available"]);
const CONSTRAINED_NA_QUESTION = /\b(?:how many|how much|years?|salary|ctc|compensation|location|city|where|date|last working day|\blwd\b|notice period|phone|mobile|age|numeric|number|expected|current pay|total experience|work experience|experience range|experience level)\b/i;

function isSafeFreeTextNaQuestion(question) {
  return !CONSTRAINED_NA_QUESTION.test(String(question || ""));
}

async function applyNaukriNaFallback(container, question) {
  const discovery = await discoverNaukriAnswerControls(container, { intent: "unknown" });
  if (["textarea", "contenteditable", "text_input"].includes(discovery.type)) {
    if (!isSafeFreeTextNaQuestion(question)) {
      return { status: "NEEDS_USER_INPUT", reason: "NA is not safe for a constrained numeric or personal-fact question." };
    }
    return applyNaukriAnswerControl(discovery, { intent: "unknown" }, "NA");
  }

  if (discovery.type === "custom_combobox") {
    try {
      await discovery.control.click({ timeout: 5000 });
    } catch (error) {
      return { status: "NEEDS_USER_INPUT", reason: "The selection control could not be opened to check for an explicit NA option." };
    }
    const options = discovery.container.locator("[role='option']");
    const visibleOptions = [];
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index);
      if (!await option.isVisible().catch(() => false)) continue;
      const label = (await option.getAttribute("aria-label").catch(() => "")
        || await option.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (label && EXPLICIT_NA_OPTIONS.has(normalizeOptionText(label))) visibleOptions.push({ option, label });
    }
    if (visibleOptions.length !== 1) {
      return { status: "NEEDS_USER_INPUT", reason: "No unique explicit NA option was available in the selection control." };
    }
    try {
      await visibleOptions[0].option.click({ timeout: 5000 });
    } catch (error) {
      return { status: "FAILED", reason: `Explicit NA option interaction failed: ${error.message}` };
    }
    const selectedText = (await discovery.control.getAttribute("aria-valuetext").catch(() => "")
      || await discovery.control.getAttribute("aria-label").catch(() => "")
      || await discovery.control.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const selected = await visibleOptions[0].option.getAttribute("aria-selected").catch(() => "");
    if (!EXPLICIT_NA_OPTIONS.has(normalizeOptionText(selectedText)) && selected !== "true") {
      return { status: "FAILED", reason: "The explicit NA option selection could not be verified." };
    }
    return { status: "APPLIED", controlType: discovery.type, answer: visibleOptions[0].label };
  }

  const explicitOption = discovery.controls.find(option => EXPLICIT_NA_OPTIONS.has(normalizeOptionText(option.label)));
  if (!explicitOption) return { status: "NEEDS_USER_INPUT", reason: "No safe free-text control or explicit NA option was available." };
  if (discovery.type === "checkbox_group") {
    const selection = await selectSingleCheckboxOption(discovery.group, explicitOption.index);
    if (!selection.selected) {
      return { status: selection.interactionFailed ? "FAILED" : "NEEDS_USER_INPUT", reason: selection.reason };
    }
    return { status: "APPLIED", controlType: discovery.type, answer: selection.label };
  }
  return applyNaukriAnswerControl(discovery, { intent: "unknown" }, explicitOption.label);
}

async function pageHasTerminalAcknowledgement(page) {
  const messages = await page.locator(".botMsg.msg").evaluateAll(elements =>
    elements.map(element => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim())
  ).catch(() => []);
  if (messages.some(message => classifyNaukriChatbotMessage(message) === "TERMINAL")) return true;
  const bodyLines = (await page.locator("body").innerText().catch(() => ""))
    .split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  return bodyLines.some(line => classifyNaukriChatbotMessage(line) === "TERMINAL");
}

function parseNaukriSaveApplyResult(url, expectedJobId = "") {
  try {
    const rawUrl = String(url || "").trim();
    if (!rawUrl || !rawUrl.includes("/myapply/saveApply")) return null;
    const parsed = new URL(rawUrl);
    if (!parsed.pathname.includes("/myapply/saveApply")) return null;
    const rawMultiApply = parsed.searchParams.get("multiApplyResp");
    if (!rawMultiApply) return null;
    let respObj = null;
    try {
      respObj = JSON.parse(rawMultiApply);
    } catch {
      return null;
    }
    if (!respObj || typeof respObj !== "object") return null;
    const normalizedExpected = normalizeJobId(expectedJobId);
    if (normalizedExpected) {
      for (const [key, code] of Object.entries(respObj)) {
        if (normalizeJobId(key) === normalizedExpected) {
          const statusCode = Number(code);
          return {
            success: statusCode === 200,
            jobId: key,
            statusCode,
            response: respObj
          };
        }
      }
      return {
        success: false,
        jobId: normalizedExpected,
        statusCode: null,
        response: respObj
      };
    }
    const entries = Object.entries(respObj);
    if (!entries.length) return null;
    const [firstKey, firstCode] = entries[0];
    const statusCode = Number(firstCode);
    return {
      success: statusCode === 200,
      jobId: firstKey,
      statusCode,
      response: respObj
    };
  } catch {
    return null;
  }
}

function isExternalApplicationRouteLabel(value) {
  const label = normalizeOptionText(value);
  return /^(?:apply in site|apply on site|direct apply|apply externally|external application|apply on company (?:site|website)|apply on employer site|continue to company website)$/.test(label);
}

async function detectNaukriApplicationRoute(page, pagesBeforeApply = [], expectedJobId = "") {
  const pages = page.context().pages();
  const externalTab = pages.find(tab => tab !== page
    && !pagesBeforeApply.includes(tab)
    && !isNaukriHostname(tab.url()));
  if (externalTab) return { type: "EXTERNAL_REDIRECT", url: externalTab.url(), page: externalTab };

  const allCurrentTabs = pages.filter(tab => !pagesBeforeApply.includes(tab) || tab === page);
  for (const tab of allCurrentTabs) {
    const tabUrl = tab.url();
    const saveApplyResult = parseNaukriSaveApplyResult(tabUrl, expectedJobId);
    if (saveApplyResult && saveApplyResult.success) {
      return { type: "APPLIED", url: tabUrl, page: tab, jobId: saveApplyResult.jobId, statusCode: saveApplyResult.statusCode };
    }
  }

  const currentUrl = page.url();
  if (!isNaukriHostname(currentUrl) && !await pageHasTerminalAcknowledgement(page)) {
    return { type: "EXTERNAL_REDIRECT", url: currentUrl, page };
  }

  if (await pageHasTerminalAcknowledgement(page)) return { type: "CHATBOT", terminalAcknowledgement: true };
  const drawer = page.locator(".chatbot_Drawer").first();
  if (await drawer.count().catch(() => 0) && await drawer.isVisible().catch(() => false)) {
    const currentMessage = await getLatestChatbotMessageContext(drawer);
    if (currentMessage && classifyNaukriChatbotMessage(currentMessage.question) === "QUESTION") {
      return { type: "CHATBOT" };
    }
  }

  const candidates = page.locator("button, a, [role='button'], [role='link'], .chatbot_Chip, .chipItem, [class*='apply']");
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const label = await candidate.getAttribute("aria-label").catch(() => "")
      || await candidate.innerText().catch(() => "");
    if (isExternalApplicationRouteLabel(label)) {
      return { type: "EXTERNAL_ROUTE", label: String(label).replace(/\s+/g, " ").trim() };
    }
  }

  const bodyLines = (await page.locator("body").innerText().catch(() => ""))
    .split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (bodyLines.some(isExternalApplicationRouteLabel)) {
    return { type: "EXTERNAL_ROUTE", label: bodyLines.find(isExternalApplicationRouteLabel) };
  }
  return { type: "UNKNOWN", url: currentUrl };
}

async function waitForNaukriApplicationRoute(page, pagesBeforeApply = [], timeoutMs = 6000, expectedJobId = "") {
  const deadline = Date.now() + timeoutMs;
  let route = await detectNaukriApplicationRoute(page, pagesBeforeApply, expectedJobId);
  while (route.type === "UNKNOWN" && Date.now() < deadline) {
    await page.waitForTimeout(250);
    route = await detectNaukriApplicationRoute(page, pagesBeforeApply, expectedJobId);
  }
  return route;
}

async function findSkipQuestionControl(container) {
  const selectors = [".chipsContainer .chatbot_Chip", ".chipsContainer .chipItem"];
  for (const selector of selectors) {
    const candidates = container.locator(selector);
    for (let index = await candidates.count() - 1; index >= 0; index -= 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const label = (await candidate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (normalizeOptionText(label) !== "skip this question") continue;
      const disabled = await candidate.evaluate(element => element.matches(":disabled")
        || element.getAttribute("aria-disabled") === "true"
        || /(?:^|\s)(?:disabled|is-disabled)(?:\s|$)/i.test(element.getAttribute("class") || "")).catch(() => true);
      if (!disabled && await candidate.isEnabled().catch(() => true)) return candidate;
    }
    if (selector === ".chipsContainer .chatbot_Chip") continue;
  }
  return null;
}

async function chatbotControlSignature(container, semantic = {}) {
  const discovery = await discoverNaukriAnswerControls(container, semantic);
  return JSON.stringify({
    type: discovery.type,
    controls: discovery.controls.map(control => ({
      label: normalizeOptionText(control.label),
      value: normalizeOptionText(control.value),
      checked: Boolean(control.checked),
      selected: Boolean(control.selected)
    }))
  });
}

async function skipCurrentNaukriQuestion(page, drawer, messageContext, semantic = {}, timeoutMs = 8000) {
  const skipControl = await findSkipQuestionControl(messageContext.container);
  if (!skipControl) return { status: "NEEDS_USER_INPUT", reason: "No visible Skip this question control was available." };

  const previousQuestion = messageContext.question;
  const previousSignature = await chatbotControlSignature(messageContext.container, semantic);
  try {
    await skipControl.click({ timeout: 5000 });
  } catch (error) {
    if (!await skipControl.isVisible().catch(() => false) || !await skipControl.isEnabled().catch(() => false)) {
      return { status: "FAILED", reason: `Skip control became unavailable: ${error.message}` };
    }
    try {
      await skipControl.click({ timeout: 3000, force: true });
    } catch (fallbackError) {
      return { status: "FAILED", reason: `Skip control interaction failed: ${fallbackError.message}` };
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const nextContext = await getLatestChatbotMessageContext(drawer);
    if (!nextContext) return { status: "CURRENT_QUESTION_SKIPPED", question: previousQuestion };
    if (classifyNaukriChatbotMessage(nextContext.question) === "TERMINAL") {
      return { status: "CURRENT_QUESTION_SKIPPED", question: previousQuestion, terminalAcknowledgement: true };
    }
    if (nextContext.question !== previousQuestion) {
      return { status: "CURRENT_QUESTION_SKIPPED", question: previousQuestion, nextQuestion: nextContext.question };
    }
    const nextSignature = await chatbotControlSignature(nextContext.container, semantic);
    if (nextSignature !== previousSignature) {
      return { status: "CURRENT_QUESTION_SKIPPED", question: previousQuestion, nextQuestion: nextContext.question };
    }
  }
  return { status: "FAILED", question: previousQuestion, reason: "Skip was clicked but the chatbot did not advance to another question or control state." };
}

async function saveNaukriChatbotAnswerAndVerifyAdvance(page, drawer, messageContext, semantic = {}, previousSignature) {
  let saveButton = null;
  const scopedSaveButtons = messageContext.container.locator(".sendMsg");
  for (let index = await scopedSaveButtons.count().catch(() => 0) - 1; index >= 0; index -= 1) {
    const candidate = scopedSaveButtons.nth(index);
    if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
      saveButton = candidate;
      break;
    }
  }
  if (!saveButton) {
    const drawerSaveButtons = drawer.locator(".sendMsg");
    for (let index = await drawerSaveButtons.count().catch(() => 0) - 1; index >= 0; index -= 1) {
      const candidate = drawerSaveButtons.nth(index);
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
        saveButton = candidate;
        break;
      }
    }
  }
  if (!saveButton) return { advanced: false, failed: true, reason: "No visible Save control was associated with the active question." };

  try {
    await saveButton.click({ timeout: 8000 });
  } catch (error) {
    return { advanced: false, failed: true, reason: `Save interaction failed: ${error.message}` };
  }
  await safeWait(page, 1200);
  const nextContext = await getLatestChatbotMessageContext(drawer);
  if (!nextContext) {
    return await pageHasTerminalAcknowledgement(page)
      ? { advanced: true, terminalAcknowledgement: true }
      : { advanced: false, failed: true, reason: "Save was clicked but no next question or terminal acknowledgement appeared." };
  }
  if (classifyNaukriChatbotMessage(nextContext.question) === "TERMINAL") {
    return { advanced: true, terminalAcknowledgement: true, nextQuestion: nextContext.question };
  }
  if (nextContext.question !== messageContext.question) {
    return { advanced: true, nextQuestion: nextContext.question };
  }
  const nextSignature = await chatbotControlSignature(nextContext.container, semantic);
  return nextSignature !== previousSignature
    ? { advanced: true, nextQuestion: nextContext.question }
    : { advanced: false, failed: true, reason: "Save was clicked but the question/control state did not advance." };
}

async function watchForTerminalAcknowledgement(page) {
  let state = terminalChatbotObservers.get(page);
  if (!state) {
    state = { detected: false, active: false, bindingName: `__naukriTerminalAck_${++terminalChatbotObserverId}` };
    await page.exposeFunction(state.bindingName, () => {
      if (state.active) state.detected = true;
    });
    terminalChatbotObservers.set(page, state);
  }
  state.detected = false;
  state.active = true;
  await page.evaluate(bindingName => {
    window.__naukriTerminalAckObserver?.disconnect();
    const normalize = value => String(value || "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!]+$/g, "").trim();
    const seen = new Set([...document.querySelectorAll(".botMsg.msg")].map(element => normalize(element.innerText || element.textContent)));
    const inspect = () => {
      for (const element of document.querySelectorAll(".botMsg.msg")) {
        const text = normalize(element.innerText || element.textContent);
        if (text === "thank you for your responses" && !seen.has(text)) {
          seen.add(text);
          window[bindingName]();
          window.__naukriTerminalAckObserver?.disconnect();
          return;
        }
        seen.add(text);
      }
    };
    window.__naukriTerminalAckObserver = new MutationObserver(inspect);
    window.__naukriTerminalAckObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }, state.bindingName);
  return {
    get detected() { return state.detected; },
    stop() { state.active = false; }
  };
}

async function resolveNaukriChatbotMessage(message, answerResolver) {
  const disposition = classifyNaukriChatbotMessage(message);
  if (disposition !== "QUESTION") return { disposition };
  return { disposition, answer: await answerResolver(message) };
}

async function fillKnownQuestions(page, applicationConfig, profile) {
  const questions = await detectFormQuestions(page);
  const mapped = [];
  for (const question of questions) {
    const answer = await resolveNaukriAnswer(question, applicationConfig, profile);
    if (answer === undefined || answer === null || answer === "") continue;
    const escapedQuestion = question.replace(/"/g, '\\"');
    const fieldTargets = [
      page.locator(`label:has-text("${escapedQuestion}")`),
      page.locator(`[aria-label*="${escapedQuestion}"]`),
      page.locator(`textarea[placeholder*="${escapedQuestion}"]`),
      page.locator(`input[placeholder*="${escapedQuestion}"]`),
      page.locator(`select[aria-label*="${escapedQuestion}"]`)
    ];

    let matched = false;
    for (const fieldTarget of fieldTargets) {
      const count = await fieldTarget.count().catch(() => 0);
      if (!count) continue;
      const field = fieldTarget.first();
      const tagName = await field.evaluate(element => element.tagName.toLowerCase()).catch(() => "");
      if (!tagName) continue;
      try {
        if (tagName === "input") {
          const type = await field.getAttribute("type").catch(() => "text");
          if (type === "checkbox") {
            await field.check().catch(() => {});
          } else {
            await field.fill(String(answer)).catch(() => {});
          }
        } else if (tagName === "select") {
          await field.selectOption({ label: String(answer) }).catch(async () => {
            await field.selectOption(String(answer)).catch(() => {});
          });
        } else if (tagName === "textarea") {
          await field.fill(String(answer)).catch(() => {});
        } else {
          await field.fill(String(answer)).catch(() => {});
        }
        mapped.push({ question, answer });
        matched = true;
        break;
      } catch (error) {
        continue;
      }
    }
    if (!matched) {
      mapped.push({ question, answer, skipped: true });
    }
  }
  return mapped;
}

async function handleExternalRedirect(page, fallbackUrl) {
  const currentUrl = page.url();
  if (isNaukriHostname(currentUrl)) return false;
  try {
    await page.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (error) {
    // do not crash the run if a safe recovery URL is unavailable
  }
  return true;
}

async function verifyApplicationSubmission(page) {
  const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  return /application submitted|applied successfully|your application has been sent|submitted successfully|application sent|application successful/i.test(bodyText);
}

function getStabilizationDelayMs(applicationConfig = {}, browserConfig = {}) {
  return Number(applicationConfig?.automation?.stabilizationWaitMs)
    || Number(applicationConfig?.automation?.applicationCompletionWaitMs)
    || Number(browserConfig?.pageLoadWaitMs)
    || 1500;
}

async function verifyNaukriApplicationSuccess(page, expectedJobId = "") {
  const currentUrl = typeof page.url === "function" ? page.url() : String(page.url || "");
  const saveApply = parseNaukriSaveApplyResult(currentUrl, expectedJobId);
  if (saveApply && saveApply.success) {
    return { verified: true, signal: "SAVE_APPLY_SUCCESS", details: saveApply };
  }

  if (await verifyApplicationSubmission(page)) {
    return { verified: true, signal: "SUBMISSION_CONFIRMATION" };
  }

  if (await pageHasTerminalAcknowledgement(page)) {
    return { verified: true, signal: "TERMINAL_CHATBOT_ACKNOWLEDGEMENT" };
  }

  const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (/applied to\b|already applied\b|application received\b/i.test(bodyText)) {
    return { verified: true, signal: "APPLIED_TEXT_CONFIRMATION" };
  }

  return { verified: false, signal: "NONE" };
}

async function discoverJobs(page) {
  const jobs = await page.evaluate(() => {
    const normalizeJobId = value => String(value || "").trim();
    const articleNodes = [...document.querySelectorAll("article[data-job-id]")];
    const fallbackNodes = [...document.querySelectorAll("[data-job-id]")].filter(node =>
      node.tagName === "ARTICLE" || node.className.toString().includes("job") || node.querySelector("h2,h3,a")
    );
    const all = [...new Set([...articleNodes, ...fallbackNodes])];

    return all.map(node => {
      const root = node.closest("article") || node;
      const hasSelectableCheckbox = [...root.querySelectorAll(
        "input[type='checkbox'], [role='checkbox'], [aria-checked='true'], [aria-checked='false'], .naukicon-ot-checkbox, .naukicon-ot-Checked"
      )].some(control => {
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0
          && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
          && !control.closest("[hidden], [aria-hidden='true'], [inert]");
        return visible && !control.disabled && control.getAttribute("aria-disabled") !== "true";
      });
      const text = (root.innerText || root.textContent || "").replace(/\s+/g, " ").trim();
      const readText = selector => {
        const target = root.querySelector(selector);
        return target ? (target.innerText || target.textContent || "").replace(/\s+/g, " ").trim() : "";
      };
      const title = readText("h2, h3, .title, .job-title, a")
        || (root.getAttribute("title") || "");
      const company = readText(".companyName, .company, .comp-name, [data-company-name]")
        || (root.getAttribute("data-company") || "");
      const experience = readText(".experience, .exp, .job-experience") || "";
      const salary = readText(".salary, .salaryCompensation, .ctc") || "";
      const location = readText(".location, .job-location") || "";
      const posted = readText(".posted, .job-posted, .date") || "";
      const description = readText(".job-description, .description") || text.slice(0, 240);
      const jobId = normalizeJobId(root.getAttribute("data-job-id") || root.getAttribute("data-job-id") || "");
      const jobUrl = [...root.querySelectorAll("a[href]")].map(anchor => {
        try {
          const target = new URL(anchor.href, location.href);
          const isNaukri = target.hostname === "naukri.com" || target.hostname.endsWith(".naukri.com");
          const isJobLink = target.pathname.toLowerCase().includes("job-listings")
            || target.pathname.toLowerCase().includes("/job/")
            || target.pathname.includes(jobId);
          return isNaukri && isJobLink ? target.href : "";
        } catch {
          return "";
        }
      }).find(Boolean) || "";
      const tags = [...root.querySelectorAll(".tag, .skills span, li, .job-tags span")]
        .map(item => (item.innerText || item.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 8);

      return {
        jobId,
        hasSelectableCheckbox,
        title,
        company,
        experience,
        salary,
        location,
        posted,
        url: jobUrl,
        description,
        tags,
        rawText: text
      };
    }).filter((job) => job.jobId);
  });

  return jobs;
}

async function getSelectedJobIds(page) {
  return page.evaluate(() => {
    const selected = [];
    const seen = new Set();
    const nodeList = [...document.querySelectorAll("[data-job-id]")];
    for (const node of nodeList) {
      const item = node.closest("article") || node;
      const jobId = String(node.getAttribute("data-job-id") || item.getAttribute("data-job-id") || "").trim();
      if (!jobId || seen.has(jobId)) continue;
      const selectedControl = item.querySelector(
        ".naukicon-ot-Checked, .selected, [aria-checked='true'], [aria-checked='true'], input[type='checkbox']:checked, .tuple-check-box.selected, .saveJobContainer.selected, .naukicon-ot-checkbox.selected"
      );
      if (selectedControl) {
        seen.add(jobId);
        selected.push(jobId);
      }
    }
    return selected;
  });
}

async function selectSingleJob(page, job) {
  const escapedId = escapeSelector(job.jobId);
  const article = page.locator(`article[data-job-id="${escapedId}"], [data-job-id="${escapedId}"]`).first();
  const checkbox = article.locator(".tuple-check-box, .saveJobContainer, .naukicon-ot-checkbox, input[type='checkbox'], [role='checkbox']").first();

  if (!(await article.count()) && !(await checkbox.count())) {
    throw new Error(`Naukri job ${job.jobId} could not be located for selection.`);
  }

  const beforeSelected = await getSelectedJobIds(page);
  if (beforeSelected.length > 1) {
    await clearSelectedJobs(page);
    throw new Error("Multiple Naukri jobs were selected; the selection was cleared safely.");
  }

  const alreadyChecked = await checkbox.evaluateAll(elements => elements.some((element) => {
    const state = element.getAttribute("aria-checked") || "";
    const className = element.getAttribute("class") || "";
    const selected = element.checked || state === "true" || className.includes("selected") || /ot-Checked/i.test(className);
    return Boolean(selected);
  })).catch(() => false);

  if (!alreadyChecked) {
    try {
      await checkbox.click({ timeout: 5000, force: true });
    } catch (error) {
      await article.evaluate((root) => {
        const target = root.querySelector(".tuple-check-box, .saveJobContainer, .naukicon-ot-checkbox, input[type='checkbox'], [role='checkbox']");
        if (target && typeof target.click === "function") target.click();
      }).catch(() => {});
    }
  }

  const selectedAfter = await getSelectedJobIds(page);
  if (selectedAfter.length !== 1 || !selectedAfter.includes(String(job.jobId || "").trim())) {
    await clearSelectedJobs(page);
    throw new Error("Naukri job selection could not be reduced to exactly one job.");
  }
  return true;
}

async function findApplyButton(page) {
  const selectedJobIds = await getSelectedJobIds(page);
  const selectedCount = selectedJobIds.length;
  if (selectedCount === 0) {
    return null;
  }
  if (selectedCount > 1) {
    await clearSelectedJobs(page);
    return null;
  }

  const candidates = await page.locator("button, [role='button'], input[type='submit'], a").evaluateAll(elements => elements
    .map((element, index) => ({
      index,
      text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
      value: element.value || "",
      aria: element.getAttribute("aria-label") || "",
      className: element.getAttribute("class") || "",
      disabled: element.disabled || element.getAttribute("aria-disabled") === "true"
    }))
    .filter(item => !item.disabled)
    .filter(item => /\bapply\b/i.test(item.text || item.value || item.aria || item.className))
    .filter(item => !/\bapply\s+\d+\s+jobs\b/i.test(`${item.text} ${item.value} ${item.aria} ${item.className}`.toLowerCase()))
  );

  if (!candidates.length) return null;
  const locator = page.locator("button, [role='button'], input[type='submit'], a");
  for (const candidate of candidates) {
    const control = locator.nth(candidate.index);
    const visible = await control.isVisible().catch(() => false);
    if (!visible) continue;
    const text = (await control.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const aria = String(await control.getAttribute("aria-label").catch(() => "") || "").trim();
    const value = String(await control.getAttribute("value").catch(() => "") || "").trim();
    const content = `${text} ${aria} ${value}`.toLowerCase();
    if (/\bapply\s+\d+\s+jobs\b/.test(content)) continue;
    return control;
  }
  return null;
}

async function queueUnresolvedQuestion(job, sectionName, question, reason = "No reliable answer available for the question.") {
  if (!question || !String(question).trim()) return;
  try {
    const queue = reviewQueue.loadQueue();
    const payload = {
      jobId: String(job.jobId || job.id || ""),
      company: String(job.company || ""),
      title: String(job.title || ""),
      portal: "naukri",
      portalUrl: "",
      blockedReason: reason,
      humanRequiredFields: [{
        label: String(question).trim(),
        canonicalId: questionMapper.canonicalQuestion(String(question).trim()) || "",
        source: "naukri"
      }]
    };
    reviewQueue.updateFromFormResults([payload], [], reviewQueue.DEFAULT_QUEUE_FILE);
  } catch (error) {
    // Intentionally safe: user review queue must not break the application flow.
  }
}

async function collectUnresolvedQuestions(page, applicationConfig, profile) {
  const questionSet = await page.locator("label, [aria-label], textarea, input:not([type=hidden]):not([type=submit]):not([type=button]), select, [role='textbox'], [role='combobox']").evaluateAll(elements => {
    const seen = new Set();
    const results = [];
    for (const element of elements) {
      const text = [
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.closest("label")?.innerText || "",
        element.value || ""
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (!text || seen.has(text.toLowerCase())) continue;
      if (/resume|cv|upload/i.test(text)) continue;
      if (/select experience|experiencedd|experience\s*dd|experience.*dropdown|type message here|save$/i.test(text)) continue;
      if (!/[a-z]/i.test(text)) continue;
      seen.add(text.toLowerCase());
      results.push(text);
    }
    return results;
  });

  const unresolved = [];
  for (const question of questionSet) {
    const answer = await resolveNaukriAnswer(question, applicationConfig, profile);
    if (answer !== undefined && answer !== null && answer !== "") continue;
    const canonical = questionMapper.canonicalQuestion(question, { experienceYearsRule: true });
    if (!canonical && !/phone|email|notice|location|experience|visa|authorization|willing|relocate/i.test(question.toLowerCase())) {
      continue;
    }
    if (/select experience|experiencedd|experience\s*dd|experience.*dropdown/i.test(question)) continue;
    unresolved.push(question);
  }
  return unresolved.slice(0, 10);
}

async function mapQuestionAnswers(page, applicationConfig, profile) {
  const questionSet = await page.locator("label, [aria-label], .question, .field, .jp-field, .label").evaluateAll(elements => {
    const items = [];
    for (const element of elements) {
      const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (items.some(item => item === text)) continue;
      items.push(text);
    }
    return items;
  });

  const mapped = [];
  for (const question of questionSet) {
    const canonical = questionMapper.canonicalQuestion(question, { experienceYearsRule: true });
    if (!canonical) continue;
    const answer = questionMapper.resolveConfiguredAnswer(canonical, {
      applicationConfig,
      profile,
      question,
      experienceYearsRule: true
    });
    if (answer !== undefined && answer !== null && answer !== "") {
      mapped.push({ question, canonical, answer });
    }
  }
  return mapped;
}

async function fillMappedQuestions(page, applicationConfig, profile) {
  const mapped = await mapQuestionAnswers(page, applicationConfig, profile);
  for (const entry of mapped) {
    const text = entry.question;
    const labelCandidates = [
      page.locator(`label:has-text("${text}")`),
      page.locator(`[aria-label*="${text}"]`),
      page.locator(`text=${text}`)
    ];
    for (const candidate of labelCandidates) {
      const count = await candidate.count().catch(() => 0);
      if (!count) continue;
      const control = candidate.first();
      const tag = await control.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
      if ((tag === "input" || tag === "select" || tag === "textarea") && !await control.isDisabled().catch(() => false)) {
        try {
          if (tag === "input" && await control.getAttribute("type") === "checkbox") {
            await control.check().catch(() => {});
          } else {
            await control.fill(String(entry.answer)).catch(() => {});
          }
        } catch (error) {
          // Ignore field-level fill failures and continue to the next mapping.
        }
      }
      break;
    }
  }
  return mapped;
}

async function handleNaukriRecruiterChatbot(page, job, applicationConfig, profile) {
  const drawer = page.locator(".chatbot_Drawer").first();
  if (!(await drawer.count()) || !(await drawer.isVisible().catch(() => false))) {
    if (await pageHasTerminalAcknowledgement(page)) {
      console.log("Naukri chatbot terminal acknowledgement detected after page navigation.");
      return { status: "TERMINAL_ACKNOWLEDGED", answeredCount: 0, terminalAcknowledgement: true, reason: "Terminal acknowledgement remained visible after chatbot navigation." };
    }
    return { status: "NONE", reason: "No visible Naukri recruiter chatbot drawer was detected." };
  }
  const terminalWatch = await watchForTerminalAcknowledgement(page);
  const finish = result => {
    terminalWatch.stop();
    return result;
  };

  const getCurrentMessageContext = () => getLatestChatbotMessageContext(drawer);

  let answeredCount = 0;
  let skippedCount = 0;
  const skipOrRequireUser = async (messageContext, question, canonicalId, semantic, reason, allowNaFallback = true) => {
    const skipResult = await skipCurrentNaukriQuestion(page, drawer, messageContext, semantic);
    if (skipResult.status === "CURRENT_QUESTION_SKIPPED") {
      skippedCount += 1;
      console.log(`Naukri optional recruiter question skipped: ${question}`);
      return { continue: true };
    }
    if (skipResult.status === "FAILED") {
      return {
        result: finish({ status: "FAILED", question, canonicalId, answeredCount, skippedCount, reason: skipResult.reason })
      };
    }

    let naResult;
    if (allowNaFallback) {
      const beforeFallbackSignature = await chatbotControlSignature(messageContext.container, semantic || {});
      naResult = await applyNaukriNaFallback(messageContext.container, question);
      if (naResult.status === "APPLIED") {
        const saveResult = await saveNaukriChatbotAnswerAndVerifyAdvance(
          page,
          drawer,
          messageContext,
          semantic || {},
          beforeFallbackSignature
        );
        if (!saveResult.advanced) {
          return { result: finish({ status: "FAILED", question, canonicalId, answeredCount, skippedCount, reason: saveResult.reason || "NA was saved but the chatbot did not advance." }) };
        }
        answeredCount += 1;
        console.log(`Naukri unresolved question answered with NA: ${question}`);
        return { continue: true };
      }
    }

    await queueUnresolvedQuestion(job, "naukri", question, reason);
    return {
      result: finish({ status: "NEEDS_USER_INPUT", question, canonicalId, answeredCount, skippedCount, reason: naResult?.reason || reason })
    };
  };

  for (let index = 0; index < MAX_CHATBOT_QUESTIONS; index += 1) {
    const messageContext = await getCurrentMessageContext();
    const currentQuestion = messageContext?.question;
    if (!messageContext) {
      return finish({ status: "COMPLETED", answeredCount, reason: "The chatbot is no longer presenting recruiter questions." });
    }

    const disposition = classifyNaukriChatbotMessage(currentQuestion);
    if (disposition === "TERMINAL") {
      console.log(`Naukri chatbot terminal acknowledgement: ${currentQuestion}`);
      return finish({
        status: "TERMINAL_ACKNOWLEDGED",
        answeredCount,
        skippedCount,
        terminalAcknowledgement: true,
        reason: "The chatbot presented a terminal acknowledgement."
      });
    }

    const canonicalId = questionMapper.canonicalQuestion(currentQuestion, { experienceYearsRule: true }) || "";
    if (disposition !== "QUESTION") {
      const reason = `Chatbot message could not be confidently classified as a recruiter question: ${currentQuestion}`;
      const unresolved = await skipOrRequireUser(messageContext, currentQuestion, canonicalId, null, reason, false);
      if (unresolved.continue) continue;
      return unresolved.result;
    }
    const answerResult = await resolveNaukriAnswerDetails(currentQuestion, applicationConfig, profile);
    let answer = answerResult.answer;

    const activeContainer = messageContext.container;
    let controlDiscovery = await discoverNaukriAnswerControls(activeContainer, answerResult.semantic);
    if (controlDiscovery.type === "unsupported" && activeContainer !== drawer) {
      const answerAreas = drawer.locator(".textAreaWrapper");
      for (let areaIndex = await answerAreas.count().catch(() => 0) - 1; areaIndex >= 0; areaIndex -= 1) {
        const answerArea = answerAreas.nth(areaIndex);
        if (!await answerArea.isVisible().catch(() => false)) continue;
        const answerAreaDiscovery = await discoverNaukriAnswerControls(answerArea, answerResult.semantic);
        if (answerAreaDiscovery.type !== "unsupported") {
          controlDiscovery = answerAreaDiscovery;
          break;
        }
      }
    }

    if (answer === undefined || answer === null || answer === "") {
      const options = Array.isArray(controlDiscovery?.controls) ? controlDiscovery.controls : [];
      const llmResult = await questionResolver.resolveQuestion({
        question: currentQuestion,
        controlType: controlDiscovery.type,
        options,
        applicationConfig,
        profile,
        skipDeterministic: true
      });

      if (llmResult.status === "RESOLVED") {
        answer = llmResult.answer;
        console.log(`Qwen resolved question: "${currentQuestion}" -> ${JSON.stringify(answer)}`);
      } else {
        const reason = llmResult.reason || `Recruiter question could not be resolved from profile/mapper or LLM: ${currentQuestion}`;
        const unresolved = await skipOrRequireUser(messageContext, currentQuestion, canonicalId, answerResult.semantic, reason);
        if (unresolved.continue) continue;
        return unresolved.result;
      }
    }

    const controlResult = await applyNaukriAnswerControl(controlDiscovery, answerResult.semantic, answer);
    if (controlResult.status === "NEEDS_USER_INPUT") {
      const unresolved = await skipOrRequireUser(messageContext, currentQuestion, canonicalId, answerResult.semantic, controlResult.reason, false);
      if (unresolved.continue) continue;
      return unresolved.result;
    }
    if (controlResult.status === "FAILED") {
      return finish({ status: "FAILED", question: currentQuestion, canonicalId, answeredCount, skippedCount, reason: controlResult.reason });
    }

    console.log("Naukri chatbot detected.");
    console.log(`Recruiter question: ${currentQuestion}`);
    console.log(`Resolved answer: ${controlResult.answer}`);
    console.log(`Chatbot ${controlResult.controlType} answer verified.`);

    const scopedSaveButtons = activeContainer.locator(".sendMsg");
    let saveButton = null;
    for (let buttonIndex = await scopedSaveButtons.count().catch(() => 0) - 1; buttonIndex >= 0; buttonIndex -= 1) {
      const candidate = scopedSaveButtons.nth(buttonIndex);
      if (await candidate.isVisible().catch(() => false)) {
        saveButton = candidate;
        break;
      }
    }
    if (!saveButton) {
      const drawerSaveButtons = drawer.locator(".sendMsg");
      for (let buttonIndex = await drawerSaveButtons.count().catch(() => 0) - 1; buttonIndex >= 0; buttonIndex -= 1) {
        const candidate = drawerSaveButtons.nth(buttonIndex);
        if (await candidate.isVisible().catch(() => false)) {
          saveButton = candidate;
          break;
        }
      }
    }
    if (!saveButton) return finish({ status: "FAILED", question: currentQuestion, canonicalId, answeredCount, reason: "No visible Save control was associated with the active chatbot interaction." });

    try {
      await saveButton.click({ timeout: 8000 });
    } catch (error) {
      return finish({ status: "FAILED", question: currentQuestion, canonicalId, answeredCount, reason: `Chatbot Save interaction failed: ${error.message}` });
    }
    console.log("Chatbot Save clicked.");
    answeredCount += 1;

    await safeWait(page, 1200);
    const nextContext = await getCurrentMessageContext();
    const nextQuestion = nextContext?.question;
    if (!nextQuestion) {
      if (answeredCount > 0 && (terminalWatch.detected || await pageHasTerminalAcknowledgement(page))) {
        console.log("Naukri chatbot terminal acknowledgement detected after page navigation.");
        return finish({ status: "TERMINAL_ACKNOWLEDGED", answeredCount, terminalAcknowledgement: true, reason: "Terminal acknowledgement received after the saved responses." });
      }
      return finish({ status: "COMPLETED", answeredCount, reason: "The chatbot completed after the last answered question." });
    }
    if (nextQuestion === currentQuestion) {
      console.log("Waiting for next recruiter question...");
      await safeWait(page, 1500);
      const refreshedQuestion = (await getCurrentMessageContext())?.question;
      if (!refreshedQuestion || refreshedQuestion === currentQuestion) {
        return finish({ status: "UNVERIFIED", question: currentQuestion, canonicalId, answeredCount, reason: "The chatbot did not advance to a new recruiter question after Save." });
      }
    }
  }

  return finish({ status: "UNVERIFIED", answeredCount, reason: "The chatbot exceeded the safe maximum question limit without a clear completion state." });
}

function isSuccessfulChatbotCompletion(chatbotResult) {
  return chatbotResult?.status === "TERMINAL_ACKNOWLEDGED"
    && (Number(chatbotResult.answeredCount) > 0 || chatbotResult.terminalAcknowledgement === true);
}

function captureOriginalJobUrl(job, page) {
  return String(job?.url || page.url() || "");
}

async function navigateBackToOriginalJobUrl(page, originalJobUrl) {
  try {
    const target = new URL(originalJobUrl);
    if (!isNaukriHostname(target.href)) throw new Error("Original job URL is not on Naukri.");
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("body").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(1000);
    const current = new URL(page.url());
    if (current.hostname !== target.hostname || current.pathname !== target.pathname) {
      throw new Error(`Navigation ended at ${current.href} instead of the original job URL.`);
    }
    return { restored: true };
  } catch (error) {
    return { restored: false, reason: error.message };
  }
}

async function finalizeJob(page, job, history, sectionName, applicationConfig, profile, inspectOnly, dryRun, originalJobUrl, browserConfig = {}) {
  const jobId = String(job.jobId || job.id || "");
  const status = { status: "UNVERIFIED" };
  const stabilizationDelayMs = getStabilizationDelayMs(applicationConfig, browserConfig);

  if (inspectOnly || dryRun) {
    noteHistory(history, job, "UNVERIFIED", sectionName, { reason: "Inspect-only mode stopped before submission." });
    return status;
  }

  const pageText = await page.locator("body").innerText().catch(() => "");
  const lower = pageText.toLowerCase();
  if (/redirect|external|company website|workday|greenhouse|lever|ats/.test(lower)
      && !isNaukriHostname(page.url())
      && !await pageHasTerminalAcknowledgement(page)) {
    noteHistory(history, job, "SKIPPED_EXTERNAL", sectionName, { reason: "Application redirected to a non-Naukri website." });
    status.status = "SKIPPED_EXTERNAL";
    return status;
  }

  const chatbotResult = await handleNaukriRecruiterChatbot(page, job, applicationConfig, profile);
  if (isSuccessfulChatbotCompletion(chatbotResult)) {
    const successResult = await verifyNaukriApplicationSuccess(page, jobId);
    if (!successResult.verified) {
      console.log(`Naukri chatbot completed but application completion could not be confirmed for job ${jobId}.`);
      noteHistory(history, job, "UNVERIFIED", sectionName, {
        reason: "Recruiter chatbot finished but application completion could not be confirmed.",
        chatbotQuestionsAnswered: chatbotResult.answeredCount
      });
      saveHistory(history);
      status.status = "UNVERIFIED";
      await navigateBackToOriginalJobUrl(page, originalJobUrl);
      return status;
    }

    console.log(`Naukri application completion confirmed (${successResult.signal}). Waiting ${stabilizationDelayMs}ms for stabilization...`);
    await safeWait(page, stabilizationDelayMs);

    noteHistory(history, job, "APPLIED", sectionName, {
      reason: "Naukri application completion confirmed after recruiter chatbot terminal acknowledgement.",
      chatbotQuestionsAnswered: chatbotResult.answeredCount
    });
    saveHistory(history);
    status.status = "APPLIED";
    const navigation = await navigateBackToOriginalJobUrl(page, originalJobUrl);
    if (!navigation.restored) {
      console.error(`APPLIED job ${jobId}; return to original job URL failed: ${navigation.reason}`);
    }
    return status;
  }
  if (chatbotResult.status === "NEEDS_USER_INPUT") {
    noteHistory(history, job, "NEEDS_USER_INPUT", sectionName, {
      reason: `${chatbotResult.reason || "Recruiter question unresolved."}`,
      question: chatbotResult.question || "",
      canonicalId: chatbotResult.canonicalId || ""
    });
    status.status = "NEEDS_USER_INPUT";
    return status;
  }
  if (chatbotResult.status === "FAILED") {
    noteHistory(history, job, "FAILED", sectionName, {
      reason: chatbotResult.reason || "Naukri chatbot control interaction failed.",
      question: chatbotResult.question || ""
    });
    status.status = "FAILED";
    return status;
  }
  if (chatbotResult.status === "UNVERIFIED") {
    console.log(`Naukri chatbot state: ${chatbotResult.reason || "ambiguous"}`);
  }

  const applicantQuestions = await fillKnownQuestions(page, applicationConfig, profile);
  const knownQuestionCount = applicantQuestions.filter(item => !item.skipped).length;
  if (knownQuestionCount > 0) {
    console.log(`Mapped ${knownQuestionCount} known Naukri questions using the shared question mapper.`);
  }

  const unresolvedQuestions = await collectUnresolvedQuestions(page, applicationConfig, profile);
  if (unresolvedQuestions.length > 0) {
    for (const question of unresolvedQuestions) {
      await queueUnresolvedQuestion(job, sectionName, question, "Naukri question was present but no reliable answer could be resolved by the current profile and shared question mapper.");
    }
    noteHistory(history, job, "NEEDS_USER_INPUT", sectionName, { reason: `Unresolved Naukri questions: ${unresolvedQuestions.join(" | ")}` });
    status.status = "NEEDS_USER_INPUT";
    return status;
  }

  const submitButton = await findApplyButton(page);
  if (!submitButton) {
    noteHistory(history, job, "NEEDS_USER_INPUT", sectionName, { reason: "No reliable final apply control was found." });
    status.status = "NEEDS_USER_INPUT";
    return status;
  }

  try {
    await submitButton.click({ timeout: 8000 });
  } catch (error) {
    noteHistory(history, job, "FAILED", sectionName, { reason: error.message });
    status.status = "FAILED";
    return status;
  }

  await safeWait(page, 2000);
  const successResult = await verifyNaukriApplicationSuccess(page, jobId);
  if (successResult.verified) {
    console.log(`Naukri application completion confirmed (${successResult.signal}). Waiting ${stabilizationDelayMs}ms for stabilization...`);
    await safeWait(page, stabilizationDelayMs);
    noteHistory(history, job, "APPLIED", sectionName, { reason: "Final application confirmation was detected." });
    status.status = "APPLIED";
    return status;
  }

  noteHistory(history, job, "UNVERIFIED", sectionName, { reason: "Submission did not produce an explicit confirmation." });
  status.status = "UNVERIFIED";
  return status;
}

async function processSection(page, section, history, applicationConfig, profile, inspectOnly, dryRun, limit, browserConfig = {}) {
  console.log(`\nSection: ${section.name}`);
  let initialState;
  try {
    initialState = await ensureSectionActive(page, section.name);
  } catch (error) {
    console.error(`Could not activate ${section.name}: ${error.message}`);
    return {
      processedJobs: 0,
      discoveredJobs: 0,
      jobsWithSelectableCheckbox: 0,
      jobsWithoutCheckbox: 0,
      excludedByHistory: 0,
      skippedNoCheckbox: 0,
      newJobsConsidered: 0,
      applied: 0,
      needsUserInput: 0,
      failed: 0,
      unverified: 0,
      skippedExternal: 0,
      skippedUnknownRoute: 0,
      jobsNeedingUserInput: 0,
      unresolvedQuestions: 0,
      sectionActivationFailed: true,
      sectionProcessed: false,
      reason: error.message
    };
  }

  console.log(`Activated: ${section.name}`);
  const sectionUrl = await captureSectionUrl(page);
  const jobs = initialState.jobs;
  const visibleJobs = jobs.filter(job => String(job.jobId || "").trim());

  const seenDiscoveredIds = new Set();
  const uniqueVisibleJobs = [];
  for (const job of visibleJobs) {
    const normalizedId = String(job.jobId || "").trim();
    if (!normalizedId || seenDiscoveredIds.has(normalizedId)) continue;
    seenDiscoveredIds.add(normalizedId);
    uniqueVisibleJobs.push(job);
  }

  const jobsDiscovered = uniqueVisibleJobs.length;
  const jobsWithSelectableCheckbox = uniqueVisibleJobs.filter(j => Boolean(j.hasSelectableCheckbox)).length;
  const jobsWithoutCheckbox = jobsDiscovered - jobsWithSelectableCheckbox;
  const excludedByHistory = uniqueVisibleJobs.filter(j => isJobPermanentlyExcludedByHistory(history, j.jobId)).length;

  if (inspectOnly) {
    console.log(`Found jobs: ${jobsDiscovered}`);
    return {
      processedJobs: 0,
      discoveredJobs: jobsDiscovered,
      jobsWithSelectableCheckbox,
      jobsWithoutCheckbox,
      excludedByHistory,
      skippedNoCheckbox: 0,
      newJobsConsidered: 0,
      applied: 0,
      needsUserInput: 0,
      failed: 0,
      unverified: 0,
      skippedExternal: 0,
      skippedUnknownRoute: 0,
      jobsNeedingUserInput: 0,
      unresolvedQuestions: 0,
      sectionProcessed: true
    };
  }

  const unprocessedJobs = [];
  for (const job of uniqueVisibleJobs) {
    if (isJobPermanentlyExcludedByHistory(history, job.jobId)) continue;
    unprocessedJobs.push(job);
  }

  const uniqueJobs = filterJobsWithSelectableCheckbox(unprocessedJobs, history, section.name);
  let skippedNoCheckbox = unprocessedJobs.length - uniqueJobs.length;
  if (skippedNoCheckbox) {
    saveHistory(history);
    console.log(`Skipped ${skippedNoCheckbox} job(s) without a visible selectable checkbox.`);
  }

  if (!uniqueJobs.length) {
    console.log(`No new jobs found in ${section.name}.`);
    return {
      processedJobs: 0,
      discoveredJobs: jobsDiscovered,
      jobsWithSelectableCheckbox,
      jobsWithoutCheckbox,
      excludedByHistory,
      skippedNoCheckbox,
      newJobsConsidered: 0,
      applied: 0,
      needsUserInput: 0,
      failed: 0,
      unverified: 0,
      skippedExternal: 0,
      skippedUnknownRoute: 0,
      jobsNeedingUserInput: 0,
      unresolvedQuestions: 0,
      sectionProcessed: true
    };
  }

  console.log(`New jobs found: ${uniqueJobs.length}`);
  let processed = 0;
  let applied = 0;
  let needsUserInput = 0;
  let failed = 0;
  let unverified = 0;
  let skippedExternal = 0;
  let skippedUnknownRoute = 0;
  let jobsNeedingUserInput = 0;
  let unresolvedQuestions = 0;

  for (const queuedJob of uniqueJobs) {
    if (Number.isFinite(limit) && processed >= limit) break;
    let job = queuedJob;

    try {
      const sectionState = await ensureSectionActive(page, section.name);
      const liveJob = sectionState.jobs.find(item => normalizeJobId(item.jobId) === normalizeJobId(queuedJob.jobId));
      if (!liveJob) {
        throw new Error(`Naukri job ${queuedJob.jobId} was not found in the freshly scanned '${section.name}' section.`);
      }
      job = liveJob;
      if (!job.hasSelectableCheckbox) {
        noteHistory(history, job, "SKIPPED_NO_CHECKBOX", section.name, {
          reason: "The live job article no longer has a visible selectable checkbox control."
        });
        saveHistory(history);
        skippedNoCheckbox += 1;
        processed += 1;
        continue;
      }
      console.log(`Job: ${job.title || "Unknown title"}`);
      console.log(`Company: ${job.company || "Unknown company"}`);
      console.log(`Job ID: ${job.jobId}`);

      const originalJobUrl = captureOriginalJobUrl(job, page);
      const preSelection = (await getSelectedJobIds(page)).length;
      if (preSelection > 1) {
        await clearSelectedJobs(page);
      }

      await selectSingleJob(page, job);
      const selectedAfter = (await getSelectedJobIds(page)).length;
      if (selectedAfter !== 1) {
        console.log("Selection failed: exactly one job was not selected.");
        await clearSelectedJobs(page);
        processed += 1;
        await restoreSectionUrl(page, sectionUrl);
        continue;
      }

      if (dryRun) {
        console.log("Dry-run: selected exactly one job.");
        const applyButton = await findApplyButton(page);
        if (!applyButton) {
          console.log("Dry-run: no valid Apply control was found for the selected job.");
          await clearSelectedJobs(page);
          processed += 1;
          await restoreSectionUrl(page, sectionUrl);
          continue;
        }
        console.log("Dry-run: Apply control detected; submission not clicked.");
        await clearSelectedJobs(page);
        processed += 1;
        await restoreSectionUrl(page, sectionUrl);
        continue;
      }

      const applyButton = await findApplyButton(page);
      if (!applyButton) {
        noteHistory(history, job, "NEEDS_USER_INPUT", section.name, { reason: "No valid Apply control was available." });
        saveHistory(history);
        needsUserInput += 1;
        jobsNeedingUserInput += 1;
        unresolvedQuestions += 1;
        await clearSelectedJobs(page);
        processed += 1;
        await restoreSectionUrl(page, sectionUrl);
        continue;
      }

      const pagesBeforeApply = page.context().pages();
      await applyButton.click({ timeout: 10000 });
      await safeWait(page, 2000);

      const applicationRoute = await waitForNaukriApplicationRoute(page, pagesBeforeApply, 6000, job.jobId);
      if (applicationRoute.type === "EXTERNAL_ROUTE" || applicationRoute.type === "EXTERNAL_REDIRECT") {
        const reason = applicationRoute.type === "EXTERNAL_ROUTE"
          ? `Naukri selected external application route: ${applicationRoute.label}.`
          : `Naukri redirected to external application page: ${applicationRoute.url}.`;
        noteHistory(history, job, "SKIPPED_EXTERNAL", section.name, { reason });
        saveHistory(history);
        skippedExternal += 1;
        if (applicationRoute.page && applicationRoute.page !== page) {
          await applicationRoute.page.close().catch(() => {});
        }
        const restored = await navigateBackToOriginalJobUrl(page, originalJobUrl);
        if (!restored.restored) console.error(`SKIPPED_EXTERNAL job ${job.jobId}; return to original job URL failed: ${restored.reason}`);
        if (isNaukriHostname(page.url())) await clearSelectedJobs(page).catch(() => {});
        processed += 1;
        await restoreSectionUrl(page, sectionUrl);
        await safeWait(page, 1000);
        const refreshedJobs = await discoverJobs(page);
        if (refreshedJobs.filter(item => String(item.jobId || "").trim()).length) {
          console.log(`Re-scanned section after external route: ${refreshedJobs.length} visible jobs remain.`);
        }
        continue;
      }
      if (applicationRoute.type === "APPLIED") {
        console.log(`Direct apply succeeded for job ${job.jobId} (saveApply multiApplyResp 200).`);
        const stabilizationDelayMs = getStabilizationDelayMs(applicationConfig, browserConfig);
        await safeWait(page, stabilizationDelayMs);
        noteHistory(history, job, "APPLIED", section.name, {
          reason: "Direct apply succeeded via saveApply with status 200.",
          routeUrl: applicationRoute.url,
          statusCode: applicationRoute.statusCode || 200
        });
        saveHistory(history);
        applied += 1;
        if (applicationRoute.page && applicationRoute.page !== page) {
          await applicationRoute.page.close().catch(() => {});
        }
        const restored = await navigateBackToOriginalJobUrl(page, originalJobUrl);
        if (!restored.restored) console.error(`APPLIED job ${job.jobId}; return to original job URL failed: ${restored.reason}`);
        if (isNaukriHostname(page.url())) await clearSelectedJobs(page).catch(() => {});
        processed += 1;
        await restoreSectionUrl(page, sectionUrl);
        await safeWait(page, 1000);
        const refreshedJobs = await discoverJobs(page);
        if (refreshedJobs.filter(item => String(item.jobId || "").trim()).length) {
          console.log(`Re-scanned section after direct apply: ${refreshedJobs.length} visible jobs remain.`);
        }
        continue;
      }
      if (applicationRoute.type !== "CHATBOT") {
        const reason = `Unable to determine Naukri application route after Apply: ${applicationRoute.url || page.url()}`;
        noteHistory(history, job, "SKIPPED_UNKNOWN_ROUTE", section.name, { reason });
        saveHistory(history);
        skippedUnknownRoute += 1;
        const restored = await navigateBackToOriginalJobUrl(page, originalJobUrl);
        if (!restored.restored) console.error(`SKIPPED_UNKNOWN_ROUTE job ${job.jobId}; return to original job URL failed: ${restored.reason}`);
        processed += 1;
        await restoreSectionUrl(page, sectionUrl);
        await safeWait(page, 1000);
        const refreshedJobs = await discoverJobs(page);
        if (refreshedJobs.filter(item => String(item.jobId || "").trim()).length) {
          console.log(`Re-scanned section after unknown route: ${refreshedJobs.length} visible jobs remain.`);
        }
        continue;
      }

      const result = await finalizeJob(page, job, history, section.name, applicationConfig, profile, false, false, originalJobUrl, browserConfig);
      console.log(`Result: ${result.status}`);
      saveHistory(history);
      processed += 1;
      if (result.status === "APPLIED") applied += 1;
      else if (result.status === "NEEDS_USER_INPUT") {
        needsUserInput += 1;
        jobsNeedingUserInput += 1;
        unresolvedQuestions += Number(result.unresolvedQuestionCount || 1);
      } else if (result.status === "FAILED") failed += 1;
      else if (result.status === "UNVERIFIED") unverified += 1;
      else if (result.status === "SKIPPED_EXTERNAL") skippedExternal += 1;
    } catch (error) {
      console.error(`Failed processing ${job.jobId}: ${error.message}`);
      if (!dryRun) {
        noteHistory(history, job, "FAILED", section.name, { reason: error.message });
        saveHistory(history);
        failed += 1;
      }
      processed += 1;
      if (error.code === "NAUKRI_SECTION_CONTEXT_ERROR") {
        return {
          processedJobs: processed,
          discoveredJobs: jobsDiscovered,
          jobsWithSelectableCheckbox,
          jobsWithoutCheckbox,
          excludedByHistory,
          skippedNoCheckbox,
          newJobsConsidered: uniqueJobs.length,
          applied,
          needsUserInput,
          failed,
          unverified,
          skippedExternal,
          skippedUnknownRoute,
          jobsNeedingUserInput,
          unresolvedQuestions,
          sectionActivationFailed: true,
          sectionProcessed: false,
          reason: error.message
        };
      }
    }

    await restoreSectionUrl(page, sectionUrl);
    await safeWait(page, 1000);
    const refreshedJobs = await discoverJobs(page);
    const nextVisible = refreshedJobs.filter(item => String(item.jobId || "").trim());
    if (nextVisible.length) {
      console.log(`Re-scanned section after job: ${nextVisible.length} visible jobs remain.`);
    }
  }

  return {
    processedJobs: processed,
    discoveredJobs: jobsDiscovered,
    jobsWithSelectableCheckbox,
    jobsWithoutCheckbox,
    excludedByHistory,
    skippedNoCheckbox,
    newJobsConsidered: uniqueJobs.length,
    applied,
    needsUserInput,
    failed,
    unverified,
    skippedExternal,
    skippedUnknownRoute,
    jobsNeedingUserInput,
    unresolvedQuestions,
    sectionProcessed: true
  };
}

async function main() {
  const inspectOnly = getFlag("inspect-only");
  const dryRun = getFlag("dry-run");
  const limit = getLimit();
  const requestedSection = getRequestedSection();
  const applicationConfig = readJson(CONFIG_FILE, {});
  const profile = readJson(PROFILE_FILE, {});
  const browserConfig = loadBrowserConfig();
  const history = loadHistory();
  questionResolver.loadUserContextOnce();

  if (!browserConfig || browserConfig.browser !== "edge") {
    throw new Error("Browser configuration is not configured for Edge.");
  }

  console.log("Naukri Job Automation");
  console.log(`Inspect-only: ${inspectOnly ? "YES" : "NO"}`);
  console.log(`Dry-run: ${dryRun ? "YES" : "NO"}`);
  if (dryRun) {
    const previewQuestion = "Notice period (please mention LWD if serving/ served)";
    const previewAnswer = await resolveNaukriAnswer(previewQuestion, applicationConfig, profile);
    console.log(`Dry-run resolver preview: ${previewQuestion} => ${String(previewAnswer)}`);
  }

  let browserContext;
  let page;
  try {
    browserContext = await launchEdge(browserConfig);
    page = await browserContext.newPage();
    await page.goto(DEFAULT_URL, { waitUntil: "domcontentloaded", timeout: browserConfig.navigationTimeoutMs || 45000 });
    await safeWait(page, 2000);
    await verifyNaukriPage(page, "Naukri home page");

    if (!await clickJobsNavigation(page)) {
      console.log("Naukri Jobs navigation could not be reached safely.");
      return;
    }

    const sections = selectRequestedSections(await discoverSections(page), requestedSection);
    console.log(`Detected sections: ${sections.map(section => section.name).join(", ") || "none"}`);
    if (requestedSection) console.log(`Selected section: ${requestedSection}`);

    const initialTrackedCount = Object.keys(history.jobs || {}).length;
    const stats = createCurrentRunStats(requestedSection);
    stats.alreadyTrackedBefore = initialTrackedCount;

    for (const section of sections) {
      if (Number.isFinite(limit) && stats.processed >= limit) break;
      const sectionResult = await processSection(page, section, history, applicationConfig, profile, inspectOnly, dryRun, Number.isFinite(limit) ? Math.max(limit - stats.processed, 0) : Number.POSITIVE_INFINITY, browserConfig);
      if (requestedSection && sectionResult.sectionActivationFailed) {
        throw new Error(`Could not process requested Naukri section '${requestedSection}': ${sectionResult.reason || "section context could not be established"}`);
      }
      if (sectionResult.sectionProcessed) stats.sectionsProcessed += 1;
      stats.processed += sectionResult.processedJobs || 0;
      stats.jobsDiscovered += sectionResult.discoveredJobs || 0;
      stats.jobsWithSelectableCheckbox += sectionResult.jobsWithSelectableCheckbox || 0;
      stats.jobsWithoutCheckbox += sectionResult.jobsWithoutCheckbox || 0;
      stats.excludedByHistory += sectionResult.excludedByHistory || 0;
      stats.skippedNoCheckbox += sectionResult.skippedNoCheckbox || 0;
      stats.newJobsConsidered += sectionResult.newJobsConsidered || 0;
      stats.applied += sectionResult.applied || 0;
      stats.needsUserInput += sectionResult.needsUserInput || 0;
      stats.failed += sectionResult.failed || 0;
      stats.unverified += sectionResult.unverified || 0;
      stats.skippedExternal += sectionResult.skippedExternal || 0;
      stats.skippedUnknownRoute += sectionResult.skippedUnknownRoute || 0;
      stats.jobsNeedingUserInput += sectionResult.jobsNeedingUserInput || 0;
      stats.unresolvedQuestions += sectionResult.unresolvedQuestions || 0;
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
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_URL,
  SECTION_ORDER,
  buildHistorySummary,
  createCurrentRunStats,
  formatAutomationSummary,
  isRorOrSafeNaSkill,
  clickJobsNavigation,
  getRequestedSection,
  selectRequestedSections,
  normalizeSectionName,
  discoverSections,
  getActiveSectionName,
  activateSection,
  ensureSectionActive,
  processSection,
  discoverJobs,
  findApplyButton,
  findUniqueNumericRangeOption,
  findSemanticOption,
  findPriorityRelocationOption,
  parseNaukriSaveApplyResult,
  filterJobsWithSelectableCheckbox,
  decideNaukriAnswerControl,
  discoverNaukriAnswerControls,
  findSkipQuestionControl,
  skipCurrentNaukriQuestion,
  applyNaukriNaFallback,
  detectNaukriApplicationRoute,
  waitForNaukriApplicationRoute,
  saveNaukriChatbotAnswerAndVerifyAdvance,
  applyNaukriAnswerControl,
  parseNumericRangeOption,
  selectSingleExperienceRange,
  readExperienceRangeOptions,
  getLatestChatbotMessageContext,
  handleNaukriRecruiterChatbot,
  loadHistory,
  captureOriginalJobUrl,
  classifyNaukriChatbotMessage,
  isSuccessfulChatbotCompletion,
  navigateBackToOriginalJobUrl,
  resolveNaukriChatbotMessage,
  resolveNaukriAnswer,
  resolveNaukriAnswerDetails,
  isTerminalHistoryStatus,
  isJobPermanentlyExcludedByHistory,
  saveHistory,
  verifyNaukriPage,
  getStabilizationDelayMs,
  verifyNaukriApplicationSuccess,
  finalizeJob,
  main
};
