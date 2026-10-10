const assert = require("assert");
const applicationConfig = require("../../config/application.json");
const llmConfig = require("../../config/llm.json");
const questionMapper = require("../lib/question-mapper");
const semanticResolver = require("../lib/semantic-resolver");
const naukriAgent = require("../naukri/naukri-agent");

function ollamaMock(classification) {
  let calls = 0;
  const fetchImpl = async (url, request) => {
    calls += 1;
    assert.strictEqual(url, "http://localhost:11434/api/chat");
    assert.strictEqual(request.method, "POST");
    assert.strictEqual(request.signal instanceof AbortSignal, true);
    const body = JSON.parse(request.body);
    assert.strictEqual(body.model, "qwen3:4b");
    assert.strictEqual(body.stream, false);
    assert.strictEqual(typeof body.format, "object");
    assert.strictEqual(body.format.properties.confidence.type, "number");
    assert.strictEqual(body.format.additionalProperties, false);
    assert.strictEqual(body.options.temperature, 0);
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: typeof classification === "string" ? classification : JSON.stringify(classification) } })
    };
  };
  return { fetchImpl, get calls() { return calls; } };
}

async function resolveQuietly(question, mock, config = llmConfig) {
  const log = console.log;
  console.log = () => {};
  try {
    return await semanticResolver.resolveSemanticAnswer(question, { applicationConfig }, {
      config,
      fetchImpl: mock?.fetchImpl
    });
  } finally {
    console.log = log;
  }
}

function classification(intent, skill = null, confidence = 0.98) {
  return { intent, skill, confidence };
}

