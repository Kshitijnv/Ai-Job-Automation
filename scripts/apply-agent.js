const fs = require("fs");
const path = require("path");
const readline = require("readline");
const {
  isLinkedInLoginRequired,
  launchEdge,
  loadBrowserConfig,
  inspectLinkedInJob,
  clickEasyApplyEntry
} = require("./lib/browser");
const { automate: automateEasyApply } = require("./lib/linkedin-easy-apply");
const { jobIdOf, normalizedUrlOf, manualJobKeys, isPreviouslyManual, isProtectedCandidate, selectApplicationJobs } = require("./lib/job-filters");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "output");
const RANKED_FILE = path.join(OUTPUT, "today_jobs_ranked.json");
const PROFILE_FILE = path.join(ROOT, "config", "profile.json");
const CANDIDATES_FILE = path.join(OUTPUT, "apply_candidates.json");
const MANUAL_FILE = path.join(OUTPUT, "manual_applications.json");
const JOB_DESCRIPTIONS = path.join(OUTPUT, "job_descriptions");

const NEXT_ACTION_BY_STATUS = {
  Ready: "OpenEasyApply",
  ManualApply: "ManualList",
  Unknown: "ManualList",
  EasyApplyEntryReached: "StopAtEasyApplyEntry",
  DIALOG_DETECTED: "StopAfterDialog",
  REVIEW_READY: "ManualReview",
  INSPECTION_LIMIT: "ManualReview",
  RESUME_CHOICES_INSPECTED: "ManualReview",
  ADDITIONAL_QUESTIONS_INSPECTED: "ManualReview",
  APPLIED: "Submitted",
  NEEDS_USER_INPUT: "ManualReview",
  UNVERIFIED: "NoRetry",
  SECURITY_STOP: "Stop",
  LOGIN_REQUIRED: "Stop",
  SecurityCheck: "Stop",
  AlreadyApplied: "Skip",
  LoginRequired: "WaitForLogin",
  ProfileLocked: "Retry",
  Error: "Retry"
};

