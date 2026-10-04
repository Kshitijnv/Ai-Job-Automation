const assert = require("assert");
const { chromium } = require("playwright");
const applicationConfig = require("../../config/application.json");
const reviewQueue = require("../shared/review-queue");
const {
  applyNaukriAnswerControl,
  applyNaukriNaFallback,
  classifyNaukriChatbotMessage,
  discoverNaukriAnswerControls,
  findSkipQuestionControl,
  getLatestChatbotMessageContext,
  skipCurrentNaukriQuestion,
  resolveNaukriAnswer,
  saveNaukriChatbotAnswerAndVerifyAdvance,
  handleNaukriRecruiterChatbot,
  isSuccessfulChatbotCompletion
} = require("../naukri/naukri-agent");

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    assert.strictEqual(await resolveNaukriAnswer("How many years of experience do you have with React?", applicationConfig, {}), 0);
    assert.strictEqual(await resolveNaukriAnswer("How many years of experience do you have with Angular?", applicationConfig, {}), 3);

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">Please describe your experience with proprietary XYZ.</div><input type="text"></div>`);
    let container = page.locator(".chatbot_MessageContainer");
    let naAnswer = await applyNaukriNaFallback(container, "Please describe your experience with proprietary XYZ.");
    assert.strictEqual(naAnswer.status, "APPLIED");
    assert.strictEqual(await container.locator("input[type=text]").inputValue(), "NA");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">Unknown optional question</div><select><option value="">Choose</option><option value="not-applicable">Not Applicable</option><option value="yes">Yes</option></select></div>`);
    container = page.locator(".chatbot_MessageContainer");
    naAnswer = await applyNaukriNaFallback(container, "Unknown optional question");
    assert.strictEqual(naAnswer.status, "APPLIED");
    assert.strictEqual(await container.locator("select").inputValue(), "not-applicable");

    await page.setContent(`
      <div class="chatbot_MessageContainer">
        <div class="botMsg msg">Unknown optional question</div>
        <div class="multiselectcheckboxes">
          <input id="na-option" type="checkbox" class="mcc__checkbox" value="N/A" checked>
          <label for="na-option" class="mcc__label">N/A</label>
          <input id="other-option" type="checkbox" class="mcc__checkbox" value="Other">
          <label for="other-option" class="mcc__label">Other</label>
        </div>
      </div>
    `);
    container = page.locator(".chatbot_MessageContainer");
    naAnswer = await applyNaukriNaFallback(container, "Unknown optional question");
    assert.strictEqual(naAnswer.status, "APPLIED");
    assert.strictEqual(await container.locator("#na-option").isChecked(), true);
    assert.strictEqual(await container.locator("#other-option").isChecked(), false);

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">Unknown question</div><select><option>Yes</option><option>No</option></select></div>`);
    container = page.locator(".chatbot_MessageContainer");
    naAnswer = await applyNaukriNaFallback(container, "Unknown question");
    assert.strictEqual(naAnswer.status, "NEEDS_USER_INPUT");

    await page.setContent(`
      <div class="chatbot_Drawer">
        <div class="chatbot_MessageContainer" id="skip-priority">
          <div class="botMsg msg">What is your favorite color?</div>
          <input type="text">
          <div class="chipsContainer"><div class="chatbot_Chip" role="button">Skip this question</div></div>
        </div>
      </div>
    `);
    await page.locator("#skip-priority .chatbot_Chip").evaluate(chip => {
      chip.addEventListener("click", () => {
        document.querySelector("#skip-priority").innerHTML = `<div class="botMsg msg">Thank you for your responses.</div><input type="text">`;
      });
    });
    const prioritizedSkip = await handleNaukriRecruiterChatbot(page, { jobId: "test-skip-priority" }, {}, {});
    assert.strictEqual(prioritizedSkip.status, "TERMINAL_ACKNOWLEDGED");
    assert.strictEqual(await page.locator("#skip-priority input").inputValue(), "");

    await page.setContent(`<div class="chatbot_Drawer"><div class="chatbot_MessageContainer"><div class="botMsg msg">Unknown Yes or No question</div><input type="radio" name="unknown" value="Yes"><label>Yes</label><input type="radio" name="unknown" value="No"><label>No</label></div></div>`);
    const originalQueueUpdate = reviewQueue.updateFromFormResults;
    reviewQueue.updateFromFormResults = () => {};
    let unresolvedRadio;
    try {
      unresolvedRadio = await handleNaukriRecruiterChatbot(page, { jobId: "test-unknown-radio" }, {}, {});
    } finally {
      reviewQueue.updateFromFormResults = originalQueueUpdate;
    }
    assert.strictEqual(unresolvedRadio.status, "NEEDS_USER_INPUT");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">Unknown Yes or No question</div><input type="radio" name="unknown" value="Yes"><label>Yes</label><input type="radio" name="unknown" value="No"><label>No</label></div>`);
    container = page.locator(".chatbot_MessageContainer");
    naAnswer = await applyNaukriNaFallback(container, "Unknown Yes or No question");
    assert.strictEqual(naAnswer.status, "NEEDS_USER_INPUT");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">Unknown selection question</div><div class="multiselectcheckboxes"><input id="yes" class="mcc__checkbox" type="checkbox" value="Yes"><label for="yes" class="mcc__label">Yes</label><input id="no" class="mcc__checkbox" type="checkbox" value="No"><label for="no" class="mcc__label">No</label></div></div>`);
    container = page.locator(".chatbot_MessageContainer");
    naAnswer = await applyNaukriNaFallback(container, "Unknown selection question");
    assert.strictEqual(naAnswer.status, "NEEDS_USER_INPUT");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">How many dependents?</div><input type="number"></div>`);
    container = page.locator(".chatbot_MessageContainer");
    naAnswer = await applyNaukriNaFallback(container, "How many dependents?");
    assert.strictEqual(naAnswer.status, "NEEDS_USER_INPUT");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">How many years of experience?</div><div class="textArea" contenteditable="true"></div></div>`);
    container = page.locator(".chatbot_MessageContainer");
    naAnswer = await applyNaukriNaFallback(container, "How many years of experience?");
    assert.strictEqual(naAnswer.status, "NEEDS_USER_INPUT");

    await page.setContent(`<div class="chatbot_MessageContainer"><div class="botMsg msg">How many years of experience do you have with React?</div><input type="text"></div>`);
    container = page.locator(".chatbot_MessageContainer");
    const reactAnswer = await resolveNaukriAnswer("How many years of experience do you have with React?", applicationConfig, {});
    assert.strictEqual(reactAnswer, 0);
    const reactControls = await discoverNaukriAnswerControls(container, { intent: "skill_experience_years" });
    const appliedReactAnswer = await applyNaukriAnswerControl(reactControls, { intent: "skill_experience_years" }, reactAnswer);
    assert.strictEqual(appliedReactAnswer.status, "APPLIED");
    assert.strictEqual(await container.locator("input[type=text]").inputValue(), "0");

    await page.setContent(`
      <div class="chatbot_Drawer">
        <div class="chatbot_MessageContainer" id="active-question">
          <ul class="list"><li class="botItem chatbot_ListItem"><div class="botMsg msg">How many years of experience in TEST AUTOMATION?</div></li></ul>
          <div class="textAreaWrapper"><div class="textArea" contenteditable="true"></div></div>
          <div class="chipsContainer"><div class="chatbot_Chips"><div class="chatbot_Chip chipInRow chipItem" role="button"><span>  SKIP   this question </span></div></div></div>
        </div>
      </div>
    `);
    const drawer = page.locator(".chatbot_Drawer");
    await page.locator("#active-question .chatbot_Chip").evaluate(chip => {
      chip.addEventListener("click", () => {
        document.querySelector("#active-question").innerHTML = `<div class="botMsg msg">How many years of experience do you have?</div><div class="textArea" contenteditable="true"></div>`;
      });
    });
    const firstContext = await getLatestChatbotMessageContext(drawer);
    assert.strictEqual(firstContext.question, "How many years of experience in TEST AUTOMATION?");
    const skip = await findSkipQuestionControl(firstContext.container);
    assert.ok(skip, "The exact normalized visible Skip chip should be discovered in the active question container.");

    const skipped = await skipCurrentNaukriQuestion(page, drawer, firstContext, { intent: "unknown" }, 1000);
    assert.strictEqual(skipped.status, "CURRENT_QUESTION_SKIPPED");
    assert.strictEqual(skipped.nextQuestion, "How many years of experience do you have?");

    const nextContext = await getLatestChatbotMessageContext(drawer);
    const nextControls = await discoverNaukriAnswerControls(nextContext.container, { intent: "total_experience_years" });
    const answerResult = await applyNaukriAnswerControl(nextControls, { intent: "total_experience_years" }, 3);
    assert.strictEqual(answerResult.status, "APPLIED");
    assert.strictEqual(await nextControls.control.textContent(), "3");

    await page.setContent(`
      <div class="chatbot_Drawer">
        <div class="chatbot_MessageContainer">
          <div class="botMsg msg">Please describe your experience with our proprietary XYZ platform.</div>
          <div class="chipsContainer"><div class="chatbot_Chip">Maybe skip it later</div></div>
        </div>
      </div>
    `);
    const noSkipContext = await getLatestChatbotMessageContext(drawer);
    assert.strictEqual(await findSkipQuestionControl(noSkipContext.container), null);
    const noSkip = await skipCurrentNaukriQuestion(page, drawer, noSkipContext, { intent: "unknown" });
    assert.strictEqual(noSkip.status, "NEEDS_USER_INPUT");

    await page.setContent(`
      <div class="chatbot_Drawer">
        <div class="chatbot_MessageContainer" id="na-fallback-question">
          <div class="botMsg msg">Please describe your experience with proprietary XYZ.</div>
          <textarea></textarea>
          <button class="sendMsg">Save</button>
        </div>
      </div>
    `);
    await page.locator("#na-fallback-question .sendMsg").evaluate(button => {
      button.addEventListener("click", () => {
        document.querySelector("#na-fallback-question").innerHTML = `<div class="botMsg msg">How many years of experience do you have?</div><div class="textArea" contenteditable="true"></div>`;
      });
    });
    const naFallbackContext = await getLatestChatbotMessageContext(drawer);
    const noSkipForText = await skipCurrentNaukriQuestion(page, drawer, naFallbackContext, { intent: "unknown" });
    assert.strictEqual(noSkipForText.status, "NEEDS_USER_INPUT");
    const naText = await applyNaukriNaFallback(naFallbackContext.container, naFallbackContext.question);
    assert.strictEqual(naText.status, "APPLIED");
    assert.strictEqual(await naFallbackContext.container.locator("textarea").inputValue(), "NA");
    const naSaved = await saveNaukriChatbotAnswerAndVerifyAdvance(page, drawer, naFallbackContext, { intent: "unknown" }, "before-na-save");
    assert.strictEqual(naSaved.advanced, true);
    assert.strictEqual(naSaved.nextQuestion, "How many years of experience do you have?");

    await page.setContent(`
      <div class="chatbot_Drawer">
        <div class="chatbot_MessageContainer">
          <div class="botMsg msg">Unknown optional recruiter question?</div>
          <div class="chipsContainer"><div class="chatbot_Chip chipItem" role="button">Skip this question</div></div>
        </div>
      </div>
    `);
    const stalledContext = await getLatestChatbotMessageContext(drawer);
    const failedSkip = await skipCurrentNaukriQuestion(page, drawer, stalledContext, { intent: "unknown" }, 20);
    assert.strictEqual(failedSkip.status, "FAILED");

    assert.strictEqual(classifyNaukriChatbotMessage("Thank you for your responses."), "TERMINAL");
    assert.strictEqual(isSuccessfulChatbotCompletion({ status: "TERMINAL_ACKNOWLEDGED", answeredCount: 0, terminalAcknowledgement: true }), true);

    await page.setContent(`
      <div class="chatbot_Drawer">
        <div class="chatbot_MessageContainer" id="na-question">
          <div class="botMsg msg">Please describe your experience with proprietary XYZ.</div>
          <input type="text" value="NA">
          <button class="sendMsg">Save</button>
        </div>
      </div>
    `);
    await page.locator("#na-question .sendMsg").evaluate(button => {
      button.addEventListener("click", () => {
        document.querySelector("#na-question").innerHTML = `<div class="botMsg msg">How many years of experience do you have?</div><div class="textArea" contenteditable="true"></div>`;
      });
    });
    const naDrawer = page.locator(".chatbot_Drawer");
    const naContext = await getLatestChatbotMessageContext(naDrawer);
    const saveResult = await saveNaukriChatbotAnswerAndVerifyAdvance(page, naDrawer, naContext, { intent: "unknown" }, "before-save-signature");
    assert.strictEqual(saveResult.advanced, true);
    assert.strictEqual(saveResult.nextQuestion, "How many years of experience do you have?");
    console.log("Naukri chatbot skip tests passed");
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
