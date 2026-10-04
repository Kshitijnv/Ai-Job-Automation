const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "output");
const CLI = path.resolve(ROOT, "..", "ai-job-search", ".agents", "skills", "linkedin-search", "cli");

const rankedFile = path.join(OUTPUT, "today_jobs_ranked.json");
const jdFolder = path.join(OUTPUT, "job_descriptions");

fs.mkdirSync(jdFolder, { recursive: true });

// =====================
// Load ranked jobs
// =====================
const rankedData = JSON.parse(fs.readFileSync(rankedFile, "utf8"));
const jobs = rankedData.jobs;

// Only Apply and Review
const targetJobs = jobs.filter(
  job => job.action === "Apply" || job.action === "Review"
);

// =====================
// Download JD
// =====================
let downloaded = 0;
let skipped = 0;

for (const job of targetJobs) {

  const safeCompany = job.company.replace(/[<>:"/\\|?*]/g, "").trim();
  const fileName = `${safeCompany}_${job.id}.md`;
  job.jd = {
    downloaded: false,
    fileName,
    downloadedAt: null
  };
  const filePath = path.join(jdFolder, fileName);

  // Skip if already downloaded
  if (fs.existsSync(filePath)) {

  job.jd.downloaded = true;
  job.jd.downloadedAt = fs.statSync(filePath).mtime.toISOString();

  skipped++;
  continue;
}

  console.log(`Downloading: ${job.company} | ${job.title}`);

  try {

    const cmd =
      `cd /d "${CLI}" && bun run src/cli.ts detail ${job.id} --format plain`;

    const output = execSync(cmd, {
      shell: "cmd.exe",
      encoding: "utf8"
    });

    const content =
`# ${job.title}

## Company

${job.company}

## Score

- Score: ${job.score}
- Action: ${job.action}

## Original URL

${job.url}

---

## Full Job Description

${output}
`;

    fs.writeFileSync(filePath, content);
    job.jd.downloaded = true;
    job.jd.downloadedAt = new Date().toISOString();
    downloaded++;

  } catch (err) {
    console.log(`Failed: ${job.id}`);
  }
}

// =====================
// Summary
// =====================
console.log("\n========== JD Agent Summary ==========");
console.table({
  Candidates: targetJobs.length,
  Downloaded: downloaded,
  Skipped: skipped
});

console.log("\nSaved to:");
console.log(jdFolder);

// =====================
// Update ranked JSON with JD status
// =====================

fs.writeFileSync(
  rankedFile,
  JSON.stringify(
    {
      metadata: rankedData.metadata,
      jobs: jobs
    },
    null,
    2
  )
);

console.log("Updated today_jobs_ranked.json with JD status.");