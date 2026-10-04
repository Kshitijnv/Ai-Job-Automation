const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const questionMapper = require("./question-mapper");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_QUEUE_FILE = path.join(ROOT, "output", "review_queue.json");
const COMPANY_SPECIFIC_QUESTION = /why.*(company|us|team|mission|product|work here|work at|work for|join)|company.*(why|interest|motivation|fit)|organization.*(why|interest)|mission|values/i;

function normalize(value) {
  const words = String(value || "").normalize("NFKC").toLowerCase()
    .replace(/\blocate\s+me\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  const midpoint = Math.floor(words.length / 2);
  if (midpoint > 0 && words.length % 2 === 0
      && words.slice(0, midpoint).join(" ") === words.slice(midpoint).join(" ")) {
    return words.slice(0, midpoint).join(" ");
  }
  return words.join(" ");
}

function sanitize(value) {
  if (typeof value === "string") return questionMapper.redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  }
  return value;
}

function isCompanySpecific(question, company) {
  const normalizedCompany = normalize(company);
  return (normalizedCompany && normalize(question).includes(normalizedCompany))
    || COMPANY_SPECIFIC_QUESTION.test(String(question));
}

function makeGroupKey(question, company) {
  if (questionMapper.sensitiveField(question)) return null;
  const normalizedQuestion = normalize(question);
  if (!normalizedQuestion) return null;
  if (isCompanySpecific(question, company)) {
    return `company:${normalize(company)}:${normalizedQuestion}`;
  }
  const canonicalId = questionMapper.canonicalQuestion(question);
  if (canonicalId) return `semantic:${canonicalId}`;
  return `shared:${normalizedQuestion}`;
}

function queueKeyFor(question, company) {
  return isCompanySpecific(question, company)
    ? `Company: ${company} :: ${question}`
    : question;
}

function emptyQueue() {
  return { generatedAt: null, questions: {}, blocked: [] };
}

function mergeQueueEntry(target, incoming) {
  if (!target.answer && incoming.answer) target.answer = incoming.answer;
  target.jobIds = [...new Set([...(target.jobIds || []), ...(incoming.jobIds || [])].map(String))];
  target.appliedJobIds = [...new Set([...(target.appliedJobIds || []), ...(incoming.appliedJobIds || [])].map(String))];
  target.applications = [...(target.applications || [])];
  for (const application of incoming.applications || []) {
    const existing = target.applications.find(item => String(item.jobId) === String(application.jobId));
    if (existing) Object.assign(existing, application);
    else target.applications.push(application);
  }
  target.jobs = target.jobIds.length;
  if (!target.company && incoming.company) target.company = incoming.company;
  return target;
}

function migrateQuestions(queue) {
  const normalized = {};
  for (const [oldKey, oldEntry] of Object.entries(queue.questions)) {
    if (questionMapper.sensitiveField(oldEntry.question)) continue;
    const groupKey = makeGroupKey(oldEntry.question, oldEntry.company || "");
    if (!groupKey) continue;
    const targetKey = Object.keys(normalized).find(key => normalized[key].groupKey === groupKey)
      || (normalized[oldKey] ? `${oldKey} [${Object.keys(normalized).length + 1}]` : oldKey);
    const incoming = { ...oldEntry, groupKey };
    if (normalized[targetKey]) mergeQueueEntry(normalized[targetKey], incoming);
    else normalized[targetKey] = incoming;
  }
  queue.questions = normalized;
  updateStatuses(queue);
}

function loadQueue(filePath = DEFAULT_QUEUE_FILE) {
  try {
    const queue = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!queue.questions || typeof queue.questions !== "object" || Array.isArray(queue.questions)) return emptyQueue();
    if (!Array.isArray(queue.blocked)) queue.blocked = [];
    migrateQuestions(queue);
    queue.blocked = sanitize(queue.blocked);
    return queue;
  } catch (error) {
    if (error.code === "ENOENT") return emptyQueue();
    throw error;
  }
}

function saveQueue(queue, filePath = DEFAULT_QUEUE_FILE) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  queue.generatedAt = new Date().toISOString();
  const safeQueue = sanitize(queue);
  fs.writeFileSync(filePath, `${JSON.stringify(safeQueue, null, 2)}\n`, "utf8");
  return safeQueue;
}

function applicationsForResult(result) {
  return {
    jobId: questionMapper.redactSensitiveText(result.jobId),
    company: questionMapper.redactSensitiveText(result.company || ""),
    title: questionMapper.redactSensitiveText(result.title || ""),
    portal: result.portal || "",
    portalUrl: questionMapper.redactSensitiveText(result.portalUrl || "")
  };
}

function findEntryKey(questions, groupKey) {
  return Object.keys(questions).find(key => questions[key].groupKey === groupKey);
}

function ensureQueueEntry(queue, question, application) {
  if (questionMapper.sensitiveField(question)) return null;
  const groupKey = makeGroupKey(question, application.company);
  if (!groupKey) return null;
  let key = findEntryKey(queue.questions, groupKey);
  if (!key) {
    key = queueKeyFor(question, isCompanySpecific(question, application.company) ? application.company : "");
    if (queue.questions[key] && queue.questions[key].groupKey !== groupKey) key = `${key} [${Object.keys(queue.questions).length + 1}]`;
    queue.questions[key] = {
      groupKey,
      question,
      company: isCompanySpecific(question, application.company) ? application.company : null,
      jobs: 0,
      jobIds: [],
      applications: [],
      answer: "",
      status: "Pending",
      appliedJobIds: []
    };
  }
  const entry = queue.questions[key];
  const jobId = String(application.jobId);
  entry.appliedJobIds = entry.appliedJobIds.filter(appliedJobId => appliedJobId !== jobId);
  if (!entry.jobIds.includes(jobId)) entry.jobIds.push(jobId);
  const existingApplication = entry.applications.find(item => item.jobId === jobId);
  if (existingApplication) Object.assign(existingApplication, application);
  else entry.applications.push(application);
  entry.jobs = entry.jobIds.length;
  return { key, entry };
}

