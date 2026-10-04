const fs = require("fs");
const path = require("path");
const { generateCompanyAnswers, researchCompany } = require("./company-answer");

const ROOT = path.resolve(__dirname, "..", "..");
const CACHE_DIRECTORY = path.join(ROOT, "data", "company_answers");
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cachePathForCompany(company) {
  const safeName = String(company || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!safeName || safeName === "." || safeName === "..") {
    throw new Error("A valid company name is required to create an answer cache.");
  }
  return path.join(CACHE_DIRECTORY, `${safeName}.json`);
}

function isCacheFresh(cache, now = Date.now()) {
  const generatedAt = Date.parse(cache?.generatedAt || "");
  return Number.isFinite(generatedAt)
    && generatedAt <= now
    && now - generatedAt < CACHE_MAX_AGE_MS
    && typeof cache.answers?.whyUs === "string"
    && Boolean(cache.answers.whyUs.trim())
    && typeof cache.answers?.whyInterested === "string"
    && Boolean(cache.answers.whyInterested.trim())
    && typeof cache.source === "string";
}

function readCache(company) {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePathForCompany(company), "utf8"));
    if (String(cache.company).trim().toLowerCase() !== String(company).trim().toLowerCase()) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeCache(company, research, answers) {
  const cache = {
    company,
    generatedAt: new Date().toISOString(),
    source: research.origin,
    answers: {
      whyUs: answers.whyUs,
      whyInterested: answers.whyInterested
    }
  };
  fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
  fs.writeFileSync(cachePathForCompany(company), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return cache;
}

function adaptAnswer(answer, jobDescription, profile) {
  const base = String(answer || "").trim();
  if (!base) return "";

  const jobText = String(jobDescription || "").toLowerCase();
  const skills = (profile.skills?.primary || []).map(String)
    .filter(skill => skill && jobText.includes(skill.toLowerCase()))
    .slice(0, 3);
  const missingSkills = skills.filter(skill => !base.toLowerCase().includes(skill.toLowerCase()));
  if (!missingSkills.length) return base;

  const jobSpecificSentence = `My professional experience includes ${missingSkills.join(", ")}, which the job description identifies as relevant.`;
  return `${base.replace(/[\s.]+$/, ".")} ${jobSpecificSentence}`.trim().split(/\s+/).slice(0, 120).join(" ");
}

function loadProfile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "config", "profile.json"), "utf8"));
  } catch {
    return {};
  }
}

async function getCompanyAnswers(company, jobDescription = "", { forceRefresh = false } = {}) {
  if (!company || !String(company).trim()) throw new Error("Company name is required for company answers.");

  if (!forceRefresh) {
    const cached = readCache(company);
    if (isCacheFresh(cached)) {
      const profile = loadProfile();
      return {
        whyUs: adaptAnswer(cached.answers.whyUs, jobDescription, profile),
        whyInterested: adaptAnswer(cached.answers.whyInterested, jobDescription, profile),
        cached: true,
        source: cached.source
      };
    }
  }

  const research = await researchCompany(company);
  if (!research?.origin || !research.evidence) {
    throw new Error(`Could not research a public website for ${company}; leaving the answer for human review.`);
  }

  const answers = await generateCompanyAnswers(company, research);
  const cache = writeCache(company, research, answers);
  const profile = loadProfile();
  return {
    whyUs: adaptAnswer(cache.answers.whyUs, jobDescription, profile),
    whyInterested: adaptAnswer(cache.answers.whyInterested, jobDescription, profile),
    cached: false,
    source: cache.source
  };
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const jdOptionIndex = argumentsList.indexOf("--job-description");
  const company = argumentsList.find((value, index) => !value.startsWith("--")
    && index !== jdOptionIndex + 1);
  if (!company) {
    throw new Error('Usage: node scripts/lib/answer-cache.js "Company Name" [--refresh] [--job-description path]');
  }

  let jobDescription = "";
  if (jdOptionIndex >= 0) {
    const jdPath = argumentsList[jdOptionIndex + 1];
    if (!jdPath) throw new Error("--job-description requires a file path.");
    jobDescription = fs.readFileSync(path.resolve(ROOT, jdPath), "utf8");
  }

  const result = await getCompanyAnswers(company, jobDescription, {
    forceRefresh: argumentsList.includes("--refresh")
  });
  console.log(`Company answer cache: ${result.cached ? "reused" : "created/refreshed"}`);
  console.log(`Source: ${result.source}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Company answer cache failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CACHE_MAX_AGE_MS,
  adaptAnswer,
  cachePathForCompany,
  getCompanyAnswers,
  isCacheFresh,
  readCache
};
