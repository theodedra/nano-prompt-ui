/**
 * Snapshot Handlers - Context snapshot UI event handlers
 *
 * Handles saving, applying, and deleting context snapshots.
 */

import * as Controller from '../controller.js';
import { fetchContext } from '../context.js';
import { getSnapshotHost, clampLabel } from '../utils.js';

let isSnapshotBusy = false;

/**
 * Apply a snapshot to the current session
 * @param {Object} snapshot - Snapshot to apply
 * @param {Object} options - Options
 * @param {boolean} options.announce - Show toast notification
 */
export async function applySnapshot(snapshot, { announce = false } = {}) {
  if (!snapshot) return;
  Controller.activateSnapshot(snapshot.id);
  Controller.setContextText(snapshot.text);
  Controller.setContextDraft(snapshot.text);
  await Controller.persistContextDraft(snapshot.text);
  Controller.setRestrictedState(false);
  Controller.renderContextUI();
  await Controller.persistState({ immediate: true }); // User action
  if (announce) Controller.showToast('success', 'Using saved context');
}

/**
 * Apply a snapshot by its ID
 * @param {string} id - Snapshot ID
 */
export async function applySnapshotById(id) {
  if (!id) return;
  const snapshot = Controller.getSnapshotById(id);
  if (!snapshot) return;
  await applySnapshot(snapshot, { announce: true });
}

/**
 * Use live context from the active tab
 * @param {Object} options - Options
 * @param {boolean} options.quiet - Suppress toast notification
 */
export async function useLiveContext({ quiet = false } = {}) {
  if (isSnapshotBusy) return;
  isSnapshotBusy = true;
  try {
    Controller.activateSnapshot(null);
    Controller.renderContextUI();

    const liveCtx = await fetchContext(true, { respectSnapshot: false });
    const liveText = liveCtx?.text || '';
    Controller.setContextText(liveText);
    Controller.setContextDraft(liveText);
    await Controller.persistContextDraft(liveText);
    Controller.setRestrictedState(Boolean(liveCtx?.isRestricted));

    await Controller.persistState({ immediate: true }); // User action
    if (!quiet) Controller.showToast('success', 'Live tab context restored');
  } catch (e) {
    console.warn('Failed to refresh live context', e);
    Controller.showToast('error', 'Could not refresh live context.');
  } finally {
    isSnapshotBusy = false;
  }
}

/**
 * Handle delete snapshot
 * @param {string} id - Snapshot ID to delete
 */
export async function handleDeleteSnapshot(id) {
  if (!id) return;
  const activeSnapshotId = Controller.getActiveContextSnapshot()?.id;
  const wasActive = activeSnapshotId === id;
  const removed = Controller.deleteSnapshot(id);
  if (!removed) return;

  if (wasActive) {
    // Get first remaining snapshot
    const snapshots = Controller.getSession(Controller.getCurrentSessionId())?.contextSnapshots || [];
    if (snapshots[0]) {
      await applySnapshot(snapshots[0]);
    } else {
      await useLiveContext({ quiet: true });
    }
  } else {
    Controller.renderContextUI();
    await Controller.persistState({ immediate: true }); // Destructive action
  }
  Controller.showToast('success', 'Snapshot deleted');
}

/**
 * Handle Save Snapshot button click
 */
export async function handleSaveSnapshotClick() {
  if (isSnapshotBusy) return;
  isSnapshotBusy = true;
  try {
    const ctx = await fetchContext(true, { respectSnapshot: false });
    if (ctx?.isRestricted || !ctx?.text) {
      Controller.showToast('error', 'Context not available on this page.');
      return;
    }

    const snapshot = Controller.saveSnapshot({
      title: clampLabel(ctx.title || getSnapshotHost(ctx.url)),
      url: ctx.url || '',
      text: ctx.text,
      createdAt: Date.now()
    });

    if (snapshot) {
      await applySnapshot(snapshot, { announce: true });
    } else {
      Controller.showToast('error', 'Could not save context snapshot.');
    }
  } catch (e) {
    console.warn('Snapshot save failed', e);
    Controller.showToast('error', 'Failed to save context snapshot.');
  } finally {
    isSnapshotBusy = false;
  }
}

/**
 * Handle Use Live Context button click
 * @param {Event} event - Click event
 */
export async function handleUseLiveContext(event) {
  event?.preventDefault();
  await useLiveContext();
}

/**
 * Handle snapshot list click events
 * @param {MouseEvent} event - Click event
 */
export async function handleSnapshotListClick(event) {
  const useBtn = event.target.closest('.use-snapshot');
  const deleteBtn = event.target.closest('.delete-snapshot');

  if (useBtn?.dataset?.id) {
    event.preventDefault();
    await applySnapshotById(useBtn.dataset.id);
    return;
  }

  if (deleteBtn?.dataset?.id) {
    event.preventDefault();
    await handleDeleteSnapshot(deleteBtn.dataset.id);
  }
}

