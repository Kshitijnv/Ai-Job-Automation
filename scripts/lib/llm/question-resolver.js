const fs = require("fs");
const path = require("path");
const questionMapper = require("../question-mapper");

const ROOT = path.resolve(__dirname, "../../..");
const RESUME_PATH = path.join(ROOT, "data", "resume.md");
const APP_CONFIG_PATH = path.join(ROOT, "config", "application.json");
const PROMPT_TEMPLATE_PATH = path.join(ROOT, "config", "llm", "question-resolver.prompt.txt");
const LLM_CONFIG_PATH = path.join(ROOT, "config", "llm.json");

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "qwen3:4b",
  timeoutMs: 60000,
  temperature: 0,
  confidenceThreshold: 0.85
});

let cachedContext = null;

function loadUserContextOnce({ forceReload = false } = {}) {
  if (cachedContext && !forceReload) {
    return cachedContext;
  }

  let resume = "";
  try {
    resume = fs.readFileSync(RESUME_PATH, "utf8");
  } catch (err) {
    resume = "";
  }

  let applicationConfig = {};
  try {
    applicationConfig = JSON.parse(fs.readFileSync(APP_CONFIG_PATH, "utf8"));
  } catch (err) {
    applicationConfig = {};
  }

  let promptTemplate = "";
  try {
    promptTemplate = fs.readFileSync(PROMPT_TEMPLATE_PATH, "utf8");
  } catch (err) {
    promptTemplate = "";
  }

  let llmConfig = { ...DEFAULT_CONFIG };
  try {
    llmConfig = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(LLM_CONFIG_PATH, "utf8")) };
  } catch (err) {
    llmConfig = { ...DEFAULT_CONFIG };
  }

  cachedContext = {
    resume,
    applicationConfig,
    promptTemplate,
    llmConfig,
    loadedAt: new Date().toISOString()
  };

  return cachedContext;
}

function getUserContext() {
  return cachedContext || loadUserContextOnce();
}

function clearUserContextCache() {
  cachedContext = null;
}

function normalizeOptionText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeOptionsList(options = []) {
  if (!Array.isArray(options)) return [];
  return options.map((option, index) => {
    if (typeof option === "string" || typeof option === "number") {
      const label = String(option).trim();
      return { index, label, value: label, normalized: normalizeOptionText(label) };
    }
    const label = String(option?.label || option?.value || option?.text || "").trim();
    const value = String(option?.value || label).trim();
    return { index, label, value, normalized: normalizeOptionText(label) };
  }).filter(opt => opt.label.length > 0);
}

function buildPrompt(template, {
  resume,
  applicationConfig,
  question,
  controlType = "text",
  options = []
}) {
  const normOptions = normalizeOptionsList(options);
  const optionsString = normOptions.length > 0
    ? JSON.stringify(normOptions.map(o => o.label), null, 2)
    : "None";

  const appJsonString = typeof applicationConfig === "string"
    ? applicationConfig
    : JSON.stringify(applicationConfig || {}, null, 2);

  let rendered = String(template || "")
    .replace(/\{\{\s*resume\s*\}\}/gi, resume || "None provided")
    .replace(/\{\{\s*(?:applicationJson|application_json)\s*\}\}/gi, appJsonString)
    .replace(/\{\{\s*question\s*\}\}/gi, String(question || "").trim())
    .replace(/\{\{\s*(?:controlType|control_type)\s*\}\}/gi, String(controlType || "text").trim())
    .replace(/\{\{\s*(?:options|available_options|availableOptions)\s*\}\}/gi, optionsString);

  if (!/CONTROL TYPE/i.test(rendered) && controlType) {
    rendered += `\n\nCONTROL TYPE:\n${controlType}`;
  }

  return rendered;
}

const LOCATION_EQUIVALENT_SETS = [
  new Set(["delhi ncr", "delhi/ncr", "delhincr", "delhi", "ncr", "new delhi", "national capital region"]),
  new Set(["gurugram", "gurgaon"]),
  new Set(["bengaluru", "bangalore"]),
  new Set(["mumbai", "bombay", "navi mumbai"]),
  new Set(["kolkata", "calcutta"]),
  new Set(["chennai", "madras"]),
  new Set(["hyderabad", "secunderabad"]),
  new Set(["remote", "work from home", "wfh", "anywhere", "virtual"])
];

function areLocationsMatching(candidate, option) {
  const normC = normalizeOptionText(candidate);
  const normO = normalizeOptionText(option);
  if (!normC || !normO) return false;
  if (normC === normO) return true;

  const partsC = String(candidate).toLowerCase().split(/[\/,\s]+/).map(p => normalizeOptionText(p)).filter(Boolean);
  const partsO = String(option).toLowerCase().split(/[\/,\s]+/).map(p => normalizeOptionText(p)).filter(Boolean);

  for (const set of LOCATION_EQUIVALENT_SETS) {
    const cMatch = set.has(normC) || partsC.some(p => set.has(p));
    const oMatch = set.has(normO) || partsO.some(p => set.has(p));
    if (cMatch && oMatch) return true;
  }
  return false;
}

