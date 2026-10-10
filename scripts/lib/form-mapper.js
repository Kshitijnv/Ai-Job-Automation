const questionMapper = require("./question-mapper");
const questionResolver = require("./llm/question-resolver");

const KNOWN_FIELDS = {
  firstName: ["first name", "given name", "forename"],
  lastName: ["last name", "family name", "surname"],
  fullName: ["full name", "your name", "legal name", "candidate name", "name"],
  email: ["email", "email address"],
  phone: ["phone", "mobile", "telephone"],
  experience: ["years of experience", "total experience", "experience"],
  noticePeriod: ["notice period", "notice duration", "when can you start"],
  linkedIn: ["linkedin", "linkedin profile", "linkedin url"]
};

const CONFIGURED_FIELDS = {
  currentSalary: ["current salary", "current ctc", "current compensation", "current pay"],
  expectedSalary: ["expected salary", "desired salary", "expected ctc", "salary expectation", "desired compensation"],
  visaSponsorship: ["visa sponsorship", "require sponsorship", "sponsorship required"],
  workAuthorization: ["work authorization", "work authorization country", "work authorization status"],
  disability: ["disability", "disability status"],
  veteranStatus: ["veteran", "protected veteran"],
  diversity: ["diversity", "gender identity", "ethnicity"],
  relocation: ["relocate", "willingness to relocate", "willing to relocate"]
};
const COMPANY_QUESTION = /why.*(us|this company|the company|work here|work at|join us|organization|employer)|company motivation/i;
const FORM_CONTROL_SELECTOR = "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role=radio]";

function framesFor(page, scopeRoot) {
  return scopeRoot ? [{ locator: selector => scopeRoot.locator(selector) }] : page.frames();
}

