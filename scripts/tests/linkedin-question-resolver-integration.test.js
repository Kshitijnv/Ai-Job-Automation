const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const questionResolver = require("../lib/llm/question-resolver");
const formMapper = require("../lib/form-mapper");

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return await chromium.launch({ channel: "msedge", headless: true });
  }
}

async function runTests() {
  console.log("Running LinkedIn Question Resolver Integration tests...\n");

  const canonicalAppConfig = {
    experienceYears: 6,
    answers: {
      contact: {
        currentLocation: "Pune",
        preferredLocation: "Pune",
        location: "Pune"
      },
      noticePeriod: {
        days: 90,
        months: 3,
        servingNoticePeriod: false,
        lastWorkingDay: "2026-10-20"
      },
      relocation: {
        willingToRelocate: true,
        locations: [
          "Remote",
          "Pune",
          "Gurugram",
          "Noida",
          "Delhi/NCR"
        ]
      },
      salary: {
        currentCTC: 8,
        expectedCTC: 13,
        currency: "INR"
      },
      skills: {
        ".NET": 3,
        "Angular": 3,
        "Ruby on Rails": 0
      }
    }
  };

  const resume = "# Candidate Resume\nSoftware Engineer with experience in .NET, Angular.";
  const promptTemplate = "PROMPT\nRESUME: {{resume}}\nAPP: {{application_json}}\nQUESTION: {{question}}\nOPTIONS: {{options}}";
  const llmConfig = {
    enabled: true,
    baseUrl: "http://localhost:11434",
    model: "qwen3:4b",
    timeoutMs: 5000,
    temperature: 0
  };

  let qwenCallCount = 0;
  let lastPrompt = "";

  const mockFetch = (responseJson, isError = false) => {
    return async (url, options) => {
      qwenCallCount += 1;
      const body = JSON.parse(options.body);
      lastPrompt = body.messages[0].content;

      if (isError) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Internal Server Error" })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: typeof responseJson === "string" ? responseJson : JSON.stringify(responseJson)
          }
        })
      };
    };
  };

  // ----------------------------------------------------
  // Test A: Deterministic application.json answer (Current CTC = 8)
  // ----------------------------------------------------
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "What is your current CTC?",
      controlType: "numeric",
      options: [],
      applicationConfig: canonicalAppConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: 99 })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "deterministic");
    assert.strictEqual(res.answer, 8);
    assert.strictEqual(qwenCallCount, 0, "Qwen should NOT be called for current CTC");
    console.log("✓ Test A Passed: Deterministic current CTC resolves to 8 without calling Qwen.");
  }

  // ----------------------------------------------------
  // Test B: Deterministic expected CTC (Expected CTC = 13)
  // ----------------------------------------------------
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "What is your expected CTC?",
      controlType: "numeric",
      options: [],
      applicationConfig: canonicalAppConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: 99 })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "deterministic");
    assert.strictEqual(res.answer, 13);
    assert.strictEqual(qwenCallCount, 0, "Qwen should NOT be called for expected CTC");
    console.log("✓ Test B Passed: Deterministic expected CTC resolves to 13 without calling Qwen.");
  }

  // ----------------------------------------------------
  // Test C: Deterministic notice period (Notice period = 90)
  // ----------------------------------------------------
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "What is your notice period in days?",
      controlType: "numeric",
      options: [],
      applicationConfig: canonicalAppConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: 99 })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "deterministic");
    assert.strictEqual(res.answer, 90);
    assert.strictEqual(qwenCallCount, 0, "Qwen should NOT be called for notice period");
    console.log("✓ Test C Passed: Deterministic notice period resolves to 90 without calling Qwen.");
  }

  // ----------------------------------------------------
  // Test D: Relocation priority (Priority: Remote > Pune > Gurugram > Noida > Delhi/NCR)
  // Available: Pune, Delhi, Bengaluru, Remote -> Result: Remote
  // ----------------------------------------------------
  {
    qwenCallCount = 0;
    const availableOptions = ["Pune", "Delhi", "Bengaluru", "Remote"];
    const res = await questionResolver.resolveQuestion({
      question: "Which location are you willing to work from?",
      controlType: "radio",
      options: availableOptions,
      applicationConfig: canonicalAppConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "Bengaluru" })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "deterministic");
    assert.strictEqual(res.answer, "Remote", "First configured preference matching available options must be Remote");
    assert.strictEqual(qwenCallCount, 0, "Qwen should NOT be called for relocation priority");
    console.log("✓ Test D Passed: Relocation priority selects Remote from available options [Pune, Delhi, Bengaluru, Remote].");
  }

  // ----------------------------------------------------
  // Test E: Relocation fallback (Available: Bengaluru, Delhi)
  // Priority: Remote (no), Pune (no), Gurugram (no), Noida (no), Delhi/NCR (matches Delhi) -> Result: Delhi
  // ----------------------------------------------------
  {
    qwenCallCount = 0;
    const availableOptions = ["Bengaluru", "Delhi"];
    const res = await questionResolver.resolveQuestion({
      question: "Which location are you willing to work from?",
      controlType: "radio",
      options: availableOptions,
      applicationConfig: canonicalAppConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "Bengaluru" })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "deterministic");
    assert.strictEqual(res.answer, "Delhi", "Delhi/NCR must match available option Delhi");
    assert.strictEqual(qwenCallCount, 0, "Qwen should NOT be called for relocation fallback");
    console.log("✓ Test E Passed: Relocation fallback matches Delhi/NCR with available option Delhi.");
  }

  // ----------------------------------------------------
  // Test F: Qwen fallback for unknown recruiter question
  // ----------------------------------------------------
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "Do you have experience managing distributed engineering teams?",
      controlType: "radio",
      options: ["Yes", "No"],
      applicationConfig: canonicalAppConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "Yes", confidence: 0.95 })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "llm");
    assert.strictEqual(res.answer, "Yes");
    assert.strictEqual(qwenCallCount, 1, "Qwen MUST be called when application.json cannot determine the answer");
    assert.ok(lastPrompt.includes("Do you have experience managing distributed engineering teams?"));
    assert.ok(lastPrompt.includes("PROMPT"));
    console.log("✓ Test F Passed: Qwen fallback invoked with full context and validated successfully.");
  }

  // ----------------------------------------------------
  // Test G: Invalid Qwen option rejected -> NEEDS_USER_INPUT
  // ----------------------------------------------------
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "What is your primary cloud platform?",
      controlType: "radio",
      options: ["AWS", "Azure", "GCP"],
      applicationConfig: canonicalAppConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "DigitalOcean", confidence: 0.9 })
    });

    assert.strictEqual(res.status, "NEEDS_USER_INPUT", "Invalid Qwen option must return NEEDS_USER_INPUT");
    assert.ok(res.reason.includes("DigitalOcean"));
    console.log("✓ Test G Passed: Invalid Qwen option correctly rejected with NEEDS_USER_INPUT.");
  }

  // ----------------------------------------------------
  // Test H, I, J: Playwright DOM Integration (Text, Radio, Checkbox)
  // ----------------------------------------------------
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    // Test H: Text field DOM population
    await page.setContent(`
      <form id="easy-apply-dialog">
        <label for="current-ctc">What is your current CTC?</label>
        <input type="number" id="current-ctc" name="currentCTC" />
      </form>
    `);

    const dialog = page.locator("#easy-apply-dialog");
    const resolvedH = await formMapper.fillSemanticQuestions(page, {
      applicationConfig: canonicalAppConfig,
      profile: { candidate: { name: "Test Candidate" } }
    }, dialog);

    const textVal = await page.locator("#current-ctc").inputValue();
    assert.strictEqual(textVal, "8", "Text field should be filled with 8");
    console.log("✓ Test H Passed: Validated text/number answer populated directly into LinkedIn input.");

    // Test I: Radio button DOM selection (Relocation priority)
    await page.setContent(`
      <form id="easy-apply-dialog">
        <fieldset>
          <legend>Which location are you willing to work from?</legend>
          <label><input type="radio" name="loc" value="Pune" /> Pune</label>
          <label><input type="radio" name="loc" value="Delhi" /> Delhi</label>
          <label><input type="radio" name="loc" value="Bengaluru" /> Bengaluru</label>
          <label><input type="radio" name="loc" value="Remote" /> Remote</label>
        </fieldset>
      </form>
    `);

    const resolvedI = await formMapper.fillSemanticQuestions(page, {
      applicationConfig: canonicalAppConfig,
      profile: { candidate: { name: "Test Candidate" } }
    }, page.locator("#easy-apply-dialog"));

    const isRemoteChecked = await page.locator("input[value='Remote']").isChecked();
    const isPuneChecked = await page.locator("input[value='Pune']").isChecked();
    assert.strictEqual(isRemoteChecked, true, "Remote radio option must be checked");
    assert.strictEqual(isPuneChecked, false, "Pune radio option must NOT be checked");
    console.log("✓ Test I Passed: Validated radio answer matched against options and correct radio checked in DOM.");

    // Test J: Checkbox DOM selection
    await page.setContent(`
      <form id="easy-apply-dialog">
        <fieldset>
          <legend>Which locations are you willing to work from?</legend>
          <label><input type="checkbox" name="locs" value="Pune" /> Pune</label>
          <label><input type="checkbox" name="locs" value="Bengaluru" /> Bengaluru</label>
          <label><input type="checkbox" name="locs" value="Remote" /> Remote</label>
        </fieldset>
      </form>
    `);

    const resolvedJ = await formMapper.fillSemanticQuestions(page, {
      applicationConfig: canonicalAppConfig,
      profile: { candidate: { name: "Test Candidate" } }
    }, page.locator("#easy-apply-dialog"));

    const puneChecked = await page.locator("input[value='Pune']").isChecked();
    const remoteChecked = await page.locator("input[value='Remote']").isChecked();
    const blrChecked = await page.locator("input[value='Bengaluru']").isChecked();
    assert.strictEqual(puneChecked, true, "Pune checkbox should be checked");
    assert.strictEqual(remoteChecked, true, "Remote checkbox should be checked");
    assert.strictEqual(blrChecked, false, "Bengaluru checkbox should NOT be checked");
    console.log("✓ Test J Passed: Validated multi-select checkboxes matched and selected in DOM.");

    // ----------------------------------------------------
    // Test L: Real LinkedIn role="radio" DOM (Somo Media Structure - Answer: Yes)
    // ----------------------------------------------------
    await page.setContent(`
      <form id="easy-apply-dialog">
        <fieldset role="radiogroup">
          <legend>If you clear the coding round, would you be available for a face-to-face interview at our office in Kirti Nagar, New Delhi?</legend>
          <div role="radio" tabindex="0" aria-checked="false" id="opt-yes">
            <div>
              <input type="radio" name="radio-group-f2f" />
              <label for="f2f-yes"></label>
            </div>
            <div>
              <p>Yes</p>
            </div>
          </div>
          <div role="radio" tabindex="0" aria-checked="false" id="opt-no">
            <div>
              <input type="radio" name="radio-group-f2f" />
              <label for="f2f-no"></label>
            </div>
            <div>
              <p>No</p>
            </div>
          </div>
        </fieldset>
      </form>
      <script>
        document.querySelectorAll('[role="radio"]').forEach(radio => {
          radio.addEventListener('click', () => {
            document.querySelectorAll('[role="radio"]').forEach(r => r.setAttribute('aria-checked', 'false'));
            radio.setAttribute('aria-checked', 'true');
          });
        });
      </script>
    `);

    // With Qwen/mock returning "Yes"
    const savedFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({ answer: "Yes", confidence: 0.95 });
    try {
      const resolvedL = await formMapper.fillSemanticQuestions(page, {
        applicationConfig: canonicalAppConfig,
        profile: { candidate: { name: "Test Candidate" } }
      }, page.locator("#easy-apply-dialog"));

      const optYesChecked = await page.locator("#opt-yes").getAttribute("aria-checked");
      const optNoChecked = await page.locator("#opt-no").getAttribute("aria-checked");
      assert.strictEqual(optYesChecked, "true", "Yes radio wrapper must become aria-checked='true'");
      assert.strictEqual(optNoChecked, "false", "No radio wrapper must remain aria-checked='false'");
      assert.ok(resolvedL.length > 0, "Radio question must be in resolved list");
      console.log("✓ Test L Passed: Real LinkedIn role='radio' wrapper (Yes) correctly identified, answered, clicked, and verified.");
    } finally {
      globalThis.fetch = savedFetch;
    }

    // ----------------------------------------------------
    // Test M: Real LinkedIn role="radio" DOM (Answer: No - verifying 2nd option selection)
    // ----------------------------------------------------
    await page.setContent(`
      <form id="easy-apply-dialog">
        <fieldset role="radiogroup">
          <legend>Do you require visa sponsorship now or in the future?</legend>
          <div role="radio" tabindex="0" aria-checked="false" id="visa-yes">
            <div>
              <input type="radio" name="radio-group-visa" />
              <label for="visa-yes-inp"></label>
            </div>
            <div>
              <p>Yes</p>
            </div>
          </div>
          <div role="radio" tabindex="0" aria-checked="false" id="visa-no">
            <div>
              <input type="radio" name="radio-group-visa" />
              <label for="visa-no-inp"></label>
            </div>
            <div>
              <p>No</p>
            </div>
          </div>
        </fieldset>
      </form>
      <script>
        document.querySelectorAll('[role="radio"]').forEach(radio => {
          radio.addEventListener('click', () => {
            document.querySelectorAll('[role="radio"]').forEach(r => r.setAttribute('aria-checked', 'false'));
            radio.setAttribute('aria-checked', 'true');
          });
        });
      </script>
    `);

    // With Qwen/mock returning "No"
    globalThis.fetch = mockFetch({ answer: "No", confidence: 0.95 });
    try {
      const resolvedM = await formMapper.fillSemanticQuestions(page, {
        applicationConfig: canonicalAppConfig,
        profile: { candidate: { name: "Test Candidate" } }
      }, page.locator("#easy-apply-dialog"));

      const visaYesChecked = await page.locator("#visa-yes").getAttribute("aria-checked");
      const visaNoChecked = await page.locator("#visa-no").getAttribute("aria-checked");
      assert.strictEqual(visaNoChecked, "true", "No radio wrapper must become aria-checked='true'");
      assert.strictEqual(visaYesChecked, "false", "Yes radio wrapper must remain aria-checked='false'");
      assert.ok(resolvedM.length > 0, "Radio question must be in resolved list");
      console.log("✓ Test M Passed: Real LinkedIn role='radio' wrapper (No) selects 2nd option, verifies aria-checked, and does not blindly click 1st option.");
    } finally {
      globalThis.fetch = savedFetch;
    }

  } finally {
    await browser.close();
  }

  // ----------------------------------------------------
  // Test K: n8n cleanup check
  // ----------------------------------------------------
  {
    const rootDir = path.resolve(__dirname, "../..");
    let n8nCount = 0;
    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.git', '.system_generated', 'edge-automation-profile'].includes(entry.name)) continue;
          scanDir(full);
        } else if (entry.isFile()) {
          if (full === __filename) continue;
          if (['.png', '.ico', '.pdf', '.log', '.aux', '.out'].some(ext => entry.name.endsWith(ext))) continue;
          try {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line) => {
              if (/n8n/i.test(line)) n8nCount++;
            });
          } catch {}
        }
      }
    }
    scanDir(rootDir);
    assert.strictEqual(n8nCount, 0, "No n8n references should remain in the codebase");
    console.log("✓ Test K Passed: 0 n8n references remain across the entire repository.");
  }

  console.log("\n==================================================");
  console.log("ALL LINKEDIN QUESTION RESOLVER INTEGRATION TESTS PASSED!");
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