function parseNumericRangeOption(label) {
  const text = String(label || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text) return null;
  if (/\bfresher\b/.test(text)) return { min: 0, max: 0, minInclusive: true, maxInclusive: true };

  const lessThan = text.match(/(?:less than|under|<)\s*(\d+(?:\.\d+)?)/);
  if (lessThan) return { min: 0, max: Number(lessThan[1]), minInclusive: true, maxInclusive: false };

  const moreThan = text.match(/(?:more than|over|>)\s*(\d+(?:\.\d+)?)/);
  if (moreThan) return { min: Number(moreThan[1]), max: Number.POSITIVE_INFINITY, minInclusive: false, maxInclusive: false };

  const plus = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*\+/);
  if (plus) return { min: Number(plus[1]), max: Number.POSITIVE_INFINITY, minInclusive: true, maxInclusive: false };

  const range = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(\d+(?:\.\d+)?)(?:\s|$)/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (max < min) return null;
    return { min, max, minInclusive: true, maxInclusive: true };
  }

  return null;
}

function findMatchingOption(candidate, availableOptions = []) {
  if (candidate === undefined || candidate === null) return null;
  const normList = normalizeOptionsList(availableOptions);
  if (!normList.length) return null;

  const targetNorm = normalizeOptionText(candidate);
  if (!targetNorm && typeof candidate !== "number") return null;

  // Exact normalized match
  const exact = normList.find(opt => opt.normalized === targetNorm);
  if (exact) return exact;

  // Boolean true / false conversion
  if (candidate === true || targetNorm === "true" || targetNorm === "yes") {
    const yesMatch = normList.find(opt => opt.normalized === "yes" || opt.normalized === "true" || opt.normalized.startsWith("yes"));
    if (yesMatch) return yesMatch;
  }
  if (candidate === false || targetNorm === "false" || targetNorm === "no") {
    const noMatch = normList.find(opt => opt.normalized === "no" || opt.normalized === "false" || opt.normalized.startsWith("no"));
    if (noMatch) return noMatch;
  }

  // Substring or zero-experience equivalents
  if (candidate === 0 || targetNorm === "no" || targetNorm === "none" || targetNorm === "no experience" || targetNorm === "0" || targetNorm === "false" || targetNorm === "na" || targetNorm === "not applicable" || targetNorm === "0 years") {
    const zeroMatch = normList.find(opt =>
      opt.normalized === "0" ||
      opt.normalized === "no" ||
      opt.normalized === "false" ||
      opt.normalized === "none" ||
      opt.normalized === "fresher" ||
      opt.normalized.includes("no experience") ||
      opt.normalized.includes("0 years") ||
      opt.normalized.includes("0 to") ||
      opt.normalized.includes("0 -") ||
      opt.normalized.includes("0-") ||
      opt.normalized.startsWith("<") ||
      opt.normalized.startsWith("less than") ||
      opt.normalized === "na" ||
      opt.normalized === "not applicable"
    );
    if (zeroMatch) return zeroMatch;
  }

  // Numeric range matching (e.g. candidate 3 -> "1-3 years" or "3 to 5 years" or "1 to 5 yrs")
  const numCandidate = typeof candidate === "number" ? candidate : Number(targetNorm);
  if (Number.isFinite(numCandidate)) {
    const rangeMatches = normList.map(opt => {
      const range = parseNumericRangeOption(opt.label);
      if (!range) return null;
      const aboveMin = range.minInclusive ? numCandidate >= range.min : numCandidate > range.min;
      const belowMax = range.maxInclusive ? numCandidate <= range.max : numCandidate < range.max;
      return aboveMin && belowMax ? opt : null;
    }).filter(Boolean);

    if (rangeMatches.length === 1) return rangeMatches[0];
    if (rangeMatches.length > 1) {
      // Pick the most specific range or first match
      return rangeMatches[0];
    }
  }

  // Location equivalence matching
  const locMatch = normList.find(opt => areLocationsMatching(candidate, opt.label));
  if (locMatch) return locMatch;

  // Prefix or contains match
  const partial = normList.find(opt => opt.normalized.includes(targetNorm) || targetNorm.includes(opt.normalized));
  if (partial) return partial;

  return null;
}

