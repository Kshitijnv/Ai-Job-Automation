const fs = require("fs");
const path = require("path");
const { launchEdge, loadBrowserConfig } = require("./lib/browser");
const reviewQueue = require("./lib/review-queue");
const { getCredentials } = require("./lib/credentials");
const { isLoginPage, loginWithCredentials } = require("./lib/portal-login");
const navigationEngine = require("./lib/navigation-engine");
const questionMapper = require("./lib/question-mapper");
const portalDetector = require("./portals/detector");
const { hasApplicationForm } = require("./portals/base");
const portalModules = {
  workday: require("./portals/workday"),
  greenhouse: require("./portals/greenhouse"),
  lever: require("./portals/lever")
};
const forms = {
  workday: require("./forms/workday"),
  greenhouse: require("./forms/greenhouse"),
  lever: require("./forms/lever")
};

const ROOT = path.resolve(__dirname, "..");
const CANDIDATES_FILE = path.join(ROOT, "output", "apply_candidates.json");
const JOBS_FILE = path.join(ROOT, "output", "today_jobs_ranked.json");
const PROFILE_FILE = path.join(ROOT, "config", "profile.json");
const APPLICATION_FILE = path.join(ROOT, "config", "application.json");
const REVIEW_FILE = path.join(ROOT, "output", "form_review.json");
const JD_DIRECTORY = path.join(ROOT, "output", "job_descriptions");
const MAX_APPLICATION_STEPS = 10;
const DEFAULT_FORM_READINESS_TIMEOUT_MS = 20000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJobDescription(job) {
  const fileName = job?.jd?.fileName;
  if (!fileName) return "";
  const filePath = path.resolve(JD_DIRECTORY, path.basename(fileName));
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function candidateJobMap(jobs) {
  return new Map((Array.isArray(jobs) ? jobs : []).map(job => [String(job.id), job]));
}

function isEligible(candidate) {
  return ["Apply", "Review"].includes(candidate.action)
    && candidate.status === "ExternalApply"
    && ["workday", "greenhouse", "lever"].includes(String(candidate.portal).toLowerCase())
    && Boolean(candidate.portalUrl);
}

function mergeUnique(target, values, keyFor = value => String(value)) {
  const known = new Set(target.map(keyFor));
  for (const value of values || []) {
    const key = keyFor(value);
    if (!known.has(key)) {
      target.push(value);
      known.add(key);
    }
  }
}

function humanFieldKey(field) {
  const canonical = field.canonicalId || questionMapper.canonicalQuestion(field.label);
  const label = questionMapper.normalize(field.label).replace(/\blocate me\b/g, " ").replace(/\s+/g, " ").trim();
  return canonical || label;
}

async function visibleFormControlCount(page) {
  let count = 0;
  for (const frame of page.frames()) {
    count += await frame.locator("input:not([type=hidden]), textarea, select, [role=textbox]")
      .count().catch(() => 0);
  }
  return count;
}

function redactText(value, secrets = []) {
  let redacted = questionMapper.redactSensitiveText(value);
  for (const secret of secrets) {
    const sensitiveValue = String(secret || "");
    if (sensitiveValue) redacted = redacted.split(sensitiveValue).join("[REDACTED]");
  }
  return redacted;
}

function sanitizeOutput(value, secrets = []) {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map(item => sanitizeOutput(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeOutput(item, secrets)]));
  }
  return value;
}

