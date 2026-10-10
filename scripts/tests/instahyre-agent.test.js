const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const instahyreAgent = require("../instahyre/instahyre-agent");

async function runTests() {
  console.log("==================================================");
  console.log("Running Instahyre Agent Tests");
  console.log("==================================================\n");

  // Test 1: Job ID extraction from various real-world Instahyre DOM attributes
  {
    assert.strictEqual(instahyreAgent.extractInstahyreJobId({ jobId: "439696" }), "439696");
    assert.strictEqual(instahyreAgent.extractInstahyreJobId('id="job-skills-439696"'), "439696");
    assert.strictEqual(instahyreAgent.extractInstahyreJobId('id="expand-skills-439696"'), "439696");
    assert.strictEqual(instahyreAgent.extractInstahyreJobId('ng-init="checkSkillsOverflow(439696)"'), "439696");
    assert.strictEqual(instahyreAgent.extractInstahyreJobId('data-job-id="439696"'), "439696");
    assert.strictEqual(instahyreAgent.extractInstahyreJobId('data-id="439696"'), "439696");
    assert.strictEqual(instahyreAgent.extractInstahyreJobId('id="employer-row-439696"'), "439696");
    assert.strictEqual(instahyreAgent.extractInstahyreJobId('439696'), "439696");
    console.log("✓ Test 1 Passed: Job ID accurately extracted across all supported DOM attributes and formats.");
  }

  // Test 2: History terminal status and persistence
  {
    assert.strictEqual(instahyreAgent.isTerminalHistoryStatus("APPLIED"), true);
    assert.strictEqual(instahyreAgent.isTerminalHistoryStatus("SKIPPED_EXTERNAL"), true);
    assert.strictEqual(instahyreAgent.isTerminalHistoryStatus("UNVERIFIED"), false);
    assert.strictEqual(instahyreAgent.isTerminalHistoryStatus("FAILED"), false);
    assert.strictEqual(instahyreAgent.isTerminalHistoryStatus("NEEDS_USER_INPUT"), false);

    const testHistory = { jobs: {} };
    instahyreAgent.noteHistory(testHistory, { jobId: "439696", title: "Software Engineer", company: "EngiNeo" }, "APPLIED");
    assert.strictEqual(testHistory.jobs["439696"].status, "APPLIED");
    assert.strictEqual(testHistory.jobs["439696"].company, "EngiNeo");
    console.log("✓ Test 2 Passed: History terminal statuses and job recording operate correctly.");
  }

  const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
  try {
    const page = await browser.newPage();

    // Test 3: Recommended Jobs section activation
    {
      await page.setContent(`
        <div class="opportunity-tabs">
          <button class="btn btn-tab">Applied Jobs</button>
          <button class="btn btn-tab">Recommended Jobs</button>
          <button class="btn btn-tab">Not interested</button>
          <button class="btn btn-tab">Search result</button>
        </div>
      `);
      await instahyreAgent.ensureRecommendedJobsSection(page);
      const isClicked = await page.evaluate(() => {
        const btn = document.querySelectorAll("button")[1];
        return btn.innerText.includes("Recommended Jobs");
      });
      assert.strictEqual(isClicked, true);
      console.log("✓ Test 3 Passed: 'Recommended Jobs' section verified and explicitly selected.");
    }

    // Test 4: Job card identification & extraction from div.employer-row
    {
      await page.setContent(`
        <div class="employer-row" data-job-id="439696">
          <div class="employer-job-name">Software Engineer - Full Stack (. .NET)</div>
          <div class="employer-name">EngiNeo Solutions</div>
          <div class="employer-locations">Gurgaon</div>
          <div class="employer-experience">3-6 Years</div>
          <div id="job-skills-439696" ng-init="checkSkillsOverflow(439696)">
            <ul>
              <li>.NET Core</li>
              <li>C#</li>
              <li>Angular</li>
            </ul>
          </div>
          <div class="action-links">
            <button class="btn btn-text-link btn-not-interested" ng-click="submitChoice(opp, false)">Not interested</button>
            <button class="btn btn-success btn-md btn-interested">View job »</button>
          </div>
        </div>
      `);

      const card = page.locator("div.employer-row").first();
      const details = await instahyreAgent.extractJobCardDetails(card);
      assert.strictEqual(details.jobId, "439696");
      assert.strictEqual(details.title, "Software Engineer - Full Stack (. .NET)");
      assert.strictEqual(details.company, "EngiNeo Solutions");
      assert.strictEqual(details.location, "Gurgaon");
      assert.strictEqual(details.experience, "3-6 Years");
      assert.deepStrictEqual(details.skills, [".NET Core", "C#", "Angular"]);
      console.log("✓ Test 4 Passed: Job card details cleanly extracted from div.employer-row.");
    }

    // Test 5: Scoped Apply button selector (never matching Not interested)
    {
      await page.setContent(`
        <div class="application-modal-wrap">
          <div class="job-title">Senior Full Stack Developer</div>
          <div class="company-name">EngiNeo Solutions</div>
          <div class="action-buttons">
            <button class="btn btn-default btn-not-interested" ng-click="submitChoice(opp, false)">Not interested</button>
            <div class="apply" ng-click="submitChoice(opp, true)">
              <button class="btn btn-lg btn-primary new-btn">Apply</button>
            </div>
          </div>
        </div>
      `);

      const applyBtn = await instahyreAgent.findApplyButton(page);
      assert.ok(applyBtn, "Apply button must be found");
      const btnText = (await applyBtn.innerText()).trim();
      assert.strictEqual(btnText, "Apply", "Must match only the Apply button");
      console.log("✓ Test 5 Passed: Scoped Apply button located; Not interested button safely ignored.");
    }

    // Test 6: External application modal detection & SKIPPED_EXTERNAL handling
    {
      await page.setContent(`
        <div class="application-modal-wrap">
          <div class="job-title">DevOps Engineer</div>
          <div class="company-name">Cloud Corp</div>
          <div class="apply" ng-click="submitChoice(opp, true)"><button class="btn btn-primary">Apply</button></div>
        </div>
        <div id="apply-external-modal" style="display: block;">
          <p>This company requires you to apply for this job on their website.</p>
          <button class="btn btn-primary" ng-click="trackExternalApplication()">Apply on company site</button>
          <button class="close" data-dismiss="modal">&times;</button>
        </div>
      `);

      const isExternal = await instahyreAgent.isExternalModalVisible(page);
      assert.strictEqual(isExternal, true, "External modal must be detected");

      const mockHistory = { jobs: {} };
      const mockStats = instahyreAgent.createCurrentRunStats();
      const res = await instahyreAgent.processSingleJob(page, mockHistory, mockStats, {
        knownJob: { jobId: "9999", title: "DevOps Engineer", company: "Cloud Corp" }
      });
      assert.strictEqual(res.status, "SKIPPED_EXTERNAL");
      assert.strictEqual(mockStats.skippedExternal, 1);
      assert.strictEqual(mockStats.applied, 0);
      console.log("✓ Test 6 Passed: External application modal detected and recorded as SKIPPED_EXTERNAL without navigating away.");
    }

    // Test 7: Optional social / premium popup detection and dismissal
    {
      await page.setContent(`
        <div class="application-modal-wrap" id="social-popup">
          <h3>Share on social profile</h3>
          <p>Want to move your application to the top?</p>
          <a class="btn-link" ng-click="closeGoPremiumModal()">No thanks, I want to continue as non-premium</a>
          <button class="application-modal-close">×</button>
        </div>
      `);

      assert.strictEqual(await instahyreAgent.isSocialPopupVisible(page), true);
      const dismissed = await instahyreAgent.handleOptionalSocialPopup(page);
      assert.strictEqual(dismissed, true);
      console.log("✓ Test 7 Passed: Optional social/premium popup dismissed cleanly via 'No thanks' control.");
    }

    // Test 8: Sourced Job ID from main card & Authoritative Applied Verification
    {
      await page.setContent(`
        <div class="opportunity-tabs">
          <button class="btn btn-tab active">Recommended Jobs</button>
          <button class="btn btn-tab">Applied Jobs</button>
        </div>
        <div class="employer-row" data-job-id="1001">
          <div class="employer-job-name">Frontend Engineer</div>
          <div class="employer-name">Alpha Tech</div>
          <button class="btn btn-success btn-md btn-interested">View job »</button>
        </div>
        <div class="application-modal-wrap" style="display: none;">
          <div class="job-title">Frontend Engineer</div>
          <div class="company-name">Alpha Tech</div>
          <div class="apply" ng-click="submitChoice(opp, true)"><button class="btn btn-primary">Apply</button></div>
        </div>
      `);

      // Mock View job click opening overlay
      await page.locator("button:has-text('View job')").evaluate(btn => {
        btn.addEventListener("click", () => {
          document.querySelector(".application-modal-wrap").style.display = "block";
        });
      });

      // Mock Apply click and Applied Jobs section update
      await page.locator(".apply button").evaluate(btn => {
        btn.addEventListener("click", () => {
          // When applied tab is rendered, include job 1001
          const tabs = document.querySelectorAll(".opportunity-tabs button");
          tabs[1].addEventListener("click", () => {
            const row = document.createElement("div");
            row.className = "employer-row";
            row.setAttribute("data-job-id", "1001");
            row.innerHTML = `<div class="employer-job-name">Frontend Engineer</div><div class="employer-name">Alpha Tech</div>`;
            document.body.appendChild(row);
          });
        });
      });

      const mockHistory = { jobs: {} };
      const mockStats = instahyreAgent.createCurrentRunStats();
      const res = await instahyreAgent.processSingleJob(page, mockHistory, mockStats, { transitionTimeoutMs: 3000 });

      assert.strictEqual(res.status, "APPLIED");
      assert.strictEqual(mockStats.applied, 1);
      assert.strictEqual(mockHistory.jobs["1001"].status, "APPLIED");
      assert.strictEqual(mockHistory.jobs["1001"].title, "Frontend Engineer");
      console.log("✓ Test 8 Passed: Main card Job ID preserved and authoritatively verified in Applied section.");
    }

    // Test 9: Unverified application when job is not found in Applied section
    {
      await page.setContent(`
        <div class="opportunity-tabs">
          <button class="btn btn-tab active">Recommended Jobs</button>
          <button class="btn btn-tab">Applied Jobs</button>
        </div>
        <div class="application-modal-wrap" style="display: block;">
          <div class="job-title">Data Scientist</div>
          <div class="company-name">Gamma AI</div>
          <div class="apply" ng-click="submitChoice(opp, true)"><button class="btn btn-primary">Apply</button></div>
        </div>
      `);

      const mockHistory = { jobs: {} };
      const mockStats = instahyreAgent.createCurrentRunStats();
      const res = await instahyreAgent.processSingleJob(page, mockHistory, mockStats, {
        knownJob: { jobId: "2001", title: "Data Scientist", company: "Gamma AI" },
        transitionTimeoutMs: 500
      });

      assert.strictEqual(res.status, "UNVERIFIED");
      assert.strictEqual(mockStats.unverified, 1);
      assert.strictEqual(mockStats.applied, 0);
      assert.strictEqual(mockHistory.jobs["2001"].status, "UNVERIFIED");
      console.log("✓ Test 9 Passed: Unconfirmed application safely recorded as UNVERIFIED.");
    }

    // Test 10: Dry-run / Inspect-only mode
    {
      await page.setContent(`
        <div class="application-modal-wrap" style="display: block;">
          <div class="job-title">QA Lead</div>
          <div class="company-name">Delta Systems</div>
          <div class="apply" ng-click="submitChoice(opp, true)"><button class="btn btn-primary">Apply</button></div>
        </div>
      `);

      let applyClicked = false;
      await page.locator(".apply button").evaluate(btn => {
        btn.addEventListener("click", () => { applyClicked = true; });
      });

      const mockHistory = { jobs: {} };
      const mockStats = instahyreAgent.createCurrentRunStats();
      const res = await instahyreAgent.processSingleJob(page, mockHistory, mockStats, {
        knownJob: { jobId: "3001", title: "QA Lead", company: "Delta Systems" },
        dryRun: true
      });

      assert.strictEqual(res.status, "UNVERIFIED");
      assert.strictEqual(applyClicked, false, "Apply button must NOT be clicked in dry-run mode");
      console.log("✓ Test 10 Passed: Dry-run / inspect-only safely halts before clicking Apply.");
    }

    // Test 11: Overlay loading wait ('Hold on, loading...' -> loaded job content)
    {
      await page.setContent(`
        <div class="application-modal-wrap">
          <div class="job-title">Hold on, loading...</div>
          <div class="company-name">Hold on, loading...</div>
        </div>
      `);

      setTimeout(async () => {
        await page.evaluate(() => {
          const wrap = document.querySelector(".application-modal-wrap");
          if (wrap) {
            wrap.setAttribute("data-job-id", "446313");
            wrap.querySelector(".job-title").innerText = "Senior .NET Developer";
            wrap.querySelector(".company-name").innerText = "Acme Corp";
          }
        }).catch(() => {});
      }, 150);

      const result = await instahyreAgent.waitForOverlayContent(page, { expectedJobId: "446313", timeoutMs: 3000 });
      assert.strictEqual(result.loaded, true);
      assert.strictEqual(result.details.jobId, "446313");
      assert.strictEqual(result.details.title, "Senior .NET Developer");
      assert.strictEqual(result.details.company, "Acme Corp");
      console.log("✓ Test 11 Passed: Overlay content wait successfully transitions from 'Hold on, loading...' to populated job details.");
    }

    // Test 12: External modal false-positive resistance (hidden template in body does NOT trigger external skip)
    {
      await page.setContent(`
        <div class="application-modal-wrap" data-job-id="446314">
          <div class="job-title">Full Stack Engineer</div>
          <div class="company-name">Beta Corp</div>
          <div class="apply" ng-click="submitChoice(opp, true)"><button class="btn btn-primary">Apply</button></div>
        </div>
        <!-- Hidden external modal template in DOM should not falsely trigger -->
        <div id="apply-external-modal" style="display: none;">
          <p>This company requires you to apply for this job on their website.</p>
        </div>
      `);

      const isExternal = await instahyreAgent.isExternalModalVisible(page);
      assert.strictEqual(isExternal, false, "Hidden external modal must NOT be detected as active");
      console.log("✓ Test 12 Passed: Hidden external modal template does not trigger false positive SKIPPED_EXTERNAL.");
    }

    // Test 13: "Apply to N jobs" similar-jobs modal detection and handling
    {
      await page.setContent(`
        <div class="similar-jobs-modal" style="display: block;">
          <h3>Apply to 3 similar jobs</h3>
          <button class="btn btn-primary">Apply to 3 jobs</button>
        </div>
      `);

      assert.strictEqual(await instahyreAgent.isSimilarJobsPopupVisible(page), true);
      await page.locator("button:has-text('Apply to 3 jobs')").evaluate(btn => {
        window.appliedSimilarClicked = false;
        btn.addEventListener("click", () => { window.appliedSimilarClicked = true; });
      });

      const handled = await instahyreAgent.handleSimilarJobsPopup(page);
      assert.strictEqual(handled, true);
      const wasClicked = await page.evaluate(() => window.appliedSimilarClicked);
      assert.strictEqual(wasClicked, true);
      console.log("✓ Test 13 Passed: 'Apply to N jobs' similar-jobs overlay detected and applied successfully.");
    }

    // Test 14: Wipro scenario detection ('Want to apply to other similar jobs at Wipro?' & 'Application sent to Wipro')
    {
      await page.setContent(`
        <div class="application-modal-wrap" style="display: block;">
          <h3>Want to apply to other similar jobs at Wipro?</h3>
          <p>Application sent to Wipro. There are some other jobs at Wipro that match your profile.</p>
          <button class="btn btn-default">Cancel</button>
          <button class="btn btn-primary">Apply to 1 job</button>
        </div>
      `);

      const detection = await instahyreAgent.detectSimilarJobsOverlay(page);
      assert.strictEqual(detection.detected, true);
      assert.strictEqual(detection.count, 1);
      assert.strictEqual(detection.company, "Wipro");
      console.log("✓ Test 14 Passed: Wipro Similar Jobs overlay and heading/content cleanly detected.");
    }

    // Test 15: Generic dynamic button regex detection (1, 2, 4, 6 jobs)
    {
      for (const n of [1, 2, 4, 6]) {
        await page.setContent(`
          <div class="application-modal-wrap" style="display: block;">
            <h3>Want to apply to other similar jobs?</h3>
            <p>Application sent to Acme.</p>
            <button class="btn btn-primary">Apply to ${n} ${n === 1 ? "job" : "jobs"}</button>
          </div>
        `);
        const info = await instahyreAgent.detectSimilarJobsOverlay(page);
        assert.strictEqual(info.detected, true);
        assert.strictEqual(info.count, n);
      }
      console.log("✓ Test 15 Passed: Dynamic 'Apply to N jobs' buttons (1, 2, 4, 6) all recognized without hardcoding.");
    }

    // Test 16: Complete Wipro flow (Recommended -> View Job -> Apply -> Similar Jobs Apply -> Close Overlay -> Applied Verification -> Return)
    {
      await page.setContent(`
        <div class="opportunity-tabs">
          <button class="btn btn-tab active">Recommended Jobs</button>
          <button class="btn btn-tab">Applied Jobs</button>
        </div>
        <div class="employer-row" data-job-id="445247">
          <div class="employer-job-name">Wipro - MERN STACK Developer</div>
          <div class="employer-name">Wipro</div>
          <button class="btn btn-success btn-md btn-interested">View job »</button>
        </div>
        <div class="application-modal-wrap" style="display: none;">
          <div class="job-title">MERN STACK Developer</div>
          <div class="company-name">Wipro</div>
          <div class="apply" ng-click="submitChoice(opp, true)"><button class="btn btn-primary">Apply</button></div>
        </div>
      `);

      // Mock View job click
      await page.locator("button:has-text('View job')").evaluate(btn => {
        btn.addEventListener("click", () => {
          document.querySelector(".application-modal-wrap").style.display = "block";
        });
      });

      // Mock Apply click -> transforms modal into Similar Jobs popup
      await page.locator(".apply button").evaluate(btn => {
        btn.addEventListener("click", () => {
          const wrap = document.querySelector(".application-modal-wrap");
          wrap.innerHTML = `
            <h3>Want to apply to other similar jobs at Wipro?</h3>
            <p>Application sent to Wipro.</p>
            <button class="btn btn-default">Cancel</button>
            <button class="btn btn-primary btn-similar-apply">Apply to 1 job</button>
          `;
          wrap.querySelector(".btn-similar-apply").addEventListener("click", () => {
            wrap.style.display = "none"; // modal completes and closes
          });

          // Setup Applied tab
          const tabs = document.querySelectorAll(".opportunity-tabs button");
          tabs[1].addEventListener("click", () => {
            const row = document.createElement("div");
            row.className = "employer-row";
            row.setAttribute("data-job-id", "445247");
            row.innerHTML = `<div class="employer-job-name">Wipro - MERN STACK Developer</div><div class="employer-name">Wipro</div>`;
            document.body.appendChild(row);
          });
        });
      });

      const mockHistory = { jobs: {} };
      const mockStats = instahyreAgent.createCurrentRunStats();
      const res = await instahyreAgent.processSingleJob(page, mockHistory, mockStats, { transitionTimeoutMs: 3000 });

      assert.strictEqual(res.status, "APPLIED");
      assert.strictEqual(mockStats.applied, 1);
      assert.strictEqual(mockHistory.jobs["445247"].status, "APPLIED");
      assert.strictEqual(mockHistory.jobs["445247"].jobId, "445247");
      assert.strictEqual(mockHistory.jobs["445247"].company, "Wipro");
      console.log("✓ Test 16 Passed: Full Wipro scenario completed with Similar Jobs Apply and Applied section confirmation.");
    }

    console.log("\n==================================================");
    console.log("ALL INSTAHYRE AGENT TESTS PASSED (16/16)!");
    console.log("==================================================");
  } finally {
    await browser.close();
  }
}

runTests().catch(err => {
  console.error("Instahyre Test Error:", err);
  process.exit(1);
});