function validateAnswerAgainstControl(rawAnswer, controlType = "text", availableOptions = [], { isPreferenceList = false } = {}) {
  const normType = String(controlType || "text").toLowerCase().trim();
  const optionsList = normalizeOptionsList(availableOptions);

  // Single-select / Radio / Dropdown
  if (normType === "radio" || normType === "radio_group" || normType === "select" || normType === "dropdown" || normType === "button_options" || normType === "custom_combobox") {
    if (!optionsList.length) {
      const answerVal = Array.isArray(rawAnswer) ? rawAnswer[0] : rawAnswer;
      return { valid: true, answer: answerVal };
    }
    // If rawAnswer is an array (e.g. priority list of locations: ["Remote", "Pune", "Gurugram", "Noida", "Delhi/NCR"])
    if (Array.isArray(rawAnswer)) {
      for (const candidate of rawAnswer) {
        const matched = findMatchingOption(candidate, optionsList);
        if (matched) {
          return { valid: true, answer: matched.label, index: matched.index, matchedOption: matched };
        }
      }
      return {
        valid: false,
        reason: `None of the configured preferences [${rawAnswer.join(", ")}] match available options: [${optionsList.map(o => o.label).join(", ")}]`
      };
    }
    const matched = findMatchingOption(rawAnswer, optionsList);
    if (matched) {
      return { valid: true, answer: matched.label, index: matched.index, matchedOption: matched };
    }
    return {
      valid: false,
      reason: `Answer "${rawAnswer}" is not among available options: [${optionsList.map(o => o.label).join(", ")}]`
    };
  }

  // Multi-select / Checkbox
  if (normType === "checkbox" || normType === "checkbox_group" || normType === "multiselect") {
    if (!optionsList.length) {
      return { valid: true, answer: rawAnswer };
    }
    const items = Array.isArray(rawAnswer)
      ? rawAnswer
      : String(rawAnswer || "").split(/\s*,\s*/).filter(Boolean);

    if (!items.length) {
      return { valid: false, reason: "Checkbox answer is empty." };
    }

    const matchedLabels = [];
    const matchedIndices = [];
    const unmatchedItems = [];

    for (const item of items) {
      const matched = findMatchingOption(item, optionsList);
      if (matched) {
        if (!matchedLabels.includes(matched.label)) {
          matchedLabels.push(matched.label);
          matchedIndices.push(matched.index);
        }
      } else {
        unmatchedItems.push(item);
      }
    }

    if (!isPreferenceList && unmatchedItems.length > 0) {
      return {
        valid: false,
        reason: `Answer contains invalid option(s) not present in form: [${unmatchedItems.join(", ")}]. Available options: [${optionsList.map(o => o.label).join(", ")}]`
      };
    }

    if (matchedLabels.length > 0) {
      return { valid: true, answer: matchedLabels, indices: matchedIndices };
    }

    return {
      valid: false,
      reason: `None of the options in "${Array.isArray(rawAnswer) ? rawAnswer.join(", ") : rawAnswer}" match available options: [${optionsList.map(o => o.label).join(", ")}]`
    };
  }

  // Number / Numeric
  if (normType === "number" || normType === "numeric") {
    const num = typeof rawAnswer === "number" ? rawAnswer : Number(String(rawAnswer).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(num)) {
      return { valid: true, answer: num };
    }
    return { valid: false, reason: `Answer "${rawAnswer}" could not be parsed as a numeric value.` };
  }

  // Free-text / Textarea
  if (normType === "text" || normType === "textarea" || normType === "contenteditable" || normType === "text_input") {
    const textAnswer = typeof rawAnswer === "string"
      ? rawAnswer.trim()
      : Array.isArray(rawAnswer) ? rawAnswer.join(", ") : String(rawAnswer ?? "").trim();
    if (textAnswer.length > 0) {
      return { valid: true, answer: textAnswer };
    }
    return { valid: false, reason: "Text answer is empty." };
  }

  // Default fallback
  return { valid: true, answer: rawAnswer };
}

function resolveDeterministicAnswer(question, applicationConfig = {}, profile = {}) {
  const text = String(question || "").replace(/\s+/g, " ").trim();
  if (!text) return { resolved: false };

  const semantic = questionMapper.resolveSemanticAnswer(text, { applicationConfig, profile, question: text });
  if (semantic && semantic.status === "RESOLVED") {
    if (semantic.intent === "notice_period_with_lwd") {
      const noticePeriodDays = Number(semantic.values?.noticePeriodDays);
      const lastWorkingDay = String(semantic.values?.lastWorkingDay || "").trim();
      if (Number.isFinite(noticePeriodDays) && lastWorkingDay) {
        return {
          resolved: true,
          answer: `${noticePeriodDays} days, LWD: ${lastWorkingDay}`,
          semantic,
          source: "deterministic"
        };
      }
    }
    if (Array.isArray(semantic.answer)) {
      return { resolved: true, answer: semantic.answer, semantic, source: "deterministic" };
    }
    if (typeof semantic.answer === "number") {
      return { resolved: true, answer: semantic.answer, semantic, source: "deterministic" };
    }
    if (semantic.displayValue !== undefined && semantic.displayValue !== null && semantic.displayValue !== "") {
      return { resolved: true, answer: semantic.displayValue, semantic, source: "deterministic" };
    }
    if (semantic.answer !== undefined && semantic.answer !== null && semantic.answer !== "") {
      return { resolved: true, answer: semantic.answer, semantic, source: "deterministic" };
    }
  }

  const canonical = questionMapper.canonicalQuestion(text, { experienceYearsRule: true });
  if (canonical) {
    const answer = questionMapper.resolveConfiguredAnswer(canonical, {
      applicationConfig,
      profile,
      question: text,
      experienceYearsRule: true
    });
    if (answer !== undefined && answer !== null && answer !== "") {
      return { resolved: true, answer, canonical, source: "deterministic" };
    }
  }

  return { resolved: false };
}

