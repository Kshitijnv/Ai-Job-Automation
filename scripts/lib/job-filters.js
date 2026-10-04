"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_POSTING_AGE_DAYS = 14;

function parsePostingAgeDays(value, now = new Date()) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;

  if (/^(?:posted\s+)?(?:today|just now|moments? ago)$/.test(text)) return 0;
  if (/^(?:posted\s+)?yesterday$/.test(text)) return 1;

  const relative = text.match(/^(?:posted\s+)?(\d+(?:\.\d+)?)\s*(minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    if (unit.startsWith("minute")) return amount / 1440;
    if (unit.startsWith("hour")) return amount / 24;
    if (unit.startsWith("day")) return amount;
    if (unit.startsWith("week")) return amount * 7;
    if (unit.startsWith("month")) return amount * 30;
    return amount * 365;
  }

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const postedDay = Date.UTC(new Date(parsed).getUTCFullYear(), new Date(parsed).getUTCMonth(), new Date(parsed).getUTCDate());
    return Math.max(0, Math.floor((today - postedDay) / DAY_MS));
  }
  return Math.max(0, (now.getTime() - parsed) / DAY_MS);
}

function isWithinPostingWindow(value, now = new Date()) {
  const ageDays = parsePostingAgeDays(value, now);
  return ageDays === null || ageDays <= MAX_POSTING_AGE_DAYS;
}

function jobIdOf(job) {
  const id = job && (job.id ?? job.jobId);
  return id === null || id === undefined || String(id).trim() === "" ? "" : String(id).trim();
}

function normalizedUrlOf(job) {
  return String((job && job.url) || "").trim().replace(/[?#].*$/, "").replace(/\/$/, "");
}

function dedupeByLinkedInJobId(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const id = jobIdOf(job);
    const key = id ? `id:${id}` : `url:${normalizedUrlOf(job)}`;
    if (key === "url:") return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function manualJobKeys(jobs) {
  const ids = new Set();
  const legacyUrls = new Set();
  for (const job of jobs || []) {
    const id = jobIdOf(job);
    if (id) ids.add(id);
    else {
      const url = normalizedUrlOf(job);
      if (url) legacyUrls.add(url);
    }
  }
  return { ids, legacyUrls };
}

function isPreviouslyManual(job, manualKeys) {
  const id = jobIdOf(job);
  if (id && manualKeys.ids.has(id)) return true;
  const url = normalizedUrlOf(job);
  return Boolean(url && manualKeys.legacyUrls.has(url));
}

function isProtectedCandidate(candidate, { inspectOnly = false, explicitJobId = false } = {}) {
  if (!candidate) return false;
  if (candidate.status === "APPLIED") return true;
  if (!inspectOnly && candidate.status === "UNVERIFIED" && (candidate.submitted || candidate.submitClickAttempted)) return true;
  if (!inspectOnly && !explicitJobId && candidate.status === "NEEDS_USER_INPUT") return true;
  return false;
}

function selectApplicationJobs(jobs, manualJobs, existingCandidates, options = {}) {
  const keys = manualJobKeys(manualJobs);
  return dedupeByLinkedInJobId(jobs || []).filter(job => {
    if (isPreviouslyManual(job, keys)) return false;
    const existing = existingCandidates.get(jobIdOf(job));
    return !isProtectedCandidate(existing, options);
  });
}

module.exports = {
  MAX_POSTING_AGE_DAYS,
  parsePostingAgeDays,
  isWithinPostingWindow,
  dedupeByLinkedInJobId,
  jobIdOf,
  normalizedUrlOf,
  manualJobKeys,
  isPreviouslyManual,
  isProtectedCandidate,
  selectApplicationJobs
};
