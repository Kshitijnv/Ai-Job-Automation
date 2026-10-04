const { spawnSync } = require("child_process");
const path = require("path");
const readline = require("readline/promises");
const reviewQueue = require("./lib/review-queue");

const ROOT = path.resolve(__dirname, "..");
const FORM_AGENT_FILE = path.join(ROOT, "scripts", "form-agent.js");

async function collectPendingAnswers(queue, queueFile = reviewQueue.DEFAULT_QUEUE_FILE) {
  const pending = reviewQueue.pendingQuestions(queue);
  if (!pending.length) return 0;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run the review agent in an interactive terminal to answer queued questions.");
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  let recorded = 0;
  try {
    for (const item of pending) {
      const scope = item.company ? ` for ${item.company}` : " (shared across companies)";
      const answer = (await prompt.question(`\n${item.question}${scope} — ${item.jobs} job(s): `)).trim();
      if (!answer) continue;
      reviewQueue.recordAnswer(queue, item.key, answer);
      reviewQueue.saveQueue(queue, queueFile);
      recorded++;
    }
  } finally {
    prompt.close();
  }
  return recorded;
}

function showQueueSummary(queue) {
  console.log("\nHuman Review Queue Summary");
  const lines = reviewQueue.summaryLines(queue);
  if (!lines.length) {
    console.log("- No human-required questions are queued.");
    return;
  }
  for (const line of lines) console.log(`- ${line}`);
  console.log("- No applications have been submitted.");
}

async function confirmResume() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const response = await prompt.question("Resume filling matching application forms with saved answers? (yes/no): ");
    return response.trim().toLowerCase() === "yes";
  } finally {
    prompt.close();
  }
}

function resumeFormFilling() {
  const result = spawnSync(process.execPath, [FORM_AGENT_FILE], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Form Agent exited with status ${result.status}.`);
}

async function main(queueFile = reviewQueue.DEFAULT_QUEUE_FILE) {
  const queue = reviewQueue.loadQueue(queueFile);
  if (!Object.keys(queue.questions).length) {
    showQueueSummary(queue);
    return;
  }

  const recorded = await collectPendingAnswers(queue, queueFile);
  showQueueSummary(queue);
  const pending = reviewQueue.pendingQuestions(queue).length;
  if (pending) console.log(`- Still pending: ${pending} question(s); blank answers were left untouched.`);

  if (!reviewQueue.answeredQuestions(queue).length) return;
  const confirmation = await confirmResume();
  if (!confirmation) {
    console.log("Answers are saved. Form filling was not resumed, and no applications were submitted.");
    return;
  }

  console.log(`Resuming form filling${recorded ? ` after saving ${recorded} answer(s)` : " with saved answers"}.`);
  resumeFormFilling();
  showQueueSummary(reviewQueue.loadQueue(queueFile));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Review Agent failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { collectPendingAnswers, confirmResume, main, showQueueSummary };
