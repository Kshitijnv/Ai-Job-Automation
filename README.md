# AI Job Search Automation — LinkedIn & Naukri

A local-first job-search and application automation MVP built with **Node.js, Playwright, Microsoft Edge, and Ollama/Qwen**.

The project currently combines two workflows:

- **LinkedIn job discovery pipeline** — search, filter, rank, process JDs, generate tailored resumes, and automate LinkedIn Easy Apply where supported.
- **Naukri application automation** — process jobs from Naukri's recommendation sections one job at a time, answer application questions, and maintain persistent application history.

> **Status: MVP working**
>
> The current MVP has been tested against the real Naukri UI and LinkedIn Easy Apply flow. It is designed for local/personal use and intentionally stops when authentication, security verification, CAPTCHA, or genuinely unresolved application questions require human intervention.

---

## Features

### LinkedIn

- Search jobs across configured roles and locations.
- Filter jobs by posting age.
- Deduplicate jobs by LinkedIn Job ID.
- Fit scoring and `Apply / Review / Maybe / Skip` classification.
- JD processing and storage.
- Tailored resume generation.
- LinkedIn Easy Apply automation.
- Reuse the user's logged-in Microsoft Edge automation profile.
- Persistent handling of manual/uncertain applications.
- Application-question mapping and semantic answer support.

### Naukri

- Process the following recommendation sections:

  1. `Applies`
  2. `Profile`
  3. `Preferences`
  4. `You might like`

- Process **one job at a time**.
- Re-scan the live Naukri page after each application.
- Skip jobs without a selectable Naukri checkbox without opening them.
- Persist application history by Naukri Job ID.
- Permanently exclude jobs already marked:
  - `APPLIED`
  - `SKIPPED_NO_CHECKBOX`
  - `SKIPPED_EXTERNAL`
- Re-process non-terminal states such as:
  - `NEEDS_USER_INPUT`
  - `FAILED`
  - `UNVERIFIED`
  - `SKIPPED_UNKNOWN_ROUTE`
- Handle Naukri recruiter/chatbot application questions.
- Use deterministic answers from `config/application.json` first.
- Fall back to local **Qwen 3 4B through Ollama** when the deterministic resolver cannot safely answer.
- Pass the actual question and available UI options to Qwen.
- Validate Qwen answers against radio/select/checkbox options before Playwright interacts with the UI.
- Use a small stabilization wait after confirmed application completion before continuing.

---

# Architecture

The application-question resolver follows this architecture:

```text
                    Application Question
                            |
                            v
                    application.json
                            |
                  deterministic answer?
                       /          \
                     YES           NO
                      |             |
                      v             v
                 Playwright       Qwen
                                   |
                    +--------------+--------------+
                    |              |              |
                 resume.md    application.json   question
                                                   +
                                             UI options
                                   |
                                   v
                              LLM answer
                                   |
                                   v
                                validate
                                   |
                         +---------+---------+
                         |                   |
                       valid               invalid
                         |                   |
                         v                   v
                    Playwright        NEEDS_USER_INPUT
```

### Source of truth

`config/application.json` contains user-specific facts such as:

- experience
- location
- notice period
- salary
- relocation preferences
- skills
- education
- employment information
- work preferences

`data/resume.md` provides supporting professional context.

The application resolver loads these files **once at startup** and keeps them in memory. They are reused for each sequential Qwen request.

### Qwen

Qwen is used only when the deterministic application configuration cannot safely answer the current question.

The prompt template is:

```text
config/llm/question-resolver.prompt.txt
```

The current local configuration is:

```json
{
  "provider": "ollama",
  "model": "qwen3:4b",
  "temperature": 0
}
```

Qwen receives:

- resume
- application source of truth
- current question
- control type
- available options

Naukri presents questions sequentially, so Qwen is called **one question at a time** rather than attempting to batch an entire application.

---

# Technology Stack

| Component | Technology |
|---|---|
| Runtime | Node.js |
| Browser automation | Playwright |
| Browser | Microsoft Edge |
| Naukri automation | Playwright |
| LinkedIn automation | Playwright |
| Local LLM | Ollama |
| LLM model | Qwen 3 4B |
| Configuration | JSON |
| Resume/context | Markdown |
| Application history | JSON |
| Dashboard | HTML + CSS |
| OS | Windows |

