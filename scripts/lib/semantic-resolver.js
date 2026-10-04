const fs = require("fs");
const path = require("path");
const questionMapper = require("./question-mapper");

const CONFIG_PATH = path.resolve(__dirname, "../../config/llm.json");
const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "qwen3:4b",
  timeoutMs: 15000,
  temperature: 0,
  confidenceThreshold: 0.85
});

const ALLOWED_INTENTS = new Set([
  "total_experience_years",
  "skill_experience_years",
  "notice_period_days",
  "notice_period_months",
  "last_working_day",
  "serving_notice_period",
  "unknown"
]);
const CLASSIFICATION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    intent: { type: "string", enum: [...ALLOWED_INTENTS] },
    skill: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["intent", "skill", "confidence"],
  additionalProperties: false
});

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function requestClassification(question, {
  config = loadConfig(),
  fetchImpl = globalThis.fetch,
  applicationConfig = {}
} = {}) {
  if (config.provider !== "ollama") throw new Error(`Unsupported semantic provider: ${config.provider}`);
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this Node.js runtime.");

  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(config.timeoutMs) || DEFAULT_CONFIG.timeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const skills = Object.keys(applicationConfig.answers?.skills || {});
  const endpoint = `${String(config.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, "")}/api/chat`;
  const systemPrompt = [
    "Classify the semantic intent of a job-application question.",
    "Return one JSON object only, with exactly: intent, skill, confidence.",
    "Allowed intents: total_experience_years, skill_experience_years, notice_period_days, notice_period_months, last_working_day, serving_notice_period, unknown.",
    "If the question names a specific technology or skill while asking for years of experience, intent MUST be skill_experience_years and skill MUST be that configured canonical skill.",
    "Use total_experience_years only when no specific technology or skill is named; then skill MUST be null.",
    "Examples: '.Net Fullstack' => skill_experience_years with skill '.NET'; 'React Full Stack' => skill_experience_years with skill 'React'; 'Angular Full Stack' => skill_experience_years with skill 'Angular'; 'Ror' => skill_experience_years with skill 'Ruby on Rails'.",
    "For skill_experience_years, choose one exact canonical skill from the supplied configuredSkills list, or unknown if none clearly matches.",
    "Normalize variants such as .Net Fullstack to the configured canonical skill .NET; Ror, RoR, Ruby Rails, Ruby/Rails to Ruby on Rails.",
    "For general experience or non-skill intents, set skill to null.",
    "Never provide an answer value, personal fact, answer path, or intent outside the allowlist.",
    `configuredSkills: ${JSON.stringify(skills)}`
  ].join("\n");

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model || DEFAULT_CONFIG.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: String(question || "") }
        ],
        format: CLASSIFICATION_SCHEMA,
        stream: false,
        think: false,
        options: { temperature: Number(config.temperature) || 0 }
      })
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
    const payload = await response.json();
    const content = payload?.message?.content;
    if (typeof content !== "string") throw new Error("Ollama response did not contain message.content.");
    const classification = JSON.parse(content);
    if (!classification || typeof classification !== "object" || Array.isArray(classification)) {
      throw new Error("Ollama classification was not a JSON object.");
    }
    const confidence = typeof classification.confidence === "number"
      ? classification.confidence
      : typeof classification.confidence === "string" && /^\d+(?:\.\d+)?$/.test(classification.confidence.trim())
        ? Number(classification.confidence)
        : NaN;
    if (typeof classification.intent !== "string"
        || (classification.skill !== null && typeof classification.skill !== "string")
        || !Number.isFinite(confidence)) {
      const shape = Object.fromEntries(Object.entries(classification).map(([key, value]) => [key, value === null ? "null" : Array.isArray(value) ? "array" : typeof value]));
      throw new Error(`Ollama classification did not match the strict semantic schema (field types: ${JSON.stringify(shape)}, confidence value: ${JSON.stringify(classification.confidence)}).`);
    }
    return {
      intent: classification.intent,
      skill: classification.skill,
      confidence
    };
  } finally {
    clearTimeout(timeout);
  }
}

function configuredAnswer(applicationConfig, intent, skill) {
  const answers = applicationConfig.answers || {};
  const notice = answers.noticePeriod || {};
  switch (intent) {
    case "total_experience_years": {
      const value = answers.experience?.totalYears;
      return value === undefined || value === null ? null : { answerSource: "answers.experience.totalYears", answer: value };
    }
    case "skill_experience_years": {
      if (typeof skill !== "string" || !skill.trim()) return null;
      const key = Object.keys(answers.skills || {}).find(candidate =>
        questionMapper.normalizedSkillName(candidate) === questionMapper.normalizedSkillName(skill)
      );
      if (!key) return null;
      const value = answers.skills[key];
      if (value === undefined || value === null || value === "") return null;
      return { answerSource: `answers.skills[${JSON.stringify(key)}]`, answer: value, skill: key };
    }
    case "notice_period_days":
      return notice.days === undefined || notice.days === null || notice.days === ""
        ? null : { answerSource: "answers.noticePeriod.days", answer: notice.days };
    case "notice_period_months":
      return notice.months === undefined || notice.months === null || notice.months === ""
        ? null : { answerSource: "answers.noticePeriod.months", answer: notice.months };
    case "last_working_day":
      return notice.servingNoticePeriod === false || !notice.lastWorkingDay
        ? null : { answerSource: "answers.noticePeriod.lastWorkingDay", answer: notice.lastWorkingDay };
    case "serving_notice_period":
      return typeof notice.servingNoticePeriod !== "boolean"
        ? null
        : {
          answerSource: "answers.noticePeriod.servingNoticePeriod",
          answer: notice.servingNoticePeriod,
          displayValue: notice.servingNoticePeriod ? "Yes" : "No"
        };
    default:
      return null;
  }
}

