
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ==========================================
// Paths
// ==========================================

const ROOT = path.resolve(__dirname, "..");

const CONFIG = path.join(ROOT, "config");
const OUTPUT = path.join(ROOT, "output");
const TEMPLATES = path.join(ROOT, "templates");

const profile = JSON.parse(
  fs.readFileSync(path.join(CONFIG, "profile.json"), "utf8")
);

const ranked = JSON.parse(
  fs.readFileSync(path.join(OUTPUT, "today_jobs_ranked.json"), "utf8")
);

const template = fs.readFileSync(
  path.join(TEMPLATES, "resume-template.tex"),
  "utf8"
);

const resumeRoot = path.join(OUTPUT, "resumes");
fs.mkdirSync(resumeRoot, { recursive: true });

// ==========================================
// Escape LaTeX
// ==========================================

function escapeLatex(text) {
  return String(text || "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function replace(template, values) {
  let output = template;

  Object.entries(values).forEach(([key, value]) => {
    output = output.replace(
      new RegExp(`@@${key}@@`, "g"),
      value
    );
  });

  return output;
}

// ==========================================
// Static Resume Sections (Preserved)
// ==========================================

const EXPERIENCE = `
\\textbf{Associate Consultant} \\hfill Apr 2024 -- Present

T-Systems Information and Communication Technologies India Pvt. Ltd.

\\begin{itemize}
\\item Designed and developed full-stack modules for Hospital Information System (HIS) using C#, .NET 8 and Angular.
\\item Developed Gematik-compliant ePA integrations using IHE XDS transactions.
\\item Implemented FHIR Patient Portal integrations with configurable endpoints and Kafka-based workflows.
\\item Architected Large Document Handling (LDH) workflows for 100MB--500MB+ healthcare documents.
\\item Built REST APIs using ASP.NET Core.
\\item Resolved recurring OutOfMemory issues through architecture redesign.
\\item Integrated veraPDF and implemented xUnit-based testing.
\\end{itemize}
`;

const EDUCATION = `
\\begin{itemize}
\\item DAC (Diploma in Advance Computing) | C-DAC ACTS Pune | 2024
\\item Master of Computer Applications | Dr. Bhimrao Ambedkar University | 2023
\\item Bachelor of Science (Computer Science) | Dr. Bhimrao Ambedkar University | 2020
\\end{itemize}
`;

const PROJECTS = `
\\textbf{Electronic Patient Record (ePA)} \\hfill Professional

\\begin{itemize}
\\item Developed Gematik-compliant healthcare integrations using IHE XDS transactions.
\\item Built REST APIs with configurable provider endpoints and secure document workflows.
\\item Implemented enterprise document exchange between healthcare providers.
\\end{itemize}

\\textbf{FHIR Patient Portal} \\hfill Professional

\\begin{itemize}
\\item Integrated FHIR DocumentReference workflows for patient document access.
\\item Implemented Kafka-based processing and configurable portal integrations.
\\end{itemize}

\\textbf{Large Document Handling (LDH)} \\hfill Professional

\\begin{itemize}
\\item Designed a separate DocumentProcessor architecture to eliminate recurring OutOfMemory exceptions.
\\item Implemented streaming-based processing for 100MB--500MB+ healthcare documents.
\\item Automated encryption, decryption, scanning, transformation and FTP workflows.
\\end{itemize}
`;

// ==========================================
// Process Apply Jobs
// ==========================================
console.log(
  ranked.jobs.map(job => ({
    company: job.company,
    action: job.action,
    downloaded: job.jd?.downloaded
  }))
);
const applyJobs = ranked.jobs.filter(
  job =>
    job.action === "Apply" &&
    job.jd &&
    job.jd.downloaded
);

let generated = 0;

for (const job of applyJobs) {

  console.log(`Generating: ${job.company}`);

  const jdPath = path.join(
    OUTPUT,
    "job_descriptions",
    job.jd.fileName
  );

  const jd = fs.readFileSync(jdPath, "utf8").toLowerCase();

  // --------------------------------------
  // Dynamic Headline
  // --------------------------------------

  let headline = ".NET Full Stack Developer";

  if (jd.includes("backend")) {
    headline = ".NET Backend Developer";
  }

  // --------------------------------------
  // Dynamic Summary
  // --------------------------------------

  let summary =
    "Full Stack .NET Developer with 3+ years of experience building enterprise healthcare applications using ASP.NET Core, C#, Angular, REST APIs and SQL.";

  if (jd.includes("microservices")) {
    summary += " Experienced in Microservices architecture.";
  }

  if (jd.includes("angular")) {
    summary += " Strong experience with Angular frontend development.";
  }

  if (jd.includes("rest api")) {
    summary += " Skilled in REST API integration.";
  }

  // --------------------------------------
  // Dynamic Skill Order
  // --------------------------------------

  const skills = [
    "C#",
    ".NET Framework 4.8",
    ".NET 8",
    "ASP.NET Core",
    "Angular",
    "REST APIs",
    "SQL Server",
    "Oracle",
    "MySQL",
    "PostgreSQL",
    "Microservices",
    "Go",
    "Kafka",
    "FHIR",
    "IHE XDS"
  ];

  const prioritized = skills.sort((a, b) => {
    const aa = jd.includes(a.toLowerCase()) ? 1 : 0;
    const bb = jd.includes(b.toLowerCase()) ? 1 : 0;
    return bb - aa;
  });

  const skillSection = prioritized.join(" • ");

  // --------------------------------------
  // Replace Template
  // --------------------------------------

  const tex = replace(template, {
    NAME: escapeLatex(profile.candidate.name),
    HEADLINE: escapeLatex(headline),
    LOCATION: escapeLatex(profile.candidate.contact.location),
    EMAIL: escapeLatex(profile.candidate.contact.email),
    PHONE: escapeLatex(profile.candidate.contact.phone),
    SUMMARY: escapeLatex(summary),
    EXPERIENCE: EXPERIENCE,
    SKILLS: escapeLatex(skillSection),
    EDUCATION: EDUCATION,
    PROJECTS: PROJECTS
  });

  const folder = path.join(
    resumeRoot,
    `${job.company.replace(/[<>:"/\\\\|?*]/g, "")}_${job.id}`
  );

  fs.mkdirSync(folder, { recursive: true });

  const texFile = path.join(folder, "resume.tex");

  fs.writeFileSync(texFile, tex);

    try {

  execSync(
    "lualatex -interaction=nonstopmode resume.tex",
    {
      cwd: folder,
      stdio: "inherit"
    }
  );

} catch (err) {

  console.log(`\nLaTeX returned a non-zero exit code for ${job.company}`);
  console.log("Exit Status:", err.status);
  console.log("Command:", err.cmd);
}

// Count success based on whether the PDF actually exists
const pdfFile = path.join(folder, "resume.pdf");

if (fs.existsSync(pdfFile)) {
  generated++;
  console.log(`✓ Resume generated: ${job.company}`);
} else {
  console.log(`✗ PDF not generated: ${job.company}`);
}
}

// ==========================================
// Summary
// ==========================================

console.log("\\n========== Resume Agent ==========");
console.log(`Apply Jobs : ${applyJobs.length}`);
console.log(`PDFs Generated : ${generated}`);