---

# Project Structure

```text
.
├── .codex/
│   ├── CODING_STANDARDS.md
│   └── PROJECT_RULES.md
│
├── assets/
│   └── dashboard.css
│
├── config/
│   ├── application.json
│   ├── browser.json
│   ├── llm.json
│   ├── profile.json
│   ├── scoring.json
│   ├── search.json
│   ├── credentials/
│   └── llm/
│       └── question-resolver.prompt.txt
│
├── data/
│   ├── resume.md
│   └── company_answers/
│
├── docs/
│
├── prompts/
│
├── scripts/
│   ├── apply-agent.js
│   ├── dashboard-agent.js
│   ├── fit-agent.js
│   ├── form-agent.js
│   ├── jd-agent.js
│   ├── resume-agent.js
│   ├── review-agent.js
│   ├── search-agent.js
│   │
│   ├── lib/
│   │   ├── browser.js
│   │   ├── form-mapper.js
│   │   ├── question-mapper.js
│   │   ├── semantic-resolver.js
│   │   └── llm/
│   │       └── question-resolver.js
│   │
│   ├── linkedin/
│   │   └── apply-agent.js
│   │
│   ├── naukri/
│   │   └── naukri-agent.js
│   │
│   ├── portals/
│   ├── shared/
│   └── tests/
│
├── templates/
│
├── workflows/
│
├── apply-naukri-jobs.bat
├── package.json
└── package-lock.json
```

`output/` is intentionally runtime-generated and should not be committed.

---

# Requirements

## 1. Windows

The current automation is Windows-oriented.

Some existing scripts contain local Windows paths and may need to be adjusted if the project is moved to another machine.

## 2. Node.js

Install Node.js and verify:

```cmd
node --version
npm --version
```

Install project dependencies:

```cmd
npm install
```

Playwright is currently the primary Node dependency.

## 3. Microsoft Edge

The browser automation uses:

```text
channel: msedge
```

The project uses a dedicated persistent Edge profile so the user can manually log into LinkedIn/Naukri and then let Playwright reuse that session.

Configured in:

```text
config/browser.json
```

Example:

```json
{
  "browser": "edge",
  "profilePath": "output/edge-automation-profile",
  "profile": "Kshitij",
  "headless": false
}
```

Do not use the same profile simultaneously from multiple Edge/Playwright processes.

## 4. Ollama + Qwen

Install Ollama separately and make sure the local Ollama service is running.

Pull the configured model:

```cmd
ollama pull qwen3:4b
```

Verify the model:

```cmd
ollama list
```

The project expects the local Ollama API at:

```text
http://localhost:11434
```

Configuration:

```text
config/llm.json
```

---

# Configuration

## `config/application.json`

This is the primary personal-answer source of truth.

Before using the project, configure it for your own:

- experience
- notice period
- current/expected salary
- location
- relocation preferences
- skills
- education
- employment status
- work preferences
- certifications

Do not copy another user's personal values into your own configuration.

## `data/resume.md`

Put your current resume in clean Markdown.

This is supplied to the Qwen question resolver as supporting professional context.

## `config/profile.json`

Contains profile information used by the LinkedIn search/resume workflow.

## `config/search.json`

Controls LinkedIn search:

- posting-age window
- search locations
- target roles
- result limit
- search source

Example concepts:

```json
{
  "days": 14,
  "limit": 50,
  "locations": [
    "Pune, Maharashtra, India",
    "Noida, Uttar Pradesh, India",
    "Gurugram, Haryana, India"
  ],
  "roles": [
    ".NET Full Stack Developer",
    ".NET Developer",
    "Full Stack Developer"
  ]
}
```

---

# Naukri Setup

1. Start Microsoft Edge using the configured automation profile.
2. Log into Naukri manually.
3. Close/reopen the automation only after the login session is available.
4. Make sure Ollama is running if Qwen fallback is required.
5. Configure `config/application.json`.
6. Run the Naukri agent.

### Run all sections

```cmd
node scripts\naukri\naukri-agent.js
```

### Run one section

