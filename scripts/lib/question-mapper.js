const SENSITIVE_PATTERNS = [
  { field: "confirm_password", pattern: /confirm\s+(?:your\s+)?password|password\s+confirmation/i },
  { field: "new_password", pattern: /new\s+password|create\s+(?:a\s+)?password/i },
  { field: "password", pattern: /password|passcode/i },
  { field: "credential", pattern: /credential|access\s+token|authentication\s+token|auth\s+token|api\s+key/i }
];

const CALLING_COUNTRY = Object.freeze({ "91": "India" });
const DOTNET_SKILL_NAMES = new Set(["net", "dot net", "net core", "dot net core", "asp net", "asp net core", "aspnet", "aspnet core"]);
const GENERIC_SKILL_SUBJECTS = new Set([
  "a role", "a position", "a field", "a domain", "a technology", "a skill", "an industry", "a stack", "the stack", "an unfamiliar stack", "unfamiliar stack",
  "the role", "the position", "the field", "the domain", "the technology", "the skill", "the industry",
  "your role", "your position", "your field", "your domain", "your technology", "your skills",
  "this role", "this position", "this field", "this domain", "this technology", "this skill", "this stack",
  "relevant field", "relevant domain", "it", "that", "this", "them"
]);

function isGenericOrUnsupportedSkillSubject(subject) {
  const norm = normalize(subject);
  if (!norm || GENERIC_SKILL_SUBJECTS.has(norm)) return true;
  if (/\b(?:field|domain|industry|role|position|profession|career|stack|unfamiliar stack)\b$/i.test(norm)) return true;
  return false;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function sensitiveField(label, name = "", id = "", type = "") {
  const source = `${label} ${name} ${id} ${type}`;
  return SENSITIVE_PATTERNS.find(item => item.pattern.test(source))?.field || "";
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function getAnswersObject(applicationConfig = {}) {
  const answers = applicationConfig.answers || applicationConfig || {};
  return answers && typeof answers === "object" ? answers : {};
}

function readAnswerConfigPath(applicationConfig = {}, answerSource = "") {
  if (!answerSource) return undefined;
  const cleanedSource = String(answerSource).trim().replace(/^answers\./, "");
  if (!cleanedSource) return undefined;
  const path = cleanedSource.replace(/\[(?:["']?)(.*?)['"]?\]/g, ".$1").split(".").filter(Boolean);
  let current = getAnswersObject(applicationConfig);
  for (const part of path) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function experienceQuestion(label) {
  const text = normalize(label);
  if (!text || /^(?:please )?(?:describe|tell us about|share|discuss|explain|elaborate)\b/.test(text)) return null;

  const numericDuration = /\b(?:how many|number of)\s+(?:total\s+)?years?\b/.test(text)
    || /\byears?\s+(?:of|working|worked|experience)\b/.test(text)
    || /\bhow long\b.*\b(?:work|worked|working|experience|been)\b/.test(text)
    || /\btotal (?:work|professional) experience\b/.test(text);
  if (!numericDuration) return null;

  const hasSpecificQualifier = /\b(?:with|using|in|as|for|on)\b/.test(text) && !/\bin total\b/.test(text);
  const contextualSubject = text.match(/\b(?:with|using|in|as|for|on)\s+(.+)$/);
  const beforeExperience = text.match(/\byears?\s+(?:of\s+)?(.+?)\s+experience\b/);
  const afterYears = text.match(/\byears?\s+of\s+(.+?)(?:\?|$)/);
  const rawSubject = contextualSubject?.[1] || beforeExperience?.[1] || afterYears?.[1] || "";
  const subject = normalize(rawSubject)
    .replace(/\b(?:do you have|have you worked|have you been working|have you been|did you work|worked with|working with)\b.*$/, "")
    .replace(/\b(?:experience|working|worked|for the past|for the last|for)\b.*$/, "")
    .replace(/^(?:a|an|the|your)\s+/, "")
    .trim();
  const generalSubject = new Set(["", "work", "professional", "total", "overall", "general", "work professional", "professional work", "total work"]);
  const generalExperience = !hasSpecificQualifier && (
    /\b(?:total work experience|total professional experience|professional experience|overall experience|experience overall|in total)\b/.test(text)
    || (/\byears?\b/.test(text) && generalSubject.has(subject))
  );
  if (generalExperience) return { type: "general" };
  if (!subject || GENERIC_SKILL_SUBJECTS.has(subject)
      || /\b(?:field|domain|industry|role|position|profession|career)\b$/.test(subject)) {
    return { type: "unsupported" };
  }
  return { type: "skill", subject };
}

function canonicalQuestion(label, options = {}) {
  const text = normalize(label);
  if (!text || sensitiveField(text)) return "";

  if (isCompoundLocationRelocationQuestion(label)) return "compound_location_relocation";
  if (/privacy policy|privacy notice|data protection|privacy acknowledgement/.test(text)) return "privacy_acknowledgement";
  if (/terms of service|terms and conditions|terms of use|terms acknowledgement/.test(text)) return "terms_acknowledgement";
  if (/expected|desired/.test(text) && /(salary|ctc|compensation|remuneration|annual pay)/.test(text)) return "expected_salary";
  if (options.experienceYearsRule) {
    const experience = experienceQuestion(label);
    if (experience?.type === "general") return "years_experience";
    if (experience?.type === "skill") return `years_experience_skill_${experience.subject.replace(/\s+/g, "_")}`;
    if (experience?.type === "unsupported") return "years_experience_unresolved";
  } else if (/(how many years|years? of|total work experience|work experience|experience.*(?:years?|yrs?)|(?:years?|yrs?).*experience)/.test(text)) {
    return "years_experience";
  }
  if (/\b(?:net|dot net)\b/.test(text) && /\bc\b/.test(text) && /experience/.test(text)) return "dotnet_csharp_experience";
  if (/\breact(?:\.js|js)?\b/.test(text) && /experience/.test(text)) return "react_experience";
  if (/(current|present)/.test(text) && /(salary|ctc|compensation|remuneration|annual pay)/.test(text)) return "current_salary";
  if (/phone country|country code.*phone|dialing code/.test(text)) return "phone_country";
  if (/linkedin|linked in/.test(text)) return "linkedin_url";
  if (/notice period|notice duration|when can you start|availability to start/.test(text)) return "notice_period";
  if (/visa sponsorship|sponsorship.*visa|require.*sponsorship/.test(text)) return "visa_sponsorship";
  if (/work authorization|authorized to work|right to work|work permit/.test(text)) return "work_authorization";
  if (/willing.*relocat|relocat.*willing/.test(text)) return "willing_to_relocate";
  if (/job location|work location|location of (?:the )?(?:job|role)|preferred work location/.test(text)) return "job_location";
  if (/current city|current location|where do you currently live|residential location/.test(text)) return "current_location";
  if (/phone|mobile number|telephone/.test(text)) return "phone";
  if (/^email(?: address)?$|email address/.test(text)) return "email";
  if (/\bresume\b|\bcv\b|curriculum vitae|attach.*resume|upload.*resume/.test(text)) return "resume_upload";
  return "";
}

function phoneCountryFromProfile(profile = {}) {
  const candidate = profile.candidate || profile;
  const contact = candidate.contact || {};
  if (contact.phoneCountry || contact.phone_country) return contact.phoneCountry || contact.phone_country;
  const phone = String(contact.phone || candidate.phone || "").trim();
  const callingCode = phone.startsWith("+91") ? "91" : phone.match(/^\+(\d{1,2})/)?.[1];
  return callingCode ? CALLING_COUNTRY[callingCode] || "" : "";
}

function collectSkillNames(value, skills = [], key = "") {
  if (/^(academiconly|noprofessionalexperience|noproexperience|nonprofessionalexperience)$/i.test(key.replace(/[_ -]/g, ""))) return skills;
  if (typeof value === "string") {
    if (value.trim()) skills.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectSkillNames(item, skills);
  } else if (value && typeof value === "object") {
    if (typeof value.name === "string") skills.push(value.name);
    else if (typeof value.skill === "string") skills.push(value.skill);
    else for (const [childKey, child] of Object.entries(value)) collectSkillNames(child, skills, childKey);
  }
  return skills;
}

const SKILL_ALIASES = Object.freeze({
  "net": ".NET",
  "dot net": ".NET",
  "dotnet": ".NET",
  ".net": ".NET",
  "net core": ".NET Core",
  "dot net core": ".NET Core",
  ".net core": ".NET Core",
  ".net framework": ".NET Framework",
  "net framework": ".NET Framework",
  ".net 8": ".NET 8",
  "net 8": ".NET 8",
  "asp net": "ASP.NET",
  "asp.net": "ASP.NET",
  "aspnet": "ASP.NET",
  "asp net core": "ASP.NET Core",
  "asp.net core": "ASP.NET Core",
  "aspnet core": "ASP.NET Core",
  "c#": "C#",
  "c sharp": "C#",
  "csharp": "C#",

  "angular": "Angular",
  "angularjs": "Angular",
  "angular 19": "Angular 19",

  "react": "React",
  "react js": "React",
  "react.js": "React",
  "reactjs": "React",

  "node": "Node.js",
  "node js": "Node.js",
  "nodejs": "Node.js",
  "node.js": "Node.js",
  "express": "Express.js",
  "express js": "Express.js",
  "expressjs": "Express.js",
  "express.js": "Express.js",

  "ror": "Ruby on Rails",
  "ruby on rails": "Ruby on Rails",
  "ruby rails": "Ruby on Rails",
  "ruby and rails": "Ruby on Rails",
  "rubyrails": "Ruby on Rails",
  "ruby": "Ruby",

  "sql": "SQL",
  "sql server": "SQL Server",
  "mssql": "SQL Server",
  "ms sql": "SQL Server",
  "ms sql server": "SQL Server",
  "postgresql": "PostgreSQL",
  "postgres": "PostgreSQL",
  "mysql": "MySQL",
  "oracle": "Oracle",
  "mongodb": "MongoDB",
  "mongo": "MongoDB",

  "typescript": "TypeScript",
  "javascript": "JavaScript",
  "js": "JavaScript",
  "ts": "TypeScript",
  "html": "HTML",
  "html5": "HTML5",
  "css": "CSS",
  "css3": "CSS3",
  "bootstrap": "Bootstrap",
  "tailwind": "Tailwind CSS",
  "tailwind css": "Tailwind CSS",
  "rxjs": "RxJS",
  "ngrx": "NgRx",

  "microservices": "Microservices",
  "micro services": "Microservices",
  "microservice": "Microservices",
  "entity framework": "Entity Framework",
  "ef core": "EF Core",
  "entity framework core": "EF Core",
  "linq": "LINQ",
  "web api": "Web API",
  "webapi": "Web API",
  "web apis": "Web API",
  "rest api": "REST API",
  "rest apis": "REST APIs",
  "rest api design": "REST API Design",
  "restful api": "REST API",
  "restful apis": "REST APIs",

  "kafka": "Kafka",
  "apache kafka": "Apache Kafka",
  "oauth2": "OAuth2",
  "oauth 2": "OAuth2",
  "oauth": "OAuth2",
  "auth0": "Auth0",
  "jwt": "JWT",
  "git": "Git",
  "github": "GitHub",
  "ci/cd": "CI/CD",
  "cicd": "CI/CD",
  "ci cd": "CI/CD",
  "testing": "Testing",
  "xunit": "xUnit",
  "jasmine": "Jasmine",
  "postman": "Postman",
  "bruno": "Bruno",
  "sdet": "SDET",

  "go": "Go",
  "golang": "Go",
  "laravel": "Laravel",
  "wordpress": "WordPress",
  "azure": "Azure",
  "ms azure": "Azure",
  "microsoft azure": "Azure",
  "aws": "AWS",
  "amazon web services": "AWS",
  "gcp": "GCP",
  "google cloud": "GCP",
  "google cloud platform": "GCP",
  "docker": "Docker",
  "kubernetes": "Kubernetes",
  "k8s": "Kubernetes",
  "machine learning": "Machine Learning",
  "ml": "Machine Learning",
  "mlops": "MLOps",
  "fastapi": "FastAPI",
  "python": "Python",
  "numpy": "NumPy",
  "pandas": "Pandas",
  "ai tools": "AI Tools",
  "genai": "GenAI",
  "generative ai": "Generative AI",
  "gen ai": "GenAI",
  "llm": "LLM",
  "llms": "LLM",
  "rag": "RAG",
  "django": "Django",
  "seo": "SEO",
  "seo pages": "SEO Pages",
  "aveva sdk": "AVEVA SDK"
});

const RUBY_ON_RAILS_ALIASES = new Set([
  "ror",
  "ruby on rails",
  "ruby rails",
  "ruby and rails",
  "rubyrails"
]);

function isCompoundLocationRelocationQuestion(text) {
  const normalized = normalize(text);
  if (!normalized) return false;
  const hasResidence = /\b(?:currently residing|currently living|living in|residing in|reside in|live in|located in|currently in|current residence)\b/i.test(text)
    || /\b(?:currently|presently)\s+(?:live|reside|stay|staying|located)\b/i.test(text)
    || /\b(?:live|reside|stay)\s+in\b/i.test(text);
  const hasRelocation = /\b(?:willing to relocate|ready to relocate|open to relocation|relocate to|relocating to|relocation to|willing to move|ready to move)\b/i.test(text)
    || /\brelocat/i.test(text);
  return Boolean(hasResidence && hasRelocation);
}

function normalizedSkillName(value) {
  const normalized = normalize(value);
  if (SKILL_ALIASES[normalized]) {
    const canonical = SKILL_ALIASES[normalized];
    if (DOTNET_SKILL_NAMES.has(normalize(canonical))) return "dotnet";
    if (["c#", "c sharp", "c"].includes(normalize(canonical))) return "csharp";
    if (RUBY_ON_RAILS_ALIASES.has(normalize(canonical))) return "ruby on rails";
    return normalize(canonical);
  }
  if (DOTNET_SKILL_NAMES.has(normalized)) return "dotnet";
  if (["c", "c sharp", "c#"].includes(normalized)) return "csharp";
  if (RUBY_ON_RAILS_ALIASES.has(normalized)) return "ruby on rails";
  return normalized;
}

function candidateHasSkill(subject, profile = {}, resumeData = {}) {
  const candidate = profile.candidate || profile;
  const profileSkills = collectSkillNames(profile.skills || candidate.skills || {});
  const candidateSkills = profile.skills && candidate.skills ? collectSkillNames(candidate.skills) : [];
  const resumeSkills = collectSkillNames(resumeData.skills || {});
  const target = normalizedSkillName(subject);
  return [...profileSkills, ...candidateSkills, ...resumeSkills]
    .some(skill => normalizedSkillName(skill) === target);
}

function parseSkillNames(skillText = "") {
  const cleaned = String(skillText || "").replace(/\b(?:with|in|for|on)\b/gi, " ").replace(/[?!.]/g, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s*(?:\band\b|\/|,|&|;|\|)\s*/i)
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => item.length > 1);
}

function findCanonicalSkillName(skillName, applicationConfig = {}) {
  const answers = getAnswersObject(applicationConfig);
  const skills = answers.skills || {};
  const normalized = normalize(skillName);
  if (SKILL_ALIASES[normalized]) {
    const aliasTarget = SKILL_ALIASES[normalized];
    const match = Object.keys(skills).find(key => normalize(key) === normalize(aliasTarget));
    if (match) return match;
    return aliasTarget;
  }
  const directMatch = Object.keys(skills).find(key => normalize(key) === normalized);
  if (directMatch) return directMatch;
  const normalizedMatch = Object.keys(skills).find(key => normalizedSkillName(key) === normalizedSkillName(skillName));
  if (normalizedMatch) return normalizedMatch;
  return undefined;
}

function findConfiguredSkillValue(skillName, applicationConfig = {}) {
  const answers = getAnswersObject(applicationConfig);
  const skills = answers.skills || {};
  const canonical = findCanonicalSkillName(skillName, applicationConfig);
  if (canonical && skills[canonical] !== undefined) return skills[canonical];
  const direct = Object.keys(skills).find(key => normalizedSkillName(key) === normalizedSkillName(skillName));
  if (direct && skills[direct] !== undefined) return skills[direct];
  return undefined;
}

function resolveAnswer(canonicalId, {
  applicationConfig = {},
  profile = {},
  job = {},
  credentialEmail = "",
  resumeData = {},
  question = "",
  experienceYearsRule = false
} = {}) {
  const candidate = profile.candidate || profile;
  const contact = candidate.contact || {};
  const resumeProfile = resumeData.profile || resumeData;
  const answers = getAnswersObject(applicationConfig);
  const consent = applicationConfig.consent || {};
  const eligibility = applicationConfig.eligibility || {};
  const salary = applicationConfig.salary || {};
  const workPrefs = answers.workPreferences || {};

  switch (canonicalId) {
    case "current_salary": return firstDefined(salary.currentCTC, answers.salary?.currentCTC, profile.salary?.currentCTC, resumeProfile.currentCTC);
    case "expected_salary": return firstDefined(salary.expectedCTC, answers.salary?.expectedCTC, profile.salary?.expectedCTC, resumeProfile.expectedCTC);
    case "salary_currency": return firstDefined(answers.salary?.currency, salary.currency, "INR");
    case "years_experience": return firstDefined(answers.experience?.totalYears, applicationConfig.experienceYears, profile.experience?.actualYears);
    case "dotnet_csharp_experience": return answers.skills?.[".NET Core"] ?? answers.skills?.["C#"] ?? answers.skills?.[".NET"] ?? false;
    case "react_experience": return answers.skills?.React ?? false;
    case "notice_period": return firstDefined(answers.noticePeriod?.days, applicationConfig.notice?.days, candidate.notice?.days, resumeProfile.noticePeriod);
    case "linkedin_url": return firstDefined(applicationConfig.contact?.linkedin, contact.linkedin, candidate.linkedin, resumeProfile.linkedin);
    case "phone": return firstDefined(applicationConfig.contact?.phone, contact.phone, candidate.phone, resumeProfile.phone);
    case "phone_country": return firstDefined(applicationConfig.contact?.phoneCountry, contact.phoneCountry, phoneCountryFromProfile(profile));
    case "email": return firstDefined(applicationConfig.contact?.email, contact.email, candidate.email, resumeProfile.email, credentialEmail);
    case "current_location": return firstDefined(answers.contact?.currentLocation, answers.contact?.location, applicationConfig.contact?.currentLocation, contact.location, candidate.location, resumeProfile.location);
    case "preferred_location": return firstDefined(answers.contact?.preferredLocation, contact.preferredLocation);
    case "job_location": return firstDefined(applicationConfig.job?.location, job.location, job.locations?.[0]);
    case "willing_to_relocate": return firstDefined(workPrefs.willingToRelocate, answers.relocation?.willingToRelocate, eligibility.willingToRelocate, candidate.locations?.relocation);
    case "relocation_locations": return firstDefined(answers.relocation?.locations, ["Remote", "Pune", "Gurugram", "Noida", "Delhi/NCR"]);
    case "compound_location_relocation": {
      const canonicalCurrentLocation = String(answers.contact?.currentLocation || answers.contact?.location || "Pune").trim();
      const willingToRelocate = Boolean(workPrefs.willingToRelocate ?? answers.relocation?.willingToRelocate ?? eligibility.willingToRelocate ?? candidate.locations?.relocation ?? true);
      const segments = String(question).split(/\b(?:or|and|\/)\b/i);
      const residenceSegment = segments.find(seg => /\b(?:currently residing|currently living|living in|residing in|reside in|live in|located in|currently in|current residence|currently|presently)\b/i.test(seg)) || segments[0] || question;
      const normalizedResidence = normalize(residenceSegment);
      let currentResidence = false;
      if (canonicalCurrentLocation) {
        const cityRegex = new RegExp(`\\b${normalize(canonicalCurrentLocation)}\\b`, "i");
        currentResidence = cityRegex.test(normalizedResidence);
      }
      return Boolean(currentResidence || willingToRelocate);
    }
    case "currently_employed": return firstDefined(answers.employment?.currentlyEmployed, true);
    case "actively_looking": return firstDefined(answers.employment?.activelyLooking, true);
    case "night_shift": return firstDefined(workPrefs.nightShift, true);
    case "hybrid_noida": return firstDefined(workPrefs.hybridNoida, true);
    case "relocate_gurugram": return firstDefined(workPrefs.relocateGurugram, true);
    case "relocate_noida": return firstDefined(workPrefs.relocateNoida, true);
    case "relocate_delhincr": return firstDefined(workPrefs.relocateDelhiNCR, true);
    case "willing_to_travel_for_interview": return firstDefined(workPrefs.willingToTravelForInterview, false);
    case "work_authorization": return firstDefined(workPrefs.workAuthorization, eligibility.workAuthorization, candidate.contact?.workAuthorization, candidate.workAuthorization);
    case "visa_sponsorship": return firstDefined(workPrefs.visaSponsorshipRequired, eligibility.visaSponsorshipRequired, candidate.visaSponsorshipRequired);
    case "certifications_azure": return firstDefined(answers.certifications?.azure, false);
    case "highest_qualification": return firstDefined(answers.education?.highestQualification, "MCA");
    case "degree": return firstDefined(answers.education?.degree, "Master of Computer Applications");
    case "graduation_year": return firstDefined(answers.education?.graduationYear, 2023);
    case "compliance_disability": return firstDefined(answers.compliance?.disability, "No");
    case "compliance_veteran": return firstDefined(answers.compliance?.veteranStatus, "No");
    case "compliance_diversity": return firstDefined(answers.compliance?.diversity, "Prefer not to say");
    case "privacy_acknowledgement": return answers.consent?.privacyPolicy ?? consent.privacyPolicy;
    case "terms_acknowledgement": return answers.consent?.terms ?? consent.terms;
    default: return undefined;
  }
}

function resolveExperienceAnswer(question, sources = {}) {
  const experience = experienceQuestion(question);
  if (!experience) return undefined;
  if (experience.type === "general") return sources.applicationConfig?.answers?.experience?.totalYears ?? sources.applicationConfig?.experienceYears;
  if (experience.type === "unsupported") return undefined;
  const configuredValue = findConfiguredSkillValue(experience.subject, sources.applicationConfig);
  if (configuredValue !== undefined) return Number(configuredValue);
  return candidateHasSkill(experience.subject, sources.profile, sources.resumeData)
    ? (sources.applicationConfig?.answers?.experience?.totalYears ?? sources.applicationConfig?.experienceYears)
    : 0;
}

function resolveConfiguredAnswer(canonicalId, sources = {}) {
  if (sources.experienceYearsRule && canonicalId && canonicalId.startsWith("years_experience")) {
    return resolveExperienceAnswer(sources.question, sources);
  }
  return resolveAnswer(canonicalId, sources);
}

function resolveSemanticAnswer(question, sources = {}) {
  const applicationConfig = sources.applicationConfig || {};
  const answers = getAnswersObject(applicationConfig);
  const normalizedQuestion = normalize(question);
  if (!normalizedQuestion) {
    return { status: "NEEDS_USER_INPUT", reason: "empty_question", confidence: 0, answer: undefined };
  }

  const lower = normalizedQuestion;

  if (/^(?:please )?(?:describe|tell us about|share|discuss|explain|elaborate)\b/.test(lower)) {
    return { status: "NEEDS_USER_INPUT", intent: "narrative_experience", questionType: "narrative", reason: "narrative questions require a human-authored answer", confidence: 0.15, answer: undefined };
  }

  // Notice period & LWD
  const noticePeriod = answers.noticePeriod || {};
  const asksForLwd = /\b(?:last working day|lwd)\b/i.test(lower);
  if (/\bnotice period\b/i.test(lower) && asksForLwd) {
    if (noticePeriod.servingNoticePeriod !== true) {
      return { status: "NEEDS_USER_INPUT", intent: "notice_period_with_lwd", questionType: "compound", reason: "last working day is only provided while actively serving notice", confidence: 0.25, answer: undefined };
    }
    if (noticePeriod.days === undefined || noticePeriod.days === null || noticePeriod.days === ""
        || !noticePeriod.lastWorkingDay) {
      return { status: "NEEDS_USER_INPUT", intent: "notice_period_with_lwd", questionType: "compound", reason: "notice period days and last working day must both be configured", confidence: 0.3, answer: undefined };
    }
    return {
      status: "RESOLVED",
      intent: "notice_period_with_lwd",
      answerSources: ["answers.noticePeriod.days", "answers.noticePeriod.lastWorkingDay"],
      values: {
        noticePeriodDays: Number(noticePeriod.days),
        lastWorkingDay: noticePeriod.lastWorkingDay
      },
      questionType: "compound",
      confidence: 0.98
    };
  }

  if (/\b(?:are you )?(?:currently )?serving (?:your )?(?:notice period|notice)\b/i.test(lower)) {
    if (noticePeriod.servingNoticePeriod === undefined || noticePeriod.servingNoticePeriod === null) {
      return { status: "NEEDS_USER_INPUT", intent: "serving_notice_period", questionType: "boolean", reason: "serving notice status is not configured", confidence: 0.3, answer: undefined };
    }
    const answer = Boolean(noticePeriod.servingNoticePeriod);
    return { status: "RESOLVED", intent: "serving_notice_period", answerSource: "answers.noticePeriod.servingNoticePeriod", answer, displayValue: answer ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }

  if (asksForLwd) {
    if (noticePeriod.servingNoticePeriod === false) {
      return { status: "NEEDS_USER_INPUT", intent: "last_working_day", questionType: "date", reason: "last working day is not provided when not serving notice", confidence: 0.25, answer: undefined };
    }
    if (!noticePeriod.lastWorkingDay) {
      return { status: "NEEDS_USER_INPUT", intent: "last_working_day", questionType: "date", reason: "last working day is not configured", confidence: 0.3, answer: undefined };
    }
    return { status: "RESOLVED", intent: "last_working_day", answerSource: "answers.noticePeriod.lastWorkingDay", answer: noticePeriod.lastWorkingDay, questionType: "date", confidence: 0.99 };
  }

  if (/what is your notice period in days\??|notice period in days\??/i.test(lower)) {
    if (noticePeriod.days === undefined || noticePeriod.days === null || noticePeriod.days === "") {
      return { status: "NEEDS_USER_INPUT", intent: "notice_period_days", questionType: "notice_period", reason: "notice period days are not configured", confidence: 0.3, answer: undefined };
    }
    return { status: "RESOLVED", intent: "notice_period_days", answerSource: "answers.noticePeriod.days", answer: Number(noticePeriod.days), questionType: "notice_period", confidence: 0.99 };
  }

  if (/what is your notice period in months\??|notice period in months\??/i.test(lower)) {
    if (noticePeriod.months === undefined || noticePeriod.months === null || noticePeriod.months === "") {
      return { status: "NEEDS_USER_INPUT", intent: "notice_period_months", questionType: "notice_period", reason: "notice period months are not configured", confidence: 0.3, answer: undefined };
    }
    return { status: "RESOLVED", intent: "notice_period_months", answerSource: "answers.noticePeriod.months", answer: Number(noticePeriod.months), questionType: "notice_period", confidence: 0.99 };
  }

  // Compound location + relocation
  if (isCompoundLocationRelocationQuestion(question)) {
    const canonicalCurrentLocation = String(answers.contact?.currentLocation || answers.contact?.location || "Pune").trim();
    const normalizedCanonical = normalize(canonicalCurrentLocation);
    const willingToRelocate = Boolean(
      answers.workPreferences?.willingToRelocate ?? answers.relocation?.willingToRelocate ?? true
    );
    const segments = String(question).split(/\b(?:or|and|\/)\b/i);
    const residenceSegment = segments.find(seg => /\b(?:currently residing|currently living|living in|residing in|reside in|live in|located in|currently in|current residence|currently|presently)\b/i.test(seg)) || segments[0] || question;
    const normalizedResidence = normalize(residenceSegment);

    let currentResidence = false;
    if (normalizedCanonical) {
      const cityRegex = new RegExp(`\\b${normalizedCanonical}\\b`, "i");
      currentResidence = cityRegex.test(normalizedResidence);
    }

    const combinedOR = Boolean(currentResidence || willingToRelocate);

    return {
      status: "RESOLVED",
      intent: "compound_location_relocation",
      answerSources: ["answers.contact.currentLocation", "answers.workPreferences.willingToRelocate"],
      answerSource: "answers.contact.currentLocation, answers.workPreferences.willingToRelocate",
      currentResidence,
      willingToRelocate,
      combinedOR,
      answer: combinedOR,
      displayValue: combinedOR ? "Yes" : "No",
      questionType: "boolean",
      confidence: 0.99,
      entities: {
        currentResidence,
        willingToRelocate,
        combinedOR
      }
    };
  }

  // Multi-select relocation locations
  if (/\b(?:which (?:of these )?locations|which (?:of these )?cities|select (?:preferred )?relocation|choose (?:preferred )?relocation|preferred relocation (?:locations|cities)|relocation locations|relocation cities)\b/i.test(lower)
      || (/\brelocation\b/i.test(lower) && /\b(?:locations|cities|places)\b/i.test(lower) && /\b(?:which|select|choose|prefer|open|willing)\b/i.test(lower))) {
    const locations = answers.relocation?.locations || ["Remote", "Pune", "Gurugram", "Noida", "Delhi/NCR"];
    return {
      status: "RESOLVED",
      intent: "relocation_locations",
      answerSource: "answers.relocation.locations",
      answer: locations,
      displayValue: locations.join(", "),
      questionType: "multi_select_locations",
      confidence: 0.99,
      entities: { locations }
    };
  }

  // Salary
  if (/expected|desired/i.test(lower) && /(salary|ctc|compensation|remuneration|annual pay)/i.test(lower)) {
    const expected = answers.salary?.expectedCTC ?? 13;
    return { status: "RESOLVED", intent: "expected_salary", answerSource: "answers.salary.expectedCTC", answer: Number(expected), displayValue: String(expected), questionType: "salary", confidence: 0.99 };
  }
  if (/(current|present)/i.test(lower) && /(salary|ctc|compensation|remuneration|annual pay)/i.test(lower)) {
    const current = answers.salary?.currentCTC ?? 8;
    return { status: "RESOLVED", intent: "current_salary", answerSource: "answers.salary.currentCTC", answer: Number(current), displayValue: String(current), questionType: "salary", confidence: 0.99 };
  }
  if (/currency/i.test(lower) && /(salary|ctc|pay)/i.test(lower)) {
    const curr = answers.salary?.currency || "INR";
    return { status: "RESOLVED", intent: "salary_currency", answerSource: "answers.salary.currency", answer: curr, displayValue: curr, questionType: "text", confidence: 0.99 };
  }

  // Employment
  if (/\b(?:currently employed|currently working)\b/i.test(lower) || /are you currently (?:employed|working)/i.test(lower)) {
    const val = answers.employment?.currentlyEmployed ?? true;
    return { status: "RESOLVED", intent: "currently_employed", answerSource: "answers.employment.currentlyEmployed", answer: Boolean(val), displayValue: val ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }
  if (/\bactively looking\b/i.test(lower) || /are you actively looking/i.test(lower)) {
    const val = answers.employment?.activelyLooking ?? true;
    return { status: "RESOLVED", intent: "actively_looking", answerSource: "answers.employment.activelyLooking", answer: Boolean(val), displayValue: val ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }

  // Work Preferences
  if (/\bnight shifts?\b|\brotational shifts?\b/i.test(lower)) {
    const val = answers.workPreferences?.nightShift ?? true;
    return { status: "RESOLVED", intent: "night_shift", answerSource: "answers.workPreferences.nightShift", answer: Boolean(val), displayValue: val ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }
  if (/\bhybrid\b/i.test(lower) && /\bnoida\b/i.test(lower)) {
    const val = answers.workPreferences?.hybridNoida ?? true;
    return { status: "RESOLVED", intent: "hybrid_noida", answerSource: "answers.workPreferences.hybridNoida", answer: Boolean(val), displayValue: val ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }
  if (/\btravel for interview\b|\btravel for face to face\b/i.test(lower)) {
    const val = answers.workPreferences?.willingToTravelForInterview ?? false;
    return { status: "RESOLVED", intent: "willing_to_travel_for_interview", answerSource: "answers.workPreferences.willingToTravelForInterview", answer: Boolean(val), displayValue: val ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }

  // Certifications
  if (/\bazure\b/i.test(lower) && /\bcertif/i.test(lower)) {
    const val = answers.certifications?.azure ?? false;
    return { status: "RESOLVED", intent: "certifications_azure", answerSource: "answers.certifications.azure", answer: Boolean(val), displayValue: val ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }

  // Domain experience
  if (/\bhealthcare\b/i.test(lower) && /\b(?:interoperability|domain|experience)\b/i.test(lower)) {
    const val = answers.domain?.healthcareInteroperability ?? answers.domain?.healthcare ?? 3;
    return { status: "RESOLVED", intent: "domain_healthcare", answerSource: "answers.domain.healthcare", answer: Number(val), displayValue: String(val), questionType: "numeric_experience", confidence: 0.98 };
  }

  // Education
  if (/\bhighest qualification\b|\bhighest degree\b|\bhighest education\b/i.test(lower)) {
    const val = answers.education?.highestQualification || "MCA";
    return { status: "RESOLVED", intent: "highest_qualification", answerSource: "answers.education.highestQualification", answer: val, displayValue: val, questionType: "text", confidence: 0.99 };
  }
  if (/\bgraduation year\b|\byear of graduation\b|\bpassing year\b|\byear of passing\b/i.test(lower)) {
    const val = answers.education?.graduationYear || 2023;
    return { status: "RESOLVED", intent: "graduation_year", answerSource: "answers.education.graduationYear", answer: Number(val), displayValue: String(val), questionType: "text", confidence: 0.99 };
  }

  // Compliance
  if (/\bdisability\b/i.test(lower)) {
    const val = answers.compliance?.disability || "No";
    return { status: "RESOLVED", intent: "compliance_disability", answerSource: "answers.compliance.disability", answer: val, displayValue: val, questionType: "text", confidence: 0.99 };
  }
  if (/\bveteran\b/i.test(lower)) {
    const val = answers.compliance?.veteranStatus || "No";
    return { status: "RESOLVED", intent: "compliance_veteran", answerSource: "answers.compliance.veteranStatus", answer: val, displayValue: val, questionType: "text", confidence: 0.99 };
  }

  // Locations
  if (/what is your current (?:location|city)\??|where are you currently located\??|current (?:location|city)\??|where do you currently live\??/i.test(lower)) {
    return { status: "RESOLVED", intent: "current_location", answerSource: "answers.contact.currentLocation", answer: answers.contact?.currentLocation || answers.contact?.location || "Pune", displayValue: answers.contact?.currentLocation || answers.contact?.location || "Pune", questionType: "location", confidence: 0.99 };
  }

  if (/preferred (?:job )?(?:location|city|locations|cities)/i.test(lower) || /locations? you prefer/i.test(lower)) {
    const pref = answers.contact?.preferredLocation || "Pune, Noida, Gurugram, Delhi, Mumbai, Bangalore, Hyderabad";
    return { status: "RESOLVED", intent: "preferred_location", answerSource: "answers.contact.preferredLocation", answer: pref, displayValue: pref, questionType: "location", confidence: 0.99 };
  }

  if (/are you willing to relocate\??|willing to relocate\??|relocate\??/i.test(lower)) {
    return { status: "RESOLVED", intent: "willing_to_relocate", answerSource: "answers.workPreferences.willingToRelocate", answer: Boolean(answers.workPreferences?.willingToRelocate ?? answers.relocation?.willingToRelocate ?? true), displayValue: "Yes", questionType: "boolean", confidence: 0.99 };
  }

  if (/do you require visa sponsorship\??|require visa sponsorship\??|visa sponsorship\??/i.test(lower)) {
    return { status: "RESOLVED", intent: "visa_sponsorship_required", answerSource: "answers.workPreferences.visaSponsorshipRequired", answer: Boolean(answers.workPreferences?.visaSponsorshipRequired), displayValue: answers.workPreferences?.visaSponsorshipRequired ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }

  if (/authorized to work|work authorization|legally authorized/i.test(lower)) {
    const auth = answers.workPreferences?.workAuthorization || "India";
    return { status: "RESOLVED", intent: "work_authorization", answerSource: "answers.workPreferences.workAuthorization", answer: auth, displayValue: "Yes", questionType: "text", confidence: 0.99 };
  }

  // Total Experience
  if (/(how many years(?:.*)?experience.*do you have|total.*experience|professional experience|work experience)/i.test(lower) && !/(with|in|for|on)\s+[a-z0-9 .#&/\-]+/i.test(lower)) {
    return {
      status: "RESOLVED",
      intent: "total_experience_years",
      answerSource: "answers.experience.totalYears",
      answer: Number(answers.experience?.totalYears ?? applicationConfig.experienceYears ?? 3),
      displayValue: String(answers.experience?.totalYears ?? applicationConfig.experienceYears ?? 3),
      questionType: "numeric_experience",
      confidence: 0.99
    };
  }

  // Check compound / multi-skill / open-ended experience questions first
  if (/(?:how many years|years of experience).*(?:aws|azure|gcp).*(?:aws|azure|gcp)/i.test(question)
      || /\b(?:aws|azure|gcp)\s*(?:\/|\band\b)\s*(?:aws|azure|gcp)\b/i.test(question)
      || /\bci\/cd\s*(?:\/|\band\b)\s*kubernetes\b/i.test(question)
      || /\bkubernetes\s*(?:\/|\band\b)\s*ci\/cd\b/i.test(question)
      || /\bopen source technologies\b/i.test(lower)) {
    return { status: "NEEDS_USER_INPUT", intent: "compound_skill_experience", questionType: "numeric_experience", reason: "compound or open-ended question cannot safely resolve to a single value", confidence: 0.35, answer: undefined };
  }

  // Specific skill experience (years)
  const skillQuestionMatch = question.match(/(?:how many years(?:.*)?(?:experience)?(?:.*)?(?:with|in|for|on)\s+(.+?))(?:\?|$)/i)
    || question.match(/(?:how many years(?:.*)?(?:with|in|for|on)\s+)(.+?)(?:\?|$)/i);

  const booleanSkillQuestionMatch = question.match(/(?:do you have experience with|have you worked with|experience with)\s+(.+?)(?:\?|$)/i)
    || question.match(/(?:do you have experience in|have you worked in)\s+(.+?)(?:\?|$)/i);

  if (skillQuestionMatch) {
    const rawSkillText = skillQuestionMatch[1].replace(/\s*(?:\.\.\.|\.)?$/g, "").trim();
    if (isGenericOrUnsupportedSkillSubject(rawSkillText)) {
      return { status: "NEEDS_USER_INPUT", intent: "unknown_skill_experience", answerSource: null, questionType: "numeric_experience", reason: `generic or unsupported skill subject: ${rawSkillText}`, confidence: 0.2, answer: undefined };
    }
    if (/\b(?:fullstack|full stack|developer)\b/i.test(rawSkillText) && !answers.skills?.[rawSkillText]) {
      return { status: "NEEDS_USER_INPUT", intent: "unknown_skill_experience", answerSource: null, questionType: "numeric_experience", reason: `fullstack or role descriptor requires semantic classification: ${rawSkillText}`, confidence: 0.2, answer: undefined };
    }
    const segments = parseSkillNames(rawSkillText);
    if (segments.length > 1) {
      return { status: "NEEDS_USER_INPUT", intent: "compound_skill_experience", answerSource: null, questionType: "numeric_experience", reason: "compound skill question requires a single unambiguous answer", confidence: 0.4, answer: undefined };
    }
    const skillName = segments[0] || rawSkillText;
    const configuredValue = findConfiguredSkillValue(skillName, applicationConfig);
    const isConfigured = configuredValue !== undefined && configuredValue !== null && configuredValue !== "";
    const canonicalSkill = findCanonicalSkillName(skillName, applicationConfig) || (normalizedSkillName(skillName) === "ruby on rails" ? "Ruby on Rails" : skillName);
    const numericYears = isConfigured ? Number(configuredValue) : 0;
    const isRor = normalizedSkillName(canonicalSkill) === "ruby on rails";
    const hasSafeNa = isRor || !isConfigured;

    return {
      status: "RESOLVED",
      intent: "skill_experience_years",
      answerSource: isConfigured ? `answers.skills.${canonicalSkill}` : "answers.skills (unconfigured => 0)",
      answer: numericYears,
      ...(hasSafeNa ? { safeTextualAnswer: "NA" } : {}),
      questionType: "numeric_experience",
      confidence: isConfigured ? 0.97 : 0.95,
      entities: { skill: canonicalSkill }
    };
  }

  if (booleanSkillQuestionMatch) {
    const rawSkillText = booleanSkillQuestionMatch[1].replace(/\s*(?:\.\.\.|\.)?$/g, "").trim();
    const segments = parseSkillNames(rawSkillText);
    if (segments.length > 1) {
      const values = segments.map(seg => findConfiguredSkillValue(seg, applicationConfig));
      const allPositive = values.every(v => v !== undefined && Number(v) > 0);
      const allZero = values.every(v => v !== undefined && Number(v) === 0);
      if (allPositive) {
        return {
          status: "RESOLVED",
          intent: "boolean_skill_experience",
          answerSource: `answers.skills.${segments.join(", ")}`,
          answer: true,
          questionType: "boolean",
          confidence: 0.97,
          displayValue: "Yes",
          entities: { skills: segments }
        };
      }
      if (allZero) {
        return {
          status: "RESOLVED",
          intent: "boolean_skill_experience",
          answerSource: `answers.skills.${segments.join(", ")}`,
          answer: false,
          questionType: "boolean",
          confidence: 0.97,
          displayValue: "No",
          entities: { skills: segments }
        };
      }
      return { status: "NEEDS_USER_INPUT", intent: "compound_skill_boolean", answerSource: null, questionType: "boolean", reason: "compound boolean skill question requires a single unambiguous answer", confidence: 0.4, answer: undefined };
    }
    const skillName = segments[0] || rawSkillText;
    const configuredValue = findConfiguredSkillValue(skillName, applicationConfig);
    const isConfigured = configuredValue !== undefined && configuredValue !== null && configuredValue !== "";
    const canonicalSkill = findCanonicalSkillName(skillName, applicationConfig) || skillName;
    const answer = isConfigured ? Number(configuredValue) > 0 : false;
    return {
      status: "RESOLVED",
      intent: "boolean_skill_experience",
      answerSource: isConfigured ? `answers.skills.${canonicalSkill}` : "answers.skills (unconfigured => 0)",
      answer,
      questionType: "boolean",
      confidence: isConfigured ? 0.97 : 0.95,
      displayValue: answer ? "Yes" : "No",
      entities: { skill: canonicalSkill }
    };
  }

  if (/how many years.*(aws|azure|gcp)/i.test(lower) || /ci\/cd.*kubernetes|kubernetes.*ci\/cd/i.test(lower) || /open source technologies/i.test(lower)) {
    return { status: "NEEDS_USER_INPUT", intent: "compound_skill_experience", questionType: "numeric_experience", reason: "compound or open-ended question cannot safely resolve to a single value", confidence: 0.35, answer: undefined };
  }

  if (/notice period/i.test(lower)) {
    const answer = resolveAnswer("notice_period", { applicationConfig, profile: sources.profile || {}, question: lower });
    if (answer !== undefined) {
      return { status: "RESOLVED", intent: "notice_period", answerSource: "answers.noticePeriod.days", answer, displayValue: String(answer), questionType: "notice_period", confidence: 0.9 };
    }
    return { status: "NEEDS_USER_INPUT", intent: "notice_period", questionType: "notice_period", reason: "notice period data is not safely available", confidence: 0.3, answer: undefined };
  }

  if (/\b(?:location|city|where are you)\b/i.test(lower)) {
    const answer = resolveAnswer("current_location", { applicationConfig, profile: sources.profile || {}, question: lower });
    if (answer !== undefined) {
      return { status: "RESOLVED", intent: "current_location", answerSource: "answers.contact.currentLocation", answer, displayValue: String(answer), questionType: "location", confidence: 0.99 };
    }
  }

  if (/relocat/i.test(lower)) {
    const answer = resolveAnswer("willing_to_relocate", { applicationConfig, profile: sources.profile || {}, question: lower });
    if (answer !== undefined) {
      return { status: "RESOLVED", intent: "willing_to_relocate", answerSource: "answers.workPreferences.willingToRelocate", answer: Boolean(answer), displayValue: answer ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
    }
  }

  if (/visa sponsorship|sponsorship/i.test(lower)) {
    const answer = resolveAnswer("visa_sponsorship", { applicationConfig, profile: sources.profile || {}, question: lower });
    if (answer !== undefined) {
      return { status: "RESOLVED", intent: "visa_sponsorship_required", answerSource: "answers.workPreferences.visaSponsorshipRequired", answer: Boolean(answer), displayValue: answer ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
    }
  }

  return { status: "NEEDS_USER_INPUT", intent: "unknown", questionType: "unknown", reason: "question is not safely resolvable from the canonical answers source", confidence: 0.12, answer: undefined };
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/(["']?(?:new[_\s-]?password|confirm[_\s-]?password|password|credential|access[_\s-]?token|auth(?:entication)?[_\s-]?token|api[_\s-]?key)["']?\s*[:=]\s*["']?)([^"'&,\s}\]]+)/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}

module.exports = {
  canonicalQuestion,
  findCanonicalSkillName,
  findConfiguredSkillValue,
  isCompoundLocationRelocationQuestion,
  normalize,
  normalizedSkillName,
  redactSensitiveText,
  resolveAnswer,
  resolveConfiguredAnswer,
  resolveSemanticAnswer,
  sensitiveField
};
