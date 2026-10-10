/**
 * Application Profile Configuration UI - Basic Client-Side Validation (Phase 2A.1)
 * 
 * Provides instant field validation for numeric and required string fields,
 * visual error states, and basic UI interactions for visual approval.
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('config-form');
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = document.getElementById('validation-summary-text');

  // -------------------------------------------------------------------------
  // Field Validation Logic
  // -------------------------------------------------------------------------

  /**
   * Validates a single input element based on its classes and attributes.
   * @param {HTMLInputElement|HTMLSelectElement} input 
   * @returns {boolean} True if valid, false if invalid
   */
  function validateField(input) {
    if (!input || input.type === 'hidden' || input.type === 'checkbox') return true;

    const value = String(input.value || '').trim();
    const isRequired = input.hasAttribute('required') || input.classList.contains('validate-required');
    const isNumeric = input.type === 'number' || input.classList.contains('validate-numeric');
    const isString = input.classList.contains('validate-string');

    let isValid = true;

    // Required check
    if (isRequired && value.length === 0) {
      isValid = false;
    }

    // Numeric check
    if (isValid && isNumeric && value.length > 0) {
      const num = Number(value);
      if (isNaN(num)) {
        isValid = false;
      } else {
        const min = input.getAttribute('min');
        const max = input.getAttribute('max');
        if (min !== null && num < Number(min)) isValid = false;
        if (max !== null && num > Number(max)) isValid = false;
      }
    }

    // Update field visual state
    if (!isValid) {
      input.classList.add('is-invalid');
    } else {
      input.classList.remove('is-invalid');
    }

    return isValid;
  }

  /**
   * Validates all inputs currently inside the form.
   * @returns {{ total: number, invalid: number }}
   */
  function validateAllFields() {
    const inputs = form.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"]), select');
    let invalidCount = 0;

    inputs.forEach(input => {
      const valid = validateField(input);
      if (!valid) invalidCount++;
    });

    if (invalidCount === 0) {
      statusIndicator.classList.remove('error');
      statusText.textContent = 'All fields valid (Phase 2A.1 UI Preview)';
      statusText.style.color = 'var(--text-muted)';
    } else {
      statusIndicator.classList.add('error');
      statusText.textContent = `${invalidCount} field(s) have invalid values. Please check highlighted inputs.`;
      statusText.style.color = 'var(--danger)';
    }

    return { total: inputs.length, invalid: invalidCount };
  }

  // Attach real-time validation listeners to all inputs
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
  // UI Interactive Stubs (For Visual Approval)
  // -------------------------------------------------------------------------

  // Add Skill button
  const addSkillBtn = document.getElementById('btn-add-skill');
  const addSkillBottomBtn = document.getElementById('btn-add-skill-bottom');
  const skillsTbody = document.getElementById('skills-tbody');

  function addNewSkillRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="form-control validate-string validate-required" placeholder="e.g. Next.js, Docker" required></td>
      <td><input type="number" class="form-control validate-numeric validate-required" value="0" min="0" max="50" step="0.5" required></td>
      <td class="text-center"><button type="button" class="btn btn-danger-outline btn-xs btn-remove-skill" title="Remove">Remove</button></td>
    `;
    skillsTbody.appendChild(tr);
    const firstInput = tr.querySelector('input');
    if (firstInput) firstInput.focus();
  }

  if (addSkillBtn) addSkillBtn.addEventListener('click', addNewSkillRow);
  if (addSkillBottomBtn) addSkillBottomBtn.addEventListener('click', addNewSkillRow);

  // Remove Skill delegation
  skillsTbody.addEventListener('click', (e) => {
    if (e.target.closest('.btn-remove-skill')) {
      const row = e.target.closest('tr');
      if (row) row.remove();
    }
  });

  // Add Education button
  const addEducationBtn = document.getElementById('btn-add-education');
  const educationContainer = document.getElementById('education-container');

  if (addEducationBtn && educationContainer) {
    addEducationBtn.addEventListener('click', () => {
      const count = educationContainer.querySelectorAll('.education-item').length + 1;
      const item = document.createElement('div');
      item.className = 'education-item';
      item.innerHTML = `
        <div class="education-header">
          <span class="education-title">Qualification Entry #${count}</span>
          <button type="button" class="btn btn-danger-outline btn-xs btn-remove-education">Remove</button>
        </div>
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label required">Qualification / Degree</label>
            <input type="text" class="form-control validate-string validate-required" placeholder="e.g. Bachelor of Science" required>
            <span class="error-message">Degree name is required</span>
          </div>
          <div class="form-group">
            <label class="form-label">Institution / University</label>
            <input type="text" class="form-control validate-string" placeholder="e.g. University Name">
            <span class="error-message">Please enter a valid institution name</span>
          </div>
          <div class="form-group">
            <label class="form-label required">Graduation Year</label>
            <input type="number" class="form-control validate-numeric validate-required" value="2020" min="1970" max="2035" step="1" required>
            <span class="error-message">Please enter a 4-digit year</span>
          </div>
        </div>
      `;
      educationContainer.appendChild(item);
      const firstInput = item.querySelector('input');
      if (firstInput) firstInput.focus();
    });
  }

  // Remove Education delegation
  if (educationContainer) {
    educationContainer.addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-education')) {
        const item = e.target.closest('.education-item');
        if (item) item.remove();
      }
    });
  }

  // Add Relocation Tag
  const addRelocBtn = document.getElementById('btn-add-relocation-location');
  const newRelocInput = document.getElementById('new-relocation-input');
  const relocList = document.getElementById('relocation-locations-list');

  function addRelocationLocation() {
    const val = String(newRelocInput.value || '').trim();
    if (!val) return;
    const rank = relocList.querySelectorAll('.tag-item').length + 1;
    const tag = document.createElement('span');
    tag.className = 'tag-item';
    tag.innerHTML = `<span class="tag-rank">${rank}</span> ${val} <button type="button" class="tag-remove" title="Remove">&times;</button>`;
    relocList.appendChild(tag);
    newRelocInput.value = '';
  }

  if (addRelocBtn && newRelocInput && relocList) {
    addRelocBtn.addEventListener('click', addRelocationLocation);
    newRelocInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addRelocationLocation();
      }
    });
  }

  // Remove Relocation Tag delegation
  if (relocList) {
    relocList.addEventListener('click', (e) => {
      if (e.target.closest('.tag-remove')) {
        const tag = e.target.closest('.tag-item');
        if (tag) {
          tag.remove();
          // Re-index ranks
          relocList.querySelectorAll('.tag-item').forEach((item, idx) => {
            const rankSpan = item.querySelector('.tag-rank');
            if (rankSpan) rankSpan.textContent = idx + 1;
          });
        }
      }
    });
  }

  // Validation Check Button
  const validateBtn = document.getElementById('btn-validate-all');
  if (validateBtn) {
    validateBtn.addEventListener('click', () => {
      const result = validateAllFields();
      if (result.invalid > 0) {
        alert(`Validation Check: Found ${result.invalid} invalid field(s). Please review highlighted inputs.`);
      } else {
        alert('Validation Check: All inputs are valid!');
      }
    });
  }

  // Save Configuration Preview Button
  const saveBtn = document.getElementById('btn-save');
  const saveBtnBottom = document.getElementById('btn-save-bottom');

  function handleSaveClick() {
    const result = validateAllFields();
    if (result.invalid > 0) {
      alert(`Cannot save: ${result.invalid} field(s) have validation errors.`);
    } else {
      alert('Phase 2A.1 Preview: Form validated successfully!\n\n(Full application.json JSON saving will be wired in Phase 2A.2)');
    }
  }

  if (saveBtn) saveBtn.addEventListener('click', handleSaveClick);
  if (saveBtnBottom) saveBtnBottom.addEventListener('click', handleSaveClick);
});