function mapClassification(classification, applicationConfig, confidenceThreshold = DEFAULT_CONFIG.confidenceThreshold) {
  if (!classification || !ALLOWED_INTENTS.has(classification.intent)
      || classification.intent === "unknown"
      || !Number.isFinite(classification.confidence)
      || classification.confidence < confidenceThreshold
      || classification.confidence > 1) return null;
  if (classification.intent === "total_experience_years" && classification.skill !== null) return null;

  const mapped = configuredAnswer(applicationConfig, classification.intent, classification.skill);
  if (!mapped) return null;
  const isRor = mapped.skill && questionMapper.normalizedSkillName(mapped.skill) === "ruby on rails";
  return {
    status: "RESOLVED",
    intent: classification.intent,
    answerSource: mapped.answerSource,
    answer: mapped.answer,
    ...(mapped.displayValue ? { displayValue: mapped.displayValue } : {}),
    ...(isRor ? { safeTextualAnswer: "NA" } : {}),
    questionType: classification.intent === "skill_experience_years" || classification.intent === "total_experience_years"
      ? "numeric_experience"
      : classification.intent === "serving_notice_period" ? "boolean" : "notice_period",
    confidence: classification.confidence,
    ...(mapped.skill ? { entities: { skill: mapped.skill } } : {})
  };
}

function isSemanticFallbackCandidate(question) {
  return /experience|\byears?\b|skill|full[ -]?stack|notice period|serving notice|last working day|\blwd\b/i.test(String(question || ""));
}

async function resolveSemanticAnswer(question, sources = {}, options = {}) {
  const deterministic = questionMapper.resolveSemanticAnswer(question, sources);
  if (deterministic.status === "RESOLVED") {
    console.log(`Question: ${String(question || "")}`);
    console.log("Resolver: deterministic");
    console.log(`Canonical source: ${deterministic.answerSource || deterministic.answerSources?.join(", ") || "configured semantic mapping"}`);
    if (deterministic.answer !== undefined) console.log(`Resolved answer: ${String(deterministic.answer)}`);
    return deterministic;
  }

  if (questionMapper.sensitiveField(question) || !isSemanticFallbackCandidate(question)) return deterministic;
  const config = options.config || sources.llmConfig || loadConfig();
  if (!config.enabled || config.provider !== "ollama") return deterministic;

  console.log(`Question: ${String(question || "")}`);
  console.log("Deterministic resolver: unresolved");
  console.log(`LLM fallback: Ollama ${config.model || DEFAULT_CONFIG.model}`);
  try {
    const classification = await requestClassification(question, {
      config,
      fetchImpl: options.fetchImpl || globalThis.fetch,
      applicationConfig: sources.applicationConfig
    });
    console.log(`LLM intent: ${String(classification.intent || "unknown")}`);
    console.log(`LLM skill: ${String(classification.skill || "none")}`);
    console.log(`LLM confidence: ${String(classification.confidence)}`);
    const threshold = Number(config.confidenceThreshold) || DEFAULT_CONFIG.confidenceThreshold;
    const resolved = mapClassification(classification, sources.applicationConfig || {}, threshold);
    if (!resolved) return deterministic;
    console.log(`Canonical source: ${resolved.answerSource}`);
    console.log(`Resolved answer: ${String(resolved.displayValue ?? resolved.answer)}`);
    return resolved;
  } catch (error) {
    console.log(`Ollama fallback unavailable; keeping deterministic result: ${error.message}`);
    return deterministic;
  }
}

async function checkOllama(options = {}) {
  const config = options.config || loadConfig();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this Node.js runtime.");
  const baseUrl = String(config.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(config.timeoutMs) || DEFAULT_CONFIG.timeoutMs));
  let tags;
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { method: "GET", signal: controller.signal });
    if (!response.ok) throw new Error(`Ollama tags endpoint returned HTTP ${response.status}.`);
    tags = await response.json();
  } finally {
    clearTimeout(timeout);
  }
  const models = (tags.models || []).map(model => model.name);
  if (!models.includes(config.model || DEFAULT_CONFIG.model)) {
    throw new Error(`Configured Ollama model ${config.model || DEFAULT_CONFIG.model} was not present in /api/tags.`);
  }
  console.log(`Ollama /api/tags reachable; ${config.model || DEFAULT_CONFIG.model} is available.`);
  const question = "How many years of experience do you have in .Net Fullstack?";
  const classification = await requestClassification(question, {
    ...options,
    config,
    fetchImpl,
    applicationConfig: options.applicationConfig || {}
  });
  const result = mapClassification(classification, options.applicationConfig || {}, Number(config.confidenceThreshold) || DEFAULT_CONFIG.confidenceThreshold);
  if (!result || result.answer !== 3 || result.entities?.skill !== ".NET") {
    throw new Error(`Ollama probe was not accepted (intent=${classification.intent}, skill=${String(classification.skill)}, confidence=${classification.confidence}).`);
  }
  return { reachable: true, model: config.model, availableModels: models, question, classification, answer: result.answer };
}

module.exports = {
  DEFAULT_CONFIG,
  checkOllama,
  isSemanticFallbackCandidate,
  loadConfig,
  mapClassification,
  requestClassification,
  resolveSemanticAnswer
};