const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { isWithinPostingWindow, dedupeByLinkedInJobId } = require("./lib/job-filters");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.resolve(ROOT, "..", "ai-job-search", ".agents", "skills", "linkedin-search", "cli");
const CONFIG = path.join(ROOT, "config");
const outputDir = path.join(ROOT, "output");
const searchConfig = JSON.parse(
  fs.readFileSync(path.join(CONFIG, "search.json"), "utf8")
);

const locations = searchConfig.locations;
const roles = searchConfig.roles;
const DAYS = searchConfig.days;
const LIMIT = searchConfig.limit;

let allJobs = [];

for (const location of locations) {
  for (const role of roles) {
    console.log(`Searching: ${role} | ${location}`);

    try {
      const cmd =
        `cd /d "${CLI}" && bun run src/cli.ts search -q "${role}" -l "${location}" --jobage ${DAYS} --limit ${LIMIT} --format json`;

      const output = execSync(cmd, {
        shell: "cmd.exe",
        encoding: "utf8"
      });

      const data = JSON.parse(output);

      data.results.forEach(job => {
        job.searchRole = role;
        job.searchLocation = location;
        allJobs.push(job);
      });

    } catch (err) {
      console.log(`Failed: ${role} | ${location}`);
    }
  }
}

// Filter by LinkedIn's actual posting date when available, then deduplicate by Job ID.
// Unknown/unrecognized dates remain eligible; upstream --jobage is only an additional query filter.
const freshJobs = allJobs.filter(job => isWithinPostingWindow(job.date));
const unique = dedupeByLinkedInJobId(freshJobs);

// Create folders
const historyDir = path.join(outputDir, "history");

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(historyDir, { recursive: true });

// Timestamp
const now = new Date();

const pad = n => String(n).padStart(2, "0");

const stamp =
  `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;

// Files
const latestFile = path.join(outputDir, "today_jobs.json");
const historyFile = path.join(historyDir, `jobs_${stamp}.json`);
const summaryFile = path.join(outputDir, "latest_summary.json");

// =====================
// Metadata
// =====================
const metadata = {
  agent: "search-agent",
  version: "1.1",
  generatedAt: now.toISOString(),
  totalJobs: unique.length,
  locations,
  roles,
  searchWindowDays: DAYS,
  limitPerSearch: LIMIT
};

const payload = {
  metadata,
  jobs: unique
};

// Save latest
fs.writeFileSync(latestFile, JSON.stringify(payload, null, 2));

// Save history
fs.writeFileSync(historyFile, JSON.stringify(payload, null, 2));

// Save lightweight summary
const summary = {
  generatedAt: metadata.generatedAt,
  totalJobs: metadata.totalJobs,
  latestFile: path.relative(ROOT, latestFile),
  historyFile: path.relative(ROOT, historyFile)
};

fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

console.log(`Saved ${unique.length} unique jobs.`);
console.log(`Latest : ${latestFile}`);
console.log(`History: ${historyFile}`);
