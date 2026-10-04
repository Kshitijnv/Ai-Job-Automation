const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");
const {
  SECTION_ORDER,
  discoverSections,
  discoverJobs,
  ensureSectionActive,
  getActiveSectionName,
  getRequestedSection,
  normalizeSectionName,
  processSection,
  selectRequestedSections
} = require("../naukri/naukri-agent");

const jobsBySection = {
  Applies: [{ id: "apply-1", title: "Apply job A" }, { id: "apply-2", title: "Apply job B" }],
  Profile: [{ id: "profile-1", title: "Profile job" }],
  Preferences: [{ id: "preferences-1", title: "Preferences job" }],
  "You might like": [{ id: "recommended-1", title: "Recommended job" }]
};

function sectionFixture(defaultSection, order) {
  const tabs = order.map(section => `<button role="tab" aria-selected="${section === defaultSection}" class="${section === defaultSection ? "active" : ""}">${section} (${section === "Applies" ? 21 : 57})</button>`).join("");
  return `
    <nav>${tabs}</nav>
    <h1>Jobs</h1>
    <button id="apply-button">Apply</button>
    <main id="job-list"></main>
    <script>(() => {
      const jobs = ${JSON.stringify(jobsBySection)};
      const list = document.querySelector("#job-list");
      window.selectionSections = [];
      window.applyClicks = 0;
      document.querySelector("#apply-button").addEventListener("click", () => window.applyClicks += 1);
      document.addEventListener("change", event => {
        if (event.target.matches("input[type=checkbox]") && event.target.checked) {
          window.selectionSections.push({ jobId: event.target.closest("article").dataset.jobId, section: document.querySelector("[role=tab][aria-selected=true]").innerText.replace(/\\s*\\(\\d+\\)$/, "") });
        }
      });
      const render = section => {
        list.innerHTML = jobs[section].map(job => '<article data-job-id="' + job.id + '"><input type="checkbox"><h2>' + job.title + '</h2></article>').join("");
      };
      const tabs = [...document.querySelectorAll("[role=tab]")];
      const active = tabs.find(tab => tab.getAttribute("aria-selected") === "true");
      render(active.innerText.replace(/\\s*\\(\\d+\\)$/, ""));
      for (const tab of tabs) tab.addEventListener("click", () => {
        for (const candidate of tabs) {
          candidate.setAttribute("aria-selected", String(candidate === tab));
          candidate.classList.toggle("active", candidate === tab);
        }
        render(tab.innerText.replace(/\\s*\\(\\d+\\)$/, ""));
      });
    })();</script>`;
}

assert.strictEqual(normalizeSectionName("Applies (21)"), "Applies");
assert.strictEqual(normalizeSectionName("Profile (57)"), "Profile");
assert.strictEqual(normalizeSectionName("something Profile"), "something Profile");
assert.deepStrictEqual(SECTION_ORDER, ["Applies", "Profile", "Preferences", "You might like"]);
assert.strictEqual(getRequestedSection(["node", "agent.js"]), "");
assert.strictEqual(getRequestedSection(["node", "agent.js", "--section", "Applies"]), "Applies");
assert.strictEqual(getRequestedSection(["node", "agent.js", "--section", "profile"]), "Profile");
assert.strictEqual(getRequestedSection(["node", "agent.js", "--section", "PREFERENCES"]), "Preferences");
assert.strictEqual(getRequestedSection(["node", "agent.js", "--section", "You might like"]), "You might like");
assert.strictEqual(getRequestedSection(["node", "agent.js", "--section=Profile (57)"]), "Profile");
assert.throws(() => getRequestedSection(["node", "agent.js", "--section", "Something Else"]), /Invalid Naukri section/);
assert.throws(() => getRequestedSection(["node", "agent.js", "--section", "1"]), /Invalid Naukri section/);
const fakeSections = SECTION_ORDER.map(name => ({ name }));
assert.deepStrictEqual(selectRequestedSections(fakeSections, ""), fakeSections);
for (const name of SECTION_ORDER) {
  assert.deepStrictEqual(selectRequestedSections(fakeSections, name), [fakeSections.find(section => section.name === name)]);
}
for (const [value, section] of [["Applies", "Applies"], ["Profile", "Profile"], ["Preferences", "Preferences"], ["You might like", "You might like"]]) {
  assert.deepStrictEqual(selectRequestedSections(fakeSections, getRequestedSection(["node", "agent.js", "--section", value])), [fakeSections.find(item => item.name === section)]);
}

