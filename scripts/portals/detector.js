const workday = require("./workday");
const greenhouse = require("./greenhouse");
const lever = require("./lever");

const PORTALS = [workday, greenhouse, lever];

async function detect(page) {
  for (const portal of PORTALS) {
    if (await portal.detect(page)) return portal;
  }
  return null;
}

async function inspect(page) {
  const portal = await detect(page);
  if (!portal) {
    return {
      portal: "Generic",
      pageType: "unknown",
      loggedIn: false,
      company: "",
      title: "",
      location: ""
    };
  }

  const [pageType, loggedIn, metadata] = await Promise.all([
    portal.classify(page),
    portal.isLoggedIn(page),
    portal.extract(page)
  ]);

  return {
    portal: portal.name,
    pageType,
    loggedIn,
    ...metadata
  };
}

async function followExternalApply(page, config) {
  const controlIndex = await page.locator("a, button, [role='button']").evaluateAll(elements => {
    return elements.findIndex(element => {
      if (!element.getClientRects().length) return false;
      const label = [
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean).join(" ").trim().toLowerCase();
      return /^(apply|apply now|apply on company website|apply on employer site)\b/.test(label)
        && !/easy\s*apply|already applied/.test(label);
    });
  });

  if (controlIndex < 0) throw new Error("LinkedIn External Apply control was not found.");

  const popupPromise = page.waitForEvent("popup", {
    timeout: Math.min(config.navigationTimeoutMs, 3000)
  }).catch(() => null);

  await page.locator("a, button, [role='button']").nth(controlIndex).click({
    noWaitAfter: true,
    timeout: config.navigationTimeoutMs
  });

  const popup = await popupPromise;
  const destinationPage = popup || page;
  await destinationPage.waitForURL(url => {
    const destinationHost = url.hostname.toLowerCase();
    return url.protocol.startsWith("http")
      && destinationHost !== "linkedin.com"
      && !destinationHost.endsWith(".linkedin.com");
  }, { timeout: Math.min(config.navigationTimeoutMs, 12000) }).catch(() => {});
  await destinationPage.waitForLoadState("domcontentloaded", {
    timeout: Math.min(config.navigationTimeoutMs, 15000)
  }).catch(() => {});
  await destinationPage.waitForTimeout(config.pageLoadWaitMs);

  const portalUrl = destinationPage.url();
  const hostname = new URL(portalUrl).hostname.toLowerCase();
  if (!portalUrl || hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) {
    throw new Error("External Apply did not leave LinkedIn.");
  }

  return { page: destinationPage, portalUrl };
}

module.exports = { detect, followExternalApply, inspect };
