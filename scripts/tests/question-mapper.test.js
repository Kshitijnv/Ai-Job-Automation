const assert = require("assert");
const questionMapper = require("../lib/question-mapper");

const appConfig = require("../../config/application.json");

const canonicalAnswers = appConfig.answers || {};

assert.strictEqual(canonicalAnswers.experience.totalYears, 3, "Canonical experience totalYears must be 3");
assert.strictEqual(canonicalAnswers.skills.Angular, 3, "Canonical Angular skill value must be 3");
assert.strictEqual(canonicalAnswers.skills.Laravel, 0, "Canonical Laravel skill value must be 0");
assert.strictEqual(canonicalAnswers.noticePeriod.days, 90, "Canonical noticePeriod.days must be 90");
assert.strictEqual(canonicalAnswers.contact.currentLocation, "Pune", "Canonical currentLocation must be Pune");

function expectResolved(question, expected, expectedType = "RESOLVED") {
  const result = questionMapper.resolveSemanticAnswer(question, { applicationConfig: appConfig, profile: {} });
  assert.strictEqual(result.status, expectedType, `Expected ${expectedType} for: ${question} but got ${result.status}`);
  if (expectedType === "RESOLVED") {
    assert.deepStrictEqual(result.answer, expected, `Wrong answer for: ${question}`);
  }
}

function expectNeedsUserInput(question) {
  const result = questionMapper.resolveSemanticAnswer(question, { applicationConfig: appConfig, profile: {} });
  assert.strictEqual(result.status, "NEEDS_USER_INPUT", `Expected NEEDS_USER_INPUT for: ${question} but got ${result.status}`);
}

function resolveWithConfig(question, applicationConfig) {
  return questionMapper.resolveSemanticAnswer(question, { applicationConfig, profile: {} });
}

expectResolved("How many years of experience do you have?", 3);
expectResolved("What is your total work experience?", 3);
expectResolved("How many years of professional experience do you have?", 3);
expectResolved("How many years have you worked with Angular?", 3);
expectResolved("How many years of experience do you have with C#?", 3);
expectResolved("How many years of experience do you have with .NET?", 3);
expectResolved("How many years of experience do you have with .NET Core?", 3);
expectResolved("How many years of experience do you have with React?", 0);
expectResolved("How many years of experience do you have with Laravel?", 0);
expectResolved("How many years of experience do you have with Kubernetes?", 0);
expectResolved("How many years of experience do you have with Web Service?", 0);
expectResolved("How many years of experience do you have with Django?", 0);
expectResolved("How many years of experience do you have with Ruby on Rails?", 0);
expectResolved("How many years of experience do you have in C#/.NET development?", 3);
expectResolved("How many years of experience do you have in GenAI / LLM / RAG?", 3);
expectResolved("How many years of experience do you have in Python Development?", 0);
expectResolved("How many years of experience do you have in FastAPI?", 0);
expectResolved("How much experience do you have in Redis?", 0);

for (const skill of ["Go", "React", "React.js", "Laravel", "WordPress", "Azure", "AWS", "GCP", "Docker", "Kubernetes", "Machine Learning", "MLOps"]) {
  expectResolved(`How many years of experience do you have with ${skill}?`, 0);
}

expectResolved("How many years of experience do you have in AWS/Azure/GCP?", 0);
expectResolved("Do you have experience with .NET and C#?", true);
expectResolved("Do you have experience with React and .NET?", false);
expectResolved("Do you have experience with React or .NET?", true);
expectResolved("Do you have experience with React or Laravel?", false);
expectResolved("Do you have experience with React?", false);
expectResolved("Have you worked with Laravel?", false);
expectResolved("Do you have production experience with Kubernetes?", false);
expectResolved("What is your notice period in days?", 90);
expectResolved("What is your notice period in months?", 3);
expectResolved("What is your current location?", "Pune");
expectResolved("Where are you currently located?", "Pune");
expectResolved("Are you currently based in Pune?", true);
expectResolved("Are you currently based in Mumbai?", false);
expectResolved("Are you willing to relocate?", true);
expectResolved("Are you willing to relocate to Noida?", true);
expectResolved("Are you willing to relocate to Indore?", false);
expectResolved("Are you comfortable with night shifts?", true);
expectResolved("Are you okay with night shift?", true);
expectResolved("Do you have any Azure certifications?", false);
expectResolved("Are you Azure certified?", false);
expectResolved("Can you join immediately?", false);