const agentPath = path.resolve(__dirname, "../naukri/naukri-agent.js");
for (const invalidValue of ["Something Else", "1"]) {
  const result = spawnSync(process.execPath, [agentPath, "--section", invalidValue], { encoding: "utf8", cwd: path.resolve(__dirname, "../../") });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.notStrictEqual(result.status, 0);
  assert.match(output, /Invalid Naukri section:/);
  assert.match(output, /Valid sections:\s*- Applies\s*- Profile\s*- Preferences\s*- You might like/);
  assert.doesNotMatch(output, /Naukri Job Automation/);
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const order = ["Profile", "You might like", "Applies", "Preferences"];
    await page.setContent(sectionFixture("Profile", order));
    assert.deepStrictEqual((await discoverSections(page)).map(section => section.name), SECTION_ORDER);

    let state = await ensureSectionActive(page, "Applies");
    assert.strictEqual(await getActiveSectionName(page), "Applies");
    assert.deepStrictEqual(state.jobs.map(job => job.jobId), ["apply-1", "apply-2"]);

    // Simulate Naukri's post-navigation default changing back to Profile.
    await page.locator("[role=tab]").filter({ hasText: "Profile" }).click();
    assert.strictEqual(await getActiveSectionName(page), "Profile");
    state = await ensureSectionActive(page, "Applies");
    assert.strictEqual(await getActiveSectionName(page), "Applies");
    assert.deepStrictEqual(state.jobs.map(job => job.jobId), ["apply-1", "apply-2"]);

    // The inverse default is also corrected, with a different tab order.
    await page.setContent(sectionFixture("Applies", ["Preferences", "Applies", "You might like", "Profile"]));
    state = await ensureSectionActive(page, "Profile");
    assert.strictEqual(await getActiveSectionName(page), "Profile");
    assert.deepStrictEqual(state.jobs.map(job => job.jobId), ["profile-1"]);

    // The active section's live DOM is the source of each discovery result.
    const liveJobs = await discoverJobs(page);
    assert.deepStrictEqual(liveJobs.map(job => job.jobId), ["profile-1"]);

    // Exercise the per-job guard with a dry-run navigation that resets Naukri to Profile.
    await page.setContent(sectionFixture("Profile", ["Profile", "Applies", "Preferences", "You might like"]));
    const inspectSection = (await discoverSections(page)).find(section => section.name === "Applies");
    const inspectOnly = await processSection(page, inspectSection, { jobs: {} }, {}, {}, true, false, Number.POSITIVE_INFINITY);
    assert.strictEqual(inspectOnly.processedJobs, 0);
    assert.strictEqual(await getActiveSectionName(page), "Applies");
    assert.deepStrictEqual(await page.evaluate(() => window.selectionSections), []);
    assert.strictEqual(await page.evaluate(() => window.applyClicks), 0);

    await page.setContent(sectionFixture("Applies", ["Profile", "Applies", "Preferences", "You might like"]));
    const appliesSection = (await discoverSections(page)).find(section => section.name === "Applies");
    page.goto = async () => {
      await page.locator("[role=tab]").filter({ hasText: "Profile" }).click();
    };
    const dryRun = await processSection(page, appliesSection, { jobs: {} }, {}, {}, false, true, Number.POSITIVE_INFINITY);
    assert.strictEqual(dryRun.processedJobs, 2);
    assert.deepStrictEqual(await page.evaluate(() => window.selectionSections), [
      { jobId: "apply-1", section: "Applies" },
      { jobId: "apply-2", section: "Applies" }
    ]);
    assert.strictEqual(await page.evaluate(() => window.applyClicks), 0);

    await page.setContent(sectionFixture("Applies", ["Applies", "Profile", "Preferences", "You might like"]));
    const limitedSection = (await discoverSections(page)).find(section => section.name === "Applies");
    page.goto = async () => {
      await page.locator("[role=tab]").filter({ hasText: "Profile" }).click();
    };
    const limitedRun = await processSection(page, limitedSection, { jobs: {} }, {}, {}, false, true, 1);
    assert.strictEqual(limitedRun.processedJobs, 1);
    assert.deepStrictEqual(await page.evaluate(() => window.selectionSections), [
      { jobId: "apply-1", section: "Applies" }
    ]);
    assert.strictEqual(await page.evaluate(() => window.applyClicks), 0);
  } finally {
    await browser.close();
  }
  console.log("Naukri section context tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