async function main() {
  assert.deepStrictEqual(llmConfig, {
    enabled: true,
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "qwen3:4b",
    timeoutMs: llmConfig.timeoutMs,
    temperature: 0,
    confidenceThreshold: 0.85
  });

  for (const [question, skill] of [
    ["How many years of experience do you have in .Net Fullstack?", ".NET"],
    [".NET Full Stack Developer experience?", ".NET"]
  ]) {
    const mock = ollamaMock(classification("skill_experience_years", skill));
    const result = await resolveQuietly(question, mock);
    assert.strictEqual(result.status, "RESOLVED");
    assert.strictEqual(result.answer, 3);
    assert.strictEqual(result.answerSource, 'answers.skills (.NET)');
    assert.strictEqual(mock.calls, 0, "Deterministic normalization resolves .Net Fullstack without Ollama");
  }

  const naukriDotnetMock = ollamaMock(classification("skill_experience_years", ".NET"));
  const naukriDotnetAnswer = await naukriAgent.resolveNaukriAnswer(
    "How many years of experience do you have in .Net Fullstack?",
    applicationConfig,
    {},
    { config: llmConfig, fetchImpl: naukriDotnetMock.fetchImpl }
  );
  assert.strictEqual(naukriDotnetAnswer, 3);
  assert.strictEqual(naukriDotnetMock.calls, 0);

  for (const [question, expected] of [
    ["How many years have you worked with Angular?", 3],
    ["How many years of experience do you have with Laravel?", 0],
    ["How many years of experience do you have?", 3],
    ["What is your notice period in days?", 90]
  ]) {
    const mock = ollamaMock(classification("unknown", null, 0.2));
    const result = await resolveQuietly(question, mock);
    assert.strictEqual(result.status, "RESOLVED");
    assert.strictEqual(result.answer, expected);
    assert.strictEqual(mock.calls, 0, `Expected deterministic resolution without Ollama: ${question}`);
  }

  const compound = await naukriAgent.resolveNaukriAnswer(
    "Notice period (please mention LWD if serving/ served)",
    applicationConfig,
    {}
  );
  assert.strictEqual(compound, "90 days, LWD: 20 October 2026");

  for (const [question, skill] of [
    ["How many years of experience do you have in AWS/Azure/GCP?", "AWS"],
    ["How many years of experience in open source technologies (mention tech stack)", "Open Source"],
    ["How many years of experience do you have in React Full Stack?", "React"],
    ["How many years of experience do you have in Angular Full Stack?", "Angular"],
    ["How many years of experience in CI/CD and Kubernetes?", "Kubernetes"],
    ["How many years of experience in Machine Learning and MLOps?", "Machine Learning"],
    ["How many years of experience do you have in Ror?", "Ruby on Rails"]
  ]) {
    const mock = ollamaMock(classification("skill_experience_years", skill));
    const result = await resolveQuietly(question, mock);
    assert.strictEqual(result.status, "RESOLVED", `Expected configured zero answer for ${question}`);
    assert.strictEqual(result.answer, applicationConfig.answers.skills[skill] ?? 0);
  }

  const rorNaukriAnswer = await naukriAgent.resolveNaukriAnswer(
    "How many years of experience do you have in Ror?",
    applicationConfig,
    {}
  );
  assert.strictEqual(rorNaukriAnswer, 0);

  const unknownMock = ollamaMock(classification("unknown", null, 0.2));
  const unknown = await resolveQuietly("How many years of experience in an unfamiliar stack?", unknownMock);
  assert.strictEqual(unknown.status, "NEEDS_USER_INPUT");
  assert.strictEqual(unknownMock.calls, 1);

  const unconfiguredMock = ollamaMock(classification("skill_experience_years", "Rust"));
  const unconfigured = await resolveQuietly("How many years of experience in an unfamiliar stack?", unconfiguredMock);
  assert.strictEqual(unconfigured.status, "NEEDS_USER_INPUT");

  const lowConfidenceMock = ollamaMock(classification("skill_experience_years", ".NET", 0.6));
  const lowConfidence = await resolveQuietly("How many years of experience in an unfamiliar stack?", lowConfidenceMock);
  assert.strictEqual(lowConfidence.status, "NEEDS_USER_INPUT");

  const malformedMock = ollamaMock("not valid json");
  const malformed = await resolveQuietly("How many years of experience in an unfamiliar stack?", malformedMock);
  assert.strictEqual(malformed.status, "NEEDS_USER_INPUT");

  const unavailable = await resolveQuietly("How many years of experience in an unfamiliar stack?", {
    fetchImpl: async () => { throw new Error("connection refused"); }
  });
  assert.strictEqual(unavailable.status, "NEEDS_USER_INPUT");
  const unavailableNaukriAnswer = await naukriAgent.resolveNaukriAnswer(
    "How many years of experience in an unfamiliar stack?",
    applicationConfig,
    {},
    { config: llmConfig, fetchImpl: async () => { throw new Error("connection refused"); } }
  );
  assert.strictEqual(unavailableNaukriAnswer, undefined);

  const timeoutResult = await resolveQuietly("How many years of experience in an unfamiliar stack?", {
    fetchImpl: async (url, request) => new Promise((resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(new Error("request timed out")), { once: true });
    })
  }, { ...llmConfig, timeoutMs: 5 });
  assert.strictEqual(timeoutResult.status, "NEEDS_USER_INPUT");

  const unsafeIntent = semanticResolver.mapClassification({
    intent: "arbitrary_path",
    path: "answers.salary.expectedCTC",
    confidence: 1
  }, applicationConfig);
  assert.strictEqual(unsafeIntent, null);

  const extraFieldMock = ollamaMock({
    intent: "skill_experience_years",
    skill: ".NET",
    confidence: 0.98,
    answer: 99,
    path: "answers.experience.totalYears"
  });
  const extraField = await resolveQuietly("How many years of experience in an unfamiliar stack?", extraFieldMock);
  assert.strictEqual(extraField.status, "RESOLVED");
  assert.strictEqual(extraField.answer, 3);
  assert.strictEqual(extraField.answerSource, 'answers.skills[".NET"]');

  let connectivityCalls = 0;
  const connectivity = await semanticResolver.checkOllama({
    config: llmConfig,
    applicationConfig,
    fetchImpl: async (url, request) => {
      connectivityCalls += 1;
      if (request.method === "GET") {
        assert.strictEqual(url, "http://localhost:11434/api/tags");
        return { ok: true, status: 200, json: async () => ({ models: [{ name: "qwen3:4b" }] }) };
      }
      const body = JSON.parse(request.body);
      assert.strictEqual(url, "http://localhost:11434/api/chat");
      assert.strictEqual(body.model, "qwen3:4b");
      assert.strictEqual(body.stream, false);
      assert.strictEqual(body.messages[1].content, "How many years of experience do you have in .Net Fullstack?");
      return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(classification("skill_experience_years", ".NET", 0.98)) } }) };
    }
  });
  assert.strictEqual(connectivity.reachable, true);
  assert.deepStrictEqual(connectivity.availableModels, ["qwen3:4b"]);
  assert.strictEqual(connectivity.answer, 3);
  assert.strictEqual(connectivityCalls, 2);

  const direct = questionMapper.resolveSemanticAnswer("How many years of experience do you have?", { applicationConfig });
  assert.strictEqual(direct.answer, 3);
  console.log("Semantic resolver tests passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});