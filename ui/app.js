/**
 * Application Profile Configuration Editor (Phase 2A UI Refinement)
 * 
 * Client-side application providing full interactive functionality for
 * config/application.json with controlled dropdowns, drag-and-drop ranked list,
 * structured multi-value selectors, distinct validation messages, and dynamic collections.
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('config-form');
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = document.getElementById('validation-summary-text');
  
  // Containers & Inputs
  const skillsTbody = document.getElementById('skills-tbody');
  const certificatesContainer = document.getElementById('certificates-container');
  const educationContainer = document.getElementById('education-container');
  const preferredLocationsList = document.getElementById('preferred-locations-list');
  const preferredLocationSelect = document.getElementById('preferred-location-select');
  const btnAddPreferredLocation = document.getElementById('btn-add-preferred-location');
  
  const relocList = document.getElementById('relocation-locations-list');
  const newRelocSelect = document.getElementById('new-relocation-select');
  const btnAddReloc = document.getElementById('btn-add-relocation-location');
  
  const servingNoticeCheckbox = document.getElementById('answers-noticePeriod-servingNoticePeriod');
  const lwdInput = document.getElementById('answers-noticePeriod-lastWorkingDay');
  const lwdFormGroup = document.getElementById('lwd-form-group');
  const servingNoticeStatusText = document.getElementById('serving-notice-status-text');

  // In-memory cache of the authoritative configuration loaded from application.json
  let loadedConfig = {};
  let draggedItem = null;

  // -------------------------------------------------------------------------
  // Notifications & UI Status
  // -------------------------------------------------------------------------

  function showNotification(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-message">${escapeHtml(message)}</span>
      <button type="button" class="toast-close">&times;</button>
    `;

    container.appendChild(toast);

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.remove();
    });

    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  function setStatus(text, isError = false) {
    if (!statusText) return;
    statusText.textContent = text;
    if (statusIndicator) {
      if (isError) {
        statusIndicator.classList.add('error');
        statusText.style.color = 'var(--danger)';
      } else {
        statusIndicator.classList.remove('error');
        statusText.style.color = 'var(--text-muted)';
      }
    }
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // -------------------------------------------------------------------------
  // Field-level Validation with Specific Error Messages
  // -------------------------------------------------------------------------

  function validateField(input) {
    if (!input || input.type === 'hidden' || input.type === 'checkbox') return true;
    // Disabled fields are not validated
    if (input.disabled) {
      input.classList.remove('is-invalid');
      const group = input.closest('.form-group');
      if (group) {
        const errorSpan = group.querySelector('.error-message');
        if (errorSpan) errorSpan.textContent = '';
      }
      return true;
    }

    const value = String(input.value || '').trim();
    const title = input.dataset.fieldTitle || input.previousElementSibling?.textContent?.replace('*', '').trim() || input.name || 'Field';
    const isRequired = input.hasAttribute('required') || input.classList.contains('validate-required');
    const isInteger = input.classList.contains('validate-integer');
    const isNumeric = input.type === 'number' || input.classList.contains('validate-numeric') || isInteger;

    let errorMessage = '';

    if (isRequired && value.length === 0) {
      errorMessage = `${title} is required.`;
    } else if (value.length > 0 && isNumeric) {
      const num = Number(value);
      if (isNaN(num) || !isFinite(num)) {
        errorMessage = `${title} must be a number.`;
      } else if (isInteger && !Number.isInteger(num)) {
        errorMessage = `${title} must be a whole number.`;
      } else if (num < 0) {
        errorMessage = `${title} must be a positive number (or 0).`;
      } else {
        const minAttr = input.getAttribute('min');
        const maxAttr = input.getAttribute('max');
        if (minAttr !== null && num < Number(minAttr)) {
          errorMessage = `${title} cannot be less than ${minAttr}.`;
        } else if (maxAttr !== null && num > Number(maxAttr)) {
          errorMessage = `${title} cannot exceed ${maxAttr}.`;
        }
      }
    }

    const group = input.closest('.form-group');
    const errorSpan = group ? group.querySelector('.error-message') : null;

    if (errorMessage) {
      input.classList.add('is-invalid');
      if (errorSpan) errorSpan.textContent = errorMessage;
      return false;
    } else {
      input.classList.remove('is-invalid');
      if (errorSpan) errorSpan.textContent = '';
      return true;
    }
  }

  function validateAllFields() {
    const inputs = form.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"]):not(:disabled), select:not(:disabled)');
    let invalidCount = 0;

    inputs.forEach(input => {
      const valid = validateField(input);
      if (!valid) invalidCount++;
    });

    // Check duplicate skill names
    const skillNameInputs = skillsTbody.querySelectorAll('.skill-name-input');
    const seenSkills = new Set();
    let duplicateSkills = 0;

    skillNameInputs.forEach(input => {
      const name = String(input.value || '').trim().toLowerCase();
      if (name) {
        if (seenSkills.has(name)) {
          input.classList.add('is-invalid');
          const group = input.closest('.form-group') || input.parentElement;
          const err = group ? group.querySelector('.error-message') : null;
          if (err) err.textContent = `Duplicate skill "${input.value.trim()}".`;
          invalidCount++;
          duplicateSkills++;
        } else {
          seenSkills.add(name);
        }
      }
    });

    if (invalidCount === 0) {
      setStatus('All fields are valid and ready to save.');
    } else {
      const msg = duplicateSkills > 0
        ? `${invalidCount} validation error(s) found (including ${duplicateSkills} duplicate skill name(s)).`
        : `${invalidCount} field(s) have invalid values. Please review highlighted inputs.`;
      setStatus(msg, true);
    }

    return { total: inputs.length, invalid: invalidCount };
  }

  // Live input validation listeners
  form.addEventListener('input', (e) => {
    if (e.target.matches('input, select')) {
      validateField(e.target);
    }
  });

  form.addEventListener('blur', (e) => {
    if (e.target.matches('input, select')) {
      validateField(e.target);
    }
  }, true);

  // -------------------------------------------------------------------------
  // Notice Period Serving Notice Toggle & LWD Sync
  // -------------------------------------------------------------------------

  function updateServingNoticeState(isServing) {
    if (!lwdInput || !lwdFormGroup || !servingNoticeStatusText) return;
    
    if (isServing) {
      lwdFormGroup.classList.remove('is-disabled');
      lwdInput.disabled = false;
      servingNoticeStatusText.textContent = 'Yes, currently serving notice period';
    } else {
      lwdFormGroup.classList.add('is-disabled');
      lwdInput.disabled = true;
      servingNoticeStatusText.textContent = 'No, not currently serving notice';
      lwdInput.classList.remove('is-invalid');
      const err = lwdFormGroup.querySelector('.error-message');
      if (err) err.textContent = '';
    }
  }

  if (servingNoticeCheckbox) {
    servingNoticeCheckbox.addEventListener('change', (e) => {
      updateServingNoticeState(e.target.checked);
    });
  }

  // -------------------------------------------------------------------------
  // Structured Preferred Locations Selector (Chips)
  // -------------------------------------------------------------------------

  function renderPreferredLocations(locations = []) {
    if (!preferredLocationsList) return;
    preferredLocationsList.innerHTML = '';
    locations.forEach(loc => {
      const trimmed = String(loc).trim();
      if (trimmed) {
        addPreferredLocationChip(trimmed);
      }
    });
  }

  function addPreferredLocationChip(locName) {
    if (!preferredLocationsList) return;
    const chip = document.createElement('span');
    chip.className = 'tag-item';
    chip.dataset.location = locName;
    chip.innerHTML = `
      <span class="tag-text">${escapeHtml(locName)}</span>
      <button type="button" class="tag-remove" title="Remove ${escapeHtml(locName)}">&times;</button>
    `;
    preferredLocationsList.appendChild(chip);
  }

  function handleAddPreferredLocation() {
    if (!preferredLocationSelect || !preferredLocationsList) return;
    const selectedLoc = preferredLocationSelect.value;
    if (!selectedLoc) return;

    // Check duplicate
    const existing = Array.from(preferredLocationsList.querySelectorAll('.tag-item'))
      .map(el => el.dataset.location.toLowerCase());

    if (existing.includes(selectedLoc.toLowerCase())) {
      showNotification(`"${selectedLoc}" is already added to preferred locations.`, 'error');
      return;
    }

    addPreferredLocationChip(selectedLoc);
    preferredLocationSelect.selectedIndex = 0;
  }

  if (btnAddPreferredLocation) {
    btnAddPreferredLocation.addEventListener('click', handleAddPreferredLocation);
  }

  if (preferredLocationsList) {
    preferredLocationsList.addEventListener('click', (e) => {
      if (e.target.closest('.tag-remove')) {
        const chip = e.target.closest('.tag-item');
        if (chip) chip.remove();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Ranked Relocation Priorities (Drag & Drop)
  // -------------------------------------------------------------------------

  function renderRelocationLocations(locations = []) {
    if (!relocList) return;
    relocList.innerHTML = '';
    locations.forEach((loc, idx) => {
      const trimmed = String(loc).trim();
      if (trimmed) {
        addRankedRelocationItem(trimmed, idx + 1);
      }
    });
    updateRelocationRanks();
  }

  function createRankedItemElement(locationName, rank) {
    const item = document.createElement('div');
    item.className = 'ranked-item';
    item.draggable = true;
    item.dataset.location = locationName;
    item.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">☰</span>
      <span class="rank-number">${rank}</span>
      <span class="location-name">${escapeHtml(locationName)}</span>
      <button type="button" class="btn btn-danger-outline btn-xs btn-remove-relocation" title="Remove location">&times;</button>
    `;

    // Drag and drop event bindings
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', locationName);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedItem = null;
      relocList.querySelectorAll('.ranked-item').forEach(el => el.classList.remove('drag-over'));
      updateRelocationRanks();
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedItem && draggedItem !== item) {
        const bounding = item.getBoundingClientRect();
        const offset = e.clientY - bounding.top;
        if (offset > bounding.height / 2) {
          item.after(draggedItem);
        } else {
          item.before(draggedItem);
        }
      }
    });

    return item;
  }

  function addRankedRelocationItem(locationName, rank) {
    if (!relocList) return;
    const item = createRankedItemElement(locationName, rank);
    relocList.appendChild(item);
  }

  function updateRelocationRanks() {
    if (!relocList) return;
    const items = relocList.querySelectorAll('.ranked-item');
    items.forEach((item, idx) => {
      const rankSpan = item.querySelector('.rank-number');
      if (rankSpan) rankSpan.textContent = idx + 1;
    });
  }

  function handleAddRelocationLocation() {
    if (!newRelocSelect || !relocList) return;
    const selectedLoc = newRelocSelect.value;
    if (!selectedLoc) return;

    // Check duplicate
    const existing = Array.from(relocList.querySelectorAll('.ranked-item'))
      .map(el => el.dataset.location.toLowerCase());

    if (existing.includes(selectedLoc.toLowerCase())) {
      showNotification(`"${selectedLoc}" is already in the ranked relocation priority list.`, 'error');
      return;
    }

    const rank = relocList.querySelectorAll('.ranked-item').length + 1;
    addRankedRelocationItem(selectedLoc, rank);
    newRelocSelect.selectedIndex = 0;
    updateRelocationRanks();
  }

  if (btnAddReloc) {
    btnAddReloc.addEventListener('click', handleAddRelocationLocation);
  }

  if (relocList) {
    relocList.addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-relocation')) {
        const item = e.target.closest('.ranked-item');
        if (item) {
          item.remove();
          updateRelocationRanks();
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Dynamic Skills Collection
  // -------------------------------------------------------------------------

  function addSkillRow(skillName = '', experienceYears = 0) {
    const tr = document.createElement('tr');
    tr.className = 'skill-row';
    tr.innerHTML = `
      <td>
        <div class="form-group mb-0">
          <input type="text" class="form-control skill-name-input validate-string validate-required" value="${escapeHtml(String(skillName))}" placeholder="Skill Name (e.g. Docker, Next.js, FHIR)" data-field-title="Skill name" required>
          <span class="error-message"></span>
        </div>
      </td>
      <td>
        <div class="form-group mb-0">
          <input type="number" class="form-control skill-exp-input validate-numeric validate-required" value="${Number(experienceYears)}" min="0" max="50" step="0.5" data-field-title="Skill experience" required>
          <span class="error-message"></span>
        </div>
      </td>
      <td class="text-center">
        <button type="button" class="btn btn-danger-outline btn-xs btn-remove-skill" title="Remove Skill">Remove</button>
      </td>
    `;
    skillsTbody.appendChild(tr);
    return tr;
  }

  const addSkillBtn = document.getElementById('btn-add-skill');
  const addSkillBottomBtn = document.getElementById('btn-add-skill-bottom');

  if (addSkillBtn) addSkillBtn.addEventListener('click', () => {
    const tr = addSkillRow('', 0);
    const input = tr.querySelector('input');
    if (input) input.focus();
  });

  if (addSkillBottomBtn) addSkillBottomBtn.addEventListener('click', () => {
    const tr = addSkillRow('', 0);
    const input = tr.querySelector('input');
    if (input) input.focus();
  });

  if (skillsTbody) {
    skillsTbody.addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-skill')) {
        const row = e.target.closest('tr');
        if (row) {
          row.remove();
          validateAllFields();
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Dynamic Certificates Collection
  // -------------------------------------------------------------------------

  function addCertificateCard(data = {}) {
    if (!certificatesContainer) return;
    const count = certificatesContainer.querySelectorAll('.certificate-item').length + 1;
    const item = document.createElement('div');
    item.className = 'certificate-item mb-3';
    
    item.innerHTML = `
      <div class="flex-between mb-2">
        <span class="certificate-title" style="font-weight: 600; color: var(--text-heading); font-size: 0.95rem;">Certificate #${count}</span>
        <button type="button" class="btn btn-danger-outline btn-xs btn-remove-certificate" title="Remove Certificate">Remove</button>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label required">Certificate / Credential Name</label>
          <input type="text" class="form-control cert-name-input validate-string validate-required" value="${escapeHtml(String(data.name || data.title || ''))}" placeholder="e.g. AWS Certified Solutions Architect" data-field-title="Certificate name" required>
          <span class="error-message"></span>
        </div>
        <div class="form-group">
          <label class="form-label">Issuing Organization</label>
          <input type="text" class="form-control cert-issuer-input validate-string" value="${escapeHtml(String(data.issuer || data.organization || ''))}" placeholder="e.g. Amazon Web Services / Microsoft">
          <span class="error-message"></span>
        </div>
        <div class="form-group">
          <label class="form-label required">Completion / Issue Year</label>
          <input type="number" class="form-control cert-year-input validate-integer validate-required" value="${data.year || new Date().getFullYear()}" min="1990" max="2035" step="1" data-field-title="Certificate year" required>
          <span class="error-message"></span>
        </div>
      </div>
    `;
    certificatesContainer.appendChild(item);
    return item;
  }

  const addCertBtn = document.getElementById('btn-add-certificate');
  if (addCertBtn) {
    addCertBtn.addEventListener('click', () => {
      const item = addCertificateCard({ name: '', issuer: '', year: new Date().getFullYear() });
      const input = item.querySelector('input');
      if (input) input.focus();
    });
  }

  if (certificatesContainer) {
    certificatesContainer.addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-certificate')) {
        const item = e.target.closest('.certificate-item');
        if (item) {
          item.remove();
          certificatesContainer.querySelectorAll('.certificate-item').forEach((el, idx) => {
            const title = el.querySelector('.certificate-title');
            if (title) title.textContent = `Certificate #${idx + 1}`;
          });
          validateAllFields();
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Dynamic Education Collection
  // -------------------------------------------------------------------------

  function addEducationCard(data = {}) {
    if (!educationContainer) return;
    const count = educationContainer.querySelectorAll('.education-item').length + 1;
    const item = document.createElement('div');
    item.className = 'education-item';
    const isPrimary = count === 1;

    item.innerHTML = `
      <div class="education-header">
        <span class="education-title">${isPrimary ? 'Primary Qualification (Highest Degree)' : `Additional Qualification #${count - 1}`}</span>
        <button type="button" class="btn btn-danger-outline btn-xs btn-remove-education" title="Remove Qualification">Remove</button>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label required">Qualification / Degree</label>
          <input type="text" class="form-control edu-degree-input validate-string validate-required" value="${escapeHtml(String(data.degree || data.highestQualification || ''))}" placeholder="e.g. Master of Computer Applications (MCA)" data-field-title="Qualification degree" required>
          <span class="error-message"></span>
        </div>
        <div class="form-group">
          <label class="form-label">Institution / University</label>
          <input type="text" class="form-control edu-inst-input validate-string" value="${escapeHtml(String(data.institution || ''))}" placeholder="e.g. University Name / Institute">
          <span class="error-message"></span>
        </div>
        <div class="form-group">
          <label class="form-label required">Graduation / Completion Year</label>
          <input type="number" class="form-control edu-year-input validate-integer validate-required" value="${data.graduationYear || data.additionalQualificationYear || 2023}" min="1970" max="2035" step="1" data-field-title="Graduation year" required>
          <span class="error-message"></span>
        </div>
      </div>
    `;
    educationContainer.appendChild(item);
    return item;
  }

  const addEducationBtn = document.getElementById('btn-add-education');
  if (addEducationBtn) {
    addEducationBtn.addEventListener('click', () => {
      const item = addEducationCard({ degree: '', institution: '', graduationYear: new Date().getFullYear() });
      const input = item.querySelector('input');
      if (input) input.focus();
    });
  }

  if (educationContainer) {
    educationContainer.addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-education')) {
        const item = e.target.closest('.education-item');
        if (item) {
          item.remove();
          educationContainer.querySelectorAll('.education-item').forEach((elem, idx) => {
            const title = elem.querySelector('.education-title');
            if (title) {
              title.textContent = idx === 0 ? 'Primary Qualification (Highest Degree)' : `Additional Qualification #${idx}`;
            }
          });
          validateAllFields();
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Loading application.json from Backend
  // -------------------------------------------------------------------------

  async function loadConfiguration() {
    setStatus('Loading configuration from config/application.json...');

    try {
      const response = await fetch('/api/config');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const config = await response.json();
      loadedConfig = config;
      populateForm(config);
      setStatus('Loaded config/application.json successfully.');
      showNotification('Configuration loaded successfully from config/application.json', 'success');
    } catch (err) {
      console.warn('Could not load from API, checking if running in static mode:', err.message);
      setStatus(`Could not load via API (${err.message}). Using local template values.`, true);
      showNotification(`Unable to load application.json automatically (${err.message}). If running standalone, start the server: node scripts/config-server.js`, 'error');
    }
  }

  function populateForm(config) {
    if (!config || typeof config !== 'object') return;

    // 1. Basic Details
    setVal('basic-fullName', config.basic?.fullName || 'Kshitij Varshney');
    setVal('basic-dateOfBirth', config.basic?.dateOfBirth || '');
    setVal('basic-birthPlace', config.basic?.birthPlace || '');
    setVal('answers-compliance-diversity', config.answers?.compliance?.diversity ?? 'Male');
    setVal('answers-compliance-disability', config.answers?.compliance?.disability ?? 'No');
    setVal('answers-compliance-veteranStatus', config.answers?.compliance?.veteranStatus ?? 'No');

    // 2. Experience & Domain
    setVal('experienceYears', config.experienceYears ?? 3);
    setVal('answers-experience-totalYears', config.answers?.experience?.totalYears ?? config.experienceYears ?? 3);
    setVal('answers-domain-primaryDomain', config.answers?.domain?.primaryDomain || 'Healthcare');

    // 3. Contact & Location
    setVal('contact-phoneCountry', config.contact?.phoneCountry || 'India');
    setVal('answers-contact-currentLocation', config.answers?.contact?.currentLocation || 'Pune');
    setVal('answers-contact-location', config.answers?.contact?.location || 'Pune');
    
    // Preferred locations list
    const prefRaw = config.answers?.contact?.preferredLocation;
    let prefList = [];
    if (Array.isArray(prefRaw)) {
      prefList = prefRaw;
    } else if (typeof prefRaw === 'string') {
      prefList = prefRaw.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      prefList = ['Pune', 'Noida', 'Gurugram', 'Delhi', 'Mumbai', 'Bangalore', 'Hyderabad'];
    }
    renderPreferredLocations(prefList);

    // 4. Notice Period
    setVal('answers-noticePeriod-days', config.answers?.noticePeriod?.days ?? 90);
    setVal('answers-noticePeriod-months', config.answers?.noticePeriod?.months ?? 3);
    const isServingNotice = Boolean(config.answers?.noticePeriod?.servingNoticePeriod);
    setChecked('answers-noticePeriod-servingNoticePeriod', isServingNotice);
    setVal('answers-noticePeriod-lastWorkingDay', config.answers?.noticePeriod?.lastWorkingDay ?? '');
    updateServingNoticeState(isServingNotice);

    // 5. Salary
    setVal('salary-currentCTC', config.salary?.currentCTC ?? config.answers?.salary?.currentCTC ?? 8);
    setVal('salary-expectedCTC', config.salary?.expectedCTC ?? config.answers?.salary?.expectedCTC ?? 13);
    setVal('salary-currency', config.salary?.currency ?? config.answers?.salary?.currency ?? 'INR');

    // 6. Employment
    setChecked('answers-employment-currentlyEmployed', Boolean(config.answers?.employment?.currentlyEmployed ?? true));
    setChecked('answers-employment-activelyLooking', Boolean(config.answers?.employment?.activelyLooking ?? true));

    // 7. Work Preferences
    setVal('answers-workPreferences-workAuthorization', config.answers?.workPreferences?.workAuthorization ?? 'India');
    setChecked('answers-workPreferences-visaSponsorshipRequired', Boolean(config.answers?.workPreferences?.visaSponsorshipRequired));
    setChecked('answers-workPreferences-willingToRelocate', Boolean(config.answers?.workPreferences?.willingToRelocate ?? true));
    setChecked('answers-workPreferences-nightShift', Boolean(config.answers?.workPreferences?.nightShift ?? true));
    setChecked('answers-workPreferences-hybridNoida', Boolean(config.answers?.workPreferences?.hybridNoida ?? true));
    setChecked('answers-workPreferences-relocateGurugram', Boolean(config.answers?.workPreferences?.relocateGurugram ?? true));
    setChecked('answers-workPreferences-relocateNoida', Boolean(config.answers?.workPreferences?.relocateNoida ?? true));
    setChecked('answers-workPreferences-relocateDelhiNCR', Boolean(config.answers?.workPreferences?.relocateDelhiNCR ?? true));
    setChecked('answers-workPreferences-willingToTravelForInterview', Boolean(config.answers?.workPreferences?.willingToTravelForInterview));

    // 8. Relocation Ranked Locations
    const relocLocations = config.answers?.relocation?.locations || ['Remote', 'Pune', 'Gurugram', 'Noida', 'Delhi/NCR'];
    renderRelocationLocations(relocLocations);

    // 9. Skills Table
    if (skillsTbody) {
      skillsTbody.innerHTML = '';
      const skillsObj = config.answers?.skills || {};
      for (const [skillName, years] of Object.entries(skillsObj)) {
        addSkillRow(skillName, years);
      }
    }

    // 10. Certificates
    if (certificatesContainer) {
      certificatesContainer.innerHTML = '';
      const certList = config.answers?.certifications?.entries || config.answers?.certifications?.list || [];
      if (Array.isArray(certList) && certList.length > 0) {
        certList.forEach(cert => addCertificateCard(cert));
      }
    }

    // 11. Education
    if (educationContainer) {
      educationContainer.innerHTML = '';
      const edu = config.answers?.education;
      if (edu) {
        if (edu.degree || edu.highestQualification) {
          addEducationCard({
            degree: edu.degree || edu.highestQualification,
            highestQualification: edu.highestQualification,
            institution: edu.institution || '',
            graduationYear: edu.graduationYear || 2023
          });
        }
        if (edu.additionalQualification) {
          addEducationCard({
            degree: edu.additionalQualification,
            institution: '',
            graduationYear: edu.additionalQualificationYear || 2024
          });
        }
        if (Array.isArray(edu.entries)) {
          edu.entries.forEach(entry => addEducationCard(entry));
        }
      } else {
        addEducationCard({ degree: 'Master of Computer Applications', institution: '', graduationYear: 2023 });
      }
    }

    // 12. Settings & Consent
    setVal('answers-certifications-azure', String(Boolean(config.answers?.certifications?.azure)));
    setVal('answers-consent-privacyPolicy', config.answers?.consent?.privacyPolicy ?? 'auto');
    setVal('automation-formReadinessTimeoutMs', config.automation?.formReadinessTimeoutMs ?? 20000);
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function setChecked(id, bool) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(bool);
  }

  // -------------------------------------------------------------------------
  // Serializing & Saving to application.json
  // -------------------------------------------------------------------------

  function collectFormData() {
    // Collect Skills
    const skills = {};
    if (skillsTbody) {
      skillsTbody.querySelectorAll('tr.skill-row').forEach(tr => {
        const nameInput = tr.querySelector('.skill-name-input');
        const expInput = tr.querySelector('.skill-exp-input');
        if (nameInput && expInput) {
          const name = String(nameInput.value || '').trim();
          const years = Number(expInput.value || 0);
          if (name) {
            skills[name] = years;
          }
        }
      });
    }

    // Collect Preferred Locations (as comma-separated string)
    const preferredLocations = preferredLocationsList
      ? Array.from(preferredLocationsList.querySelectorAll('.tag-item')).map(el => el.dataset.location.trim()).filter(Boolean)
      : ['Pune', 'Noida', 'Gurugram', 'Delhi', 'Mumbai', 'Bangalore', 'Hyderabad'];

    // Collect Ranked Relocation locations
    const relocLocations = relocList
      ? Array.from(relocList.querySelectorAll('.ranked-item')).map(el => el.dataset.location.trim()).filter(Boolean)
      : ['Remote', 'Pune', 'Gurugram', 'Noida', 'Delhi/NCR'];

    // Collect Certificates
    const certEntries = [];
    if (certificatesContainer) {
      certificatesContainer.querySelectorAll('.certificate-item').forEach(item => {
        const nameInput = item.querySelector('.cert-name-input');
        const instInput = item.querySelector('.cert-issuer-input');
        const yearInput = item.querySelector('.cert-year-input');
        if (nameInput && nameInput.value.trim()) {
          certEntries.push({
            name: nameInput.value.trim(),
            issuer: instInput ? instInput.value.trim() : '',
            year: yearInput ? Number(yearInput.value || 2024) : 2024
          });
        }
      });
    }

    // Collect Education
    let primaryEdu = null;
    let additionalEdu = null;
    const additionalEntries = [];

    if (educationContainer) {
      const eduCards = educationContainer.querySelectorAll('.education-item');
      eduCards.forEach((card, idx) => {
        const degInput = card.querySelector('.edu-degree-input');
        const instInput = card.querySelector('.edu-inst-input');
        const yearInput = card.querySelector('.edu-year-input');

        const entry = {
          degree: degInput ? String(degInput.value || '').trim() : '',
          institution: instInput && instInput.value.trim() ? instInput.value.trim() : null,
          graduationYear: yearInput ? Number(yearInput.value || 2023) : 2023
        };

        if (idx === 0) {
          primaryEdu = entry;
        } else if (idx === 1) {
          additionalEdu = entry;
        } else {
          additionalEntries.push(entry);
        }
      });
    }

    const expYears = Number(document.getElementById('experienceYears')?.value || 3);
    const currCTC = Number(document.getElementById('salary-currentCTC')?.value || 8);
    const expCTC = Number(document.getElementById('salary-expectedCTC')?.value || 13);
    const currency = document.getElementById('salary-currency')?.value || 'INR';

    const isServing = Boolean(servingNoticeCheckbox?.checked);
    const lwdValue = document.getElementById('answers-noticePeriod-lastWorkingDay')?.value || '';

    // Build the updated structure while preserving unedited properties
    const updated = {
      automation: {
        formReadinessTimeoutMs: Number(document.getElementById('automation-formReadinessTimeoutMs')?.value || 20000)
      },
      basic: {
        fullName: document.getElementById('basic-fullName')?.value || 'Kshitij Varshney',
        dateOfBirth: document.getElementById('basic-dateOfBirth')?.value || '',
        birthPlace: document.getElementById('basic-birthPlace')?.value || ''
      },
      experienceYears: expYears,
      contact: {
        phoneCountry: document.getElementById('contact-phoneCountry')?.value || 'India'
      },
      salary: {
        currentCTC: currCTC,
        expectedCTC: expCTC,
        currency: currency
      },
      answers: {
        experience: {
          totalYears: Number(document.getElementById('answers-experience-totalYears')?.value || expYears)
        },
        contact: {
          location: document.getElementById('answers-contact-location')?.value || 'Pune',
          preferredLocation: preferredLocations.join(', '),
          currentLocation: document.getElementById('answers-contact-currentLocation')?.value || 'Pune'
        },
        noticePeriod: {
          days: Number(document.getElementById('answers-noticePeriod-days')?.value || 90),
          months: Number(document.getElementById('answers-noticePeriod-months')?.value || 3),
          servingNoticePeriod: isServing,
          lastWorkingDay: lwdValue
        },
        salary: {
          currentCTC: currCTC,
          expectedCTC: expCTC,
          currency: currency
        },
        employment: {
          currentlyEmployed: Boolean(document.getElementById('answers-employment-currentlyEmployed')?.checked),
          activelyLooking: Boolean(document.getElementById('answers-employment-activelyLooking')?.checked)
        },
        workPreferences: {
          willingToRelocate: Boolean(document.getElementById('answers-workPreferences-willingToRelocate')?.checked),
          workAuthorization: document.getElementById('answers-workPreferences-workAuthorization')?.value || 'India',
          visaSponsorshipRequired: Boolean(document.getElementById('answers-workPreferences-visaSponsorshipRequired')?.checked),
          nightShift: Boolean(document.getElementById('answers-workPreferences-nightShift')?.checked),
          hybridNoida: Boolean(document.getElementById('answers-workPreferences-hybridNoida')?.checked),
          relocateGurugram: Boolean(document.getElementById('answers-workPreferences-relocateGurugram')?.checked),
          relocateNoida: Boolean(document.getElementById('answers-workPreferences-relocateNoida')?.checked),
          relocateDelhiNCR: Boolean(document.getElementById('answers-workPreferences-relocateDelhiNCR')?.checked),
          willingToTravelForInterview: Boolean(document.getElementById('answers-workPreferences-willingToTravelForInterview')?.checked)
        },
        relocation: {
          willingToRelocate: Boolean(document.getElementById('answers-workPreferences-willingToRelocate')?.checked),
          locations: relocLocations
        },
        certifications: {
          azure: document.getElementById('answers-certifications-azure')?.value === 'true',
          entries: certEntries
        },
        skills: skills,
        domain: {
          primaryDomain: document.getElementById('answers-domain-primaryDomain')?.value || 'Healthcare',
          healthcare: loadedConfig.answers?.domain?.healthcare ?? 3,
          healthcareInteroperability: loadedConfig.answers?.domain?.healthcareInteroperability ?? 3,
          FHIR: loadedConfig.answers?.domain?.FHIR ?? 3,
          "IHE XDS": loadedConfig.answers?.domain?.['IHE XDS'] ?? loadedConfig.answers?.domain?.IHEXDS ?? 3,
          electronicPatientRecord: loadedConfig.answers?.domain?.electronicPatientRecord ?? 3
        },
        education: {
          highestQualification: primaryEdu?.degree ? (primaryEdu.degree.match(/\b(MCA|B\.?Tech|B\.?Sc|BCA|M\.?Tech|MS|MBA)\b/i)?.[0] || primaryEdu.degree) : 'MCA',
          degree: primaryEdu?.degree || 'Master of Computer Applications',
          institution: primaryEdu?.institution || null,
          graduationYear: primaryEdu?.graduationYear || 2023,
          ...(additionalEdu ? {
            additionalQualification: additionalEdu.degree,
            additionalQualificationYear: additionalEdu.graduationYear
          } : {}),
          ...(additionalEntries.length > 0 ? { entries: additionalEntries } : {})
        },
        compliance: {
          disability: document.getElementById('answers-compliance-disability')?.value || 'No',
          veteranStatus: document.getElementById('answers-compliance-veteranStatus')?.value || 'No',
          diversity: document.getElementById('answers-compliance-diversity')?.value || 'Prefer not to say'
        },
        consent: {
          privacyPolicy: document.getElementById('answers-consent-privacyPolicy')?.value || 'auto',
          terms: 'auto'
        }
      }
    };

    return updated;
  }

  async function saveConfiguration() {
    const validation = validateAllFields();
    if (validation.invalid > 0) {
      showNotification(`Cannot save: ${validation.invalid} field(s) have validation errors. Please fix highlighted fields.`, 'error');
      return;
    }

    const payload = collectFormData();
    setStatus('Saving configuration to config/application.json...');

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error ${response.status}`);
      }

      loadedConfig = result.data || payload;
      setStatus('Configuration saved successfully to config/application.json.');
      showNotification('Configuration saved successfully to config/application.json', 'success');
    } catch (err) {
      setStatus(`Failed to save: ${err.message}`, true);
      showNotification(`Unable to save application.json: ${err.message}`, 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Event Bindings for Actions
  // -------------------------------------------------------------------------

  const saveBtn = document.getElementById('btn-save');
  const saveBtnBottom = document.getElementById('btn-save-bottom');
  const validateBtn = document.getElementById('btn-validate-all');

  if (saveBtn) saveBtn.addEventListener('click', saveConfiguration);
  if (saveBtnBottom) saveBtnBottom.addEventListener('click', saveConfiguration);

  if (validateBtn) {
    validateBtn.addEventListener('click', () => {
      const result = validateAllFields();
      if (result.invalid > 0) {
        showNotification(`Validation Check: Found ${result.invalid} invalid field(s).`, 'error');
      } else {
        showNotification('Validation Check: All inputs are valid and ready to save!', 'success');
      }
    });
  }

  // Initial Load from application.json
  loadConfiguration();
});
