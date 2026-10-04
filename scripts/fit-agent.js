const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "config");
const OUTPUT = path.join(ROOT, "output");

const jobsFile = path.join(OUTPUT, "today_jobs.json");
const profileFile = path.join(CONFIG, "profile.json");
const scoringFile = path.join(CONFIG, "scoring.json");

// =====================
// Load Files
// =====================
const searchResult = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
const jobs = searchResult.jobs;
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const scoring = JSON.parse(fs.readFileSync(scoringFile, "utf8"));

// =====================
// Helpers
// =====================
const contains = (text, keyword) =>
  text.toLowerCase().includes(keyword.toLowerCase());

function scoreJob(job) {
  let score = 0;
  const why = [];

  const title = job.title || "";
  const location = job.location || "";

  // Title scoring
  for (const [keyword, points] of Object.entries(scoring.weights.title)) {
    if (contains(title, keyword)) {
      score += points;
      why.push(keyword);
    }
  }

  // Preferred skills from profile
  for (const skill of profile.skills.primary) {
    if (contains(title, skill)) {
      score += 5;
      if (!why.includes(skill)) why.push(skill);
    }
  }

  // Location bonus
  for (const [city, points] of Object.entries(scoring.weights.location)) {
    if (contains(location, city)) {
      score += points;
      if (!why.includes(city)) why.push(city);
    }
  }

  // Seniority penalties
  for (const [keyword, points] of Object.entries(scoring.weights.seniorityPenalty)) {
    if (contains(title, keyword)) {
      score += points;
      why.push(`${keyword} role`);
    }
  }

  // Clamp score
  score = Math.max(
    scoring.limits.minScore,
    Math.min(score, scoring.limits.maxScore)
  );

  // Decide action
  let action = "Skip";

  if (score >= scoring.thresholds.apply) action = "Apply";
  else if (score >= scoring.thresholds.review) action = "Review";
  else if (score >= scoring.thresholds.maybe) action = "Maybe";

  return {
    ...job,
    score,
    action,
    why
  };
}

// =====================
// Score & Sort
// =====================
const rankedJobs = jobs
  .map(scoreJob)
  .sort((a, b) => b.score - a.score);

// =====================
// Metadata
// =====================
const metadata = {
  agent: "fit-agent",
  version: "1.1",
  generatedAt: new Date().toISOString(),
  totalJobs: rankedJobs.length,
  apply: rankedJobs.filter(j => j.action === "Apply").length,
  review: rankedJobs.filter(j => j.action === "Review").length,
  maybe: rankedJobs.filter(j => j.action === "Maybe").length,
  skip: rankedJobs.filter(j => j.action === "Skip").length
};

// =====================
// Save JSON
// =====================
fs.writeFileSync(
  path.join(OUTPUT, "today_jobs_ranked.json"),
  JSON.stringify(
    {
      metadata,
      jobs: rankedJobs
    },
    null,
    2
  )
);

// =====================
// Save CSV
// =====================
const csv = [
  "Score,Action,Company,Title,Location,Date,Why,JobID,URL"
];

rankedJobs.forEach(job => {
  csv.push([
    job.score,
    job.action,
    `"${job.company}"`,
    `"${job.title}"`,
    `"${job.location}"`,
    job.date,
    `"${job.why.join(" | ")}"`,
    job.id,
    job.url
  ].join(","));
});

fs.writeFileSync(
  path.join(OUTPUT, "today_jobs_ranked.csv"),
  csv.join("\n")
);

// =====================
// Console Summary
// =====================
console.log("\n========== Fit Agent Summary ==========");
console.table({
  Total: metadata.totalJobs,
  Apply: metadata.apply,
  Review: metadata.review,
  Maybe: metadata.maybe,
  Skip: metadata.skip
});

console.log("\nTop 10 Matches\n");

console.table(
  rankedJobs.slice(0, 10).map(job => ({
    Score: job.score,
    Action: job.action,
    Company: job.company,
    Title: job.title,
    Why: job.why.join(", ")
  }))
);

console.log("\nFiles generated:");
console.log("- today_jobs_ranked.json");
console.log("- today_jobs_ranked.csv");