function resumeFolderFor(job) {
  const safeCompany = String(job.company ?? "Company")
    .replace(/[<>:"/\\|?*]/g, "")
    .trim();
  return `${safeCompany}_${job.id ?? "unknown"}`;
}

function makeCandidate(job, result = {}, checkedAt = new Date().toISOString(), existing = {}) {
  const resumeFolder = resumeFolderFor(job);
  const jdFileName = job.jd?.fileName;
  const jdDownloaded = job.jd?.downloaded === true
    && Boolean(jdFileName)
    && fs.existsSync(path.join(JOB_DESCRIPTIONS, jdFileName));
  const status = Object.hasOwn(NEXT_ACTION_BY_STATUS, result.status)
    ? result.status
    : "Error";

  return {
    ...existing,
    jobId: String(job.id ?? ""),
    company: String(result.company || job.company || existing.company || ""),
    title: String(result.title || job.title || existing.title || ""),
    location: String(result.location || job.location || existing.location || ""),
    source: String(existing.source || "linkedin"),
    url: String(job.url ?? ""),
    action: job.action,
    score: Number.isFinite(Number(job.score)) ? Number(job.score) : null,
    portal: String(result.portal ?? existing.portal ?? "linkedin"),
    portalUrl: String(result.portalUrl ?? ""),
    button: String(result.button ?? "Unknown"),
    status,
    classification: result.classification || (status === "ManualApply" ? "MANUAL_APPLY" : ["Ready", "EasyApplyEntryReached"].includes(status) ? "EASY_APPLY" : ["Unknown", "LoginRequired", "SecurityCheck", "Error"].includes(status) ? "UNKNOWN" : ""),
    reason: result.reason || (status === "LoginRequired" ? "LinkedIn login is required; application type could not be inspected." : status === "SecurityCheck" ? "LinkedIn security verification prevented inspection." : ""),
    fieldsDetected: result.fieldsDetected || [],
    knownFieldsFilled: result.knownFieldsFilled || [],
    configuredFieldsFilled: result.configuredFieldsFilled || [],
    semanticQuestionsResolved: result.semanticQuestionsResolved || [],
    missingQuestions: result.missingQuestions || [],
    stepsCompleted: result.stepsCompleted || 0,
    submitted: result.submitted === true,
    submitClicked: result.submitClicked === true,
    submitClickAttempted: result.submitClickAttempted === true,
    submissionControl: result.submissionControl || null,
    submissionVerified: result.submissionVerified === true,
    reviewReached: result.reviewReached === true,
    resumeStatus: result.resumeStatus || "NOT_INSPECTED",
    resumeChoices: result.resumeChoices || null,
    questionRadioGroups: result.questionRadioGroups || [],
    easyApplyControl: result.easyApplyControl || null,
    dialogDetected: result.dialogDetected === true,
    easyApplyDiagnostics: result.diagnostics || null,
    dialogSelector: result.dialogSelector || "",
    dialogWaitMs: result.dialogWaitMs ?? null,
    stepsInspected: result.stepsInspected || [],
    nextButtonSelector: result.nextButtonSelector || "",
    externalUrl: result.externalUrl || "",
    postedTime: result.postedTime || job.postedTime || job.postedAt || job.posted || "",
    nextAction: NEXT_ACTION_BY_STATUS[status],
    loginRequired: status === "LoginRequired",
    jdDownloaded,
    resumeFolder,
    resumePdf: path.posix.join("output", "resumes", resumeFolder, "resume.pdf"),
    checkedAt
  };
}

function loadExistingCandidates() {
  try {
    const output = JSON.parse(fs.readFileSync(CANDIDATES_FILE, "utf8"));
    return new Map((output.candidates || []).map(candidate => [String(candidate.jobId), candidate]));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

function loadManualApplications() {
  try {
    const output = JSON.parse(fs.readFileSync(MANUAL_FILE, "utf8"));
    return Array.isArray(output.jobs) ? output.jobs : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function errorResult(job, status, existing = {}) {
  return makeCandidate(job, { status, button: "Unknown" }, new Date().toISOString(), existing);
}

async function processJob(page, job, candidate, profile, applicationConfig, config, inspectOnly = false) {
  const result = await inspectLinkedInJob(page, job, config);
  result.portalUrl = "";
  if (result.status === "Ready") {
    const click = await clickEasyApplyEntry(page);
    result.status = click.clicked ? "EasyApplyEntryReached" : "Unknown";
    result.classification = click.clicked ? "EASY_APPLY" : "UNKNOWN";
    result.easyApplyControl = click;
    result.reason = click.clicked
      ? "Opened the LinkedIn Easy Apply entry point."
      : "Easy Apply was detected but its control could not be safely clicked.";
    if (!/^https?:\/\/(www\.|[a-z]{2}\.)?linkedin\.com\//i.test(page.url())) {
      result.status = "Unknown";
      result.classification = "UNKNOWN";
      result.reason = "The action left LinkedIn; processing stopped.";
    }
    if (click.clicked && result.status === "EasyApplyEntryReached") {
      const application = await automateEasyApply(page, job, candidate, profile, applicationConfig, { inspectOnly });
      result.status = application.status;
      result.classification = "EASY_APPLY";
      result.reason = application.reason;
      result.fieldsDetected = application.fieldsDetected;
      result.knownFieldsFilled = [...new Set(application.knownFieldsFilled)];
      result.configuredFieldsFilled = [...new Set(application.configuredFieldsFilled)];
      result.semanticQuestionsResolved = [...new Set(application.semanticQuestionsResolved)];
      result.missingQuestions = application.missingQuestions;
      result.stepsCompleted = application.stepsCompleted;
      result.submitted = application.submitted;
      result.submitClicked = application.submitClicked === true;
      result.submitClickAttempted = application.submitClickAttempted === true;
      result.submissionControl = application.submissionControl || null;
      result.submissionVerified = application.submissionVerified === true;
      result.reviewReached = application.reviewReached === true;
      result.resumeStatus = application.resumeStatus || "NOT_INSPECTED";
      result.diagnostics = application.diagnostics || null;
      result.dialogSelector = application.dialogSelector || "";
      result.dialogWaitMs = application.dialogWaitMs ?? null;
      result.stepsInspected = application.stepsInspected || [];
      result.nextButtonSelector = application.nextButtonSelector || "";
      result.dialogDetected = application.dialogDetected === true;
      result.resumeChoices = application.resumeChoices || null;
      result.questionRadioGroups = application.questionRadioGroups || [];
    }
  }
  return result;
}

function saveManualApplications(candidates) {
  let prior = [];
  try {
    prior = JSON.parse(fs.readFileSync(MANUAL_FILE, "utf8")).jobs || [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const recordKey = job => {
    const id = jobIdOf(job);
    return id ? `id:${id}` : `url:${normalizedUrlOf(job)}`;
  };
  const keyed = new Map(prior.map(job => [recordKey(job), job]));
  for (const candidate of candidates.filter(item => ["MANUAL_APPLY", "UNKNOWN"].includes(item.classification))) {
    const key = recordKey(candidate);
    keyed.set(key, {
      jobId: candidate.jobId,
      title: candidate.title,
      company: candidate.company,
      location: candidate.location,
      url: candidate.url,
      postedTime: candidate.postedTime || "",
      reason: candidate.classification === "MANUAL_APPLY" ? "NO_EASY_APPLY" : "UNKNOWN_APPLICATION_TYPE",
      reasonDetail: candidate.reason || "",
      externalApplicationUrl: candidate.externalUrl || "",
      classification: candidate.classification,
      recordedAt: candidate.checkedAt
    });
  }
  fs.writeFileSync(MANUAL_FILE, `${JSON.stringify({ generatedAt: new Date().toISOString(), jobs: [...keyed.values()] }, null, 2)}\n`, "utf8");
}

function waitForManualLogin() {
  console.log("First-time setup: Please log into LinkedIn in the automation browser. Press Enter after login.");
  if (!process.stdin.isTTY) return Promise.resolve(false);

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    prompt.question("", () => {
      prompt.close();
      resolve(true);
    });
  });
}

function loadJobs() {
  const ranked = JSON.parse(fs.readFileSync(RANKED_FILE, "utf8"));
  const jobs = Array.isArray(ranked.jobs) ? ranked.jobs : [];
  const jobIdIndex = process.argv.indexOf("--job-id");
  if (jobIdIndex >= 0) {
    const jobId = String(process.argv[jobIdIndex + 1] || "");
    if (!jobId) throw new Error("--job-id requires a job ID.");
    const job = jobs.find(item => String(item.id) === jobId);
    if (!job) throw new Error(`Job ${jobId} was not found in the ranked results.`);
    return [job];
  }
  const limitIndex = process.argv.indexOf("--limit");
  if (limitIndex >= 0) {
    const limit = Number(process.argv[limitIndex + 1]);
    if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
    return jobs.slice(0, limit);
  }
  return jobs;
}

async function main() {
  const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8"));
  const applicationConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "application.json"), "utf8"));
  const jobs = loadJobs();
  const existingCandidates = loadExistingCandidates();
  const manualApplications = loadManualApplications();
  const config = loadBrowserConfig();

  if (!profile.candidate?.name) {
    throw new Error("config/profile.json is missing candidate.name.");
  }

  fs.mkdirSync(OUTPUT, { recursive: true });
  const inspectOnly = process.argv.includes("--inspect-only");
  const explicitJobId = process.argv.includes("--job-id");
  const manualKeys = manualJobKeys(manualApplications);
  const manualSkipped = jobs.filter(job => isPreviouslyManual(job, manualKeys));
  const protectedSkipped = jobs.filter(job => !isPreviouslyManual(job, manualKeys)
    && isProtectedCandidate(existingCandidates.get(jobIdOf(job)), { inspectOnly, explicitJobId }));
  const processableJobs = selectApplicationJobs(jobs, manualApplications, existingCandidates, { inspectOnly, explicitJobId });
  const candidates = [];
  console.log(`Skipped before browser navigation: ${manualSkipped.length} previously manual, ${protectedSkipped.length} protected application records.`);
  let context;
  let page;
  let browserError;
  let loginPromptShown = false;

  try {
    if (processableJobs.length) {
      context = await launchEdge(config);
      page = await context.newPage();
    }
    for (let index = 0; index < processableJobs.length; index++) {
      const job = processableJobs[index];
      const existing = existingCandidates.get(String(job.id)) || {};
      let result;
      try {
        result = await processJob(page, job, makeCandidate(job, {}, new Date().toISOString(), existing), profile, applicationConfig, config, inspectOnly);
      } catch (error) {
        console.error(`Inspection failed for ${job.id}: ${error.stack || error.message}`);
        result = {
          portal: "linkedin",
          portalUrl: "",
          status: "Error",
          classification: "UNKNOWN",
          reason: `Unable to inspect the LinkedIn job: ${error.message}`,
          button: "Unknown"
        };
      }

      if (result.status === "LoginRequired" && result.portal === "linkedin") {
        if (!loginPromptShown) {
          loginPromptShown = true;
          const canWaitForLogin = await waitForManualLogin();
          if (canWaitForLogin) {
            await page.waitForTimeout(config.pageLoadWaitMs);
            if (!(await isLinkedInLoginRequired(page))) {
              try {
                result = await processJob(page, job, makeCandidate(job, {}, new Date().toISOString(), existing), profile, applicationConfig, config, inspectOnly);
              } catch (error) {
                console.error(`Inspection failed for ${job.id}: ${error.stack || error.message}`);
                result = { portal: "linkedin", portalUrl: "", status: "Error", classification: "UNKNOWN", reason: `Unable to inspect the LinkedIn job: ${error.message}`, button: "Unknown" };
              }
            }
          }
        }

        if (result.status === "LoginRequired") {
          candidates.push(makeCandidate(job, result, new Date().toISOString(), existing));
          for (const remainingJob of processableJobs.slice(index + 1)) {
            const remainingExisting = existingCandidates.get(String(remainingJob.id)) || {};
            candidates.push(makeCandidate(remainingJob, {
              portal: "linkedin",
              portalUrl: "",
              status: "LoginRequired",
              classification: "UNKNOWN",
              reason: "LinkedIn login is required; application type could not be inspected.",
              button: "Login Required"
            }, new Date().toISOString(), remainingExisting));
          }
          break;
        }
      }

      candidates.push(makeCandidate(job, result, new Date().toISOString(), existing));
      if (result.diagnostics) {
        console.log(`Easy Apply post-click UI diagnostics for ${job.id}: ${JSON.stringify(result.diagnostics)}`);
      }
      if (["SecurityCheck", "SECURITY_STOP", "LOGIN_REQUIRED"].includes(result.status)) {
        console.error("LinkedIn security, verification, or login state detected; stopping the workflow.");
        break;
      }
    }
  } catch (error) {
    browserError = error;
    const status = /ProcessSingleton|profile.*in use|user data directory.*in use/i.test(error.message)
      ? "ProfileLocked"
      : "Error";
    for (const job of processableJobs) {
      candidates.push(errorResult(job, status, existingCandidates.get(String(job.id)) || {}));
    }
  } finally {
    try {
      if (page) await page.close();
    } finally {
      if (context) await context.close();
    }
  }

  let previousCandidateRecords = [];
  try {
    previousCandidateRecords = JSON.parse(fs.readFileSync(CANDIDATES_FILE, "utf8")).candidates || [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const candidateKey = candidate => {
    const id = jobIdOf(candidate);
    return id ? `id:${id}` : `url:${normalizedUrlOf(candidate)}`;
  };
  const persistentCandidates = new Map(previousCandidateRecords.map(candidate => [candidateKey(candidate), candidate]));
  for (const candidate of candidates) persistentCandidates.set(candidateKey(candidate), candidate);
  fs.writeFileSync(CANDIDATES_FILE, `${JSON.stringify({
    candidate: profile.candidate.name,
    generatedAt: new Date().toISOString(),
    candidates: [...persistentCandidates.values()]
  }, null, 2)}\n`, "utf8");
  saveManualApplications(candidates);

  const counts = candidates.reduce((summary, candidate) => {
    summary[candidate.status] = (summary[candidate.status] || 0) + 1;
    return summary;
  }, {});
  console.log("Apply Agent Summary\n");
  console.log(`- Jobs Processed: ${candidates.length}`);
  console.log(`- Ready: ${counts.Ready || 0}`);
  console.log(`- External Apply: ${counts.ExternalApply || 0}`);
  console.log(`- Manual Apply: ${counts.ManualApply || 0}`);
  console.log(`- Unknown: ${counts.Unknown || 0}`);
  console.log(`- Easy Apply entry reached: ${counts.EasyApplyEntryReached || 0}`);
  console.log(`- Easy Apply dialog detected: ${counts.DIALOG_DETECTED || 0}`);
  console.log(`- Already Applied: ${counts.AlreadyApplied || 0}`);
  console.log(`- Login Required: ${counts.LoginRequired || 0}`);
  console.log(`- Errors: ${counts.Error || 0}`);
  console.log(`Results: ${CANDIDATES_FILE}`);
  console.log(`Manual list: ${MANUAL_FILE}`);
  if (browserError) throw browserError;
}

main().catch(error => {
  console.error(`Apply Agent failed: ${error.message}`);
  process.exitCode = 1;
});
