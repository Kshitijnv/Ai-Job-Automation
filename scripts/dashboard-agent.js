const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "output");
const ASSETS = path.join(ROOT, "assets");
const TEMPLATE = path.join(ROOT, "templates", "dashboard-template.html");
const RANKED_FILE = path.join(OUTPUT, "today_jobs_ranked.json");
const DASHBOARD_FILE = path.join(OUTPUT, "dashboard.html");
const ACTIONS = ["Apply", "Review", "Maybe", "Skip"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fileHref(...segments) {
  return segments.map(segment => encodeURIComponent(segment)).join("/");
}

function renderJob(job) {
  const safeCompany = String(job.company ?? "").replace(/[<>:"/\\|?*]/g, "").trim();
  const jdName = job.jd?.fileName || `${safeCompany}_${job.id}.md`;
  const jdPath = path.join(OUTPUT, "job_descriptions", jdName);
  const resumeDir = `${safeCompany}_${job.id}`;
  const resumePath = path.join(OUTPUT, "resumes", resumeDir, "resume.pdf");
  const action = ACTIONS.includes(job.action) ? job.action : "Maybe";
  const applyLink = action === "Apply" && job.url
    ? `<a class="button button-primary" href="${escapeHtml(job.url)}" target="_blank" rel="noopener">Apply</a>`
    : "";
  const jdLink = job.jd?.downloaded && fs.existsSync(jdPath)
    ? `<a class="button button-secondary" href="${fileHref("job_descriptions", jdName)}" target="_blank" rel="noopener">Open JD</a>`
    : "";
  const resumeLink = action === "Apply" && fs.existsSync(resumePath)
    ? `<a class="button button-primary" href="${fileHref("resumes", resumeDir, "resume.pdf")}" target="_blank" rel="noopener">Open Resume</a>`
    : "";

  return `
    <article class="job-card">
      <div class="job-heading">
        <div>
          <p class="company">${escapeHtml(job.company || "Company not listed")}</p>
          <h2>${escapeHtml(job.title || "Untitled role")}</h2>
        </div>
        <span class="badge badge-${action.toLowerCase()}">To ${escapeHtml(action)}</span>
      </div>
      <div class="job-meta">
        <span>${escapeHtml(job.location || "Location not listed")}</span>
        <span class="score">Score <strong>${escapeHtml(job.score ?? "—")}</strong></span>
      </div>
      <div class="job-actions">${applyLink}${jdLink}${resumeLink}</div>
    </article>`;
}

function main() {
  const rankedData = JSON.parse(fs.readFileSync(RANKED_FILE, "utf8"));
  const jobs = Array.isArray(rankedData.jobs) ? rankedData.jobs : [];
  const counts = Object.fromEntries(ACTIONS.map(action => [
    action,
    jobs.filter(job => job.action === action).length
  ]));
  const sortedJobs = [...jobs].sort((a, b) => {
    const actionOrder = ACTIONS.indexOf(a.action) - ACTIONS.indexOf(b.action);
    if (actionOrder !== 0) return actionOrder;
    return (Number(b.score) || 0) - (Number(a.score) || 0);
  });
  const template = fs.readFileSync(TEMPLATE, "utf8");
  const stylesheet = fs.readFileSync(path.join(ASSETS, "dashboard.css"), "utf8");
  const summary = ACTIONS.map(action =>
    `<div class="summary-item"><span class="summary-count">${counts[action]}</span><span>${action}</span></div>`
  ).join("");
  const cards = sortedJobs.length
    ? sortedJobs.map(renderJob).join("\n")
    : '<p class="empty-state">No ranked jobs found.</p>';
  const html = template
    .replace("@@STYLES@@", () => stylesheet)
    .replace("@@GENERATED_AT@@", () => escapeHtml(new Date().toLocaleString()))
    .replace("@@SUMMARY@@", () => summary)
    .replace("@@JOB_CARDS@@", () => cards);

  fs.writeFileSync(DASHBOARD_FILE, html, "utf8");
  console.log(`Dashboard generated: ${DASHBOARD_FILE}`);
  console.log(`Jobs: ${jobs.length} | Apply: ${counts.Apply} | Review: ${counts.Review} | Maybe: ${counts.Maybe} | Skip: ${counts.Skip}`);
}

main();
