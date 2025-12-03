import { getEls } from './core.js';
import { formatDate, getSnapshotHost, clampLabel } from '../utils/utils.js';

export function buildContextSnapshotUI() {
  const els = getEls();
  if (!els.contextModal) return;
  const modalCard = els.contextModal.querySelector('.modal-card');
  const contextArea = document.getElementById('context-text');
  if (!modalCard || !contextArea) return;

  const container = document.createElement('div');
  container.className = 'context-snapshots';

  const source = document.createElement('div');
  source.id = 'context-source-label';
  source.className = 'context-source-label';
  container.appendChild(source);

  const hint = document.createElement('p');
  hint.className = 'context-snapshot-hint';
  hint.textContent = 'Save page context to reuse it later without re-scraping.';
  container.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'row context-snapshot-actions';

  const saveBtn = document.createElement('button');
  saveBtn.id = 'save-context-snapshot';
  saveBtn.type = 'button';
  saveBtn.className = 'filled';
  saveBtn.textContent = 'Save snapshot';
  actions.appendChild(saveBtn);

  const liveBtn = document.createElement('button');
  liveBtn.id = 'use-live-context';
  liveBtn.type = 'button';
  liveBtn.className = 'tonal';
  liveBtn.textContent = 'Use live tab';
  actions.appendChild(liveBtn);

  container.appendChild(actions);

  const list = document.createElement('ul');
  list.id = 'context-snapshot-list';
  list.className = 'attachment-list context-snapshot-list';
  container.appendChild(list);

  modalCard.insertBefore(container, contextArea);

  // Store references in els
  els.contextSource = source;
  els.snapshotList = list;
  els.saveSnapshotBtn = saveBtn;
  els.useLiveContextBtn = liveBtn;
  setContextSourceLabel(null);
}

export function setContextSourceLabel(snapshot = null) {
  const els = getEls();
  if (!els.contextSource) return;
  if (snapshot) {
    const label = snapshot.title || snapshot.url || 'Saved context';
    els.contextSource.textContent = `Using saved context: ${label}`;
  } else {
    els.contextSource.textContent = 'Using live tab context';
  }
}

export function renderContextSnapshots(
  snapshots = [],
  activeId = null
) {
  const els = getEls();
  if (!els.snapshotList) return;

  els.snapshotList.innerHTML = '';
  if (!snapshots || snapshots.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'context-snapshot-empty';
    empty.textContent = 'No saved contexts yet.';
    els.snapshotList.appendChild(empty);
    setContextSourceLabel();
    return;
  }

  const fragment = document.createDocumentFragment();
  snapshots.forEach((snap) => {
    const row = document.createElement('li');
    row.className = 'snapshot-row';
    row.dataset.id = snap.id;
    if (snap.id === activeId) row.classList.add('is-active');

    const info = document.createElement('div');
    info.className = 'snapshot-info';

    const title = document.createElement('div');
    title.className = 'snapshot-title';
    title.textContent = clampLabel(snap.title || getSnapshotHost(snap.url));
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'snapshot-meta';
    const host = getSnapshotHost(snap.url);
    const metaBits = [host, snap.createdAt ? formatDate(snap.createdAt) : ''].filter(Boolean);
    meta.textContent = metaBits.join(' • ');
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'snapshot-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'tonal use-snapshot';
    useBtn.dataset.id = snap.id;
    useBtn.textContent = snap.id === activeId ? 'In use' : 'Use';
    useBtn.disabled = snap.id === activeId;
    actions.appendChild(useBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon delete-snapshot';
    delBtn.dataset.id = snap.id;
    delBtn.textContent = '✕';
    delBtn.title = 'Delete snapshot';
    delBtn.setAttribute('aria-label', 'Delete snapshot');
    actions.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(actions);
    fragment.appendChild(row);
  });

  els.snapshotList.appendChild(fragment);
  const activeSnapshot = snapshots.find(s => s.id === activeId);
  setContextSourceLabel(activeSnapshot || null);
}


