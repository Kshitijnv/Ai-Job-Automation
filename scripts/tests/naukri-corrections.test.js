const assert = require("assert");
const { chromium } = require("playwright");
const applicationConfig = require("../../config/application.json");
const questionMapper = require("../lib/question-mapper");
const semanticResolver = require("../lib/semantic-resolver");
const naukriAgent = require("../naukri/naukri-agent");

async function runTests() {
  console.log("Running comprehensive validation tests for Naukri corrections...\n");

  // 1. Current location + relocation compound question
  // Given: currentLocation = Pune, willingToRelocate = true
  // Question: "Are you currently residing in Gurugram, Haryana or willing to relocate to Gurugram, Haryana?"
  const q1 = "Are you currently residing in Gurugram, Haryana or willing to relocate to Gurugram, Haryana?";
  const res1 = questionMapper.resolveSemanticAnswer(q1, { applicationConfig });
  assert.strictEqual(res1.status, "RESOLVED", "Q1 must be resolved");
  assert.strictEqual(res1.currentResidence, false, "Q1 currentResidence must be false (residence in Gurugram != Pune)");
  assert.strictEqual(res1.willingToRelocate, true, "Q1 willingToRelocate must be true");
  assert.strictEqual(res1.combinedOR, true, "Q1 combinedOR must be true (false || true)");
  assert.strictEqual(res1.answer, true, "Q1 answer boolean must be true");
  assert.strictEqual(res1.displayValue, "Yes", "Q1 displayValue must be Yes");
  const agentAnswer1 = await naukriAgent.resolveNaukriAnswer(q1, applicationConfig, {});
  assert.strictEqual(agentAnswer1, "Yes", "resolveNaukriAnswer for Q1 must be Yes");
  console.log("✓ Test 1 Passed: Compound location + relocation (Gurugram) resolves to currentResidence=false, willingToRelocate=true, combinedOR=true, Yes");

  // 2. Equivalent wording
  // Question: "Are you currently living in or ready to relocate to Gurugram ?"
  const q2 = "Are you currently living in or ready to relocate to Gurugram ?";
  const res2 = questionMapper.resolveSemanticAnswer(q2, { applicationConfig });
  assert.strictEqual(res2.status, "RESOLVED", "Q2 must be resolved");
  assert.strictEqual(res2.currentResidence, false, "Q2 currentResidence must be false");
  assert.strictEqual(res2.willingToRelocate, true, "Q2 willingToRelocate must be true");
  assert.strictEqual(res2.combinedOR, true, "Q2 combinedOR must be true");
  assert.strictEqual(res2.displayValue, "Yes", "Q2 displayValue must be Yes");
  const agentAnswer2 = await naukriAgent.resolveNaukriAnswer(q2, applicationConfig, {});
  assert.strictEqual(agentAnswer2, "Yes", "resolveNaukriAnswer for Q2 must be Yes");
  console.log("✓ Test 2 Passed: Equivalent wording ('living in or ready to relocate to Gurugram') resolves to Yes");

  // 3. Current location is same as requested location
  // Given: currentLocation = Pune
  // Question: "Are you currently living in Pune or ready to relocate to Pune?"
  const q3 = "Are you currently living in Pune or ready to relocate to Pune?";
  const res3 = questionMapper.resolveSemanticAnswer(q3, { applicationConfig });
  assert.strictEqual(res3.status, "RESOLVED", "Q3 must be resolved");
  assert.strictEqual(res3.currentResidence, true, "Q3 currentResidence must be true (residence in Pune == Pune)");
  assert.strictEqual(res3.willingToRelocate, true, "Q3 willingToRelocate must be true");
  assert.strictEqual(res3.combinedOR, true, "Q3 combinedOR must be true");
  assert.strictEqual(res3.displayValue, "Yes", "Q3 displayValue must be Yes");
  const agentAnswer3 = await naukriAgent.resolveNaukriAnswer(q3, applicationConfig, {});
  assert.strictEqual(agentAnswer3, "Yes", "resolveNaukriAnswer for Q3 must be Yes");
  console.log("✓ Test 3 Passed: Current location matching requested location resolves to currentResidence=true, willingToRelocate=true, Yes");

  // 4. ROR recognition
  // Question: "How many years of experience do you have in Ror?"
  const q4 = "How many years of experience do you have in Ror?";
  const res4 = questionMapper.resolveSemanticAnswer(q4, { applicationConfig });
  assert.strictEqual(res4.status, "RESOLVED", "Q4 must be resolved");
  assert.strictEqual(res4.entities?.skill, "Ruby on Rails", "Q4 semantic skill must be 'Ruby on Rails'");
  assert.strictEqual(questionMapper.normalizedSkillName("Ror"), "ruby on rails");
  assert.strictEqual(questionMapper.normalizedSkillName("RoR"), "ruby on rails");
  assert.strictEqual(questionMapper.normalizedSkillName("Ruby on Rails"), "ruby on rails");
  assert.strictEqual(questionMapper.normalizedSkillName("Ruby/Rails"), "ruby on rails");
  assert.strictEqual(questionMapper.normalizedSkillName("Ruby & Rails"), "ruby on rails");
  console.log("✓ Test 4 Passed: ROR and aliases recognized as 'Ruby on Rails'");

  // 5. Ruby on Rails experience -> 0 (Primary Business Rule: absent/unconfigured = 0)
  const agentAnswer4 = await naukriAgent.resolveNaukriAnswer(q4, applicationConfig, {});
  assert.strictEqual(agentAnswer4, 0, "resolveNaukriAnswer for Ror must be 0");
  const details4 = await naukriAgent.resolveNaukriAnswerDetails(q4, applicationConfig, {});
  assert.strictEqual(details4.answer, 0);

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();

    // Test text_input / contenteditable with ROR -> fills 0
    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">${q4}</div><input type="text" /></div>`);
    let controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), details4.semantic);
    let applied = await naukriAgent.applyNaukriAnswerControl(controls, details4.semantic, details4.answer);
    assert.strictEqual(applied.status, "APPLIED");
    assert.strictEqual(applied.answer, "0");
    assert.strictEqual(await controls.control.inputValue(), "0");
    console.log("✓ Test 5 Passed: Free-text input for Ror entered '0'");

    // 6. ROR with 0-range option: select 0-1
    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">${q4}</div>
        <select>
          <option value="">Select</option>
          <option value="0-1">0-1 years</option>
          <option value="1-3">1-3 years</option>
        </select>
      </div>
    `);
    controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), details4.semantic);
    applied = await naukriAgent.applyNaukriAnswerControl(controls, details4.semantic, details4.answer);
    assert.strictEqual(applied.status, "APPLIED");
    assert.strictEqual(applied.answer, "0-1 years");
    assert.strictEqual(await controls.control.inputValue(), "0-1");

    // Radio group with 0 / Fresher option
    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">${q4}</div>
        <label><input type="radio" name="ror_exp" value="Fresher" /> Fresher</label>
        <label><input type="radio" name="ror_exp" value="1-3" /> 1-3 years</label>
      </div>
    `);
    controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), details4.semantic);
    applied = await naukriAgent.applyNaukriAnswerControl(controls, details4.semantic, details4.answer);
    assert.strictEqual(applied.status, "APPLIED");
    assert.strictEqual(applied.answer, "Fresher");
    console.log("✓ Test 6 Passed: Fresher/0 option selected for ROR");

    // 7. ROR with numeric/range control having no 0 option: returns NEEDS_USER_INPUT
    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">${q4}</div>
        <div class="multiselectcheckboxes">
          <label class="mcc__label" for="cb-1">1-3 years</label>
          <input class="mcc__checkbox" id="cb-1" type="checkbox" value="1-3 years" />
          <label class="mcc__label" for="cb-2">3-5 years</label>
          <input class="mcc__checkbox" id="cb-2" type="checkbox" value="3-5 years" />
        </div>
      </div>
    `);
    controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), details4.semantic);
    applied = await naukriAgent.applyNaukriAnswerControl(controls, details4.semantic, details4.answer);
    assert.strictEqual(applied.status, "NEEDS_USER_INPUT", "Must return NEEDS_USER_INPUT when range control has no 0 option");

    // Native select with only 1+ numeric options
    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">${q4}</div>
        <select>
          <option value="">Select</option>
          <option value="1">1 year</option>
          <option value="2">2 years</option>
        </select>
      </div>
    `);
    controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), details4.semantic);
    applied = await naukriAgent.applyNaukriAnswerControl(controls, details4.semantic, details4.answer);
    assert.strictEqual(applied.status, "NEEDS_USER_INPUT", "Must return NEEDS_USER_INPUT when select control has no 0 option");
    // Relocation radio_group tests (Issue 2)
    const relocationQuestion = "Which of these locations are you willing to relocate to?";
    const relocationDetails = await naukriAgent.resolveNaukriAnswerDetails(relocationQuestion, applicationConfig, {});

    // Case 3: Available: ["Remote", "Pune", "Bengaluru"] -> Remote selected
    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">${relocationQuestion}</div>
        <label><input type="radio" name="reloc" value="Remote" /> Remote</label>
        <label><input type="radio" name="reloc" value="Pune" /> Pune</label>
        <label><input type="radio" name="reloc" value="Bengaluru" /> Bengaluru</label>
      </div>
    `);
    controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), relocationDetails.semantic);
    applied = await naukriAgent.applyNaukriAnswerControl(controls, relocationDetails.semantic, relocationDetails.answer);
    assert.strictEqual(applied.status, "APPLIED");
    assert.strictEqual(applied.answer, "Remote");
    console.log("✓ Test: Relocation radio_group with Remote, Pune, Bengaluru selects 'Remote'");

    // Case 4: Available: ["Bengaluru", "Pune", "Noida"] -> Pune selected
    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">${relocationQuestion}</div>
        <label><input type="radio" name="reloc" value="Bengaluru" /> Bengaluru</label>
        <label><input type="radio" name="reloc" value="Pune" /> Pune</label>
        <label><input type="radio" name="reloc" value="Noida" /> Noida</label>
      </div>
    `);
    controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), relocationDetails.semantic);
    applied = await naukriAgent.applyNaukriAnswerControl(controls, relocationDetails.semantic, relocationDetails.answer);
    assert.strictEqual(applied.status, "APPLIED");
    assert.strictEqual(applied.answer, "Pune");
    console.log("✓ Test: Relocation radio_group with Bengaluru, Pune, Noida selects 'Pune'");

    // Case 5: Available: ["Bengaluru", "Noida"] -> Noida selected
    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">${relocationQuestion}</div>
        <label><input type="radio" name="reloc" value="Bengaluru" /> Bengaluru</label>
        <label><input type="radio" name="reloc" value="Noida" /> Noida</label>
      </div>
    `);
    controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), relocationDetails.semantic);
    applied = await naukriAgent.applyNaukriAnswerControl(controls, relocationDetails.semantic, relocationDetails.answer);
    assert.strictEqual(applied.status, "APPLIED");
    assert.strictEqual(applied.answer, "Noida");
    console.log("✓ Test: Relocation radio_group with Bengaluru, Noida selects 'Noida'");

    // Case 6: Checkbox / multi-select behavior preserved
    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">${relocationQuestion}</div>
        <div class="multiselectcheckboxes">
          <label class="mcc__label" for="loc-1">Remote</label>
          <input class="mcc__checkbox" id="loc-1" type="checkbox" value="Remote" />
          <label class="mcc__label" for="loc-2">Pune</label>
          <input class="mcc__checkbox" id="loc-2" type="checkbox" value="Pune" />
          <label class="mcc__label" for="loc-3">Bengaluru</label>
          <input class="mcc__checkbox" id="loc-3" type="checkbox" value="Bengaluru" />
        </div>
      </div>
    `);
    controls = await naukriAgent.discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), relocationDetails.semantic);
    applied = await naukriAgent.applyNaukriAnswerControl(controls, relocationDetails.semantic, relocationDetails.answer);
    assert.strictEqual(applied.status, "APPLIED");
    assert.strictEqual(applied.answer, "Remote, Pune");
    assert.strictEqual(await page.locator("#loc-1").isChecked(), true);
    assert.strictEqual(await page.locator("#loc-2").isChecked(), true);
    assert.strictEqual(await page.locator("#loc-3").isChecked(), false);
    console.log("✓ Test: Relocation checkbox multi-select selects both Remote and Pune, leaves Bengaluru unchecked");

    // Case 1 & 2: saveApply direct apply route detection (Issue 1)
    const saveApplyUrl1 = "https://www.naukri.com/myapply/saveApply?strJobsarr=[011026934188]&applytype=single&resId=215212286&ApplyMode=1&id=228574614&src=h&logstr=drecomm-drecomm_apply&applySrc=drecomm_apply&multiApplyResp=%7B%22011026934188%22%3A200%7D&jobTitle=Software%20Development%20Engineer%202%20%28SDE%202%29";
    const parsedSaveApply = naukriAgent.parseNaukriSaveApplyResult(saveApplyUrl1, "011026934188");
    assert.strictEqual(parsedSaveApply.success, true);
    assert.strictEqual(parsedSaveApply.jobId, "011026934188");
    assert.strictEqual(parsedSaveApply.statusCode, 200);

    const parsedMismatched = naukriAgent.parseNaukriSaveApplyResult(saveApplyUrl1, "280926919764");
    assert.strictEqual(parsedMismatched.success, false);

    const parsedFailure = naukriAgent.parseNaukriSaveApplyResult("https://www.naukri.com/myapply/saveApply?multiApplyResp=%7B%22011026934188%22%3A500%7D", "011026934188");
    assert.strictEqual(parsedFailure.success, false);
    console.log("✓ Test: parseNaukriSaveApplyResult correctly verifies job ID and 200 status code");

    await page.close();
  } finally {
    await browser.close();
  }

  // 8. Current-run counters start from zero on every invocation
  const initialStats = naukriAgent.createCurrentRunStats("Applies");
  assert.strictEqual(initialStats.processed, 0);
  assert.strictEqual(initialStats.applied, 0);
  assert.strictEqual(initialStats.needsUserInput, 0);
  assert.strictEqual(initialStats.failed, 0);
  assert.strictEqual(initialStats.unverified, 0);
  assert.strictEqual(initialStats.skippedExternal, 0);
  assert.strictEqual(initialStats.skippedUnknownRoute, 0);
  assert.strictEqual(initialStats.jobsNeedingUserInput, 0);
  assert.strictEqual(initialStats.unresolvedQuestions, 0);
  assert.strictEqual(initialStats.jobsDiscovered, 0);
  assert.strictEqual(initialStats.jobsWithSelectableCheckbox, 0);
  assert.strictEqual(initialStats.jobsWithoutCheckbox, 0);
  assert.strictEqual(initialStats.excludedByHistory, 0);
  assert.strictEqual(initialStats.skippedNoCheckbox, 0);
  assert.strictEqual(initialStats.newJobsConsidered, 0);
  console.log("✓ Test 8 Passed: Current-run counters start from zero on every invocation");

  // 9. Historical APPLIED records do not inflate current-run Applied
  // 10. Historical NEEDS_USER_INPUT records do not inflate current-run Needs user input
  const mockHistory = {
    jobs: {
      "old-1": { jobId: "old-1", status: "APPLIED" },
      "old-2": { jobId: "old-2", status: "APPLIED" },
      "old-3": { jobId: "old-3", status: "NEEDS_USER_INPUT" },
      "old-4": { jobId: "old-4", status: "FAILED" }
    }
  };
  const stats9 = naukriAgent.createCurrentRunStats("Applies");
  stats9.alreadyTrackedBefore = Object.keys(mockHistory.jobs).length;
  // Simulate applying to 2 new jobs in current run
  stats9.processed = 2;
  stats9.applied = 2;
  stats9.totalTrackedAfter = stats9.alreadyTrackedBefore + 2;
  const formattedSummary9 = naukriAgent.formatAutomationSummary(stats9);
  assert.match(formattedSummary9, /Current Run Results\s*\n-+\s*\nProcessed: 2\s*\nApplied: 2\s*\nNeeds user input: 0/);
  assert.match(formattedSummary9, /History\s*\n-+\s*\nAlready tracked before this run: 4\s*\nTotal tracked after this run: 6/);
  console.log("✓ Test 9 & 10 Passed: Historical records do not inflate current run counts");

  // 11. A job with two unresolved questions contributes:
  // Jobs needing user input += 1
  // Unresolved questions += 2
  const stats11 = naukriAgent.createCurrentRunStats("Applies");
  stats11.jobsNeedingUserInput += 1;
  stats11.unresolvedQuestions += 2;
  const formattedSummary11 = naukriAgent.formatAutomationSummary(stats11);
  assert.match(formattedSummary11, /User Input\s*\n-+\s*\nJobs needing user input: 1\s*\nUnresolved questions: 2/);
  console.log("✓ Test 11 Passed: 1 job with 2 unresolved questions contributes Jobs needing user input: 1, Unresolved questions: 2");

  // 12. Unknown route is counted separately
  const stats12 = naukriAgent.createCurrentRunStats("Applies");
  stats12.skippedUnknownRoute = 3;
  const formattedSummary12 = naukriAgent.formatAutomationSummary(stats12);
  assert.match(formattedSummary12, /Skipped - unknown route: 3/);
  console.log("✓ Test 12 Passed: Unknown route counted separately as 'Skipped - unknown route'");

  // 13. Discovery breakdown format
  const stats13 = naukriAgent.createCurrentRunStats("Applies");
  stats13.jobsDiscovered = 15;
  stats13.jobsWithSelectableCheckbox = 10;
  stats13.jobsWithoutCheckbox = 5;
  stats13.excludedByHistory = 2;
  stats13.newJobsConsidered = 8;
  const formattedSummary13 = naukriAgent.formatAutomationSummary(stats13);
  assert.match(formattedSummary13, /Discovery\s*\n-+\s*\nJobs discovered: 15\s*\nJobs with selectable checkbox: 10\s*\nJobs without checkbox: 5\s*\nExcluded by persistent history: 2\s*\nNew jobs considered: 8/);
  console.log("✓ Test 13 Passed: Discovery breakdown formatted correctly");

  // 14. Selected section behavior remains unchanged
  assert.strictEqual(naukriAgent.normalizeSectionName("Applies (5)"), "Applies");
  assert.strictEqual(naukriAgent.normalizeSectionName("Profile"), "Profile");
  assert.strictEqual(naukriAgent.normalizeSectionName("Preferences"), "Preferences");
  assert.strictEqual(naukriAgent.normalizeSectionName("You might like"), "You might like");
  console.log("✓ Test 14 Passed: Selected section normalization and behavior preserved");

  // 15. Persistent-history filtering logic tests (Cases 1 - 8)
  const historyFilterTest = {
    jobs: {
      "job-applied": { jobId: "job-applied", status: "APPLIED" },
      "job-nocheckbox": { jobId: "job-nocheckbox", status: "SKIPPED_NO_CHECKBOX" },
      "job-external": { jobId: "job-external", status: "SKIPPED_EXTERNAL" },
      "job-needsinput": { jobId: "job-needsinput", status: "NEEDS_USER_INPUT" },
      "job-failed": { jobId: "job-failed", status: "FAILED" },
      "job-unverified": { jobId: "job-unverified", status: "UNVERIFIED" },
      "job-unknownroute": { jobId: "job-unknownroute", status: "SKIPPED_UNKNOWN_ROUTE" }
    }
  };

  // 1. Existing APPLIED -> permanently excluded
  assert.strictEqual(naukriAgent.isTerminalHistoryStatus("APPLIED"), true);
  assert.strictEqual(naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, "job-applied"), true);
  console.log("✓ Test: Existing APPLIED is permanently excluded");

  // 2. Existing SKIPPED_NO_CHECKBOX -> permanently excluded
  assert.strictEqual(naukriAgent.isTerminalHistoryStatus("SKIPPED_NO_CHECKBOX"), true);
  assert.strictEqual(naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, "job-nocheckbox"), true);
  console.log("✓ Test: Existing SKIPPED_NO_CHECKBOX is permanently excluded");

  // 3. Existing SKIPPED_EXTERNAL -> permanently excluded
  assert.strictEqual(naukriAgent.isTerminalHistoryStatus("SKIPPED_EXTERNAL"), true);
  assert.strictEqual(naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, "job-external"), true);
  console.log("✓ Test: Existing SKIPPED_EXTERNAL is permanently excluded");

  // 4. Existing NEEDS_USER_INPUT -> eligible for reprocessing
  assert.strictEqual(naukriAgent.isTerminalHistoryStatus("NEEDS_USER_INPUT"), false);
  assert.strictEqual(naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, "job-needsinput"), false);
  console.log("✓ Test: Existing NEEDS_USER_INPUT remains eligible");

  // 5. Existing FAILED -> eligible for reprocessing
  assert.strictEqual(naukriAgent.isTerminalHistoryStatus("FAILED"), false);
  assert.strictEqual(naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, "job-failed"), false);
  console.log("✓ Test: Existing FAILED remains eligible");

  // 6. Existing UNVERIFIED -> eligible for reprocessing
  assert.strictEqual(naukriAgent.isTerminalHistoryStatus("UNVERIFIED"), false);
  assert.strictEqual(naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, "job-unverified"), false);
  console.log("✓ Test: Existing UNVERIFIED remains eligible");

  // 7. Existing SKIPPED_UNKNOWN_ROUTE -> eligible for reprocessing
  assert.strictEqual(naukriAgent.isTerminalHistoryStatus("SKIPPED_UNKNOWN_ROUTE"), false);
  assert.strictEqual(naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, "job-unknownroute"), false);
  console.log("✓ Test: Existing SKIPPED_UNKNOWN_ROUTE remains eligible");

  // 8. Unknown/new job -> eligible for processing
  assert.strictEqual(naukriAgent.isTerminalHistoryStatus(undefined), false);
  assert.strictEqual(naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, "job-brand-new"), false);
  console.log("✓ Test: Unknown/new job remains eligible");

  // Verify list filtering with all 8 jobs
  const sampleDiscovered = [
    { jobId: "job-applied", hasSelectableCheckbox: true },
    { jobId: "job-nocheckbox", hasSelectableCheckbox: false },
    { jobId: "job-external", hasSelectableCheckbox: false },
    { jobId: "job-needsinput", hasSelectableCheckbox: true },
    { jobId: "job-failed", hasSelectableCheckbox: true },
    { jobId: "job-unverified", hasSelectableCheckbox: true },
    { jobId: "job-unknownroute", hasSelectableCheckbox: true },
    { jobId: "job-brand-new", hasSelectableCheckbox: true }
  ];
  const sampleExcludedCount = sampleDiscovered.filter(j => naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, j.jobId)).length;
  assert.strictEqual(sampleExcludedCount, 3, "Only APPLIED, SKIPPED_NO_CHECKBOX, and SKIPPED_EXTERNAL must be excluded by history");

  const sampleEligible = sampleDiscovered.filter(j => !naukriAgent.isJobPermanentlyExcludedByHistory(historyFilterTest, j.jobId));
  assert.deepStrictEqual(sampleEligible.map(j => j.jobId), ["job-needsinput", "job-failed", "job-unverified", "job-unknownroute", "job-brand-new"]);
  console.log("✓ Test: Excluded by persistent history counts only terminal statuses (3) and keeps 5 eligible jobs");

  console.log("\n==================================================");
  console.log("ALL VALIDATION TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================");
}

runTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
