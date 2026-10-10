const assert = require("assert");
const { chromium } = require("playwright");
const {
  extractLinkedInJobId,
  classifyLinkedInApply,
  inspectLinkedInJob,
  clickEasyApplyEntry
} = require("../lib/browser");

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    return await chromium.launch({ channel: "msedge", headless: true });
  }
}

async function runTests() {
  console.log("Running LinkedIn Easy Apply targeting tests...\n");

  // ----------------------------------------------------
  // Test 1: extractLinkedInJobId helper verification
  // ----------------------------------------------------
  assert.strictEqual(extractLinkedInJobId({ id: "4470552594" }), "4470552594");
  assert.strictEqual(extractLinkedInJobId({ jobId: 4470552594 }), "4470552594");
  assert.strictEqual(extractLinkedInJobId({ url: "https://www.linkedin.com/jobs/view/4472945012/" }), "4472945012");
  assert.strictEqual(extractLinkedInJobId("https://in.linkedin.com/jobs/view/senior-developer-at-company-4472945012"), "4472945012");
  assert.strictEqual(extractLinkedInJobId("https://www.linkedin.com/jobs/search/?currentJobId=4462689216&origin=search"), "4462689216");
  assert.strictEqual(extractLinkedInJobId("urn:li:jobPosting:4470552594"), "4470552594");
  assert.strictEqual(extractLinkedInJobId("4470552594"), "4470552594");
  console.log("✓ Test 1 Passed: extractLinkedInJobId reliably extracts Job ID from all formats.");

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    // ----------------------------------------------------
    // Test 2: Target Easy Apply control is selected when multiple Easy Apply buttons exist
    // ----------------------------------------------------
    await page.setContent(`
      <div class="jobs-details__main-content">
        <div class="jobs-unified-top-card" data-job-id="4470552594">
          <h1>MegaNucleus - Full Stack Developer</h1>
          <button type="button" class="jobs-apply-button--top-card" id="target-easy-apply" aria-label="Easy Apply to MegaNucleus">
            Easy Apply
          </button>
        </div>
      </div>
      <aside class="jobs-similar-jobs">
        <h2>Similar jobs</h2>
        <div class="similar-job-card" data-job-id="4462689216">
          <h3>LogixHealth - Senior Software Engineer</h3>
          <button type="button" class="jobs-apply-button" id="similar-easy-apply" aria-label="Easy Apply to LogixHealth">
            Easy Apply
          </button>
        </div>
      </aside>
    `);

    await page.evaluate(() => {
      window.targetClicked = false;
      window.similarClicked = false;
      document.getElementById("target-easy-apply").addEventListener("click", () => { window.targetClicked = true; });
      document.getElementById("similar-easy-apply").addEventListener("click", () => { window.similarClicked = true; });
    });

    const targetJob = { id: "4470552594", title: "Full Stack Developer", company: "MegaNucleus" };
    const clickResult1 = await clickEasyApplyEntry(page, targetJob);

    assert.strictEqual(clickResult1.clicked, true);
    assert.strictEqual(clickResult1.targetJobId, "4470552594");
    assert.strictEqual(await page.evaluate(() => window.targetClicked), true, "Target Easy Apply must be clicked");
    assert.strictEqual(await page.evaluate(() => window.similarClicked), false, "Similar job Easy Apply must NOT be clicked");
    console.log("✓ Test 2 Passed: Target Easy Apply control is preferred and selected when multiple Easy Apply buttons exist.");

    // ----------------------------------------------------
    // Test 3: Recommended/similar-job Easy Apply control is rejected (EY / Tieto scenario)
    // ----------------------------------------------------
    await page.setContent(`
      <div class="jobs-details__main-content">
        <div class="jobs-unified-top-card" data-job-id="4472945012">
          <h1>EY - TTT - .NET plus Angular-Full Stack</h1>
          <a class="jobs-apply-button" id="ey-external-apply" href="https://ey.com/careers/apply" target="_blank">
            Apply on company website
          </a>
        </div>
      </div>
      <section class="similar-jobs">
        <h2>More jobs like this</h2>
        <a class="similar-card" id="similar-job-link" href="https://www.linkedin.com/jobs/search-results/?origin=JobSearchOrigin_JOB_DETAILS_SIMILAR_JOBS_CARD&currentJobId=4462689216">
          <span>Senior Software Engineer - LogixHealth - Easy Apply</span>
        </a>
      </section>
    `);

    await page.evaluate(() => {
      window.eyClicked = false;
      window.similarLinkClicked = false;
      document.getElementById("ey-external-apply").addEventListener("click", () => { window.eyClicked = true; });
      document.getElementById("similar-job-link").addEventListener("click", (e) => { e.preventDefault(); window.similarLinkClicked = true; });
    });

    const eyJob = { id: "4472945012", title: "TTT - .NET plus Angular-Full Stack", company: "EY" };
    const clickResult2 = await clickEasyApplyEntry(page, eyJob);

    assert.strictEqual(clickResult2.clicked, false, "Must not click Easy Apply belonging to similar job");
    assert.strictEqual(clickResult2.action, "target-mismatch");
    assert.strictEqual(await page.evaluate(() => window.similarLinkClicked), false, "Similar job link must NOT be clicked");
    console.log("✓ Test 3 Passed: Recommended/similar-job Easy Apply control is rejected when target is external apply.");

    // ----------------------------------------------------
    // Test 4: Mismatched Job ID is never clicked
    // ----------------------------------------------------
    await page.setContent(`
      <div class="job-container">
        <button type="button" id="mismatched-btn" data-job-id="4462689216" aria-label="Easy Apply">
          Easy Apply
        </button>
      </div>
    `);

    await page.evaluate(() => {
      window.mismatchedClicked = false;
      document.getElementById("mismatched-btn").addEventListener("click", () => { window.mismatchedClicked = true; });
    });

    const clickResult3 = await clickEasyApplyEntry(page, { id: "4472945012" });
    assert.strictEqual(clickResult3.clicked, false, "Must not click mismatched Job ID");
    assert.strictEqual(clickResult3.action, "target-mismatch");
    assert.strictEqual(await page.evaluate(() => window.mismatchedClicked), false, "Mismatched button was not clicked");
    console.log("✓ Test 4 Passed: Mismatched Job ID control is safely rejected without clicking.");

    // ----------------------------------------------------
    // Test 5: Existing MegaNucleus-style valid Easy Apply targeting still works
    // ----------------------------------------------------
    await page.setContent(`
      <div class="jobs-unified-top-card">
        <button type="button" class="jobs-apply-button" id="meganucleus-btn" aria-label="Easy Apply to this job">
          Easy Apply
        </button>
      </div>
    `);

    await page.evaluate(() => {
      window.megaNucleusClicked = false;
      document.getElementById("meganucleus-btn").addEventListener("click", () => { window.megaNucleusClicked = true; });
    });

    const megaNucleusJob = { id: "4470552594", title: "Full Stack Developer", company: "MegaNucleus" };
    const clickResult4 = await clickEasyApplyEntry(page, megaNucleusJob);
    assert.strictEqual(clickResult4.clicked, true);
    assert.strictEqual(await page.evaluate(() => window.megaNucleusClicked), true);
    console.log("✓ Test 5 Passed: Existing MegaNucleus-style valid Easy Apply targeting works seamlessly.");

    // ----------------------------------------------------
    // Test 6: Unsafe/unverifiable targeting fails safely
    // ----------------------------------------------------
    await page.setContent(`
      <aside class="recommendations">
        <div class="random-box">
          <button type="button" id="random-btn" aria-label="Easy Apply">Easy Apply</button>
        </div>
      </aside>
    `);

    await page.evaluate(() => {
      window.randomClicked = false;
      document.getElementById("random-btn").addEventListener("click", () => { window.randomClicked = true; });
    });

    const clickResult5 = await clickEasyApplyEntry(page, { id: "8888888888" });
    assert.strictEqual(clickResult5.clicked, false);
    assert.strictEqual(await page.evaluate(() => window.randomClicked), false);
    assert.ok(clickResult5.diagnostic, "Diagnostic is provided");
    console.log("✓ Test 6 Passed: Unsafe/unverifiable targeting fails safely with diagnostic.");

  } finally {
    await browser.close();
  }

  console.log("\n==================================================");
  console.log("ALL LINKEDIN EASY APPLY TARGETING TESTS PASSED!");
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
