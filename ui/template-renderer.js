import { getEls } from './core.js';
import { getIsAddingNewTemplate, setIsAddingNewTemplate } from '../core/state.js';

let editingTemplateInputRef = null;

export function updateTemplates(templates, blankTemplateId = null, editingId = null) {
  const els = getEls();
  if (!els.templatesMenu) return;
  els.templatesMenu.innerHTML = '';

  const fragment = document.createDocumentFragment();

  templates.forEach(t => {
    if (blankTemplateId && t.id === blankTemplateId) return;

    const isEditing = t.id === editingId;

    const item = document.createElement('li');
    item.className = 'template-row';
    if (isEditing) item.classList.add('is-editing');
    item.dataset.id = t.id;

    // Use DocumentFragment for batch child element creation
    const itemFragment = document.createDocumentFragment();

    if (isEditing) {
      // Inline edit mode
      const editContainer = document.createElement('div');
      editContainer.className = 'template-edit-form';

      // Use DocumentFragment for batch input creation
      const containerFragment = document.createDocumentFragment();

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'template-edit-label';
      labelInput.value = t.label || '';
      labelInput.placeholder = 'Template name';
      labelInput.dataset.id = t.id;
      labelInput.dataset.field = 'label';
      labelInput.setAttribute('aria-label', 'Template name');
      labelInput.setAttribute('autocomplete', 'off');
      containerFragment.appendChild(labelInput);

      const textInput = document.createElement('textarea');
      textInput.className = 'template-edit-text';
      textInput.value = t.text || '';
      textInput.placeholder = 'Template prompt text';
      textInput.dataset.id = t.id;
      textInput.dataset.field = 'text';
      textInput.setAttribute('aria-label', 'Template prompt');
      textInput.rows = 3;
      containerFragment.appendChild(textInput);

      const actions = document.createElement('div');
      actions.className = 'template-edit-actions';

      // Use DocumentFragment for batch button creation
      const actionsFragment = document.createDocumentFragment();
      
      const saveBtn = document.createElement('button');
      saveBtn.className = 'action-btn save';
      saveBtn.textContent = '✓ Save';
      saveBtn.dataset.id = t.id;
      saveBtn.dataset.action = 'save-template';
      actionsFragment.appendChild(saveBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'action-btn cancel';
      cancelBtn.textContent = '✕ Cancel';
      cancelBtn.dataset.id = t.id;
      cancelBtn.dataset.action = 'cancel-template';
      actionsFragment.appendChild(cancelBtn);
      
      actions.appendChild(actionsFragment);
      containerFragment.appendChild(actions);
      
      editContainer.appendChild(containerFragment);
      itemFragment.appendChild(editContainer);

      editingTemplateInputRef = labelInput;
    } else {
      // Normal display mode
      const content = document.createElement('div');
      content.className = 'template-content';

      const btn = document.createElement('button');
      btn.className = 'dropdown-item template-select';
      btn.textContent = t.label;
      btn.dataset.text = t.text;
      btn.dataset.id = t.id;
      content.appendChild(btn);

      itemFragment.appendChild(content);

      const actions = document.createElement('div');
      actions.className = 'template-actions';

      // Use DocumentFragment for batch button creation
      const actionsFragment = document.createDocumentFragment();
      
      const editBtn = document.createElement('button');
      editBtn.className = 'action-btn edit';
      editBtn.textContent = '✎';
      editBtn.title = 'Edit template';
      editBtn.dataset.id = t.id;
      editBtn.dataset.action = 'edit-template';
      actionsFragment.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn delete';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete template';
      delBtn.dataset.id = t.id;
      delBtn.dataset.action = 'delete-template';
      actionsFragment.appendChild(delBtn);
      
      actions.appendChild(actionsFragment);
      itemFragment.appendChild(actions);
    }
    
    // Append all children at once
    item.appendChild(itemFragment);

    fragment.appendChild(item);
  });

  if (!editingId && !getIsAddingNewTemplate()) {
    const addRow = document.createElement('li');
    addRow.className = 'template-add-row';

    const addBtn = document.createElement('button');
    addBtn.className = 'dropdown-item template-add';
    addBtn.dataset.action = 'add-template';
    addBtn.textContent = '+ Add new template';
    addRow.appendChild(addBtn);

    fragment.appendChild(addRow);
  }

  if (getIsAddingNewTemplate()) {
    const addFormRow = document.createElement('li');
    addFormRow.className = 'template-row is-editing new-template';

    const editContainer = document.createElement('div');
    editContainer.className = 'template-edit-form';

    // Use DocumentFragment for batch input creation
    const containerFragment = document.createDocumentFragment();

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'template-edit-label';
    labelInput.id = 'new-template-label';
    labelInput.value = '';
    labelInput.placeholder = 'Template name';
    labelInput.setAttribute('aria-label', 'New template name');
    labelInput.setAttribute('autocomplete', 'off');
    containerFragment.appendChild(labelInput);

    const textInput = document.createElement('textarea');
    textInput.className = 'template-edit-text';
    textInput.id = 'new-template-text';
    textInput.value = '';
    textInput.placeholder = 'Template prompt text';
    textInput.setAttribute('aria-label', 'New template prompt');
    textInput.rows = 3;
    containerFragment.appendChild(textInput);

    const actions = document.createElement('div');
    actions.className = 'template-edit-actions';

    // Use DocumentFragment for batch button creation
    const actionsFragment = document.createDocumentFragment();
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'action-btn save';
    saveBtn.textContent = '✓ Save';
    saveBtn.dataset.action = 'save-new-template';
    actionsFragment.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn cancel';
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.dataset.action = 'cancel-new-template';
    actionsFragment.appendChild(cancelBtn);
    
    actions.appendChild(actionsFragment);
    containerFragment.appendChild(actions);
    
    editContainer.appendChild(containerFragment);
    addFormRow.appendChild(editContainer);
    fragment.appendChild(addFormRow);

    editingTemplateInputRef = labelInput;
  }

  els.templatesMenu.appendChild(fragment);

  // Focus the input after DOM is updated
  if (editingTemplateInputRef && (editingId || getIsAddingNewTemplate())) {
    requestAnimationFrame(() => {
      if (editingTemplateInputRef) {
        editingTemplateInputRef.focus();
        if (editingId) {
          editingTemplateInputRef.select();
        }
      }
    });
  }
}

/**
 * Get template edit form values
 * @param {string} id - Template ID (or null for new template)
 * @returns {{label: string, text: string}|null}
 */
export function getTemplateEditValues(id) {
  const els = getEls();
  if (id) {
    const row = els.templatesMenu?.querySelector(`.template-row[data-id="${id}"]`);
    if (!row) return null;
    const labelInput = row.querySelector('.template-edit-label');
    const textInput = row.querySelector('.template-edit-text');
    return {
      label: labelInput?.value?.trim() || '',
      text: textInput?.value?.trim() || ''
    };
  } else {
    // New template form
    const labelInput = document.getElementById('new-template-label');
    const textInput = document.getElementById('new-template-text');
    return {
      label: labelInput?.value?.trim() || '',
      text: textInput?.value?.trim() || ''
    };
  }
}

/**
 * Set whether we're adding a new template
 * @param {boolean} adding
 */
export function setAddingNewTemplate(adding) {
  setIsAddingNewTemplate(adding);
  if (!adding) {
    editingTemplateInputRef = null;
  }
}