function updateStatuses(queue) {
  for (const entry of Object.values(queue.questions)) {
    entry.jobs = entry.jobIds.length;
    if (!entry.answer) entry.status = "Pending";
    else if (entry.jobIds.every(jobId => entry.appliedJobIds.includes(jobId))) entry.status = "Applied";
    else entry.status = "Answered";
  }
}

function pruneResolvedQuestions(queue, results) {
  for (const result of results) {
    const resolved = new Set(result.semanticQuestionsResolved || []);
    if (result.resumeUpload?.uploaded) resolved.add("resume_upload");
    if (!resolved.size) continue;
    const jobId = String(result.jobId);
    for (const [key, entry] of Object.entries(queue.questions)) {
      const canonicalId = questionMapper.canonicalQuestion(entry.question);
      if (!canonicalId || !resolved.has(canonicalId)) continue;
      entry.jobIds = (entry.jobIds || []).filter(id => String(id) !== jobId);
      entry.appliedJobIds = (entry.appliedJobIds || []).filter(id => String(id) !== jobId);
      entry.applications = (entry.applications || []).filter(application => String(application.jobId) !== jobId);
      entry.jobs = entry.jobIds.length;
      if (!entry.jobIds.length) delete queue.questions[key];
    }
  }
}

function updateFromFormResults(results, appliedAnswers = [], filePath = DEFAULT_QUEUE_FILE) {
  const queue = loadQueue(filePath);
  const processedJobIds = new Set(results.map(result => String(result.jobId)));
  queue.blocked = queue.blocked.filter(item => !processedJobIds.has(String(item.jobId)));
  pruneResolvedQuestions(queue, results);
  for (const result of results) {
    const application = applicationsForResult(result);
    if (result.blockedReason) {
      queue.blocked.push({
        ...application,
        reason: questionMapper.redactSensitiveText(result.blockedReason),
        checkedAt: new Date().toISOString()
      });
    }
    for (const field of result.humanRequiredFields || []) {
      ensureQueueEntry(queue, field.label, application);
    }
  }

  for (const applied of appliedAnswers) {
    const entry = queue.questions[applied.key];
    if (!entry) continue;
    const application = applicationsForResult(applied.application || applied);
    const jobId = String(applied.jobId || application.jobId);
    if (!entry.jobIds.includes(jobId)) entry.jobIds.push(jobId);
    const existingApplication = entry.applications.find(item => item.jobId === jobId);
    if (existingApplication) Object.assign(existingApplication, application);
    else entry.applications.push(application);
    if (!entry.appliedJobIds.includes(jobId)) entry.appliedJobIds.push(jobId);
  }

  updateStatuses(queue);
  return saveQueue(queue, filePath);
}

function getAnswersForJob(queue, jobId, company) {
  return Object.entries(queue.questions || {})
    .filter(([, entry]) => entry.answer
      && (entry.company === null || String(entry.company).trim().toLowerCase() === String(company || "").trim().toLowerCase()))
    .sort((left, right) => Number(Boolean(right[1].company)) - Number(Boolean(left[1].company)))
    .map(([key, entry]) => ({ key, question: entry.question, company: entry.company, answer: entry.answer }));
}

function pendingQuestions(queue) {
  return Object.entries(queue.questions || {})
    .filter(([, entry]) => entry.status === "Pending")
    .map(([key, entry]) => ({ key, ...entry }));
}

function answeredQuestions(queue) {
  return Object.entries(queue.questions || {})
    .filter(([, entry]) => entry.answer && entry.status !== "Applied")
    .map(([key, entry]) => ({ key, ...entry }));
}

function recordAnswer(queue, key, answer) {
  const entry = queue.questions[key];
  if (!entry) throw new Error(`Review question was not found: ${key}`);
  if (questionMapper.sensitiveField(entry.question)) {
    throw new Error("Sensitive credential questions cannot be stored in the review queue.");
  }
  entry.answer = questionMapper.redactSensitiveText(String(answer || "").trim());
  updateStatuses(queue);
  return entry;
}

function summaryLines(queue) {
  return Object.entries(queue.questions || {})
    .filter(([, entry]) => !questionMapper.sensitiveField(entry.question))
    .map(([, entry]) =>
      `${entry.status}: ${questionMapper.redactSensitiveText(entry.question)}${entry.company ? ` (${entry.company})` : ""} — ${entry.jobs} job(s)`);
}

async function confirmBeforeSubmission(queue, input = process.stdin, output = process.stdout) {
  output.write("Application submission summary\n");
  for (const line of summaryLines(queue)) output.write(`- ${line}\n`);
  for (const item of queue.blocked || []) {
    output.write(`- Blocked: ${item.company || item.jobId} — ${item.reason}\n`);
  }
  output.write("No applications will be submitted by the review agent.\nType SUBMIT to explicitly confirm a future submission step: ");
  if (!input.isTTY || !output.isTTY) return false;
  const prompt = readline.createInterface({ input, output });
  try {
    return (await prompt.question("")).trim() === "SUBMIT";
  } finally {
    prompt.close();
  }
}

module.exports = {
  DEFAULT_QUEUE_FILE,
  answeredQuestions,
  confirmBeforeSubmission,
  getAnswersForJob,
  isCompanySpecific,
  loadQueue,
  makeGroupKey,
  pendingQuestions,
  queueKeyFor,
  recordAnswer,
  saveQueue,
  summaryLines,
  updateFromFormResults
};