const frontendSkillsResult = questionMapper.resolveSemanticAnswer("In front end you have experience in which skills?", { applicationConfig: appConfig });
assert.strictEqual(frontendSkillsResult.status, "RESOLVED");
assert.ok(Array.isArray(frontendSkillsResult.answer));
assert.ok(frontendSkillsResult.answer.includes("Angular"));
assert.ok(frontendSkillsResult.answer.includes("TypeScript"));

expectNeedsUserInput("How many years of experience in CI/CD and Kubernetes?");
expectNeedsUserInput("How many years of experience in open source technologies (mention tech stack)");
expectNeedsUserInput("Describe your experience with Angular.");
expectNeedsUserInput("Preferred Employment type");
expectNeedsUserInput("Are you interested in Contract to Hire (C2H) basis?");
expectNeedsUserInput("Are you comfortable working on a 6-month contractual assignment?");
expectNeedsUserInput("What is your passport number?");
expectResolved("How many years of experience do you have in Machine Learning?", 0);

for (const question of [
  "Are you currently serving notice?",
  "Are you serving your notice period?",
  "Are you currently serving your notice period?"
]) {
  const result = resolveWithConfig(question, appConfig);
  assert.strictEqual(result.status, "RESOLVED", `Expected serving notice resolution for: ${question}`);
  assert.strictEqual(result.answer, true, `Expected true for: ${question}`);
  assert.strictEqual(result.displayValue, "Yes", `Expected Yes display value for: ${question}`);
  assert.strictEqual(result.answerSource, "answers.noticePeriod.servingNoticePeriod");
}

expectResolved("What is your last working day?", "20 October 2026");
expectResolved("What is your LWD?", "20 October 2026");
expectResolved("When is your last working day?", "20 October 2026");
expectResolved("Please mention your LWD", "20 October 2026");

const compoundNoticeResult = resolveWithConfig(
  "Notice period (please mention LWD if serving/ served)",
  appConfig
);
assert.strictEqual(compoundNoticeResult.status, "RESOLVED");
assert.strictEqual(compoundNoticeResult.intent, "notice_period_with_lwd");
assert.deepStrictEqual(compoundNoticeResult.answerSources, [
  "answers.noticePeriod.days",
  "answers.noticePeriod.lastWorkingDay"
]);
assert.deepStrictEqual(compoundNoticeResult.values, {
  noticePeriodDays: 90,
  lastWorkingDay: "20 October 2026"
});
assert.strictEqual(compoundNoticeResult.questionType, "compound");

const notServingConfig = JSON.parse(JSON.stringify(appConfig));
notServingConfig.answers.noticePeriod.servingNoticePeriod = false;
assert.strictEqual(resolveWithConfig("What is your last working day?", notServingConfig).status, "NEEDS_USER_INPUT");
assert.strictEqual(resolveWithConfig("Notice period (please mention LWD if serving/ served)", notServingConfig).status, "NEEDS_USER_INPUT");

const missingLwdConfig = JSON.parse(JSON.stringify(appConfig));
delete missingLwdConfig.answers.noticePeriod.lastWorkingDay;
assert.strictEqual(resolveWithConfig("What is your LWD?", missingLwdConfig).status, "NEEDS_USER_INPUT");
assert.strictEqual(resolveWithConfig("Notice period (please mention LWD if serving/ served)", missingLwdConfig).status, "NEEDS_USER_INPUT");