```cmd
node scripts\naukri\naukri-agent.js --section "Applies"
```

Available sections:

```text
Applies
Profile
Preferences
You might like
```

### Limit processing within a section

```cmd
node scripts\naukri\naukri-agent.js --section "Applies" --limit 5
```

There are no numeric section aliases.

### Batch file

The repository also contains:

```cmd
apply-naukri-jobs.bat
```

This launches the Naukri application agent.

---

# Naukri Application Flow

For every eligible job:

```text
Discover job
    ↓
Check persistent history
    ↓
Check selectable checkbox
    ↓
Select exactly one job
    ↓
Click Apply
    ↓
Answer questions sequentially
    ↓
Deterministic application.json answer?
    ├── YES → Playwright
    └── NO  → Qwen → validate → Playwright
    ↓
Naukri completion signal
    ↓
Stabilization wait
    ↓
Confirm application completion
    ↓
Save APPLIED
    ↓
Re-scan live section
    ↓
Next job
```

The automation intentionally does not batch-select multiple Naukri jobs.

---

# Persistent Naukri History

Naukri history is stored at runtime in:

```text
output/naukri_application_history.json
```

History is keyed by Naukri Job ID.

### Permanent exclusions

```text
APPLIED
SKIPPED_NO_CHECKBOX
SKIPPED_EXTERNAL
```

### Reprocessable states

```text
NEEDS_USER_INPUT
FAILED
UNVERIFIED
SKIPPED_UNKNOWN_ROUTE
```

This allows temporary failures or unresolved questions to be retried on a later run.

---

# LinkedIn Workflow

The LinkedIn pipeline is designed around:

```text
Search
  ↓
Fit
  ↓
JD
  ↓
Resume
  ↓
Apply
  ↓
Dashboard
```

The major agents are:

```text
scripts/search-agent.js
scripts/fit-agent.js
scripts/jd-agent.js
scripts/resume-agent.js
scripts/apply-agent.js
scripts/dashboard-agent.js
```

The project uses Microsoft Edge with a dedicated persistent automation profile.

### Start Edge and log in

Run:

```cmd
start-edge-login.bat
```

This creates the runtime Edge profile under:

```text
output/edge-automation-profile/
```

Log in manually to LinkedIn and Naukri using that dedicated Edge profile. After login, close Edge before starting the automation.

### Run LinkedIn

Run the LinkedIn agents individually in this order:

```cmd
node scripts\search-agent.js
node scripts\fit-agent.js
node scripts\jd-agent.js
node scripts\resume-agent.js
node scripts\apply-agent.js
node scripts\dashboard-agent.js
```

Each step should complete successfully before starting the next one.

### LinkedIn search CLI prerequisite

The LinkedIn search agent depends on the configured local LinkedIn-search CLI. If you move the project to another computer, make sure that CLI is installed and that its configured path is valid on the new machine.

---

# Testing

The repository contains focused tests for the Naukri automation and answer-resolution system.

Examples:

```cmd
node scripts\tests\naukri-application-route.test.js
node scripts\tests\naukri-chatbot-controls.test.js
node scripts\tests\naukri-chatbot-skip.test.js
node scripts\tests\naukri-chatbot-stabilization.test.js
node scripts\tests\naukri-corrections.test.js
node scripts\tests\naukri-section-context.test.js
node scripts\tests\question-mapper.test.js
node scripts\tests\question-resolver-mvp.test.js
node scripts\tests\semantic-resolver.test.js
```

Qwen connectivity can be checked with:

```cmd
node scripts\tests\ollama-connectivity.js
```

For a new installation, run the relevant tests before using live application automation.

---

# Safety and Automation Boundaries

This project is intended for controlled personal automation.

The automation does **not** intentionally bypass:

- CAPTCHA
- authentication
- security verification
- account restrictions
- anti-bot/security mechanisms

If LinkedIn/Naukri presents a security challenge, login interruption, CAPTCHA, or account restriction, the automation should stop rather than attempt to bypass it.

The application resolver also avoids inventing personal information.

When an answer cannot safely be determined from the configured source of truth, resume, and available UI options, the application can enter:

```text
NEEDS_USER_INPUT
```

rather than guessing.

---