async function processCandidate(context, candidate, job, profile, applicationConfig, browserConfig, queue, credentialsCache, counters) {
  const result = {
    jobId: String(candidate.jobId),
    company: candidate.company || "",
    title: candidate.title || "",
    portal: String(candidate.portal).toLowerCase(),
    portalUrl: candidate.portalUrl,
    action: candidate.action,
    knownFieldsFilled: [],
    configuredFieldsFilled: [],
    semanticQuestionsResolved: [],
    fieldsDetected: [],
    sensitiveFieldsDetected: [],
    reviewAnswersApplied: [],
    companyAnswersFilled: [],
    resumeUpload: { uploaded: false },
    humanRequiredFields: [],
    loginRequired: false,
    loginAttempted: false,
    loginSuccessful: false,
    finalSubmitReached: false,
    entryActionsPerformed: 0,
    continueActionsPerformed: 0,
    blockedReason: ""
  };

  const page = await context.newPage();
  let activePage = page;
  const formReadinessTimeoutMs = Math.max(1000, Number(applicationConfig.automation?.formReadinessTimeoutMs)
    || DEFAULT_FORM_READINESS_TIMEOUT_MS);
  try {
    await page.goto(candidate.portalUrl, {
      waitUntil: "domcontentloaded",
      timeout: browserConfig.navigationTimeoutMs
    });
    await page.waitForTimeout(browserConfig.pageLoadWaitMs);

    let detectedPortal = await portalDetector.detect(page);
    const form = forms[result.portal];
    const portalModule = portalModules[result.portal];
    if (!portalModule || !form) {
      result.blockedReason = "No portal entry or form module is available for this portal.";
      return result;
    }
    if (detectedPortal && detectedPortal.name !== result.portal) {
      result.blockedReason = "The saved portal URL resolved to a different portal.";
      return result;
    }
    result.pageType = (detectedPortal || portalModule).classify
      ? await (detectedPortal || portalModule).classify(page)
      : "unknown";

    async function loginIfRequired(loginPage) {
      if (result.pageType !== "login" && !await isLoginPage(loginPage)) return true;
      result.loginRequired = true;
      if (result.loginAttempted) {
        result.blockedReason = "Login is still required after the login attempt.";
        return false;
      }
      result.loginAttempted = true;
      counters.loginAttempts++;
      try {
        if (!credentialsCache.has(result.portal)) {
          credentialsCache.set(result.portal, await getCredentials(result.portal));
        }
        const login = await loginWithCredentials(loginPage, {
          portal: portalModule,
          credentials: credentialsCache.get(result.portal),
          jobUrl: candidate.portalUrl,
          browserConfig,
          portalDetector
        });
        if (!login.success) {
          result.blockedReason = login.reason || "Login failed.";
          return false;
        }
        result.loginSuccessful = true;
        result.loginRequired = false;
        counters.successfulLogins++;
        activePage = loginPage;
        detectedPortal = await portalDetector.detect(activePage);
        result.pageType = detectedPortal?.classify ? await detectedPortal.classify(activePage) : "unknown";
        return true;
      } catch (error) {
        result.blockedReason = `Login could not be completed: ${error.message}`;
        return false;
      }
    }

    if (!await loginIfRequired(page)) return result;

    if (!detectedPortal || detectedPortal.name !== result.portal) {
      detectedPortal = await portalDetector.detect(activePage);
    }
    if (!detectedPortal || detectedPortal.name !== result.portal) {
      result.blockedReason = "The saved portal URL did not resolve to its expected supported portal after login.";
      return result;
    }
    counters.jobPagesReached++;

    async function enterApplication(targetPage) {
      const entryResult = await detectedPortal.enterApplication(targetPage, { timeoutMs: formReadinessTimeoutMs });
      activePage = entryResult.page || targetPage;
      if (entryResult.applyClicked) {
        result.entryActionsPerformed++;
        counters.entryActionsPerformed++;
      }
      if (entryResult.formDetected) counters.formsDetected++;
      if (entryResult.finalSubmitReached) {
        result.finalSubmitReached = true;
        result.finalSubmitLabel = entryResult.finalSubmitLabel || "";
        result.blockedReason = "Final submit reached; awaiting human review. No submission action was taken.";
        counters.finalSubmitPagesReached++;
      }
      return entryResult;
    }

    let entry = await enterApplication(activePage);
    if (entry.finalSubmitReached) return result;

    const portalAfterEntry = await portalDetector.detect(activePage);
    const pageTypeAfterEntry = portalAfterEntry?.classify
      ? await portalAfterEntry.classify(activePage)
      : "unknown";
    if (!entry.formDetected && (pageTypeAfterEntry === "login" || await isLoginPage(activePage))) {
      result.pageType = "login";
      if (!await loginIfRequired(activePage)) return result;
      detectedPortal = await portalDetector.detect(activePage);
      if (!detectedPortal || detectedPortal.name !== result.portal) {
        result.blockedReason = "Portal could not be detected after login from the application entry page.";
        return result;
      }
      entry = await enterApplication(activePage);
      if (entry.finalSubmitReached) return result;
    }

    if (!entry.formDetected) {
      result.blockedReason = entry.reason || "Application form failed to load after entering the portal.";
      return result;
    }

    let resumeFailure = "";
    let completedSteps = 0;
    let stoppedAtFinalSubmit = false;
    for (let step = 0; step < MAX_APPLICATION_STEPS; step++) {
      completedSteps++;
      mergeUnique(result.fieldsDetected, await form.collectFieldMetadata(activePage),
        field => `${field.label.toLowerCase()}::${field.type}`);
      mergeUnique(result.sensitiveFieldsDetected, await form.collectSensitiveFields(activePage), field => field.field);
      mergeUnique(result.knownFieldsFilled, await form.fillKnownFields(activePage, profile));
      mergeUnique(result.configuredFieldsFilled, await form.fillConfiguredFields(activePage, applicationConfig));
      mergeUnique(result.semanticQuestionsResolved, await form.fillSemanticQuestions(activePage, {
        applicationConfig,
        profile,
        job,
        credentialEmail: credentialsCache.get(result.portal)?.email || "",
        resumeData: profile.resume || profile.candidate?.resume || {}
      }));
      mergeUnique(result.reviewAnswersApplied, await form.fillReviewAnswers(
        activePage,
        reviewQueue.getAnswersForJob(queue, candidate.jobId, candidate.company)
      ), value => value.key);

      if (!result.resumeUpload.uploaded) {
        const resumePath = candidate.resumePdf ? path.resolve(ROOT, candidate.resumePdf) : "";
        if (!resumePath || !fs.existsSync(resumePath)) {
          resumeFailure = "Tailored resume not available";
        } else {
          try {
            const upload = await form.uploadResume(activePage, resumePath);
            if (upload.uploaded) result.resumeUpload = upload;
            else resumeFailure = upload.reason || "Resume upload control missing.";
          } catch (error) {
            resumeFailure = error.message;
          }
        }
      }

      mergeUnique(result.companyAnswersFilled, await form.fillCompanyAnswers(
        activePage,
        candidate.company,
        readJobDescription(job)
      ));
      mergeUnique(result.humanRequiredFields, await form.collectHumanRequiredFields(activePage, result.semanticQuestionsResolved),
        humanFieldKey);

      const navigation = await navigationEngine.inspectNavigation(activePage);
      if (navigation.stage === "submit") {
        result.finalSubmitReached = true;
        result.finalSubmitLabel = navigation.label;
        result.blockedReason = "Final submit reached; awaiting human review. No submission action was taken.";
        counters.finalSubmitPagesReached++;
        stoppedAtFinalSubmit = true;
        break;
      }
      if (navigation.stage !== "continue") {
        if (!await visibleFormControlCount(activePage)) {
          result.blockedReason ||= "Application form controls were unavailable after rendering.";
        }
        break;
      }

      const continued = await navigationEngine.navigate(activePage, "continue", { timeoutMs: formReadinessTimeoutMs });
      if (continued.finalSubmitReached) {
        result.finalSubmitReached = true;
        result.finalSubmitLabel = continued.label;
        result.blockedReason = "Final submit reached; awaiting human review. No submission action was taken.";
        counters.finalSubmitPagesReached++;
        stoppedAtFinalSubmit = true;
        break;
      }
      if (!continued.clicked) {
        result.blockedReason = `Unable to continue application: ${continued.reason}`;
        break;
      }

      result.continueActionsPerformed++;
      counters.continueActionsPerformed++;
      activePage = continued.page || activePage;
      if (!continued.transitioned && navigation.stage === "continue") {
        const afterClick = await navigationEngine.inspectNavigation(activePage);
        if (afterClick.stage !== "submit") {
          result.blockedReason = "Application did not advance after the continue action.";
          break;
        }
      }
      detectedPortal = await portalDetector.detect(activePage);
      result.pageType = detectedPortal?.classify ? await detectedPortal.classify(activePage) : "unknown";
      if (result.pageType === "login" || await isLoginPage(activePage)) {
        result.pageType = "login";
        if (!await loginIfRequired(activePage)) break;
        detectedPortal = await portalDetector.detect(activePage);
        if (!detectedPortal || detectedPortal.name !== result.portal) {
          result.blockedReason = "Portal could not be detected after login between application steps.";
          break;
        }
        entry = await enterApplication(activePage);
        if (entry.finalSubmitReached) {
          stoppedAtFinalSubmit = true;
          break;
        }
        if (!entry.formDetected) {
          result.blockedReason = entry.reason || "Application form failed to load after login.";
          break;
        }
      } else if (!await hasApplicationForm(activePage) && await visibleFormControlCount(activePage) === 0) {
        result.blockedReason = "Application form failed to load after continuing to the next step.";
        break;
      } else if (await hasApplicationForm(activePage)) {
        counters.formsDetected++;
      }
    }

    if (!stoppedAtFinalSubmit && !result.blockedReason && completedSteps === MAX_APPLICATION_STEPS
        && (await navigationEngine.inspectNavigation(activePage)).stage === "continue") {
      result.blockedReason = `Application stopped after ${MAX_APPLICATION_STEPS} steps to prevent an uncontrolled navigation loop.`;
    }
    if (!result.resumeUpload.uploaded && resumeFailure) {
      result.resumeUpload = { uploaded: false, reason: resumeFailure };
      if (/no resume file input|resume upload control missing|resume pdf does not exist|tailored resume not available|resume\/cv attachment control/i.test(resumeFailure)) {
        result.blockedReason ||= /tailored resume not available/i.test(resumeFailure)
          ? "Tailored resume not available"
          : `Resume required: ${resumeFailure}`;
      }
    }
    if (result.humanRequiredFields.some(field => /portfolio url/i.test(field.label))) {
      result.blockedReason ||= "Portfolio URL required; waiting for human review.";
    }
    if (result.humanRequiredFields.some(field => !/^(input|textarea|select|text|email|tel|number|url|checkbox|radio|file)$/i.test(field.type))) {
      result.blockedReason ||= "Unsupported custom widget requires human review.";
    }
    return result;
  } catch (error) {
    const secrets = [...credentialsCache.values()].map(credential => credential.password);
    result.error = redactText(error.message, secrets);
    result.blockedReason = redactText(`Processing failed: ${error.message}`, secrets);
    return result;
  } finally {
    if (activePage !== page) await activePage.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

async function main() {
  const candidatesOutput = readJson(CANDIDATES_FILE);
  const jobsOutput = readJson(JOBS_FILE);
  const profile = readJson(PROFILE_FILE);
  const applicationConfig = readJson(APPLICATION_FILE);
  const jobsById = candidateJobMap(jobsOutput.jobs);
  const candidates = (candidatesOutput.candidates || []).filter(isEligible);
  const browserConfig = loadBrowserConfig();
  const queue = reviewQueue.loadQueue();
  const results = [];
  const credentialsCache = new Map();
  const counters = {
    loginAttempts: 0,
    successfulLogins: 0,
    jobPagesReached: 0,
    entryActionsPerformed: 0,
    continueActionsPerformed: 0,
    finalSubmitPagesReached: 0,
    formsDetected: 0
  };
  let context;

  try {
    if (candidates.length) context = await launchEdge(browserConfig);
    for (const candidate of candidates) {
      const result = await processCandidate(
        context,
        candidate,
        jobsById.get(String(candidate.jobId)),
        profile,
        applicationConfig,
        browserConfig,
        queue,
        credentialsCache,
        counters
      );
      results.push(result);
      const secrets = [...credentialsCache.values()].map(credential => credential.password);
      console.log(redactText(`${result.portal}: ${result.company || result.jobId} — ${result.knownFieldsFilled.length + result.configuredFieldsFilled.length} fields filled; ${result.humanRequiredFields.length} human-required.`, secrets));
    }
  } finally {
    if (context) await context.close();
  }

  fs.mkdirSync(path.dirname(REVIEW_FILE), { recursive: true });
  const secrets = [...credentialsCache.values()].map(credential => credential.password);
  const safeResults = sanitizeOutput(results, secrets);
  const appliedAnswers = safeResults.flatMap(result => (result.reviewAnswersApplied || []).map(answer => ({
    ...answer,
    jobId: result.jobId,
    application: result
  })));
  reviewQueue.updateFromFormResults(safeResults, appliedAnswers);
  fs.writeFileSync(REVIEW_FILE, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    candidatesProcessed: safeResults.length,
    results: safeResults
  }, null, 2)}\n`, "utf8");

  const uploadCount = results.filter(result => result.resumeUpload.uploaded).length;
  const answerCount = results.reduce((total, result) => total + result.companyAnswersFilled.length, 0);
  const humanCount = results.reduce((total, result) => total + result.humanRequiredFields.length, 0);
  console.log("\nForm Agent Summary");
  console.log(`- Candidates processed: ${results.length}`);
  console.log(`- Job pages reached: ${counters.jobPagesReached}`);
  console.log(`- Entry actions performed: ${counters.entryActionsPerformed}`);
  console.log(`- Continue actions performed: ${counters.continueActionsPerformed}`);
  console.log(`- Final submit pages reached: ${counters.finalSubmitPagesReached}`);
  console.log(`- Forms detected: ${counters.formsDetected}`);
  console.log(`- Fields detected: ${safeResults.reduce((total, result) => total + result.fieldsDetected.length, 0)}`);
  console.log(`- Fields filled: ${results.reduce((total, result) => total + result.knownFieldsFilled.length
    + result.configuredFieldsFilled.length + result.semanticQuestionsResolved.length
    + result.reviewAnswersApplied.length + result.companyAnswersFilled.length, 0)}`);
  console.log(`- Semantic questions resolved: ${safeResults.reduce((total, result) => total + result.semanticQuestionsResolved.length, 0)}`);
  console.log(`- Questions sent to review: ${safeResults.reduce((total, result) => total + result.humanRequiredFields.length, 0)}`);
  console.log(`- Login attempts: ${counters.loginAttempts}`);
  console.log(`- Successful logins: ${counters.successfulLogins}`);
  console.log(`- Resumes uploaded: ${uploadCount}`);
  console.log(`- Company answers generated: ${answerCount}`);
  console.log(`- Human-required questions: ${humanCount}`);
  console.log(`- Blocked applications: ${results.filter(result => result.blockedReason).length}`);
  console.log(`- Review file: ${REVIEW_FILE}`);
}

main().catch(error => {
  console.error(`Form Agent failed: ${questionMapper.redactSensitiveText(error.message)}`);
  process.exitCode = 1;
});
