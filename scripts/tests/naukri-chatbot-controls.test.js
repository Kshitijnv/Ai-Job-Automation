const assert = require("assert");
const { chromium } = require("playwright");
const {
  decideNaukriAnswerControl,
  discoverNaukriAnswerControls,
  findUniqueNumericRangeOption,
  getLatestChatbotMessageContext,
  applyNaukriAnswerControl,
  findSemanticOption,
  discoverJobs,
  filterJobsWithSelectableCheckbox,
  resolveNaukriAnswerDetails,
  parseNumericRangeOption,
  readExperienceRangeOptions,
  selectSingleExperienceRange
} = require("../naukri/naukri-agent");

function expectRange(value, options, expectedLabel, expectedIndex) {
  assert.deepStrictEqual(findUniqueNumericRangeOption(value, options), {
    label: expectedLabel,
    index: expectedIndex
  });
}

expectRange(3, ["less than 1 yr", "1 to 5 yrs", "More than 5 yrs"], "1 to 5 yrs", 1);
expectRange(3, ["0 to 2 years", "3 to 5 years", "6 to 10 years", "More than 10 years"], "3 to 5 years", 1);
expectRange(3, ["Fresher", "1-3 years", "4-6 years", "7+ years"], "1-3 years", 1);

assert.deepStrictEqual(parseNumericRangeOption("< 1 year"), {
  min: 0,
  max: 1,
  minInclusive: true,
  maxInclusive: false
});
assert.deepStrictEqual(parseNumericRangeOption("10+ years"), {
  min: 10,
  max: Number.POSITIVE_INFINITY,
  minInclusive: true,
  maxInclusive: false
});

const textDecision = decideNaukriAnswerControl({
  intent: "total_experience_years",
  answer: 3,
  hasTextInput: true
});
assert.deepStrictEqual(textDecision, { status: "SUPPORTED", control: "TEXT", answer: "3" });

const noMatch = decideNaukriAnswerControl({
  intent: "skill_experience_years",
  answer: 3,
  options: ["less than 1 year", "More than 5 years"]
});
assert.strictEqual(noMatch.status, "NEEDS_USER_INPUT");

assert.deepStrictEqual(findSemanticOption("Pune", "current_location", ["Bangalore", "Mumbai", "Other"]), { index: 2, label: "Other" });
assert.deepStrictEqual(findSemanticOption("Pune", "current_location", ["Pune", "Mumbai", "Delhi"]), { index: 0, label: "Pune" });
assert.deepStrictEqual(findSemanticOption("Delhi NCR", "current_location", ["Delhi/NCR", "Mumbai", "Other"]), { index: 0, label: "Delhi/NCR" });
assert.strictEqual(findSemanticOption("Yes", "willing_to_relocate", ["Yes", "No", "Other"]).label, "Yes");
assert.strictEqual(findSemanticOption("Pune", "current_location", ["Pune", "Pune", "Other"]), null);

const overlapping = decideNaukriAnswerControl({
  intent: "skill_experience_years",
  answer: 3,
  options: ["1 to 5 years", "3 to 5 years"]
});
assert.strictEqual(overlapping.status, "NEEDS_USER_INPUT");

const unrelatedCheckbox = decideNaukriAnswerControl({
  intent: "boolean_skill_experience",
  answer: true,
  options: ["Yes", "No"]
});
assert.strictEqual(unrelatedCheckbox.status, "NEEDS_USER_INPUT");

function makeGroup(optionEntries) {
  const associatedLabels = [];
  const elements = optionEntries.map((entry, index) => {
    const id = `option-${index}`;
    const associatedLabel = {
      htmlFor: id,
      innerText: entry.label,
      textContent: entry.label,
      getAttribute(name) { return name === "for" ? id : null; },
      ownerDocument: { defaultView: { getComputedStyle: () => ({ display: "block", visibility: "visible" }) } },
      getBoundingClientRect: () => ({ width: 100, height: 20 })
    };
    const element = {
      id,
      value: entry.label,
      checked: Boolean(entry.checked),
      disabled: Boolean(entry.disabled),
      labels: [associatedLabel],
      closest(selector) {
        return selector === ".multiselectcheckboxes"
          ? { querySelectorAll: () => associatedLabels }
          : null;
      }
    };
    associatedLabels.push(associatedLabel);
    return {
      element,
      async evaluate(callback) { return callback(element); },
      async isVisible() { return true; },
      async click() { element.checked = !element.checked; }
    };
  });
  const checkboxCollection = {
    async count() { return elements.length; },
    nth(index) { return elements[index]; },
    async evaluateAll(callback) { return callback(elements.map(item => item.element)); }
  };
  const labelCollection = {
    nth(index) {
      return {
        async isVisible() { return true; },
        async click() { elements[index].element.checked = !elements[index].element.checked; }
      };
    }
  };
  return {
    locator(selector) { return selector === "label" ? labelCollection : checkboxCollection; },
    elements
  };
}

