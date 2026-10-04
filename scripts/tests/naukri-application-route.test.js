const assert = require("assert");
const { chromium } = require("playwright");
const { detectNaukriApplicationRoute, waitForNaukriApplicationRoute } = require("../naukri/naukri-agent");

function withUrl(page, url) {
  let wrappedPage;
  wrappedPage = {
    context: () => ({ pages: () => [wrappedPage] }),
    url: () => url,
    waitForTimeout: milliseconds => page.waitForTimeout(milliseconds),
    locator: (...args) => page.locator(...args)
  };
  return wrappedPage;
}

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div class="chatbot_Drawer"><div class="chatbot_MessageContainer"><div class="botMsg msg">Notice period?</div></div></div>`);
    assert.deepStrictEqual(await detectNaukriApplicationRoute(withUrl(page, "https://www.naukri.com/apply")), { type: "CHATBOT" });

    for (const routeLabel of ["Apply in site", "Direct Apply"]) {
      let clickCount = 0;
      await page.setContent(`<button type="button" id="route">${routeLabel}</button>`);
      await page.locator("#route").evaluate(button => button.addEventListener("click", () => { window.routeClicked = true; }));
      const route = await detectNaukriApplicationRoute(withUrl(page, "https://www.naukri.com/apply"));
      assert.strictEqual(route.type, "EXTERNAL_ROUTE");
      assert.match(route.label, new RegExp(routeLabel, "i"));
      clickCount = await page.evaluate(() => Number(Boolean(window.routeClicked)));
      assert.strictEqual(clickCount, 0, "External route choice must never be clicked or automated.");
    }

    await page.setContent("<main>Apply page</main>");
    const directExternal = await detectNaukriApplicationRoute(withUrl(page, "https://careers.example.org/apply"));
    assert.strictEqual(directExternal.type, "EXTERNAL_REDIRECT");
    assert.strictEqual(directExternal.url, "https://careers.example.org/apply");

    const unknown = await detectNaukriApplicationRoute(withUrl(page, "https://www.naukri.com/mnjuser/application"));
    assert.deepStrictEqual(unknown, { type: "UNKNOWN", url: "https://www.naukri.com/mnjuser/application" });

    await page.setContent("<main>Applying</main>");
    await page.evaluate(() => setTimeout(() => {
      const route = document.createElement("button");
      route.textContent = "Direct Apply";
      document.body.append(route);
    }, 350));
    // saveApply + multiApplyResp with current job ID + 200 => APPLIED
    const validSaveApplyUrl = "https://www.naukri.com/myapply/saveApply?strJobsarr=[011026934188]&applytype=single&resId=215212286&ApplyMode=1&id=228574614&src=h&logstr=drecomm-drecomm_apply&applySrc=drecomm_apply&multiApplyResp=%7B%22011026934188%22%3A200%7D&jobTitle=Software%20Development%20Engineer%202%20%28SDE%202%29";
    const appliedRoute = await detectNaukriApplicationRoute(withUrl(page, validSaveApplyUrl), [], "011026934188");
    assert.strictEqual(appliedRoute.type, "APPLIED");
    assert.strictEqual(appliedRoute.jobId, "011026934188");
    assert.strictEqual(appliedRoute.statusCode, 200);

    // saveApply without matching current job ID => UNKNOWN (existing route handling preserved)
    const mismatchedJobRoute = await detectNaukriApplicationRoute(withUrl(page, validSaveApplyUrl), [], "999999999999");
    assert.strictEqual(mismatchedJobRoute.type, "UNKNOWN");

    // saveApply with error status code in multiApplyResp => UNKNOWN
    const failedSaveApplyUrl = "https://www.naukri.com/myapply/saveApply?strJobsarr=[011026934188]&multiApplyResp=%7B%22011026934188%22%3A500%7D";
    const failedSaveRoute = await detectNaukriApplicationRoute(withUrl(page, failedSaveApplyUrl), [], "011026934188");
    assert.strictEqual(failedSaveRoute.type, "UNKNOWN");

    const delayedRoute = await waitForNaukriApplicationRoute(withUrl(page, "https://www.naukri.com/apply"), [], 2000);
    assert.strictEqual(delayedRoute.type, "EXTERNAL_ROUTE");
    console.log("Naukri application route tests passed");
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
