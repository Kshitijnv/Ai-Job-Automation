const fs = require("fs");
const path = require("path");
const questionMapper = require("./question-mapper");

const ROOT = path.resolve(__dirname, "..", "..");
const FILE_INPUT_SELECTOR = "input[type='file']";
const ATTACH_CONTROL_SELECTOR = "button, [role=button], a, label, input[type=button]";
const RESUME_CONTEXT = /resume|curriculum vitae|\bcv\b/i;
const NON_RESUME_CONTEXT = /cover letter|portfolio|transcript|certificate|identity document/i;

function resolveResumePath(resumePath) {
  if (!resumePath) return "";
  return path.isAbsolute(resumePath) ? resumePath : path.resolve(ROOT, resumePath);
}

async function fileInputContext(input) {
  return input.evaluate(element => {
    const parts = [element.getAttribute("name"), element.getAttribute("aria-label"),
      element.getAttribute("accept"), element.id];
    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
      const text = (parent.innerText || "").replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
      if (/resume|curriculum vitae|\bcv\b|cover letter/i.test(text)) break;
    }
    return parts.filter(Boolean).join(" ");
  }).catch(() => "");
}

async function findResumeInput(page) {
  for (const frame of page.frames()) {
    const inputs = frame.locator(FILE_INPUT_SELECTOR);
    for (let index = 0; index < await inputs.count(); index++) {
      const input = inputs.nth(index);
      const context = await fileInputContext(input);
      if (RESUME_CONTEXT.test(context) && !NON_RESUME_CONTEXT.test(context)) return { frame, input, context };
    }
  }
  return null;
}

async function findResumeAttachControl(page) {
  for (const frame of page.frames()) {
    const controls = frame.locator(ATTACH_CONTROL_SELECTOR);
    for (let index = 0; index < await controls.count(); index++) {
      const control = controls.nth(index);
      try {
        if (!await control.isVisible() || !await control.isEnabled()) continue;
        const details = await control.evaluate(element => {
          const label = [element.innerText, element.value, element.getAttribute("aria-label"),
            element.getAttribute("title")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
          const ancestors = [];
          let parent = element.parentElement;
          for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
            ancestors.push((parent.innerText || "").replace(/\s+/g, " ").trim());
          }
          return { label, ancestors };
        });
        if (!/^attach(?:\s+(?:file|resume|document))?$/i.test(details.label)) continue;
        const context = details.ancestors.find(text => RESUME_CONTEXT.test(text)) || "";
        if (!context || NON_RESUME_CONTEXT.test(context)) continue;
        return { frame, control };
      } catch {
        // Ignore a widget that disappears while the page rerenders.
      }
    }
  }
  return null;
}

async function waitForResumeInput(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const input = await findResumeInput(page);
    if (input) return input;
    await page.waitForTimeout(200);
  }
  return null;
}

async function verifyResumeUpload(input, resolvedPath) {
  const filePath = await input.inputValue().catch(() => "");
  const fileName = path.basename(resolvedPath);
  const state = await input.evaluate(element => {
    const parentTexts = [];
    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
      parentTexts.push((parent.innerText || "").replace(/\s+/g, " ").trim());
    }
    return { hasFile: Boolean(element.files?.length), text: parentTexts.join(" ") };
  }).catch(() => ({ hasFile: false, text: "" }));
  return filePath.includes(fileName) || state.hasFile || state.text.includes(fileName);
}

async function uploadResume(page, resumePath) {
  const resolvedPath = resolveResumePath(resumePath);
  if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()
      || path.extname(resolvedPath).toLowerCase() !== ".pdf") {
    return { uploaded: false, verified: false, reason: "Tailored resume not available" };
  }

  let match = await findResumeInput(page);
  if (!match) {
    const attach = await findResumeAttachControl(page);
    if (attach) {
      const fileChooser = attach.frame.page().waitForEvent("filechooser", { timeout: 1000 }).catch(() => null);
      await attach.control.click({ timeout: 5000 }).catch(() => {});
      const chooser = await fileChooser;
      if (chooser) {
        await chooser.setFiles(resolvedPath);
        return { uploaded: true, verified: true, path: resolvedPath };
      }
      match = await waitForResumeInput(page);
    }
  }
  if (!match) return { uploaded: false, verified: false, reason: "Resume/CV attachment control or associated file input was not found." };

  await match.input.setInputFiles(resolvedPath);
  const verified = await verifyResumeUpload(match.input, resolvedPath);
  return {
    uploaded: true,
    verified,
    path: resolvedPath,
    ...(!verified ? { verification: "Playwright selected the tailored resume; the portal did not expose a confirmation state." } : {})
  };
}

async function resumeRequested(page) {
  return Boolean(await findResumeInput(page) || await findResumeAttachControl(page));
}

module.exports = { resolveResumePath, resumeRequested, uploadResume };