(async () => {
  const group = makeGroup([
    { label: "less than 1 yr", checked: true },
    { label: "1 to 5 yrs" },
    { label: "More than 5 yrs" }
  ]);
  const discovered = await readExperienceRangeOptions(group);
  assert.deepStrictEqual(discovered.options.map(option => option.label), [
    "less than 1 yr",
    "1 to 5 yrs",
    "More than 5 yrs"
  ]);
  const selection = await selectSingleExperienceRange(group, 1);
  assert.deepStrictEqual(selection, { selected: true, label: "1 to 5 yrs", index: 1 });
  assert.deepStrictEqual(group.elements.map(option => option.element.checked), [false, true, false]);

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();

    await page.setContent(`
      <article data-job-id="checkbox-job"><input type="checkbox"><h2>Selectable job</h2></article>
      <article data-job-id="empty-container-job"><div class="dspIB saveJobContainer tuple-check-box"></div><h2>External job</h2></article>
      <article data-job-id="no-checkbox-job"><h2>Unsupported job</h2></article>
    `);
    const discoveredJobs = await discoverJobs(page);
    assert.strictEqual(discoveredJobs.find(job => job.jobId === "checkbox-job").hasSelectableCheckbox, true);
    assert.strictEqual(discoveredJobs.find(job => job.jobId === "empty-container-job").hasSelectableCheckbox, false);
    assert.strictEqual(discoveredJobs.find(job => job.jobId === "no-checkbox-job").hasSelectableCheckbox, false);
    const discoveryHistory = { jobs: {} };
    const eligibleJobs = filterJobsWithSelectableCheckbox(discoveredJobs, discoveryHistory, "Profile");
    assert.deepStrictEqual(eligibleJobs.map(job => job.jobId), ["checkbox-job"]);
    assert.strictEqual(discoveryHistory.jobs["empty-container-job"].status, "SKIPPED_NO_CHECKBOX");
    assert.strictEqual(discoveryHistory.jobs["no-checkbox-job"].status, "SKIPPED_NO_CHECKBOX");

    const locationConfig = { answers: { contact: { currentLocation: "Pune" } } };
    const cityAnswer = await resolveNaukriAnswerDetails("What is your current city?", locationConfig, {});
    assert.strictEqual(cityAnswer.answer, "Pune");
    assert.strictEqual(cityAnswer.semantic.intent, "current_location");
    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">What is your current city?</div><select><option value="">Choose</option><option>Bangalore</option><option>Mumbai</option><option>Other</option></select></div>`);
    let cityControls = await discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), cityAnswer.semantic);
    let citySelection = await applyNaukriAnswerControl(cityControls, cityAnswer.semantic, cityAnswer.answer);
    assert.strictEqual(citySelection.status, "APPLIED");
    assert.strictEqual(await cityControls.control.inputValue(), "Other");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">What is your current city?</div><select><option value="">Choose</option><option>Pune</option><option>Mumbai</option><option>Delhi</option></select></div>`);
    cityControls = await discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), cityAnswer.semantic);
    citySelection = await applyNaukriAnswerControl(cityControls, cityAnswer.semantic, cityAnswer.answer);
    assert.strictEqual(citySelection.status, "APPLIED");
    assert.strictEqual(await cityControls.control.inputValue(), "Pune");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">What is your current location?</div><select><option value="">Choose</option><option>Delhi/NCR</option><option>Mumbai</option><option>Other</option></select></div>`);
    const delhiSemantic = { ...cityAnswer.semantic, answer: "Delhi NCR", displayValue: "Delhi NCR" };
    const delhiControls = await discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), delhiSemantic);
    const delhiSelection = await applyNaukriAnswerControl(delhiControls, delhiSemantic, "Delhi NCR");
    assert.strictEqual(delhiSelection.status, "APPLIED");
    assert.strictEqual(await delhiControls.control.inputValue(), "Delhi/NCR");

    const inspectContainer = async (semantic = {}) => discoverNaukriAnswerControls(page.locator(".chatbot_MessageContainer"), semantic);
    await page.setContent(`
      <div class="chatbot_Drawer">
        <div class="chatbot_MessageContainer">
          <ul class="list">
            <li class="botItem chatbot_ListItem">
              <div class="botMsg msg"><div><span>How many years of experience do you have in building API ?</span></div></div>
            </li>
          </ul>
          <div class="multiselectcheckboxes">
            <div class="multicheckboxes-container">
              <input id="less than 1 yr" name="less than 1 yr" type="checkbox" value="less than 1 yr" class="mcc__checkbox" checked style="display:none">
              <label for="less than 1 yr" class="mcc__label" onclick="window.labelClicks = (window.labelClicks || 0) + 1">less than 1 yr</label>
              <input id="1 to 5 yrs" name="1 to 5 yrs" type="checkbox" value="1 to 5 yrs" class="mcc__checkbox" style="display:none">
              <label for="1 to 5 yrs" class="mcc__label" onclick="window.labelClicks = (window.labelClicks || 0) + 1">1 to 5 yrs</label>
              <input id="More than 5 yrs" name="More than 5 yrs" type="checkbox" value="More than 5 yrs" class="mcc__checkbox" style="display:none">
              <label for="More than 5 yrs" class="mcc__label" onclick="window.labelClicks = (window.labelClicks || 0) + 1">More than 5 yrs</label>
            </div>
          </div>
        </div>
      </div>
    `);
    const activeDrawer = page.locator(".chatbot_Drawer");
    const latest = await getLatestChatbotMessageContext(activeDrawer);
    assert.strictEqual(latest.question, "How many years of experience do you have in building API ?");
    const checkboxGroup = latest.container.locator(".multiselectcheckboxes");
    const domOptions = await readExperienceRangeOptions(checkboxGroup);
    const domDecision = decideNaukriAnswerControl({
      intent: "skill_experience_years",
      answer: 3,
      options: domOptions.options.map(option => option.label)
    });
    assert.deepStrictEqual(domDecision, { status: "SUPPORTED", control: "SINGLE_EXPERIENCE_RANGE", index: 1, label: "1 to 5 yrs" });
    const domSelection = await selectSingleExperienceRange(checkboxGroup, domDecision.index);
    assert.deepStrictEqual(domSelection, { selected: true, label: "1 to 5 yrs", index: 1 });
    assert.deepStrictEqual(await domOptions.checkboxes.evaluateAll(inputs => inputs.map(input => input.checked)), [false, true, false]);
    assert.ok(await page.evaluate(() => window.labelClicks >= 2), "Visible labels must be clicked before any hidden-input fallback.");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">How many years of experience do you have?</div><div class="textArea" contenteditable="true"></div></div>`);
    let discovery = await inspectContainer({ intent: "total_experience_years" });
    assert.strictEqual(discovery.type, "contenteditable");
    let interaction = await applyNaukriAnswerControl(discovery, { intent: "total_experience_years" }, 3);
    assert.deepStrictEqual(interaction, { status: "APPLIED", controlType: "contenteditable", answer: "3" });
    assert.strictEqual(await discovery.control.textContent(), "3");

    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">Are you willing to relocate?</div>
        <input id="relocate-yes" type="radio" name="relocate" value="Yes" style="display:none">
        <label for="relocate-yes">Yes</label>
        <input id="relocate-no" type="radio" name="relocate" value="No" style="display:none">
        <label for="relocate-no">No</label>
      </div>
    `);
    discovery = await inspectContainer({ intent: "willing_to_relocate" });
    assert.strictEqual(discovery.type, "radio_group");
    interaction = await applyNaukriAnswerControl(discovery, { intent: "willing_to_relocate", displayValue: "Yes" }, true);
    assert.strictEqual(interaction.status, "APPLIED");
    assert.strictEqual(await page.locator("#relocate-yes").isChecked(), true);
    assert.strictEqual(await page.locator("#relocate-no").isChecked(), false);

    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">Are you currently serving notice?</div>
        <select aria-label="Serving notice"><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
      </div>
    `);
    discovery = await inspectContainer({ intent: "serving_notice_period" });
    assert.strictEqual(discovery.type, "select");
    interaction = await applyNaukriAnswerControl(discovery, { intent: "serving_notice_period", displayValue: "Yes" }, true);
    assert.strictEqual(interaction.status, "APPLIED");
    assert.strictEqual(await discovery.control.inputValue(), "yes");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">How many years of experience do you have?</div><textarea aria-label="Experience"></textarea></div>`);
    discovery = await inspectContainer({ intent: "total_experience_years" });
    assert.strictEqual(discovery.type, "textarea");
    interaction = await applyNaukriAnswerControl(discovery, { intent: "total_experience_years" }, 3);
    assert.strictEqual(interaction.status, "APPLIED");
    assert.strictEqual(await discovery.control.inputValue(), "3");

    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">Would you like to relocate?</div>
        <button type="button" onclick="this.classList.add('selected')">Yes</button>
        <button type="button">No</button>
      </div>
    `);
    discovery = await inspectContainer({ intent: "willing_to_relocate" });
    assert.strictEqual(discovery.type, "button_options");
    interaction = await applyNaukriAnswerControl(discovery, { intent: "willing_to_relocate", displayValue: "Yes" }, true);
    assert.strictEqual(interaction.status, "APPLIED");

    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">Are you serving notice?</div>
        <button role="combobox" aria-haspopup="listbox" aria-label="Serving notice">Select</button>
        <div role="listbox"><div role="option" onclick="document.querySelector('[role=combobox]').setAttribute('aria-valuetext', this.textContent)">Yes</div><div role="option">No</div></div>
      </div>
    `);
    discovery = await inspectContainer({ intent: "serving_notice_period" });
    assert.strictEqual(discovery.type, "custom_combobox");
    interaction = await applyNaukriAnswerControl(discovery, { intent: "serving_notice_period", displayValue: "Yes" }, true);
    assert.strictEqual(interaction.status, "APPLIED");

    await page.setContent(`
      <div class="chatbot_Drawer">
        <div class="chatbot_MessageContainer" id="dynamic-question">
          <div class="botMsg msg">How many years of experience do you have?</div>
          <div class="textArea" contenteditable="true"></div>
          <button class="sendMsg">Save</button>
        </div>
      </div>
    `);
    await page.locator("#dynamic-question").evaluate(container => {
      container.querySelector(".sendMsg").addEventListener("click", () => {
        container.innerHTML = `<div class="botMsg msg">How many years of experience in API?</div>
          <div class="multiselectcheckboxes">
            <input id="low" class="mcc__checkbox" type="checkbox" value="less than 1 yr">
            <label class="mcc__label" for="low">less than 1 yr</label>
            <input id="range" class="mcc__checkbox" type="checkbox" value="1 to 5 yrs">
            <label class="mcc__label" for="range">1 to 5 yrs</label>
          </div>`;
      });
    });
    const drawer = page.locator(".chatbot_Drawer");
    let current = await getLatestChatbotMessageContext(drawer);
    discovery = await discoverNaukriAnswerControls(current.container, { intent: "total_experience_years" });
    interaction = await applyNaukriAnswerControl(discovery, { intent: "total_experience_years" }, 3);
    assert.strictEqual(interaction.status, "APPLIED");
    await current.container.locator(".sendMsg").click();
    current = await getLatestChatbotMessageContext(drawer);
    assert.strictEqual(current.question, "How many years of experience in API?");
    discovery = await discoverNaukriAnswerControls(current.container, { intent: "skill_experience_years" });
    assert.strictEqual(discovery.type, "checkbox_group");
    interaction = await applyNaukriAnswerControl(discovery, { intent: "skill_experience_years" }, 3);
    assert.strictEqual(interaction.status, "APPLIED");
    assert.strictEqual(await current.container.locator("#range").isChecked(), true);

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">Unknown question?</div><div class="slider-control"></div></div>`);
    discovery = await inspectContainer({ intent: "unknown" });
    assert.strictEqual(discovery.type, "unsupported");
    interaction = await applyNaukriAnswerControl(discovery, { intent: "unknown" }, undefined);
    assert.strictEqual(interaction.status, "NEEDS_USER_INPUT");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">How many years of experience do you have?</div><textarea disabled></textarea></div>`);
    discovery = await inspectContainer({ intent: "total_experience_years" });
    interaction = await applyNaukriAnswerControl(discovery, { intent: "total_experience_years" }, 3);
    assert.strictEqual(interaction.status, "FAILED");
  } finally {
    await browser.close();
  }
  console.log("Naukri chatbot control tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