const naukriAgent = require("../naukri/naukri-agent");
(async () => {
  const terminalMessage = "Thank you for your responses.";
  assert.strictEqual(naukriAgent.classifyNaukriChatbotMessage(terminalMessage), "TERMINAL");
  assert.strictEqual(naukriAgent.classifyNaukriChatbotMessage("  THANK   YOU FOR YOUR RESPONSES.  "), "TERMINAL");

  let answerResolverCalls = 0;
  const resolverSpy = async message => {
    answerResolverCalls += 1;
    return `resolved: ${message}`;
  };
  const terminalDispatch = await naukriAgent.resolveNaukriChatbotMessage(terminalMessage, resolverSpy);
  assert.deepStrictEqual(terminalDispatch, { disposition: "TERMINAL" });
  assert.strictEqual(answerResolverCalls, 0, "Terminal acknowledgements must not enter answer resolution");
  assert.strictEqual(naukriAgent.isSuccessfulChatbotCompletion({ status: "TERMINAL_ACKNOWLEDGED", answeredCount: 6 }), true);
  assert.strictEqual(naukriAgent.isSuccessfulChatbotCompletion({ status: "TERMINAL_ACKNOWLEDGED", answeredCount: 0 }), false);
  assert.strictEqual(naukriAgent.isSuccessfulChatbotCompletion({ status: "TERMINAL_ACKNOWLEDGED", answeredCount: 0, terminalAcknowledgement: true }), true);
  assert.strictEqual(naukriAgent.isSuccessfulChatbotCompletion({ status: "COMPLETED", answeredCount: 6 }), false);

  const navigatedTerminalPage = {
    locator(selector) {
      if (selector === ".chatbot_Drawer") {
        return { first() { return this; }, async count() { return 0; }, async isVisible() { return false; } };
      }
      if (selector === ".botMsg.msg") return { async evaluateAll() { return []; } };
      return { async innerText() { return "Thank you for your responses."; } };
    }
  };
  const afterNavigation = await naukriAgent.handleNaukriRecruiterChatbot(navigatedTerminalPage, {}, appConfig, {});
  assert.strictEqual(afterNavigation.status, "TERMINAL_ACKNOWLEDGED");
  assert.strictEqual(afterNavigation.terminalAcknowledgement, true);
  assert.strictEqual(answerResolverCalls, 0, "A terminal page acknowledgement must not enter answer resolution");

  const originalJobUrl = "https://www.naukri.com/job-listings/example-123";
  assert.strictEqual(naukriAgent.captureOriginalJobUrl({ url: originalJobUrl }, { url: () => "https://www.naukri.com/faq/job-seeker" }), originalJobUrl);
  assert.strictEqual(naukriAgent.captureOriginalJobUrl({}, { url: () => originalJobUrl }), originalJobUrl);

  const restoreTarget = "https://www.naukri.com/job-listings/example-123";
  let currentUrl = "https://www.naukri.com/faq/job-seeker";
  const restorePage = {
    async goto(url) { currentUrl = url; },
    locator() { return { async waitFor() {} }; },
    async waitForTimeout() {},
    url() { return currentUrl; }
  };
  assert.deepStrictEqual(await naukriAgent.navigateBackToOriginalJobUrl(restorePage, restoreTarget), { restored: true });
  assert.strictEqual(currentUrl, restoreTarget);
  const failedRestore = await naukriAgent.navigateBackToOriginalJobUrl({
    async goto() { throw new Error("network unavailable"); }
  }, restoreTarget);
  assert.strictEqual(failedRestore.restored, false);
  assert.match(failedRestore.reason, /network unavailable/);
  assert.strictEqual(naukriAgent.isSuccessfulChatbotCompletion({ status: "TERMINAL_ACKNOWLEDGED", answeredCount: 6 }), true);

  for (const question of [
    "How many years of experience do you have?",
    "Notice period (please mention LWD if serving/ served)"
  ]) {
    assert.strictEqual(naukriAgent.classifyNaukriChatbotMessage(question), "QUESTION");
    const questionDispatch = await naukriAgent.resolveNaukriChatbotMessage(question, resolverSpy);
    assert.strictEqual(questionDispatch.disposition, "QUESTION");
    assert.strictEqual(questionDispatch.answer, `resolved: ${question}`);
  }
  assert.strictEqual(answerResolverCalls, 2, "Recognized recruiter questions must enter answer resolution");

  const answers = await Promise.all([
  naukriAgent.resolveNaukriAnswer("Notice period (please mention LWD if serving/ served)", appConfig, {}),
  naukriAgent.resolveNaukriAnswer("What is your notice period in days?", appConfig, {}),
  naukriAgent.resolveNaukriAnswer("What is your notice period in months?", appConfig, {}),
  naukriAgent.resolveNaukriAnswer("Are you currently serving notice?", appConfig, {}),
  naukriAgent.resolveNaukriAnswer("What is your last working day?", appConfig, {}),
  naukriAgent.resolveNaukriAnswer("What is your LWD?", appConfig, {})
  ]);
  assert.deepStrictEqual(answers, [
    "90 days, LWD: 20 October 2026",
    90,
    3,
    "Yes",
    "20 October 2026",
    "20 October 2026"
  ]);
  console.log("Shared resolver tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
