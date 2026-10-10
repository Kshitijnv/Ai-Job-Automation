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
  "web service": "Web Service",
  "web services": "Web Service",
  "webservices": "Web Service",
  "redis": "Redis",

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
  "fast api": "FastAPI",
  "python": "Python",
  "python development": "Python",
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

/**
 * Looks up a skill in application.json answers.skills (or domain skills).
 * If the skill is not configured, it returns value: 0 (Primary Business Rule).
 */
function lookupSkillValue(skillName, applicationConfig = {}) {
  const answers = getAnswersObject(applicationConfig);
  const skills = answers.skills || {};
  const trimmed = String(skillName || "").trim();
  const norm = normalize(trimmed);
  if (!norm) return { found: false, value: 0, canonicalName: trimmed };

  // 1. Direct match
  const exactKey = Object.keys(skills).find(k => normalize(k) === norm);
  if (exactKey !== undefined && skills[exactKey] !== undefined) {
    return { found: true, value: Number(skills[exactKey]), canonicalName: exactKey };
  }

  // 2. Alias lookup
  if (SKILL_ALIASES[norm]) {
    const aliasTarget = SKILL_ALIASES[norm];
    const aliasKey = Object.keys(skills).find(k => normalize(k) === normalize(aliasTarget));
    if (aliasKey !== undefined && skills[aliasKey] !== undefined) {
      return { found: true, value: Number(skills[aliasKey]), canonicalName: aliasKey };
    }
    if (skills[aliasTarget] !== undefined) {
      return { found: true, value: Number(skills[aliasTarget]), canonicalName: aliasTarget };
    }
  }

  // 3. Normalized skill name matching
  const targetNormSkill = normalizedSkillName(trimmed);
  const normKey = Object.keys(skills).find(k => normalizedSkillName(k) === targetNormSkill);
  if (normKey !== undefined && skills[normKey] !== undefined) {
    return { found: true, value: Number(skills[normKey]), canonicalName: normKey };
  }

  // 4. Domain skills (e.g. Healthcare, FHIR, IHE XDS)
  const domain = answers.domain || {};
  const domainKey = Object.keys(domain).find(k => normalize(k) === norm);
  if (domainKey !== undefined && Number.isFinite(Number(domain[domainKey]))) {
    return { found: true, value: Number(domain[domainKey]), canonicalName: domainKey };
  }

  // 5. Unconfigured skill => 0 years (Rule 1: Absent skill = 0)
  const canonicalName = findCanonicalSkillName(trimmed, applicationConfig) || trimmed;
  return { found: false, value: 0, canonicalName };
}

function findConfiguredSkillValue(skillName, applicationConfig = {}) {
  const res = lookupSkillValue(skillName, applicationConfig);
  return res.value;
}

/**
 * Parses multiple skills from a subject string (e.g. "C#/.NET development", "GenAI / LLM / RAG").
 */
function parseSkillsFromSubject(rawSubject) {
  let cleaned = String(rawSubject || "")
    .replace(/\s*(?:\.\.\.|\.)+$/g, "")
    .replace(/\s*\(in years\)/gi, "")
    .replace(/\b(?:do you have|have you worked|have you been working|have you been|did you work|worked with|working with)\b.*$/i, "")
    .replace(/^(?:a|an|the|your)\s+/i, "")
    .replace(/\bci\s*\/\s*cd\b/gi, "__CICD__")
    .replace(/\b(?:full[ -]?stack|fullstack|front[ -]?end|frontend|back[ -]?end|backend|developer|development|engineer|engineering|programming|programmer|frameworks?|technologies|technology|tech stack|stack|tools?|apps?|applications?)\b/gi, " ")
    .replace(/[?!]/g, " ")
    .trim();

  if (!cleaned) return [];

  // Split on delimiters: / , & ; | + and words 'and', 'or', 'using'
  const rawParts = cleaned
    .split(/\s*(?:\band\b|\bor\b|\/|,|&|;|\||\+|\busing\b)\s*/i)
    .map(p => p.trim())
    .filter(Boolean);

  const skills = [];
  for (const part of rawParts) {
    const restored = part.replace(/__CICD__/g, "CI/CD");
    if (/\bc#\s+\.net\b/i.test(restored)) {
      skills.push("C#", ".NET");
    } else if (/\b\.net\s+c#\b/i.test(restored)) {
      skills.push(".NET", "C#");
    } else if (restored.length > 0) {
      skills.push(restored);
    }
  }

  return skills;
}

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

