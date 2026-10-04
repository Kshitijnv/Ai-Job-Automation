const assert = require("assert");
const naukriAgent = require("../naukri/naukri-agent");

async function runTests() {
  console.log("Running Naukri Chatbot Application Completion & Stabilization tests...\n");

  // Test 1: Classify terminal messages including "Thank you for showing interest..."
  {
    const msg1 = "Thank you for showing interest. Kindly answer all the recruiter's questions to successfully apply for the job.";
    assert.strictEqual(naukriAgent.classifyNaukriChatbotMessage(msg1), "TERMINAL");

    const msg2 = "Thank you for your responses.";
    assert.strictEqual(naukriAgent.classifyNaukriChatbotMessage(msg2), "TERMINAL");

    const msg3 = "Your responses have been submitted.";
    assert.strictEqual(naukriAgent.classifyNaukriChatbotMessage(msg3), "TERMINAL");

    const msg4 = "How many years of experience do you have in Angular?";
    assert.strictEqual(naukriAgent.classifyNaukriChatbotMessage(msg4), "QUESTION");

    console.log("✓ Test 1 Passed: Terminal chatbot messages classified accurately.");
  }

  // Test 2: getStabilizationDelayMs prefers configured delay or falls back to 1500 ms
  {
    assert.strictEqual(naukriAgent.getStabilizationDelayMs({}, {}), 1500);
    assert.strictEqual(naukriAgent.getStabilizationDelayMs({}, { pageLoadWaitMs: 1800 }), 1800);
    assert.strictEqual(naukriAgent.getStabilizationDelayMs({ automation: { stabilizationWaitMs: 2200 } }, {}), 2200);
    console.log("✓ Test 2 Passed: getStabilizationDelayMs correctly defaults to 1500 ms and respects config.");
  }

  // Test 3: verifyNaukriApplicationSuccess detects various valid success signals
  {
    // Mock page with saveApply URL
    const pageWithSaveApply = {
      url: () => "https://www.naukri.com/myapply/saveApply?multiApplyResp=%7B%22job-123%22%3A200%7D",
      locator: () => ({ innerText: async () => "", count: async () => 0, isVisible: async () => false, evaluateAll: async () => [] })
    };
    const res1 = await naukriAgent.verifyNaukriApplicationSuccess(pageWithSaveApply, "job-123");
    assert.strictEqual(res1.verified, true);
    assert.strictEqual(res1.signal, "SAVE_APPLY_SUCCESS");

    // Mock page with submission text in body
    const pageWithBodyText = {
      url: () => "https://www.naukri.com/job-listings",
      locator: (sel) => ({
        innerText: async () => sel === "body" ? "Your application has been sent to the recruiter." : "",
        count: async () => 0,
        isVisible: async () => false,
        evaluateAll: async () => []
      })
    };
    const res2 = await naukriAgent.verifyNaukriApplicationSuccess(pageWithBodyText, "job-456");
    assert.strictEqual(res2.verified, true);
    assert.strictEqual(res2.signal, "SUBMISSION_CONFIRMATION");

    // Mock page with terminal bot message
    const pageWithTerminalBotMsg = {
      url: () => "https://www.naukri.com/job-listings",
      locator: (sel) => ({
        innerText: async () => "",
        count: async () => 0,
        isVisible: async () => false,
        evaluateAll: async () => sel === ".botMsg.msg" ? ["Thank you for your responses."] : []
      })
    };
    const res3 = await naukriAgent.verifyNaukriApplicationSuccess(pageWithTerminalBotMsg, "job-789");
    assert.strictEqual(res3.verified, true);
    assert.strictEqual(res3.signal, "TERMINAL_CHATBOT_ACKNOWLEDGEMENT");

    // Mock page with no success signal
    const pageWithNoSignal = {
      url: () => "https://www.naukri.com/job-listings",
      locator: () => ({
        innerText: async () => "Please answer question 1.",
        count: async () => 0,
        isVisible: async () => false,
        evaluateAll: async () => ["Please answer question 1."]
      })
    };
    const res4 = await naukriAgent.verifyNaukriApplicationSuccess(pageWithNoSignal, "job-999");
    assert.strictEqual(res4.verified, false);
    assert.strictEqual(res4.signal, "NONE");

    console.log("✓ Test 3 Passed: verifyNaukriApplicationSuccess correctly identifies valid signals and rejects ambiguous pages.");
  }

  // Test 4: Stabilization sequence and ordering in finalizeJob
  {
    const callOrder = [];
    const createLocator = (sel, isTerminal = true) => ({
      first: () => createLocator(sel, isTerminal),
      nth: () => createLocator(sel, isTerminal),
      count: async () => (sel === ".chatbot_Drawer" && isTerminal) ? 1 : 0,
      isVisible: async () => (sel === ".chatbot_Drawer" && isTerminal),
      locator: (childSel) => createLocator(childSel, isTerminal),
      evaluateAll: async () => {
        if (sel === ".botMsg.msg" && isTerminal) {
          return ["Thank you for showing interest. Kindly answer all the recruiter's questions to successfully apply for the job."];
        }
        return [];
      },
      all: async () => [],
      waitFor: async () => {},
      innerText: async () => isTerminal ? "Thank you for showing interest. Kindly answer all the recruiter's questions to successfully apply for the job." : "Some unfinished question",
      textContent: async () => isTerminal ? "Thank you for showing interest. Kindly answer all the recruiter's questions to successfully apply for the job." : "Some unfinished question",
      evaluate: async () => false,
      click: async () => {},
      fill: async () => {}
    });

    const mockPage = {
      url: () => "https://www.naukri.com/job-listings-test",
      locator: (sel) => createLocator(sel, true),
      exposeFunction: async () => {},
      evaluate: async () => {},
      waitForTimeout: async (ms) => {
        callOrder.push(`wait:${ms}`);
      },
      goto: async (url) => {
        callOrder.push(`goto:${url}`);
      }
    };

    const history = { jobs: {} };
    const job = { jobId: "job-stable-1", title: "Senior Engineer", url: "https://www.naukri.com/job-stable-1" };

    const result = await naukriAgent.finalizeJob(
      mockPage,
      job,
      history,
      "Applies",
      { automation: { stabilizationWaitMs: 1500 } },
      {},
      false,
      false,
      "https://www.naukri.com/job-stable-1",
      { pageLoadWaitMs: 1500 }
    );

    assert.strictEqual(result.status, "APPLIED");
    assert.strictEqual(history.jobs["job-stable-1"].status, "APPLIED");
    assert.ok(history.jobs["job-stable-1"].reason.includes("confirmed after recruiter chatbot terminal acknowledgement"));

    // Verify ordering: stabilization wait happened BEFORE navigation back
    const stabilizationWaitIndex = callOrder.findIndex(item => item === "wait:1500");
    const navigationIndex = callOrder.findIndex(item => item.startsWith("goto:"));
    assert.ok(stabilizationWaitIndex >= 0, "Stabilization wait must occur");
    assert.ok(navigationIndex >= 0, "Navigation must occur");
    assert.ok(stabilizationWaitIndex < navigationIndex, "Stabilization delay must occur BEFORE navigation");

    console.log("✓ Test 4 Passed: APPLIED is recorded after successful signal and stabilization wait, before navigation.");
  }

  // Test 5: If success cannot be confirmed, APPLIED is NOT written merely because timer elapsed
  {
    const createLocator = () => ({
      first: () => createLocator(),
      nth: () => createLocator(),
      count: async () => 0,
      isVisible: async () => false,
      locator: () => createLocator(),
      evaluateAll: async () => [],
      all: async () => [],
      waitFor: async () => {},
      innerText: async () => "Some random error or unfinished form.",
      textContent: async () => "Some random error or unfinished form.",
      evaluate: async () => false,
      click: async () => {},
      fill: async () => {}
    });

    const mockPageNoSuccess = {
      url: () => "https://www.naukri.com/job-listings-unverified",
      locator: () => createLocator(),
      exposeFunction: async () => {},
      evaluate: async () => [],
      waitForTimeout: async () => {},
      goto: async () => {}
    };

    const history = { jobs: {} };
    const job = { jobId: "job-unverified-2", title: "QA Engineer", url: "https://www.naukri.com/job-unverified-2" };

    const result = await naukriAgent.finalizeJob(
      mockPageNoSuccess,
      job,
      history,
      "Applies",
      {},
      {},
      false,
      false,
      "https://www.naukri.com/job-unverified-2"
    );

    assert.notStrictEqual(result.status, "APPLIED");
    assert.notStrictEqual(history.jobs["job-unverified-2"]?.status, "APPLIED");
    console.log("✓ Test 5 Passed: APPLIED is not written when success signal cannot be confirmed.");
  }

  console.log("\nAll Naukri chatbot application completion & stabilization tests passed successfully!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