async function callQwen(prompt, {
  config = DEFAULT_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = String(config.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, "");
  const endpoint = `${baseUrl}/api/chat`;
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(config.timeoutMs) || DEFAULT_CONFIG.timeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model || DEFAULT_CONFIG.model,
        messages: [
          { role: "user", content: prompt }
        ],
        format: "json",
        stream: false,
        options: { temperature: Number(config.temperature) || 0 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Ollama response did not contain message.content");
    }

    const parsed = JSON.parse(content);
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveQuestion({
  question,
  controlType = "text",
  options = [],
  applicationConfig,
  profile,
  resume,
  promptTemplate,
  llmConfig,
  fetchImpl,
  skipDeterministic = false
} = {}) {
  const context = getUserContext();
  const activeAppConfig = applicationConfig || context.applicationConfig;
  const activeProfile = profile || {};
  const activeResume = resume !== undefined ? resume : context.resume;
  const activeTemplate = promptTemplate || context.promptTemplate;
  const activeLlmConfig = llmConfig || context.llmConfig;
  const activeFetch = fetchImpl || globalThis.fetch;

  // Step 1: Deterministic resolution first (if not explicitly skipped)
  if (!skipDeterministic) {
    const deterministic = resolveDeterministicAnswer(question, activeAppConfig, activeProfile);
    if (deterministic.resolved && deterministic.answer !== undefined && deterministic.answer !== null && deterministic.answer !== "") {
      const validation = validateAnswerAgainstControl(deterministic.answer, controlType, options, { isPreferenceList: Array.isArray(deterministic.answer) });
      if (validation.valid) {
        return {
          status: "RESOLVED",
          source: "deterministic",
          answer: validation.answer,
          confidence: 1.0,
          details: deterministic
        };
      }
    }
  }

  // Step 2: Qwen LLM Fallback (Single question invocation)
  if (!activeLlmConfig.enabled) {
    return {
      status: "NEEDS_USER_INPUT",
      reason: "LLM resolution is disabled and deterministic answer is unavailable."
    };
  }

  const prompt = buildPrompt(activeTemplate, {
    resume: activeResume,
    applicationConfig: activeAppConfig,
    question,
    controlType,
    options
  });

  let llmResponse;
  try {
    llmResponse = await callQwen(prompt, {
      config: activeLlmConfig,
      fetchImpl: activeFetch
    });
  } catch (error) {
    return {
      status: "NEEDS_USER_INPUT",
      reason: `LLM call failed: ${error.message}`
    };
  }

  if (!llmResponse || typeof llmResponse !== "object") {
    return {
      status: "NEEDS_USER_INPUT",
      reason: "LLM response was not a valid JSON object."
    };
  }

  const rawAnswer = llmResponse.answer;
  const confidence = typeof llmResponse.confidence === "number"
    ? llmResponse.confidence
    : typeof llmResponse.confidence === "string" && /^\d+(?:\.\d+)?$/.test(llmResponse.confidence.trim())
      ? Number(llmResponse.confidence)
      : 0.95;

  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === "") {
    return {
      status: "NEEDS_USER_INPUT",
      reason: "LLM did not provide an answer value."
    };
  }

  // Step 3: Validate LLM answer against control type and available options
  const validation = validateAnswerAgainstControl(rawAnswer, controlType, options);
  if (!validation.valid) {
    return {
      status: "NEEDS_USER_INPUT",
      reason: validation.reason || `LLM answer "${rawAnswer}" is invalid for ${controlType} control.`,
      rawLlmResponse: llmResponse
    };
  }

  return {
    status: "RESOLVED",
    source: "llm",
    answer: validation.answer,
    confidence,
    rawLlmResponse: llmResponse,
    validation
  };
}

module.exports = {
  loadUserContextOnce,
  getUserContext,
  clearUserContextCache,
  normalizeOptionText,
  normalizeOptionsList,
  findMatchingOption,
  buildPrompt,
  validateAnswerAgainstControl,
  resolveDeterministicAnswer,
  callQwen,
  resolveQuestion
};