function isLocationMatched(optionLabel, canonicalLocations = []) {
  const normLabel = normalize(optionLabel);
  return canonicalLocations.some(location => {
    const normLoc = normalize(location);
    if (normLabel === normLoc) return true;
    if (normLoc.includes("remote") && normLabel.includes("remote")) return true;
    if (normLoc.includes("gurugram") && (normLabel.includes("gurugram") || normLabel.includes("gurgaon"))) return true;
    if (normLoc.includes("noida") && normLabel.includes("noida")) return true;
    if ((normLoc.includes("delhi") || normLoc.includes("ncr")) && (normLabel.includes("delhi") || normLabel.includes("ncr"))) return true;
    if (normLoc.includes("pune") && normLabel.includes("pune")) return true;
    if (normLoc.includes("mumbai") && normLabel.includes("mumbai")) return true;
    if (normLoc.includes("bangalore") && (normLabel.includes("bangalore") || normLabel.includes("bengaluru"))) return true;
    if (normLoc.includes("hyderabad") && normLabel.includes("hyderabad")) return true;
    return false;
  });
}

function experienceQuestion(label) {
  const text = normalize(label);
  if (!text || /^(?:please )?(?:describe|tell us about|share|discuss|explain|elaborate)\b/.test(text)) return null;

  const numericDuration = /\b(?:how many|number of)\s+(?:total\s+)?years?\b/.test(text)
    || /\bhow much experience\b/.test(text)
    || /\byears?\s+(?:of|working|worked|experience)\b/.test(text)
    || /\bhow long\b.*\b(?:work|worked|working|experience|been)\b/.test(text)
    || /\btotal (?:work|professional) experience\b/.test(text)
    || /\bexperience\s+in\s+years\b/.test(text)
    || /\bexperience\s*\(in years\)/.test(text);
  if (!numericDuration) return null;

  const hasSpecificQualifier = /\b(?:with|using|in|as|for|on|of)\b/.test(text) && !/\bin total\b/.test(text);
  const contextualSubject = text.match(/\b(?:with|using|in|as|for|on|of)\s+(.+)$/);
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
    case "react_experience": return answers.skills?.React ?? 0;
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
  if (experience.type === "general") {
    return sources.applicationConfig?.answers?.experience?.totalYears ?? sources.applicationConfig?.experienceYears ?? 3;
  }
  if (experience.type === "unsupported") return undefined;
  
  // Single or multiple skill experience resolution
  const skills = parseSkillsFromSubject(experience.subject);
  if (!skills.length) return 0;
  const lookup = skills.map(s => lookupSkillValue(s, sources.applicationConfig));
  const uniqueVals = [...new Set(lookup.map(l => l.value))];
  if (uniqueVals.length === 1) return uniqueVals[0];
  return undefined;
}

function resolveConfiguredAnswer(canonicalId, sources = {}) {
  if (sources.experienceYearsRule && canonicalId && canonicalId.startsWith("years_experience")) {
    return resolveExperienceAnswer(sources.question, sources);
  }
  return resolveAnswer(canonicalId, sources);
}

/**
 * Main semantic question resolver implementing Rules 1 through 16.
 */