function normalize(value) {
  return String(value ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

function logicalFieldKey(label, name = "", id = "", type = "") {
  const canonicalId = questionMapper.canonicalQuestion(label);
  if (canonicalId) return canonicalId;
  const normalized = normalize(label).replace(/\b(locate me|required)\b/g, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(" ");
  const midpoint = Math.floor(words.length / 2);
  const withoutRepeatedPhrase = midpoint > 0 && words.length % 2 === 0
    && words.slice(0, midpoint).join(" ") === words.slice(midpoint).join(" ")
    ? words.slice(0, midpoint).join(" ")
    : normalized;
  return withoutRepeatedPhrase || normalize(name) || normalize(id);
}

function profileValues(profile = {}) {
  const candidate = profile.candidate || profile;
  const contact = candidate.contact || {};
  const name = String(candidate.name || "").trim().split(/\s+/);
  return {
    firstName: name[0] || "",
    lastName: name.length > 1 ? name.slice(1).join(" ") : "",
    fullName: candidate.name || "",
    email: contact.email || candidate.email || "",
    phone: contact.phone || candidate.phone || "",
    location: contact.location || candidate.location || "",
    experience: candidate.experience?.actualYears ?? profile.experience?.actualYears,
    noticePeriod: candidate.notice?.days ?? profile.notice?.days,
    linkedIn: contact.linkedin || candidate.linkedin || ""
  };
}

function applicationValues(config = {}) {
  return {
    currentSalary: config.salary?.currentCTC,
    expectedSalary: config.salary?.expectedCTC,
    visaSponsorship: config.eligibility?.visaSponsorshipRequired,
    workAuthorization: config.eligibility?.workAuthorization,
    disability: config.compliance?.disability,
    veteranStatus: config.compliance?.veteranStatus,
    diversity: config.compliance?.diversity,
    relocation: config.eligibility?.willingToRelocate
  };
}

function textValue(value, key) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "experience" && typeof value === "number") return `${value} years`;
  if (key === "noticePeriod" && typeof value === "number") return `${value} days`;
  return String(value);
}

async function describeField(locator) {
  return locator.evaluate(element => {
    const id = element.id;
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const parentLabel = element.closest("label");
    const legend = element.closest("fieldset")?.querySelector("legend")?.innerText || "";
    const labels = element.labels ? Array.from(element.labels).map(item => item.innerText).join(" ") : "";
    const labelledBy = (element.getAttribute("aria-labelledby") || "")
      .split(/\s+/).map(labelId => document.getElementById(labelId)?.innerText || "").join(" ");
    const radioGroup = element.getAttribute("role") === "radio" ? element.closest("[role='radiogroup'], fieldset") : null;
    const groupLabelledBy = (radioGroup?.getAttribute("aria-labelledby") || "")
      .split(/\s+/).map(labelId => document.getElementById(labelId)?.innerText || "").join(" ");
    const groupHeading = radioGroup?.querySelector("h1, h2, h3, h4, h5, h6, [role='heading'], [data-test-form-builder-radio-button-form-component__title], [class*='title'], [class*='label']")?.innerText || "";
    const groupLabel = radioGroup?.getAttribute("aria-label") || groupLabelledBy
      || radioGroup?.closest("fieldset")?.querySelector("legend")?.innerText
      || groupHeading || "";
    const fieldContainer = element.closest(".field, .form-group, .application-question, fieldset, [data-automation-id*='formField'], [class*='field']");
    let nearbyQuestionText = "";
    let nearby = element.parentElement;
    for (let depth = 0; nearby && depth < 5; depth++, nearby = nearby.parentElement) {
      const controls = nearby.querySelectorAll("input:not([type=hidden]), textarea, select, [role=radio]").length;
      const text = (nearby.innerText || "").replace(/\s+/g, " ").trim();
      if (controls === 1 && text.length > 0 && text.length <= 180) {
        nearbyQuestionText = text;
        break;
      }
    }
    const visibleText = (element.innerText || "").replace(/\s+/g, " ").trim();
    const securityParts = [...new Set([groupLabel, legend, labels, label?.innerText, parentLabel?.innerText, labelledBy,
      element.getAttribute("aria-label"), element.getAttribute("placeholder")]
      .map(value => (value || "").replace(/\s+/g, " ").trim()).filter(Boolean))];
    const securityLabel = securityParts.join(" ");
    const labelText = securityParts.length ? securityParts : [fieldContainer?.innerText || nearbyQuestionText].filter(Boolean);
    if (!labelText.length) labelText.push(element.getAttribute("name") || id || visibleText);
    return {
      id,
      name: element.getAttribute("name") || "",
      securityLabel,
      type: (element.getAttribute("type") || (element.getAttribute("role") === "radio" ? "radio" : element.tagName)).toLowerCase(),
      label: labelText.join(" "),
      required: element.required || element.getAttribute("aria-required") === "true" || radioGroup?.getAttribute("aria-required") === "true",
      value: element.value || (element.getAttribute("role") === "radio" ? visibleText || element.getAttribute("aria-label") || "" : ""),
      checked: Boolean(element.checked) || element.getAttribute("aria-checked") === "true",
      maxLength: Number(element.maxLength) > 0 ? Number(element.maxLength) : null,
      options: element.tagName === "SELECT"
        ? Array.from(element.options).map(option => ({ value: option.value, text: option.textContent.trim() }))
        : []
    };
  });
}

function matchField(label, aliases) {
  const normalized = normalize(label);
  return aliases.find(alias => normalized === normalize(alias)
    || (normalize(alias) !== "name" && normalized.includes(normalize(alias))));
}

function targetForLabel(label, aliases, values) {
  if (/\b(emergency|reference|manager|company|employer|former|previous|secondary)\b/i.test(normalize(label))) return null;
  for (const [key, fieldAliases] of Object.entries(aliases)) {
    if (key === "experience") {
      const normalized = normalize(label);
      const generalExperience = /^(?:total )?(?:years? of )?experience$/.test(normalized)
        || /^(?:how many )?(?:total )?years? of experience (?:do you have|overall|in total)$/.test(normalized);
      if (!generalExperience) continue;
    }
    if (matchField(label, fieldAliases)) return { key, value: values[key] };
  }
  return null;
}

async function currentValue(locator, type) {
  try {
    if (type === "checkbox" || type === "radio") {
      const isChecked = await locator.isChecked().catch(() => null);
      if (typeof isChecked === "boolean") return isChecked ? "checked" : "";
      const ariaChecked = await locator.getAttribute("aria-checked").catch(() => null);
      if (ariaChecked === "true") return "checked";
      const checkedAttr = await locator.evaluate(el => el.checked || el.getAttribute("aria-checked") === "true" || el.querySelector("[role='radio'][aria-checked='true'], input[type='radio']:checked") !== null).catch(() => false);
      return checkedAttr ? "checked" : "";
    }
    return String(await locator.inputValue()).trim();
  } catch {
    return "";
  }
}

async function semanticValueAlreadySet(locator, descriptor, answer) {
  if (typeof answer === "boolean" && descriptor.type === "checkbox") {
    return (await locator.isChecked()) === answer;
  }
  if (typeof answer === "boolean" && descriptor.type === "radio") {
    if (!await currentValue(locator, descriptor.type)) return false;
    const choice = normalize(`${descriptor.value} ${descriptor.securityLabel} ${descriptor.label}`);
    return answer ? /\b(yes|true|agree|authorized)\b/.test(choice) : /\b(no|false|disagree|not authorized)\b/.test(choice);
  }
  if (typeof answer === "boolean" && descriptor.type === "select") {
    const value = await locator.inputValue().catch(() => "");
    const selected = descriptor.options.find(option => option.value === value);
    const choice = normalize(`${selected?.value || ""} ${selected?.text || ""}`);
    return answer ? /\b(yes|true|agree)\b/.test(choice) : /\b(no|false|disagree)\b/.test(choice);
  }
  return Boolean(await currentValue(locator, descriptor.type));
}

async function setFieldValue(locator, descriptor, value, key) {
  const type = descriptor.type;
  if (type === "checkbox") {
    if (typeof value === "boolean") {
      await locator.setChecked(value);
      return true;
    }
    const desired = normalize(value);
    if (desired === "auto" && ["privacy_acknowledgement", "terms_acknowledgement"].includes(key)) {
      await locator.setChecked(true);
      return true;
    }
    const group = locator.locator("xpath=ancestor::fieldset[1]").locator("input[type=checkbox]");
    if (await group.count()) {
      for (let index = 0; index < await group.count(); index++) {
        const option = group.nth(index);
        const info = await describeField(option);
        if (normalize(`${info.value} ${info.label}`).includes(desired)) {
          await option.check();
          return true;
        }
      }
      return false;
    }
    if (/^(yes|no|true|false|prefer not to say)$/.test(desired)) {
      await locator.setChecked(desired === "yes" || desired === "true");
      return true;
    }
    return false;
  }
  if (type === "radio") {
    const desired = textValue(value, key);
    let group = locator.locator("xpath=ancestor::*[@role='radiogroup'][1]");
    let options = group.locator("[role=radio]");
    if (!await options.count()) {
      group = locator.locator("xpath=ancestor::fieldset[1]");
      options = group.locator("[role=radio]");
      if (!await options.count()) {
        options = group.locator("input[type=radio]");
      }
    }
    for (let index = 0; index < await options.count(); index++) {
      const option = options.nth(index);
      const info = await describeField(option);
      const optionLabel = normalize(`${info.value} ${info.label}`);
      if (optionLabel.includes(normalize(desired)) || normalize(desired).includes(optionLabel)) {
        if (!await currentValue(option, "radio")) {
          if (await option.getAttribute("role") === "radio") {
            await option.click();
            const isChecked = await option.evaluate(el => el.getAttribute("aria-checked") === "true").catch(() => false);
            if (!isChecked) {
              const inner = option.locator("input[type='radio'], label, p").first();
              if (await inner.count().catch(() => 0)) {
                await inner.click({ force: true }).catch(() => {});
              }
            }
          } else {
            await option.check();
          }
        }
        return true;
      }
    }
    return false;
  }
  const valueText = type === "number" && typeof value === "number"
    ? String(value)
    : textValue(value, key);
  if (type === "select") {
    const options = descriptor.options;
    const desired = normalize(valueText);
    const option = options.find(item => normalize(item.label || item.text) === desired)
      || options.find(item => normalize(item.label || item.text).includes(desired) && desired)
      || options.find(item => desired.includes(normalize(item.label || item.text)) && normalize(item.label || item.text));
    if (!option) return false;
    await locator.selectOption(option.value);
    return true;
  }
  await locator.fill(valueText);
  return true;
}

async function fillValues(page, aliases, values, applicationConfig = {}, scopeRoot = null) {
  const filled = [];
  for (const frame of framesFor(page, scopeRoot)) {
    const controls = frame.locator(FORM_CONTROL_SELECTOR);
    for (let index = 0; index < await controls.count(); index++) {
      const locator = controls.nth(index);
      try {
        if (!(await locator.isVisible()) || !(await locator.isEnabled())) continue;
        const descriptor = await describeField(locator);
        if (questionMapper.sensitiveField(descriptor.securityLabel, descriptor.name, descriptor.id, descriptor.type)) continue;
        if (questionMapper.canonicalQuestion(descriptor.label) === "phone_country" && aliases === KNOWN_FIELDS) continue;
        const target = targetForLabel(descriptor.label, aliases, values);
        if (!target || target.value === undefined || target.value === null || target.value === "") continue;
        if (await currentValue(locator, descriptor.type)) continue;
        if (await setFieldValue(locator, descriptor, target.value, target.key)) {
          filled.push(target.key);
        }
      } catch {
        // Dynamic portal controls can disappear as forms rerender; continue with remaining fields.
      }
    }
  }
  return [...new Set(filled)];
}

async function fillKnownFields(page, profile, scopeRoot = null, options = {}) {
  const aliases = options.skipExperience
    ? Object.fromEntries(Object.entries(KNOWN_FIELDS).filter(([key]) => key !== "experience"))
    : KNOWN_FIELDS;
  return fillValues(page, aliases, profileValues(profile), {}, scopeRoot);
}

async function fillConfiguredFields(page, applicationConfig, scopeRoot = null) {
  return fillValues(page, CONFIGURED_FIELDS, applicationValues(applicationConfig), applicationConfig, scopeRoot);
}

async function fillSemanticQuestions(page, sources = {}, scopeRoot = null) {
  const resolved = [];
  const applicationConfig = sources.applicationConfig || {};
  const profile = sources.profile || {};
  const resume = sources.resumeData || sources.resume || profile.resume || profile.candidate?.resume || {};

  for (const frame of framesFor(page, scopeRoot)) {
    // 1. Process Radio Groups
    const radioGroups = frame.locator("[role='radiogroup'], fieldset:has(input[type='radio']), fieldset:has([role='radio'])");
    for (let gIndex = 0; gIndex < await radioGroups.count().catch(() => 0); gIndex++) {
      const groupLocator = radioGroups.nth(gIndex);
      try {
        if (!await groupLocator.isVisible().catch(() => false)) continue;
        const groupInfo = await groupLocator.evaluate(group => {
          const labelledBy = (group.getAttribute("aria-labelledby") || "").split(/\s+/)
            .map(id => document.getElementById(id)?.innerText || "").join(" ").trim();
          const legend = group.querySelector("legend")?.innerText || "";
          const ariaLabel = group.getAttribute("aria-label") || "";
          const heading = group.querySelector("h1, h2, h3, h4, h5, h6, [role='heading'], [data-test-form-builder-radio-button-form-component__title], [class*='title'], [class*='label']")?.innerText || "";
          let question = (legend || ariaLabel || labelledBy || heading || "").replace(/\s+/g, " ").trim();
          if (!question) {
            const prev = group.previousElementSibling;
            if (prev && prev.innerText) {
              question = prev.innerText.replace(/\s+/g, " ").trim();
            }
          }
          if (!question) {
            const parent = group.closest(".fb-form-element, [class*='form-element'], .artdeco-form-item");
            if (parent) {
              const parentLabel = parent.querySelector("label, legend, [class*='title'], [class*='label']");
              if (parentLabel) question = (parentLabel.innerText || "").replace(/\s+/g, " ").trim();
            }
          }

          const roleRadios = Array.from(group.querySelectorAll("[role='radio']"));
          const inputRadios = Array.from(group.querySelectorAll("input[type='radio']"));
          const isRoleRadio = roleRadios.length > 0;
          const radioElements = isRoleRadio ? roleRadios : inputRadios;

          const radios = radioElements.map((radio, idx) => {
            let rLabel = "";
            if (isRoleRadio) {
              const clone = radio.cloneNode(true);
              clone.querySelectorAll("input, label:empty").forEach(el => el.remove());
              const cleanText = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
              rLabel = cleanText || radio.getAttribute("aria-label") || "";
            } else {
              rLabel = (radio.getAttribute("aria-label")
                || (radio.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ")
                || Array.from(radio.labels || []).map(l => l.innerText).join(" ")
                || radio.closest("label")?.innerText
                || radio.parentElement?.innerText
                || radio.value
                || "").replace(/\s+/g, " ").trim();
            }
            const checked = radio instanceof HTMLInputElement
              ? radio.checked
              : radio.getAttribute("aria-checked") === "true";
            return { index: idx, label: rLabel, value: radio.value || rLabel, checked };
          });
          return { question, options: radios, isRoleRadio };
        }).catch(() => null);

        if (!groupInfo || !groupInfo.question || !groupInfo.options.length) continue;
        if (questionMapper.sensitiveField(groupInfo.question)) continue;

        const options = groupInfo.options.map(o => o.label);
        const resolution = await questionResolver.resolveQuestion({
          question: groupInfo.question,
          controlType: "radio_group",
          options,
          applicationConfig,
          profile,
          resume
        });

        if (resolution && resolution.status === "RESOLVED") {
          let matchIndex = resolution.validation?.index;
          if (matchIndex === undefined || matchIndex === null || matchIndex < 0) {
            const matched = questionResolver.findMatchingOption(resolution.answer, groupInfo.options);
            if (matched) matchIndex = matched.index;
          }

          if (matchIndex !== undefined && matchIndex !== null && matchIndex >= 0 && matchIndex < groupInfo.options.length) {
            const selector = groupInfo.isRoleRadio ? "[role='radio']" : "input[type='radio']";
            const targetRadio = groupLocator.locator(selector).nth(matchIndex);
            if (await targetRadio.isVisible().catch(() => false)) {
              let verified = false;

              if (groupInfo.isRoleRadio) {
                // Preferred click target: [role="radio"] wrapper
                await targetRadio.click().catch(() => {});
                let isChecked = await targetRadio.evaluate(el => el.getAttribute("aria-checked") === "true").catch(() => false);

                if (!isChecked) {
                  // Fallback: click nested input, label, or paragraph
                  const inner = targetRadio.locator("input[type='radio'], label, p").first();
                  if (await inner.count().catch(() => 0)) {
                    await inner.click({ force: true }).catch(() => {});
                  } else {
                    await targetRadio.evaluate(el => el.click()).catch(() => {});
                  }
                  isChecked = await targetRadio.evaluate(el => el.getAttribute("aria-checked") === "true").catch(() => false);
                }
                verified = isChecked;
              } else {
                await targetRadio.check().catch(async () => {
                  await targetRadio.click().catch(() => {});
                });
                verified = await targetRadio.isChecked().catch(() => false);
              }

              const chosenOption = groupInfo.options[matchIndex]?.label || resolution.answer;
              console.log(`Question: ${groupInfo.question}`);
              console.log(`Control: radio_group`);
              console.log(`Options: ${JSON.stringify(options)}`);
              console.log(`Resolved answer: ${resolution.answer}`);
              console.log(`Selected option: ${chosenOption}`);
              console.log(`Verified: ${verified}`);

              if (verified) {
                const canonicalId = questionMapper.canonicalQuestion(groupInfo.question);
                resolved.push(canonicalId || `question:${normalize(groupInfo.question)}`);
              }
            }
          }
        }
      } catch (err) {}
    }

    // 2. Process Checkbox Groups (fieldsets or groups with multiple checkboxes)
    const checkboxGroups = frame.locator("fieldset:has(input[type='checkbox']), fieldset:has([role='checkbox']), [role='group']:has(input[type='checkbox']), [role='group']:has([role='checkbox'])");
    for (let cgIndex = 0; cgIndex < await checkboxGroups.count().catch(() => 0); cgIndex++) {
      const cgLocator = checkboxGroups.nth(cgIndex);
      try {
        if (!await cgLocator.isVisible().catch(() => false)) continue;
        const cbCount = await cgLocator.locator("input[type='checkbox'], [role='checkbox']").count().catch(() => 0);
        if (cbCount <= 1) continue;

        const cgInfo = await cgLocator.evaluate(group => {
          const legend = group.querySelector("legend")?.innerText || "";
          const ariaLabel = group.getAttribute("aria-label") || "";
          const heading = group.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']")?.innerText || "";
          const question = (legend || ariaLabel || heading || "").replace(/\s+/g, " ").trim();
          const checkboxes = Array.from(group.querySelectorAll("input[type='checkbox'], [role='checkbox']")).map((cb, idx) => {
            const label = (cb.getAttribute("aria-label")
              || Array.from(cb.labels || []).map(l => l.innerText).join(" ")
              || cb.closest("label")?.innerText
              || cb.parentElement?.innerText
              || cb.value
              || "").replace(/\s+/g, " ").trim();
            return { index: idx, label, value: cb.value || label };
          });
          return { question, options: checkboxes };
        }).catch(() => null);

        if (!cgInfo || !cgInfo.question || !cgInfo.options.length) continue;
        if (questionMapper.sensitiveField(cgInfo.question)) continue;

        const options = cgInfo.options.map(o => o.label);
        const resolution = await questionResolver.resolveQuestion({
          question: cgInfo.question,
          controlType: "checkbox_group",
          options,
          applicationConfig,
          profile,
          resume
        });

        if (resolution && resolution.status === "RESOLVED") {
          const matchedAnswers = Array.isArray(resolution.answer) ? resolution.answer : [resolution.answer];
          for (const opt of cgInfo.options) {
            const isMatch = matchedAnswers.some(ans =>
              questionResolver.findMatchingOption(ans, [opt])
              || questionResolver.findMatchingOption(opt.label, [{ label: String(ans), value: String(ans) }])
            );
            if (isMatch) {
              const cb = cgLocator.locator("input[type='checkbox'], [role='checkbox']").nth(opt.index);
              if (await cb.isVisible().catch(() => false)) {
                await cb.setChecked(true).catch(() => cb.click());
              }
            }
          }
          const canonicalId = questionMapper.canonicalQuestion(cgInfo.question);
          resolved.push(canonicalId || `question:${normalize(cgInfo.question)}`);
        }
      } catch (err) {}
    }

    // 3. Process remaining controls (Select, text/number/textarea inputs, single checkboxes)
    const controls = frame.locator(FORM_CONTROL_SELECTOR);
    for (let index = 0; index < await controls.count(); index++) {
      const locator = controls.nth(index);
      try {
        if (!(await locator.isVisible()) || !(await locator.isEnabled())) continue;
        const descriptor = await describeField(locator);
        if (questionMapper.sensitiveField(descriptor.securityLabel, descriptor.name, descriptor.id, descriptor.type)) continue;

        if (descriptor.type === "radio") continue;

        const canonicalOptions = { experienceYearsRule: Boolean(sources.experienceYearsRule) };
        const canonicalId = questionMapper.canonicalQuestion(descriptor.label, canonicalOptions)
          || questionMapper.canonicalQuestion(`${descriptor.name} ${descriptor.id}`, canonicalOptions);
        if (canonicalId === "resume_upload") continue;

        let controlType = descriptor.type;
        let options = [];
        if (descriptor.type === "select") {
          controlType = "select";
          options = (descriptor.options || []).map(o => o.text || o.label || o.value);
        } else if (descriptor.type === "checkbox") {
          controlType = "checkbox";
          options = ["Yes", "No"];
        } else if (descriptor.type === "number") {
          controlType = "number";
        } else if (descriptor.type === "textarea") {
          controlType = "textarea";
        } else {
          controlType = "text";
        }

        const isFilled = await currentValue(locator, descriptor.type);
        if (isFilled && isFilled !== "unchecked") {
          if (canonicalId) resolved.push(canonicalId);
          continue;
        }

        const resolution = await questionResolver.resolveQuestion({
          question: descriptor.label,
          controlType,
          options,
          applicationConfig,
          profile,
          resume
        });

        if (resolution && resolution.status === "RESOLVED") {
          const resolvedKey = canonicalId || `question:${normalize(descriptor.label)}`;
          if (await setFieldValue(locator, descriptor, resolution.answer, canonicalId)) {
            resolved.push(resolvedKey);
          }
        }
      } catch (err) {}
    }
  }
  return [...new Set(resolved)];
}

async function collectHumanRequiredFields(page, resolvedCanonicalIds = [], scopeRoot = null, options = {}) {
  const resolvedIds = new Set(resolvedCanonicalIds);
  const unresolved = [];
  const seenFields = new Set();
  for (const frame of framesFor(page, scopeRoot)) {
    const controls = frame.locator(`${FORM_CONTROL_SELECTOR}, [aria-required='true'], [required]`);
    for (let index = 0; index < await controls.count(); index++) {
      const locator = controls.nth(index);
      try {
        if (!(await locator.isVisible()) || !(await locator.isEnabled())) continue;
        const field = await describeField(locator);
        if (questionMapper.sensitiveField(field.securityLabel, field.name, field.id, field.type)) continue;
        if (!field.required || await currentValue(locator, field.type)) continue;
        if (field.type === "file") continue;
        const label = field.label || field.name || field.id || "Unlabelled required field";
        const canonicalId = questionMapper.canonicalQuestion(label, options);
        if ((canonicalId && resolvedIds.has(canonicalId)) || resolvedIds.has(`question:${normalize(label)}`)) continue;
        if (canonicalId === "resume_upload") continue;
        const key = logicalFieldKey(field.securityLabel || label, field.name, field.id, field.type);
        if (seenFields.has(key)) continue;
        seenFields.add(key);
        unresolved.push({
          label,
          type: field.type,
          canonicalId: canonicalId || null
        });
      } catch {
        // Ignore controls that changed while the portal rendered.
      }
    }
  }
  return unresolved;
}

async function collectSensitiveFields(page) {
  const detected = new Map();
  for (const frame of page.frames()) {
    const controls = frame.locator("input, textarea, select, [role=textbox], [contenteditable=true]");
    for (let index = 0; index < await controls.count(); index++) {
      const locator = controls.nth(index);
      try {
        if (!await locator.isVisible()) continue;
        const field = await describeField(locator);
        const fieldName = questionMapper.sensitiveField(field.securityLabel, field.name, field.id, field.type);
        if (fieldName) detected.set(fieldName, {
          field: fieldName,
          status: "detected",
          value: "[REDACTED]"
        });
      } catch {
        // Never expose a field value when the control is changing or cannot be inspected.
      }
    }
  }
  return [...detected.values()];
}

async function collectFieldMetadata(page, scopeRoot = null, options = {}) {
  const metadata = new Map();
  for (const frame of framesFor(page, scopeRoot)) {
    const controls = frame.locator("input:not([type=hidden]), textarea, select, [role=textbox], [role=radio], [aria-required='true']");
    for (let index = 0; index < await controls.count(); index++) {
      const locator = controls.nth(index);
      try {
        if (!await locator.isVisible()) continue;
        const field = await describeField(locator);
        const sensitive = questionMapper.sensitiveField(field.securityLabel, field.name, field.id, field.type);
        const label = sensitive || field.label || field.name || field.id || "Unlabelled field";
        const canonicalId = sensitive ? null : questionMapper.canonicalQuestion(field.label, options) || null;
        const entry = {
          label,
          type: field.type,
          canonicalId,
          required: field.required,
          ...(sensitive ? { value: "[REDACTED]" } : {})
        };
        metadata.set(logicalFieldKey(sensitive || field.securityLabel || label, field.name, field.id, field.type), entry);
      } catch {
        // Metadata collection never reads or returns input values.
      }
    }
  }
  return [...metadata.values()];
}

async function fillCompanyAnswers(page, company, jobDescription, generateAnswer) {
  const filled = [];
  for (const frame of page.frames()) {
    const controls = frame.locator("textarea, input:not([type=hidden]):not([type=submit]):not([type=button])");
    for (let index = 0; index < await controls.count(); index++) {
      const locator = controls.nth(index);
      try {
        if (!(await locator.isVisible()) || !(await locator.isEnabled()) || await currentValue(locator, "text")) continue;
        const descriptor = await describeField(locator);
        if (!COMPANY_QUESTION.test(descriptor.label)) continue;
        let answer = await generateAnswer(descriptor.label, company, jobDescription);
        if (answer) {
          if (descriptor.maxLength) answer = answer.slice(0, descriptor.maxLength);
          await locator.fill(answer);
          filled.push(descriptor.label);
        }
      } catch {
        // If research or generation is unavailable, leave the field for human review.
      }
    }
  }
  return filled;
}

async function fillReviewAnswers(page, reviewAnswers) {
  const applied = [];
  const answers = [...(reviewAnswers || [])].sort(
    (left, right) => Number(Boolean(right.company)) - Number(Boolean(left.company))
  );
  const appliedKeys = new Set();
  for (const frame of page.frames()) {
    const controls = frame.locator("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]), textarea, select, [role=textbox], [contenteditable=true]");
    for (let index = 0; index < await controls.count(); index++) {
      const locator = controls.nth(index);
      try {
        if (!(await locator.isVisible()) || !(await locator.isEnabled())) continue;
        const descriptor = await describeField(locator);
        if (questionMapper.sensitiveField(descriptor.securityLabel, descriptor.name, descriptor.id, descriptor.type)) continue;
        const questionText = normalize(descriptor.label);
        const fieldCanonicalId = questionMapper.canonicalQuestion(descriptor.label);
        const answerEntry = answers.find(entry => !appliedKeys.has(entry.key)
          && !questionMapper.sensitiveField(entry.question)
          && ((fieldCanonicalId && questionMapper.canonicalQuestion(entry.question) === fieldCanonicalId)
            || normalize(entry.question) === questionText));
        if (!answerEntry || !String(answerEntry.answer || "").trim()) continue;
        if (await currentValue(locator, descriptor.type)) continue;
        if (!await setFieldValue(locator, descriptor, answerEntry.answer, "reviewAnswer")) continue;
        appliedKeys.add(answerEntry.key);
        applied.push({ key: answerEntry.key, question: answerEntry.question });
      } catch {
        // An answer that does not fit the portal's control stays visible in the review queue.
      }
    }
  }
  return applied;
}

module.exports = {
  collectHumanRequiredFields,
  collectFieldMetadata,
  collectSensitiveFields,
  fillCompanyAnswers,
  fillConfiguredFields,
  fillKnownFields,
  fillSemanticQuestions,
  fillReviewAnswers,
  profileValues
};