## What to Remove Before Sharing on GitHub

Yes — **remove the entire `output/` folder before sharing the repository**, including:

```text
output/edge-automation-profile/
```

The Edge profile contains local browser session/cookie data and must never be committed or shared.

Also remove runtime-generated data such as:

```text
output/naukri_application_history.json
output/apply_candidates.json
output/manual_applications.json
output/history/
output/job_descriptions/
output/resumes/
output/dashboard.html
```

The application recreates the required runtime directories.

In particular, `scripts/lib/browser.js` uses `fs.mkdirSync(..., { recursive: true })` for the configured Edge profile path, so the profile is created automatically when Playwright launches.

A clean repository can therefore start without:

```text
output/
output/edge-automation-profile/
```

Also exclude:

```text
node_modules/
```

and never share credentials or personal browser/session data.

# Important: Before Publishing to GitHub

This repository contains user-specific configuration and should **not be published publicly unchanged**.

Review and sanitize at least:

```text
config/application.json
config/profile.json
config/credentials/
data/resume.md
```

These may contain:

- name
- email
- phone number
- LinkedIn/GitHub profile information
- salary information
- employment information
- resume content
- personal application preferences

For a public repository, replace personal files with examples such as:

```text
config/application.example.json
config/profile.example.json
data/resume.example.md
```

and keep the real files local.

Also make sure the following are excluded from Git:

```text
node_modules/
output/
```

The persistent Edge automation profile must also never be committed.

A suitable `.gitignore` should include:

```gitignore
node_modules/
output/
config/credentials/*
!config/credentials/.gitkeep
*.log
.env
```

---

# Current MVP Limitations

This is a working personal MVP, not a production SaaS application.

Current limitations include:

- Windows-oriented paths and batch files.
- Microsoft Edge is the supported browser.
- LinkedIn search depends on a locally configured search CLI.
- - Naukri/LinkedIn UI changes can break selectors.
- Application questions that cannot be safely resolved require review.
- External career-site applications are intentionally not automated by the Naukri workflow.
- No CAPTCHA/security-verification bypass is implemented.
- Generated runtime data is intentionally kept outside source control.
- The project is currently primarily designed for a single local user.

---

# Development Principles

The project follows a few simple rules:

1. **Local first** — prefer local JSON, Markdown, JavaScript, HTML, Ollama, and Playwright.
2. **MVP first** — implement useful working automation before adding infrastructure.
3. **Configuration over hardcoding** — personal values belong in `config/`.
4. **Truthfulness** — never invent professional experience, certifications, or achievements.
5. **Professional vs academic** — keep professional experience separate from academic projects.
6. **Small targeted changes** — avoid refactoring unrelated working automation.
7. **Human handoff when uncertain** — do not guess application answers.
8. **Persistent history** — use Job IDs rather than titles as application identity.

See:

```text
.codex/PROJECT_RULES.md
.codex/CODING_STANDARDS.md
```

for the project's development rules.

---

# MVP Status

### LinkedIn

- [x] Job discovery
- [x] Posting-age filtering
- [x] Job ID deduplication
- [x] Fit scoring
- [x] JD processing
- [x] Resume generation
- [x] LinkedIn Easy Apply workflow
- [x] Application-question handling
- [x] Persistent application/manual state

### Naukri

- [x] Section discovery
- [x] One-job-at-a-time application
- [x] Selectable-checkbox detection
- [x] Persistent Job ID history
- [x] Terminal-status filtering
- [x] Sequential recruiter questions
- [x] Deterministic application.json answers
- [x] Qwen fallback
- [x] Resume + source-of-truth context for Qwen
- [x] Option validation
- [x] Free-text answer handling
- [x] Application completion stabilization
- [x] Focused automated tests

---

# Future Ideas

Possible future work:

- Better cross-platform path/configuration support.
- More robust application tracking.
- Additional job portals.
- Improved review/notification workflow.
- More comprehensive test coverage against UI changes.
- SQLite or another persistent database after the JSON workflow is stable.
- Multi-user configuration and onboarding.
- GitHub-friendly example configuration files.

---

## License

No license is currently specified in the project.

If this repository will be made public, choose and add an appropriate open-source license before presenting it as an open-source project.
