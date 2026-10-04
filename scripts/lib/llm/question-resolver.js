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

function findMatchingOption(candidate, availableOptions = []) {
  if (candidate === undefined || candidate === null) return null;
  const normList = normalizeOptionsList(availableOptions);
  if (!normList.length) return null;

  const targetNorm = normalizeOptionText(candidate);
  if (!targetNorm) return null;

  // Exact normalized match
  const exact = normList.find(opt => opt.normalized === targetNorm);
  if (exact) return exact;

  // Substring or zero-experience equivalents
  if (targetNorm === "no" || targetNorm === "none" || targetNorm === "no experience" || targetNorm === "0" || targetNorm === "na" || targetNorm === "not applicable") {
    const zeroMatch = normList.find(opt =>
      opt.normalized.includes("no experience") ||
      opt.normalized.includes("0 years") ||
      opt.normalized === "0" ||
      opt.normalized === "na" ||
      opt.normalized === "not applicable" ||
      opt.normalized.startsWith("<") ||
      opt.normalized.startsWith("less than")
    );
    if (zeroMatch) return zeroMatch;
  }

  // Prefix or contains match
  const partial = normList.find(opt => opt.normalized.includes(targetNorm) || targetNorm.includes(opt.normalized));
  if (partial) return partial;

  return null;
}

function validateAnswerAgainstControl(rawAnswer, controlType = "text", availableOptions = []) {
  const normType = String(controlType || "text").toLowerCase().trim();
  const optionsList = normalizeOptionsList(availableOptions);

  // Single-select / Radio / Dropdown
  if (normType === "radio" || normType === "radio_group" || normType === "select" || normType === "dropdown" || normType === "button_options" || normType === "custom_combobox") {
    if (!optionsList.length) {
      return { valid: true, answer: rawAnswer };
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

    for (const item of items) {
      const matched = findMatchingOption(item, optionsList);
      if (!matched) {
        return {
          valid: false,
          reason: `Checkbox option "${item}" does not exist in available options: [${optionsList.map(o => o.label).join(", ")}]`
        };
      }
      matchedLabels.push(matched.label);
      matchedIndices.push(matched.index);
    }

    return { valid: true, answer: matchedLabels, indices: matchedIndices };
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
    if (semantic.safeTextualAnswer) {
      return { resolved: true, answer: semantic.safeTextualAnswer, semantic, source: "deterministic" };
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
      const validation = validateAnswerAgainstControl(deterministic.answer, controlType, options);
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
