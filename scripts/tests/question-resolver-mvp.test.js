const assert = require("assert");
const fs = require("fs");
const path = require("path");
const questionResolver = require("../lib/llm/question-resolver");

async function runTests() {
  console.log("Running question-resolver-mvp tests...\n");

  const appConfig = {
    experienceYears: 6,
    answers: {
      experience: {
        totalYears: 6
      },
      contact: {
        currentLocation: "Pune",
        preferredLocation: "Pune",
        location: "Pune"
      },
      noticePeriod: {
        days: 30,
        servingNoticePeriod: true,
        lastWorkingDay: "2026-04-30"
      },
      workPreferences: {
        willingToRelocate: true,
        locations: ["Remote", "Pune", "Gurugram", "Noida", "Delhi/NCR"]
      },
      salary: {
        currentCTC: 18,
        expectedCTC: 25,
        currency: "INR"
      },
      skills: {
        "Angular": 5,
        "Node.js": 5,
        "TypeScript": 4,
        "C#": 6,
        ".NET Core": 6
      }
    }
  };

  const resume = "# John Doe\nExperienced Full Stack Engineer with 6 years in Angular, .NET Core, Node.js.";
  const promptTemplate = "SYSTEM PROMPT\nRESUME:\n{{resume}}\nAPP:\n{{application_json}}\nQUESTION:\n{{question}}\nOPTIONS:\n{{options}}";
  const llmConfig = {
    enabled: true,
    baseUrl: "http://localhost:11434",
    model: "qwen3:4b",
    timeoutMs: 5000,
    temperature: 0
  };

  let qwenCallCount = 0;
  let lastPrompt = "";

  const mockFetch = (responseJson, isError = false) => {
    return async (url, options) => {
      qwenCallCount += 1;
      const body = JSON.parse(options.body);
      lastPrompt = body.messages[0].content;

      if (isError) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Internal Server Error" })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: typeof responseJson === "string" ? responseJson : JSON.stringify(responseJson)
          }
        })
      };
    };
  };

  // Test 1: Deterministic answer (Notice period) -> Qwen is NOT called
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "Notice period in days",
      controlType: "numeric",
      options: [],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "99" })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "deterministic");
    assert.strictEqual(res.answer, 30);
    assert.strictEqual(qwenCallCount, 0, "Qwen must NOT be called for deterministic questions");
    console.log("✓ Test 1 Passed: Deterministic question resolved without calling Qwen.");
  }

  // Test 2: Unknown experience subject ("Opcenter Developer") with "No experience" radio option -> Qwen selects "No experience"
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "How many years of experience do you have as an Opcenter Developer?",
      controlType: "radio_group",
      options: [
        { label: "No experience", value: "0" },
        { label: "1-2 years", value: "1-2" },
        { label: "3+ years", value: "3+" }
      ],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "No experience", confidence: 0.98 })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "llm");
    assert.strictEqual(res.answer, "No experience");
    assert.strictEqual(qwenCallCount, 1, "Qwen must be called exactly once");
    console.log("✓ Test 2 Passed: Unknown experience subject with 'No experience' radio option handled.");
  }

  // Test 3: Supported skill (Angular) -> deterministic answer used
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "How many years of experience do you have in Angular?",
      controlType: "numeric",
      options: [],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "99" })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "deterministic");
    assert.strictEqual(res.answer, 5);
    assert.strictEqual(qwenCallCount, 0, "Qwen must NOT be called for supported skill");
    console.log("✓ Test 3 Passed: Supported skill (Angular) uses deterministic answer.");
  }

  // Test 4: Unsupported skill with radio options -> Qwen chooses zero-equivalent option
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "What level of proficiency do you have in COBOL Mainframe Systems?",
      controlType: "radio_group",
      options: [
        { label: "No experience", value: "0" },
        { label: "Intermediate", value: "intermediate" },
        { label: "Expert", value: "expert" }
      ],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "No experience", confidence: 0.99 })
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "llm");
    assert.strictEqual(res.answer, "No experience");
    assert.strictEqual(qwenCallCount, 1);
    console.log("✓ Test 4 Passed: Unsupported skill with radio options chooses zero-equivalent option.");
  }

  // Test 5: Checkbox: Qwen returns array with all valid options -> validation succeeds
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "Which languages/frameworks have you worked with?",
      controlType: "checkbox_group",
      options: [
        { label: "Angular", value: "Angular" },
        { label: "Node.js", value: "Node.js" },
        { label: "Ruby on Rails", value: "Ruby on Rails" },
        { label: "Python", value: "Python" }
      ],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: ["Angular", "Node.js"], confidence: 0.95 }),
      skipDeterministic: true
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "llm");
    assert.deepStrictEqual(res.answer, ["Angular", "Node.js"]);
    assert.strictEqual(qwenCallCount, 1);
    console.log("✓ Test 5 Passed: Multi-select checkbox validation succeeds for valid options.");
  }

  // Test 6: Checkbox containing an invalid option -> NEEDS_USER_INPUT
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "Which tools are you certified in?",
      controlType: "checkbox_group",
      options: [
        { label: "AWS Certified", value: "AWS" },
        { label: "Azure Certified", value: "Azure" }
      ],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: ["AWS Certified", "GCP Certified"], confidence: 0.9 }),
      skipDeterministic: true
    });

    assert.strictEqual(res.status, "NEEDS_USER_INPUT");
    assert.strictEqual(res.source, undefined);
    assert.ok(res.reason.includes("GCP Certified"));
    console.log("✓ Test 6 Passed: Checkbox with invalid option returns NEEDS_USER_INPUT.");
  }

  // Test 7: Radio containing an invalid option -> NEEDS_USER_INPUT
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "What is your highest education level?",
      controlType: "radio_group",
      options: [
        { label: "Bachelor's Degree", value: "Bachelors" },
        { label: "Master's Degree", value: "Masters" }
      ],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "Doctorate / Ph.D", confidence: 0.9 }),
      skipDeterministic: true
    });

    assert.strictEqual(res.status, "NEEDS_USER_INPUT");
    assert.ok(res.reason.includes("Doctorate / Ph.D"));
    console.log("✓ Test 7 Passed: Radio with invalid option returns NEEDS_USER_INPUT.");
  }

  // Test 8: Free-text answer -> fills text
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "Briefly describe your most challenging project architecture.",
      controlType: "textarea",
      options: [],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: "Designed a high-throughput microservices architecture with Kafka and .NET Core.", confidence: 0.9 }),
      skipDeterministic: true
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "llm");
    assert.strictEqual(res.answer, "Designed a high-throughput microservices architecture with Kafka and .NET Core.");
    console.log("✓ Test 8 Passed: Free-text textarea question resolved.");
  }

  // Test 9: Numeric answer -> numeric validation succeeds
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "How many engineers did you manage or mentor?",
      controlType: "number",
      options: [],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch({ answer: 4, confidence: 0.92 }),
      skipDeterministic: true
    });

    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(res.source, "llm");
    assert.strictEqual(res.answer, 4);
    console.log("✓ Test 9 Passed: Numeric answer validation succeeds.");
  }

  // Test 10: Invalid/non-JSON Qwen response -> NEEDS_USER_INPUT
  {
    qwenCallCount = 0;
    const res = await questionResolver.resolveQuestion({
      question: "Custom unrecognized prompt?",
      controlType: "text",
      options: [],
      applicationConfig: appConfig,
      resume,
      promptTemplate,
      llmConfig,
      fetchImpl: mockFetch("This is not valid JSON string at all")
    });

    assert.strictEqual(res.status, "NEEDS_USER_INPUT");
    assert.ok(res.reason.includes("LLM response was not a valid JSON object") || res.reason.includes("Unexpected token"));
    console.log("✓ Test 10 Passed: Non-JSON response gracefully returns NEEDS_USER_INPUT.");
  }

  // Test 11: Context loaded once at startup -> verified no repeated disk reads
  {
    questionResolver.clearUserContextCache();
    let readCount = 0;
    const origReadFileSync = fs.readFileSync;
    fs.readFileSync = (...args) => {
      readCount += 1;
      return origReadFileSync(...args);
    };

    try {
      // First call loads context from disk
      const ctx1 = questionResolver.loadUserContextOnce();
      const readsAfterFirst = readCount;
      assert.ok(readsAfterFirst > 0, "Should have performed disk reads on first load");

      // Second call returns cached context
      const ctx2 = questionResolver.loadUserContextOnce();
      assert.strictEqual(readCount, readsAfterFirst, "No additional disk reads should occur");
      assert.strictEqual(ctx1, ctx2, "Cached context object reference should match");

      const ctx3 = questionResolver.getUserContext();
      assert.strictEqual(readCount, readsAfterFirst, "getUserContext should not read from disk");
      assert.strictEqual(ctx1, ctx3);
      console.log("✓ Test 11 Passed: Context loaded once at startup with caching verified.");
    } finally {
      fs.readFileSync = origReadFileSync;
    }
  }

  // Test 12: Multiple sequential questions -> separate Qwen call per unresolved question (no batching)
  {
    qwenCallCount = 0;
    const sequentialQuestions = [
      { q: "What is your primary reason for seeking a job change at this stage?", control: "radio_group", opts: [{ label: "Career Growth", value: "growth" }, { label: "Relocation", value: "relocation" }], expectedAnswer: "Career Growth" },
      { q: "Current salary in Lakhs?", control: "number", opts: [], expectedAnswer: 18 }, // deterministic from appConfig
      { q: "Which software development methodology do you prefer working in?", control: "radio_group", opts: [{ label: "Agile / Scrum", value: "agile" }, { label: "Waterfall", value: "waterfall" }], expectedAnswer: "Agile / Scrum" }
    ];

    const results = [];
    for (const item of sequentialQuestions) {
      const res = await questionResolver.resolveQuestion({
        question: item.q,
        controlType: item.control,
        options: item.opts,
        applicationConfig: appConfig,
        resume,
        promptTemplate,
        llmConfig,
        fetchImpl: mockFetch({ answer: item.expectedAnswer, confidence: 0.95 })
      });
      results.push(res);
    }

    assert.strictEqual(results[0].status, "RESOLVED");
    assert.strictEqual(results[0].source, "llm");
    assert.strictEqual(results[0].answer, "Career Growth");

    assert.strictEqual(results[1].status, "RESOLVED");
    assert.strictEqual(results[1].source, "deterministic");
    assert.strictEqual(results[1].answer, 18);

    assert.strictEqual(results[2].status, "RESOLVED");
    assert.strictEqual(results[2].source, "llm");
    assert.strictEqual(results[2].answer, "Agile / Scrum");

    // Exactly 2 Qwen calls for the 2 non-deterministic questions, sequentially!
    assert.strictEqual(qwenCallCount, 2, "Exactly 2 individual Qwen calls must be made for 2 unresolved questions");
    console.log("✓ Test 12 Passed: Multiple sequential questions handled 1-by-1 with individual Qwen calls.");
  }

  console.log("\nAll 12 question-resolver-mvp tests passed successfully!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
