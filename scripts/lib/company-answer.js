const https = require("https");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE_FILE = path.join(ROOT, "config", "profile.json");
const REQUEST_TIMEOUT_MS = 8000;
const SKIP_HOSTS = /(^|\.)(duckduckgo|google|bing|linkedin|facebook|instagram|wikipedia|glassdoor|indeed|crunchbase)\./i;

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { "User-Agent": "AIJobSearchAssistant/1.0 (+public company information)" },
      timeout: REQUEST_TIMEOUT_MS
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirected = new URL(response.headers.location, url).toString();
        if (!redirected.startsWith("https://")) return reject(new Error("Only HTTPS pages are supported."));
        return resolve(requestText(redirected));
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        return resolve("");
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", chunk => {
        body += chunk;
        if (body.length > 1_500_000) request.destroy(new Error("Company page exceeded the size limit."));
      });
      response.on("end", () => resolve(body));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Company page request timed out.")));
    request.on("error", reject);
  });
}

function decodeHtml(value) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripHtml(html) {
  return decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function officialSearchUrl(company) {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${company} official website`)}`;
}

function searchResultUrls(html) {
  const urls = [];
  const linkPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    try {
      if (!/\bresult__a\b/i.test(match[1])) continue;
      const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const resultUrl = new URL(decodeHtml(href), "https://html.duckduckgo.com");
      const destination = resultUrl.searchParams.get("uddg") || resultUrl.toString();
      const parsed = new URL(destination);
      if (parsed.protocol === "https:" && !SKIP_HOSTS.test(parsed.hostname)) urls.push(parsed.origin);
    } catch {
      // Search results can contain malformed tracking links.
    }
  }
  return [...new Set(urls)].slice(0, 5);
}

function relevantPageUrls(html, origin) {
  const urls = new Set([origin]);
  const linkPattern = /href=["']([^"']+)["']/gi;
  for (const match of html.matchAll(linkPattern)) {
    try {
      const url = new URL(decodeHtml(match[1]), origin);
      if (url.origin === origin && /about|mission|values|product|solution|company/i.test(url.pathname)) {
        url.hash = "";
        urls.add(url.toString());
      }
    } catch {
      // Ignore non-URL links.
    }
  }
  return [...urls].slice(0, 5);
}

async function researchCompany(company) {
  const searchPage = await requestText(officialSearchUrl(company));
  const distinctiveTokens = String(company).toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3);
  for (const origin of searchResultUrls(searchPage)) {
    try {
      const homepage = await requestText(origin);
      const host = new URL(origin).hostname.toLowerCase();
      const homepageText = stripHtml(homepage);
      if (distinctiveTokens.length && !distinctiveTokens.some(token => host.includes(token) || homepageText.toLowerCase().includes(token))) continue;
      const pages = relevantPageUrls(homepage, origin);
      const texts = [homepageText];
      for (const pageUrl of pages.slice(1)) {
        const page = await requestText(pageUrl);
        if (page) texts.push(stripHtml(page));
      }
      const evidence = texts.join(" ").replace(/\s+/g, " ").trim();
      if (evidence.length > 150) return { origin, evidence: evidence.slice(0, 12000) };
    } catch {
      // A blocked or unavailable site should not prevent human review.
    }
  }
  return null;
}

function loadProfile() {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function answerProfile(profile) {
  return {
    headline: profile.candidate?.headline || "",
    experienceYears: profile.candidate?.experience?.actualYears ?? null,
    professionalSkills: profile.skills?.primary || [],
    secondarySkills: profile.skills?.secondary || [],
    professionalProjects: profile.projects?.professional || []
  };
}

function evidenceSentence(evidence, company) {
  const sentences = evidence.split(/(?<=[.!?])\s+/).map(text => text.trim()).filter(text => text.length > 40 && text.length < 280);
  const priorities = /mission|product|platform|solution|customer|patient|business|technology|help|build|provide|develop|purpose|value/i;
  const selected = sentences.find(sentence => priorities.test(sentence) && !/cookie|privacy policy|sign up|sign in/i.test(sentence));
  if (selected) return selected;
  const index = evidence.toLowerCase().indexOf(company.toLowerCase());
  return index >= 0 ? evidence.slice(Math.max(0, index - 70), Math.min(evidence.length, index + company.length + 140)).trim() : "";
}

function groundedAnswers({ company, evidence, profile }) {
  const summary = evidenceSentence(evidence, company);
  if (!summary) return { whyUs: "", whyInterested: "" };
  const professionalSkills = (profile.skills?.primary || []).slice(0, 3).map(String);
  const skillText = professionalSkills.length
    ? ` My professional experience includes ${professionalSkills.join(", ")}.`
    : "";
  return {
    whyUs: limitWords(`I am interested in ${company} because its public materials describe: "${summary}"`, 120),
    whyInterested: limitWords(`I would be excited to contribute to ${company}. Its public materials state: "${summary}"${skillText}`, 120)
  };
}

function limitWords(value, maximum) {
  return String(value).replace(/\s+/g, " ").trim().split(" ").slice(0, maximum).join(" ");
}

function modelOutputText(payload) {
  return payload.output?.flatMap(item => item.content || [])
    .find(item => item.type === "output_text")?.text || "";
}

function parseAnswers(value) {
  const text = String(value || "").trim();
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return {
      whyUs: limitWords(parsed.whyUs || "", 120),
      whyInterested: limitWords(parsed.whyInterested || "", 120)
    };
  } catch {
    return null;
  }
}

async function generateWithConfiguredModel({ company, research, profile }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: "Return only a JSON object with string keys whyUs and whyInterested. Write two distinct concise job-application answers about why the candidate wants to work at the company. Use only the supplied company evidence and candidate profile. Respect professional/academic distinctions and experience exclusions. Never invent company facts or candidate experience. Each answer must be truthful and no more than 120 words. If company evidence is insufficient, use an empty string for both values.",
      input: JSON.stringify({
        company,
        officialWebsite: research.origin,
        companyEvidence: research.evidence,
        candidateProfile: answerProfile(profile)
      }),
      max_output_tokens: 450
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Company answer model request failed (${response.status}).`);
  const payload = await response.json();
  return parseAnswers(modelOutputText(payload));
}

async function generateCompanyAnswers(company, research) {
  if (!research?.evidence) throw new Error(`No public company research was available for ${company}.`);
  const profile = loadProfile();
  try {
    const generated = await generateWithConfiguredModel({ company, research, profile });
    if (generated?.whyUs && generated?.whyInterested) return generated;
  } catch {
    // Use the source-grounded fallback if the optional model is unavailable.
  }
  const fallback = groundedAnswers({ company, evidence: research.evidence, profile });
  if (!fallback.whyUs || !fallback.whyInterested) {
    throw new Error(`Company research for ${company} did not contain enough evidence to write both answers.`);
  }
  return fallback;
}

async function generateCompanyAnswer(type, company, jobDescription, options = {}) {
  if (!/why.*(us|company|interested|work here|work at|join us|organization|employer)|company motivation/i.test(String(type))) return "";
  if (!company) return "";
  const answerKey = /why\s*us|why\s+(this|the)\s+company|company motivation/i.test(String(type))
    ? "whyUs"
    : "whyInterested";
  const { getCompanyAnswers } = require("./answer-cache");
  const answers = await getCompanyAnswers(company, jobDescription, options);
  return answers[answerKey] || "";
}

module.exports = { generateCompanyAnswer, generateCompanyAnswers, researchCompany };