function resolveSemanticAnswer(question, sources = {}) {
  const applicationConfig = sources.applicationConfig || {};
  const answers = getAnswersObject(applicationConfig);
  const normalizedQuestion = normalize(question);
  if (!normalizedQuestion) {
    return { status: "NEEDS_USER_INPUT", reason: "empty_question", confidence: 0, answer: undefined };
  }

  const lower = normalizedQuestion;

  // Rule 5: Narrative questions
  if (/^(?:please )?(?:describe|tell us about|share|discuss|explain|elaborate)\b/.test(lower)) {
    return {
      status: "NEEDS_USER_INPUT",
      intent: "narrative_experience",
      questionType: "narrative",
      reason: "narrative questions require a human-authored answer",
      confidence: 0.15,
      answer: undefined
    };
  }

  // Rule 14: Frontend Skills List Questions
  if (/\b(?:in front end|in frontend|in ui)\b.*\b(?:which skills|what skills|which technologies|what technologies|experience in which)\b/i.test(question)
      || /\b(?:which|what)\s+(?:front end|frontend|ui)\s+(?:skills|technologies)\s+(?:do you have|do you know|are you experienced in|have you worked)/i.test(question)) {
    const FRONTEND_SKILLS = new Set([
      "angular", "angular 19", "typescript", "javascript", "html", "html5", "css", "css3", "bootstrap", "tailwind css", "rxjs", "ngrx"
    ]);
    const configuredSkills = answers.skills || {};
    const matchingSkills = Object.keys(configuredSkills).filter(k =>
      FRONTEND_SKILLS.has(normalize(k)) && Number(configuredSkills[k]) > 0
    );
    return {
      status: "RESOLVED",
      intent: "frontend_skills_list",
      answerSource: "answers.skills (frontend skills > 0)",
      answer: matchingSkills,
      displayValue: matchingSkills.join(", "),
      questionType: "skill_list",
      confidence: 0.98,
      entities: { skills: matchingSkills }
    };
  }

  // Rule 9: Last Working Day (LWD)
  const noticePeriod = answers.noticePeriod || {};
  const asksForLwd = /\b(?:last working day|last working date|lwd)\b/i.test(lower);
  
  // Notice period compound with LWD
  if (/\bnotice period\b/i.test(lower) && asksForLwd) {
    if (noticePeriod.servingNoticePeriod !== true) {
      return { status: "NEEDS_USER_INPUT", intent: "notice_period_with_lwd", questionType: "compound", reason: "last working day is only provided while actively serving notice", confidence: 0.25, answer: undefined };
    }
    if (noticePeriod.days === undefined || noticePeriod.days === null || noticePeriod.days === "" || !noticePeriod.lastWorkingDay) {
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
    return { status: "RESOLVED", intent: "last_working_day", answerSource: "answers.noticePeriod.lastWorkingDay", answer: noticePeriod.lastWorkingDay, displayValue: noticePeriod.lastWorkingDay, questionType: "date", confidence: 0.99 };
  }

  if (/what is your notice period in days\??|notice period in days\??/i.test(lower)) {
    if (noticePeriod.days === undefined || noticePeriod.days === null || noticePeriod.days === "") {
      return { status: "NEEDS_USER_INPUT", intent: "notice_period_days", questionType: "notice_period", reason: "notice period days are not configured", confidence: 0.3, answer: undefined };
    }
    return { status: "RESOLVED", intent: "notice_period_days", answerSource: "answers.noticePeriod.days", answer: Number(noticePeriod.days), displayValue: String(noticePeriod.days), questionType: "notice_period", confidence: 0.99 };
  }

  if (/what is your notice period in months\??|notice period in months\??/i.test(lower)) {
    if (noticePeriod.months === undefined || noticePeriod.months === null || noticePeriod.months === "") {
      return { status: "NEEDS_USER_INPUT", intent: "notice_period_months", questionType: "notice_period", reason: "notice period months are not configured", confidence: 0.3, answer: undefined };
    }
    return { status: "RESOLVED", intent: "notice_period_months", answerSource: "answers.noticePeriod.months", answer: Number(noticePeriod.months), displayValue: String(noticePeriod.months), questionType: "notice_period", confidence: 0.99 };
  }

  // Rule 16: Immediate Joining
  if (/\b(?:can you join immediately|are you (?:an )?immediate joiner|available to join immediately|immediate joining)\b/i.test(lower)) {
    const isServing = Boolean(noticePeriod.servingNoticePeriod);
    const days = Number(noticePeriod.days ?? 90);
    const isImmediate = !isServing && days === 0;
    return {
      status: "RESOLVED",
      intent: "immediate_joining",
      answerSource: "answers.noticePeriod",
      answer: isImmediate,
      displayValue: isImmediate ? "Yes" : "No",
      questionType: "boolean",
      confidence: 0.98
    };
  }

  // Rule 10: Compound location + relocation
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

  // Rule 11: Specific city relocation (e.g. "Are you willing to relocate to Noida?" vs "Indore")
  const specificRelocMatch = question.match(/(?:willing|ready|open)\s+to\s+relocate\s+to\s+([a-z/ ]+?)(?:\?|$)/i);
  if (specificRelocMatch) {
    const targetCity = specificRelocMatch[1].trim();
    const configuredLocations = answers.relocation?.locations || ["Remote", "Pune", "Gurugram", "Noida", "Delhi/NCR"];
    const isMatched = isLocationMatched(targetCity, configuredLocations);
    return {
      status: "RESOLVED",
      intent: "willing_to_relocate_city",
      answerSource: "answers.relocation.locations",
      answer: isMatched,
      displayValue: isMatched ? "Yes" : "No",
      questionType: "boolean",
      confidence: 0.98,
      entities: { targetCity, matched: isMatched }
    };
  }

  // Relocation / Preferred locations list
  if (/\b(?:which (?:of these )?locations?|which (?:of these )?cities|select (?:preferred )?(?:relocation|work)?\s*(?:locations?|cities)|choose (?:preferred )?(?:relocation|work)?\s*(?:locations?|cities)|preferred (?:relocation|work)?\s*(?:locations?|cities)|relocation locations?|relocation cities?|which locations? (?:are you |do you )?(?:willing to|prefer to|ready to)?\s*(?:work|relocate|live)(?: from)?|where are you willing to work|where do you want to work)\b/i.test(lower)
      || (/\b(?:relocation|work location|preferred location|willing to work|location to work)\b/i.test(lower) && /\b(?:locations?|cities|places)\b/i.test(lower) && /\b(?:which|select|choose|prefer|open|willing|work from)\b/i.test(lower))
      || /\bwhich location are you willing to work from\b/i.test(lower)) {
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

  // Salary & CTC
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

  // Rule 12: Work Preferences & Night shift
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

  // Rule 13: Certifications (Azure)
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

  // Rule 10: Location & Residence questions
  if (/\bare you currently based in\s+([a-z/ ]+?)(?:\?|$)/i.test(question)
      || /\bdo you currently live in\s+([a-z/ ]+?)(?:\?|$)/i.test(question)
      || /\bdo you currently reside in\s+([a-z/ ]+?)(?:\?|$)/i.test(question)) {
    const targetCity = (question.match(/\b(?:based in|live in|reside in)\s+([a-z/ ]+?)(?:\?|$)/i)?.[1] || "").trim();
    const currLoc = String(answers.contact?.currentLocation || answers.contact?.location || "Pune").trim();
    const isMatched = isLocationMatched(targetCity, [currLoc]);
    return {
      status: "RESOLVED",
      intent: "current_location_boolean",
      answerSource: "answers.contact.currentLocation",
      answer: isMatched,
      displayValue: isMatched ? "Yes" : "No",
      questionType: "boolean",
      confidence: 0.98
    };
  }

  if (/what is your current (?:location|city)\??|where are you currently located\??|current (?:location|city)\??|where do you currently live\??/i.test(lower)) {
    const loc = answers.contact?.currentLocation || answers.contact?.location || "Pune";
    return { status: "RESOLVED", intent: "current_location", answerSource: "answers.contact.currentLocation", answer: loc, displayValue: loc, questionType: "location", confidence: 0.99 };
  }

  if (/preferred (?:job )?(?:location|city|locations|cities)/i.test(lower) || /locations? you prefer/i.test(lower)) {
    const pref = answers.contact?.preferredLocation || "Pune, Noida, Gurugram, Delhi, Mumbai, Bangalore, Hyderabad";
    return { status: "RESOLVED", intent: "preferred_location", answerSource: "answers.contact.preferredLocation", answer: pref, displayValue: pref, questionType: "location", confidence: 0.99 };
  }

  if (/are you willing to relocate\??|willing to relocate\??/i.test(lower)) {
    return { status: "RESOLVED", intent: "willing_to_relocate", answerSource: "answers.workPreferences.willingToRelocate", answer: Boolean(answers.workPreferences?.willingToRelocate ?? answers.relocation?.willingToRelocate ?? true), displayValue: "Yes", questionType: "boolean", confidence: 0.99 };
  }

  if (/do you require visa sponsorship\??|require visa sponsorship\??|visa sponsorship\??/i.test(lower)) {
    return { status: "RESOLVED", intent: "visa_sponsorship_required", answerSource: "answers.workPreferences.visaSponsorshipRequired", answer: Boolean(answers.workPreferences?.visaSponsorshipRequired), displayValue: answers.workPreferences?.visaSponsorshipRequired ? "Yes" : "No", questionType: "boolean", confidence: 0.99 };
  }

  if (/authorized to work|work authorization|legally authorized/i.test(lower)) {
    const auth = answers.workPreferences?.workAuthorization || "India";
    return { status: "RESOLVED", intent: "work_authorization", answerSource: "answers.workPreferences.workAuthorization", answer: auth, displayValue: "Yes", questionType: "text", confidence: 0.99 };
  }

  // Rule 8: General Total Experience (No skill specified)
  const isGeneralExp = /^(?:what is your\s+)?(?:total|overall|professional)?\s*work\s+experience\??$/i.test(lower)
    || /^(?:what is your\s+)?total\s+(?:professional\s+)?experience(?:\s+in\s+years)?\??$/i.test(lower)
    || /^how many years of (?:total |overall |professional )?experience do you have\??$/i.test(lower)
    || /^how many years of professional experience do you have\??$/i.test(lower)
    || /^total years of experience\??$/i.test(lower)
    || (/(how many years(?:.*)?experience.*do you have|total.*experience|professional experience|work experience)/i.test(lower) && !/(with|in|for|on|using|of)\s+[a-z0-9 .#&/\-]+/i.test(lower));

  if (isGeneralExp) {
    const exp = Number(answers.experience?.totalYears ?? applicationConfig.experienceYears ?? 3);
    return {
      status: "RESOLVED",
      intent: "total_experience_years",
      answerSource: "answers.experience.totalYears",
      answer: exp,
      displayValue: String(exp),
      questionType: "numeric_experience",
      confidence: 0.99
    };
  }

  // Rule 1, 2, 6, 7: Numeric Skill Experience Questions
  const isNumericSkillQuestion = /\b(?:how many years|how much experience|how long have you|number of years|years of experience|total years of experience|experience in years)\b/i.test(question)
    || /\bexperience\s*\(in years\)/i.test(question)
    || /\bwhat is your experience (?:with|in|on)\s+[^?]+?\s*\(in years\)/i.test(question)
    || /^[a-z0-9 .#&/\-]+\s+experience\??$/i.test(String(question || "").trim());

  let skillNumericMatch = null;
  if (isNumericSkillQuestion) {
    skillNumericMatch = question.match(/\bhow many years\s+(?:have you (?:worked|been working)|do you have(?:\s+experience)?)\s+(?:with|in|for|on|using|of)\s+([^?]+?)(?:\s*\(in years\))?(?:\?|$)/i)
      || question.match(/\b(?:how many years(?: of experience)?|how much experience|how long have you (?:worked|been working)|number of years(?: of experience)?)\s+(?:do you have\s+)?(?:with|in|for|on|using|of)\s+([^?]+?)(?:\s*\(in years\))?(?:\?|$)/i)
      || question.match(/\bhow many years\s+(?:of\s+)?(.+?)\s+experience(?:\s+do you have)?(?:\?|$)/i)
      || question.match(/\byears of\s+([^?]+?)\s+experience(?:\?|$)/i)
      || question.match(/\bexperience (?:in|with|on)\s+([^?]+?)(?:\s*\(in years\))(?:\?|$)/i)
      || question.match(/^([^?]+?)\s+experience in years(?:\?|$)/i)
      || question.match(/\bwhat is your experience (?:with|in|on)\s+([^?]+?)\s*\(in years\)(?:\?|$)/i)
      || question.match(/^([^?]+?)\s+experience(?:\?|$)/i);
  }

  if (skillNumericMatch) {
    const rawSubject = skillNumericMatch[1].replace(/\s*(?:\.\.\.|\.)+$/g, "").trim();
    if (isGenericOrUnsupportedSkillSubject(rawSubject)) {
      return { status: "NEEDS_USER_INPUT", intent: "unknown_skill_experience", answerSource: null, questionType: "numeric_experience", reason: `generic or unsupported skill subject: ${rawSubject}`, confidence: 0.2, answer: undefined };
    }

    const skills = parseSkillsFromSubject(rawSubject);
    if (!skills.length) {
      const exp = Number(answers.experience?.totalYears ?? applicationConfig.experienceYears ?? 3);
      return { status: "RESOLVED", intent: "total_experience_years", answerSource: "answers.experience.totalYears", answer: exp, displayValue: String(exp), questionType: "numeric_experience", confidence: 0.99 };
    }

    const lookupResults = skills.map(s => lookupSkillValue(s, applicationConfig));
    const uniqueVals = [...new Set(lookupResults.map(r => r.value))];

    if (uniqueVals.length === 1) {
      const commonVal = uniqueVals[0];
      const canonicalNames = lookupResults.map(r => r.canonicalName).join(", ");
      return {
        status: "RESOLVED",
        intent: "skill_experience_years",
        answerSource: `answers.skills (${canonicalNames})`,
        answer: commonVal,
        displayValue: String(commonVal),
        questionType: "numeric_experience",
        confidence: 0.98,
        entities: { skills: lookupResults.map(r => r.canonicalName), skill: lookupResults[0].canonicalName }
      };
    }

    // Multiple skills with conflicting values
    return {
      status: "NEEDS_USER_INPUT",
      intent: "compound_skill_experience",
      answerSource: null,
      questionType: "numeric_experience",
      reason: `Multiple referenced skills have conflicting configured values: [${lookupResults.map(r => `${r.canonicalName}=${r.value}`).join(", ")}]`,
      confidence: 0.35,
      answer: undefined
    };
  }

  // Rule 3 & 4: Yes/No Skill Experience Questions
  const isBooleanSkillQuestion = !isNumericSkillQuestion && (
    /\b(?:do you have (?:any )?(?:hands[- ]on |production |work |prior )?experience (?:with|in|on|using)|have you (?:previously )?worked (?:with|in|on|using)|are you experienced in|do you know|are you familiar with)\s+(.+?)(?:\?|$)/i.test(question)
  );
  if (isBooleanSkillQuestion) {
    const booleanSkillMatch = question.match(/(?:do you have (?:any )?(?:hands[- ]on |production |work |prior )?experience (?:with|in|on|using)|have you (?:previously )?worked (?:with|in|on|using)|are you experienced in|do you know|are you familiar with)\s+(.+?)(?:\?|$)/i);
    if (booleanSkillMatch) {
      const rawSubject = booleanSkillMatch[1].replace(/\s*(?:\.\.\.|\.)+$/g, "").trim();
      if (!isGenericOrUnsupportedSkillSubject(rawSubject)) {
        const isOrCondition = /\bor\b/i.test(question);
        const skills = parseSkillsFromSubject(rawSubject);
        if (skills.length > 0) {
          const lookupResults = skills.map(s => lookupSkillValue(s, applicationConfig));
          let answerBool = false;
          if (isOrCondition) {
            answerBool = lookupResults.some(r => r.value > 0);
          } else {
            answerBool = lookupResults.every(r => r.value > 0);
          }
          return {
            status: "RESOLVED",
            intent: "boolean_skill_experience",
            answerSource: `answers.skills (${lookupResults.map(r => r.canonicalName).join(", ")})`,
            answer: answerBool,
            displayValue: answerBool ? "Yes" : "No",
            questionType: "boolean",
            confidence: 0.98,
            entities: { skills: lookupResults.map(r => r.canonicalName), skill: lookupResults[0].canonicalName }
          };
        }
      }
    }
  }

  // Rule 15: Unknown personal preferences & missing personal facts
  if (/contract to hire|\bc2h\b|contractual assignment|passport number|aadhaar number/i.test(lower)) {
    return { status: "NEEDS_USER_INPUT", intent: "unknown_preference", questionType: "unknown", reason: "unknown personal preference or fact not configured in application.json", confidence: 0.1, answer: undefined };
  }

  if (/notice period/i.test(lower)) {
    const answer = resolveAnswer("notice_period", { applicationConfig, profile: sources.profile || {}, question: lower });
    if (answer !== undefined) {
      return { status: "RESOLVED", intent: "notice_period", answerSource: "answers.noticePeriod.days", answer, displayValue: String(answer), questionType: "notice_period", confidence: 0.9 };
    }
    return { status: "NEEDS_USER_INPUT", intent: "notice_period", questionType: "notice_period", reason: "notice period data is not safely available", confidence: 0.3, answer: undefined };
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
  extractAndNormalizeSkills: parseSkillsFromSubject,
  findCanonicalSkillName,
  findConfiguredSkillValue,
  isCompoundLocationRelocationQuestion,
  isLocationMatched,
  lookupSkillValue,
  normalize,
  normalizedSkillName,
  parseSkillsFromSubject,
  redactSensitiveText,
  resolveAnswer,
  resolveConfiguredAnswer,
  resolveExperienceAnswer,
  resolveSemanticAnswer,
  sensitiveField
};
