/**
 * Application Configuration UI Server (Phase 2A.2)
 * 
 * Lightweight, zero-dependency local Node.js server for editing config/application.json.
 * Uses only built-in http, fs, and path modules.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'application.json');
const UI_DIR = path.join(ROOT_DIR, 'ui');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Performs Level 2 structural validation on the application configuration object.
 * @param {any} config 
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateApplicationConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: ['Configuration must be a valid JSON object.'] };
  }

  // Top-level experienceYears
  if (config.experienceYears !== undefined) {
    const exp = Number(config.experienceYears);
    if (!Number.isFinite(exp) || exp < 0) {
      errors.push('experienceYears must be a non-negative number.');
    }
  }

  // Salary
  if (config.salary && typeof config.salary === 'object') {
    if (config.salary.currentCTC !== undefined && (!Number.isFinite(Number(config.salary.currentCTC)) || Number(config.salary.currentCTC) < 0)) {
      errors.push('salary.currentCTC must be a non-negative number.');
    }
    if (config.salary.expectedCTC !== undefined && (!Number.isFinite(Number(config.salary.expectedCTC)) || Number(config.salary.expectedCTC) < 0)) {
      errors.push('salary.expectedCTC must be a non-negative number.');
    }
  }

  // Answers container
  if (config.answers && typeof config.answers === 'object') {
    const answers = config.answers;

    // Notice Period
    if (answers.noticePeriod && typeof answers.noticePeriod === 'object') {
      if (answers.noticePeriod.days !== undefined) {
        const days = Number(answers.noticePeriod.days);
        if (!Number.isFinite(days) || days < 0) {
          errors.push('answers.noticePeriod.days must be a non-negative number.');
        } else if (!Number.isInteger(days)) {
          errors.push('answers.noticePeriod.days must be a whole number.');
        } else if (days > 180) {
          errors.push('answers.noticePeriod.days cannot exceed 180.');
        }
      }
      if (answers.noticePeriod.months !== undefined) {
        const months = Number(answers.noticePeriod.months);
        if (!Number.isFinite(months) || months < 0) {
          errors.push('answers.noticePeriod.months must be a non-negative number.');
        } else if (!Number.isInteger(months)) {
          errors.push('answers.noticePeriod.months must be a whole number.');
        } else if (months > 12) {
          errors.push('answers.noticePeriod.months cannot exceed 12.');
        }
      }
    }

    // Skills
    if (answers.skills !== undefined) {
      if (typeof answers.skills !== 'object' || Array.isArray(answers.skills) || answers.skills === null) {
        errors.push('answers.skills must be a valid key-value object of { [skillName]: years }.');
      } else {
        for (const [skillName, years] of Object.entries(answers.skills)) {
          if (!skillName || typeof skillName !== 'string' || !skillName.trim()) {
            errors.push('Skill names cannot be empty.');
          }
          if (!Number.isFinite(Number(years)) || Number(years) < 0) {
            errors.push(`Skill "${skillName}" experience must be a non-negative number.`);
          }
        }
      }
    }

    // Relocation locations
    if (answers.relocation && answers.relocation.locations !== undefined) {
      if (!Array.isArray(answers.relocation.locations)) {
        errors.push('answers.relocation.locations must be an array of location strings.');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Safely writes configuration to disk using an atomic temp-file rename.
 * Preserves unedited fields from existing application.json.
 * @param {object} updatedConfig 
 * @returns {object} The merged and saved configuration
 */
function safeWriteApplicationConfig(updatedConfig) {
  let existing = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      existing = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Unable to read existing application.json: ${err.message}`);
    }
  }

  // Deep merge to preserve unsupported/unedited keys
  const merged = deepMerge(existing, updatedConfig);

  // If skills were explicitly passed, ensure deleted skills are removed from the merged object
  if (updatedConfig.answers && updatedConfig.answers.skills && typeof updatedConfig.answers.skills === 'object') {
    if (!merged.answers) merged.answers = {};
    merged.answers.skills = { ...updatedConfig.answers.skills };
  }

  // If education was explicitly passed, ensure deleted education fields are removed from the merged object
  if (updatedConfig.answers && updatedConfig.answers.education && typeof updatedConfig.answers.education === 'object') {
    if (!merged.answers) merged.answers = {};
    merged.answers.education = { ...updatedConfig.answers.education };
  }

  // If relocation locations were explicitly passed, replace array rather than concatenating
  if (updatedConfig.answers?.relocation?.locations && Array.isArray(updatedConfig.answers.relocation.locations)) {
    if (!merged.answers) merged.answers = {};
    if (!merged.answers.relocation) merged.answers.relocation = {};
    merged.answers.relocation.locations = [...updatedConfig.answers.relocation.locations];
  }

  // If certifications entries were explicitly passed, replace array rather than concatenating
  if (updatedConfig.answers?.certifications?.entries && Array.isArray(updatedConfig.answers.certifications.entries)) {
    if (!merged.answers) merged.answers = {};
    if (!merged.answers.certifications) merged.answers.certifications = {};
    merged.answers.certifications.entries = [...updatedConfig.answers.certifications.entries];
  }

  // Structural validation
  const validation = validateApplicationConfig(merged);
  if (!validation.valid) {
    const error = new Error(`Configuration validation failed:\n- ${validation.errors.join('\n- ')}`);
    error.validationErrors = validation.errors;
    throw error;
  }

  const jsonString = JSON.stringify(merged, null, 2) + '\n';
  const tempPath = `${CONFIG_PATH}.tmp.${Date.now()}`;

  // Atomic write
  fs.writeFileSync(tempPath, jsonString, 'utf8');
  fs.renameSync(tempPath, CONFIG_PATH);

  return merged;
}

/**
 * Helper to deep-merge objects while preserving unedited properties.
 */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  if (!target || typeof target !== 'object') return { ...source };

  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(target[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**
 * Request handler for the HTTP server.
 */
function requestHandler(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: GET /api/config
  if (req.method === 'GET' && pathname === '/api/config') {
    if (!fs.existsSync(CONFIG_PATH)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Configuration file not found.',
        path: CONFIG_PATH
      }));
      return;
    }

    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const data = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: `Unable to load application.json because the file contains invalid JSON: ${err.message}`
      }));
    }
    return;
  }

  // API: POST /api/config
  if (req.method === 'POST' && pathname === '/api/config') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB limit
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large.' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const saved = safeWriteApplicationConfig(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Configuration saved successfully.',
          data: saved
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: err.message,
          validationErrors: err.validationErrors || []
        }));
      }
    });
    return;
  }

  // Static File Serving (from ui/)
  let filePath = pathname === '/' ? path.join(UI_DIR, 'index.html') : path.join(UI_DIR, pathname);
  const normalizedPath = path.normalize(filePath);

  // Security check: ensure path is within UI_DIR
  if (!normalizedPath.startsWith(UI_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(normalizedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(normalizedPath).pipe(res);
  });
}

function startServer(port = PORT) {
  const server = http.createServer(requestHandler);
  server.listen(port, () => {
    console.log(`====================================================`);
    console.log(`Application Configuration Server running at:`);
    console.log(`  http://localhost:${port}/`);
    console.log(`Source of truth: ${CONFIG_PATH}`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  validateApplicationConfig,
  safeWriteApplicationConfig,
  deepMerge,
  startServer,
  CONFIG_PATH
};
