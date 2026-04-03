// ==========================================
// Workout Cycle - PWA App
// ==========================================

const DB_NAME = 'physio-workouts';
const DB_VERSION = 1;
let db;

// ---- IndexedDB Setup ----
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('exercises')) {
        db.createObjectStore('exercises', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e);
  });
}

function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

function dbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e);
  });
}

// ---- State ----
let exercises = [];
let editingId = null;
let locationFilter = 'all';

// ---- Tab Navigation ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');

    if (tab.dataset.tab === 'todo') renderDueList();
    if (tab.dataset.tab === 'exercises') renderExerciseList();
    if (tab.dataset.tab === 'plan') renderPlan();
  });
});

// ---- Helpers ----
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isDue(exercise) {
  if (!exercise.lastCompleted) return true;
  const now = startOfDay(new Date());
  const last = startOfDay(new Date(exercise.lastCompleted));
  const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  return diffDays > exercise.restDays;
}

function daysUntilDue(exercise) {
  if (!exercise.lastCompleted) return 0;
  const now = startOfDay(new Date());
  const last = startOfDay(new Date(exercise.lastCompleted));
  const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  const remaining = exercise.restDays - diffDays + 1;
  return Math.max(0, remaining);
}

function daysSinceCompleted(exercise) {
  if (!exercise.lastCompleted) return null;
  const now = startOfDay(new Date());
  const last = startOfDay(new Date(exercise.lastCompleted));
  return Math.floor((now - last) / (1000 * 60 * 60 * 24));
}

// ---- Location Filter ----
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    locationFilter = btn.dataset.filter;
    renderDueList();
  });
});

function matchesLocationFilter(exercise) {
  if (locationFilter === 'all') return true;
  // 'both' exercises show up everywhere
  if (exercise.location === 'both') return true;
  return exercise.location === locationFilter;
}

function locationLabel(loc) {
  const labels = { home: 'Home', gym: 'Gym', both: 'Home & Gym' };
  return labels[loc] || 'Home & Gym';
}

function frequencyLabel(restDays) {
  if (restDays === 0) return 'Daily';
  if (restDays === 1) return 'Every other day';
  return `Every ${restDays + 1} days`;
}

function typeLabel(type) {
  const labels = { workout: 'Workout', stretch: 'Cooldown' };
  return labels[type] || '';
}

function bodypartLabel(bp) {
  const labels = { legs: 'Legs', upper: 'Upper Body', core: 'Core' };
  return labels[bp] || '';
}

function typeBadgeHtml(type) {
  if (!type) return '';
  return `<span class="type-badge ${type}">${typeLabel(type)}</span>`;
}

function bodypartBadgeHtml(bp) {
  if (!bp) return '';
  return `<span class="bodypart-badge ${bp}">${bodypartLabel(bp)}</span>`;
}

// Urgency score: higher = more overdue relative to cycle length
function urgencyScore(exercise) {
  if (!exercise.lastCompleted) return Infinity;
  const days = daysSinceCompleted(exercise);
  const cycleLength = exercise.restDays + 1;
  return days / cycleLength;
}

// Count completions in past N days from history
function completionsInDays(exercise, days) {
  if (!exercise.completionHistory || exercise.completionHistory.length === 0) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return exercise.completionHistory.filter(d => new Date(d) >= cutoff).length;
}

// ---- Render: Due List (To Do tab) ----
function renderDueList() {
  const container = document.getElementById('due-list');
  const emptyMsg = document.getElementById('all-done');

  const activeFiltered = exercises.filter(e => !e.paused && matchesLocationFilter(e));
  const dueExercises = activeFiltered.filter(e => isDue(e));
  const notDueExercises = activeFiltered.filter(e => !isDue(e));

  if (activeFiltered.length === 0) {
    container.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }

  emptyMsg.style.display = 'none';

  // Sort due by urgency (descending)
  dueExercises.sort((a, b) => {
    const ua = urgencyScore(a);
    const ub = urgencyScore(b);
    if (ua === ub) return a.name.localeCompare(b.name);
    return ub - ua;
  });

  // Sort not-due by days until due (ascending)
  notDueExercises.sort((a, b) => daysUntilDue(a) - daysUntilDue(b) || a.name.localeCompare(b.name));

  function renderCard(ex, isDueNow) {
    const days = daysSinceCompleted(ex);
    let detail;
    if (isDueNow) {
      if (days === null) {
        detail = 'Never done — start today!';
      } else {
        const overdueDays = days - ex.restDays;
        detail = overdueDays > 1 ? `${overdueDays} days overdue` : 'Due today';
      }
    } else {
      const remaining = daysUntilDue(ex);
      detail = `Due in ${remaining} day${remaining !== 1 ? 's' : ''}`;
    }
    const overdueClass = isDueNow && days !== null && (days - ex.restDays) > 1 ? 'overdue' : '';
    const notDueClass = isDueNow ? '' : 'not-due';
    const loc = ex.location || 'both';
    const skipBtn = isDueNow ? `<button class="skip-btn" onclick="skipExercise('${ex.id}', this)" title="Skip (reset timer)">&#8631;</button>` : '';
    return `
      <div class="exercise-card ${overdueClass} ${notDueClass}" data-id="${ex.id}">
        <div class="play-icon" onclick="playVideo('${ex.id}')">&#9654;</div>
        <div class="info" onclick="playVideo('${ex.id}')">
          <div class="name">${escapeHtml(ex.name)} <span class="location-badge ${loc}">${locationLabel(loc)}</span>${typeBadgeHtml(ex.exerciseType)}${bodypartBadgeHtml(ex.bodyPart)}</div>
          <div class="detail">${detail}</div>
        </div>
        ${skipBtn}
        <button class="check-btn" onclick="markDone('${ex.id}', this)" title="Mark as done">&#10003;</button>
      </div>
    `;
  }

  let html = dueExercises.map(ex => renderCard(ex, true)).join('');

  if (notDueExercises.length > 0) {
    if (dueExercises.length > 0) {
      html += '<div class="section-divider">Not yet due</div>';
    }
    html += notDueExercises.map(ex => renderCard(ex, false)).join('');
  }

  container.innerHTML = html;
}

// ---- Render: Exercise List (Exercises tab) ----
function renderExerciseList() {
  const container = document.getElementById('exercise-list');
  const emptyMsg = document.getElementById('no-exercises');

  if (exercises.length === 0) {
    container.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }

  emptyMsg.style.display = 'none';

  const sorted = [...exercises].sort((a, b) => a.name.localeCompare(b.name));

  // Show active exercises first, then paused
  const active = sorted.filter(e => !e.paused);
  const paused = sorted.filter(e => e.paused);
  const ordered = [...active, ...paused];

  container.innerHTML = ordered.map(ex => {
    const pausedClass = ex.paused ? 'paused' : '';
    const pausedBadge = ex.paused ? '<span class="paused-badge">Paused</span>' : '';
    let statusText, statusColor;
    if (ex.paused) {
      statusText = 'Out of rotation';
      statusColor = 'color: var(--text-secondary);';
    } else {
      const due = isDue(ex);
      statusText = due ? 'Due now' : `Due in ${daysUntilDue(ex)} day${daysUntilDue(ex) !== 1 ? 's' : ''}`;
      statusColor = due ? 'color: var(--success); font-weight: 600;' : '';
    }
    const loc = ex.location || 'both';
    return `
      <div class="exercise-card ${pausedClass}" data-id="${ex.id}">
        <div class="play-icon" onclick="playVideo('${ex.id}')">&#9654;</div>
        <div class="info" onclick="playVideo('${ex.id}')">
          <div class="name">${escapeHtml(ex.name)} <span class="location-badge ${loc}">${locationLabel(loc)}</span>${typeBadgeHtml(ex.exerciseType)}${bodypartBadgeHtml(ex.bodyPart)}${pausedBadge}</div>
          <div class="detail">${frequencyLabel(ex.restDays)} &middot; <span style="${statusColor}">${statusText}</span></div>
        </div>
        <button class="edit-icon" onclick="openEditExercise('${ex.id}')" title="Edit">&#9998;</button>
      </div>
    `;
  }).join('');
}

// ---- Render: Workout Plan ----
function renderPlan() {
  const container = document.getElementById('plan-text');

  if (exercises.length === 0) {
    container.textContent = 'No exercises added yet.';
    return;
  }

  const sorted = [...exercises].sort((a, b) => a.name.localeCompare(b.name));
  const activeExercises = sorted.filter(e => !e.paused);
  const pausedExercises = sorted.filter(e => e.paused);
  const lines = [];

  lines.push('MY PHYSIOTHERAPY WORKOUT PLAN');
  lines.push('Generated: ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  lines.push('');

  function formatExerciseLine(ex, i) {
    const freq = ex.restDays === 0
      ? 'Daily'
      : ex.restDays === 1
        ? 'Every other day (~3-4x/week)'
        : `Every ${ex.restDays + 1} days (~${Math.round(7 / (ex.restDays + 1) * 10) / 10}x/week)`;

    lines.push(`${i + 1}. ${ex.name}`);
    lines.push(`   Location: ${locationLabel(ex.location || 'both')}`);
    lines.push(`   Frequency: ${freq}`);
    lines.push(`   Done: ${completionsInDays(ex, 7)}x in past 7 days, ${completionsInDays(ex, 28)}x in past 28 days`);

    if (ex.lastCompleted) {
      const d = new Date(ex.lastCompleted);
      lines.push(`   Last completed: ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    } else {
      lines.push('   Last completed: Not yet');
    }
    lines.push('');
  }

  // Group active exercises by body part, then by type
  const bodyPartOrder = ['legs', 'upper', 'core', ''];
  const bodyPartNames = { legs: 'LEGS', upper: 'UPPER BODY', core: 'CORE', '': 'UNASSIGNED' };
  const typeOrder = ['workout', 'stretch', ''];
  const typeNames = { workout: 'Workout', stretch: 'Cooldown', '': 'Unset timing' };

  lines.push('ACTIVE EXERCISES');
  lines.push('='.repeat(35));

  if (activeExercises.length === 0) {
    lines.push('(none)');
    lines.push('');
  } else {
    let counter = 0;
    for (const bp of bodyPartOrder) {
      const bpExercises = activeExercises.filter(e => (e.bodyPart || '') === bp);
      if (bpExercises.length === 0) continue;

      lines.push('');
      lines.push(`${bodyPartNames[bp]}`);
      lines.push('-'.repeat(35));

      for (const t of typeOrder) {
        const group = bpExercises.filter(e => (e.exerciseType || '') === t);
        if (group.length === 0) continue;

        lines.push(`  ${typeNames[t]}`);
        group.forEach(ex => {
          formatExerciseLine(ex, counter);
          counter++;
        });
      }
    }
  }

  if (pausedExercises.length > 0) {
    lines.push('');
    lines.push('PAUSED (OUT OF ROTATION)');
    lines.push('='.repeat(35));
    pausedExercises.forEach((ex, i) => formatExerciseLine(ex, i));
  }

  lines.push('-'.repeat(35));
  lines.push(`Active: ${activeExercises.length} | Paused: ${pausedExercises.length} | Total: ${exercises.length}`);

  container.textContent = lines.join('\n');
}

// ---- Mark Done ----
async function markDone(id, btn) {
  const ex = exercises.find(e => e.id === id);
  if (!ex) return;

  btn.classList.add('checked');
  btn.innerHTML = '&#10003;';

  // Brief visual feedback before removing
  setTimeout(async () => {
    const now = new Date().toISOString();
    ex.lastCompleted = now;
    if (!ex.completionHistory) ex.completionHistory = [];
    ex.completionHistory.push(now);
    await dbPut('exercises', ex);
    renderDueList();
  }, 400);
}

// ---- Skip (reset timer without marking done) ----
async function skipExercise(id, btn) {
  const ex = exercises.find(e => e.id === id);
  if (!ex) return;

  btn.classList.add('checked');

  setTimeout(async () => {
    // Set lastCompleted to now so the rest timer resets, but don't add to history
    ex.lastCompleted = new Date().toISOString();
    await dbPut('exercises', ex);
    renderDueList();
  }, 400);
}

// ---- Video Playback ----
function playVideo(id) {
  const ex = exercises.find(e => e.id === id);
  if (!ex || !ex.videoBlob) return;

  const modal = document.getElementById('video-modal');
  const player = document.getElementById('video-player');

  const url = URL.createObjectURL(ex.videoBlob);
  player.src = url;
  modal.style.display = 'flex';

  player.play().catch(() => {});
}

function closeVideoModal() {
  const modal = document.getElementById('video-modal');
  const player = document.getElementById('video-player');
  player.pause();
  player.removeAttribute('src');
  player.load();
  modal.style.display = 'none';
}

document.querySelector('#video-modal .modal-close').addEventListener('click', closeVideoModal);
document.getElementById('video-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeVideoModal();
});

// ---- Add / Edit Exercise Modal ----
document.getElementById('add-exercise-btn').addEventListener('click', () => {
  openAddExercise();
});

function openAddExercise() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add Exercise';
  document.getElementById('exercise-name').value = '';
  document.getElementById('exercise-video').value = '';
  document.getElementById('exercise-rest').value = '2';
  document.getElementById('exercise-location').value = 'both';
  document.getElementById('exercise-type').value = '';
  document.getElementById('exercise-bodypart').value = '';
  document.getElementById('exercise-paused').checked = false;
  document.getElementById('current-video-name').textContent = '';
  document.getElementById('delete-exercise-btn').style.display = 'none';
  hideModalVideoPreview();
  document.getElementById('exercise-modal').style.display = 'flex';
}

function openEditExercise(id) {
  const ex = exercises.find(e => e.id === id);
  if (!ex) return;

  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit Exercise';
  document.getElementById('exercise-name').value = ex.name;
  document.getElementById('exercise-video').value = '';
  document.getElementById('exercise-rest').value = ex.restDays;
  document.getElementById('exercise-location').value = ex.location || 'both';
  document.getElementById('exercise-type').value = ex.exerciseType || '';
  document.getElementById('exercise-bodypart').value = ex.bodyPart || '';
  document.getElementById('exercise-paused').checked = !!ex.paused;
  document.getElementById('current-video-name').textContent = ex.videoName ? `Current: ${ex.videoName}` : '';
  document.getElementById('delete-exercise-btn').style.display = 'block';

  // Show existing video preview
  if (ex.videoBlob) {
    showModalVideoPreview(URL.createObjectURL(ex.videoBlob));
  } else {
    hideModalVideoPreview();
  }

  document.getElementById('exercise-modal').style.display = 'flex';
}

// Modal video preview
function showModalVideoPreview(url) {
  const preview = document.getElementById('modal-video-preview');
  preview.src = url;
  preview.style.display = 'block';
}

function hideModalVideoPreview() {
  const preview = document.getElementById('modal-video-preview');
  preview.pause();
  preview.removeAttribute('src');
  preview.load();
  preview.style.display = 'none';
}

// Show preview when a new file is selected
document.getElementById('exercise-video').addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    showModalVideoPreview(URL.createObjectURL(e.target.files[0]));
  }
});

function closeExerciseModal() {
  document.getElementById('exercise-modal').style.display = 'none';
  hideModalVideoPreview();
  editingId = null;
}

document.getElementById('cancel-exercise-btn').addEventListener('click', closeExerciseModal);

// Save exercise
document.getElementById('save-exercise-btn').addEventListener('click', async () => {
  const name = document.getElementById('exercise-name').value.trim();
  const restDays = parseInt(document.getElementById('exercise-rest').value) || 0;
  const location = document.getElementById('exercise-location').value;
  const exerciseType = document.getElementById('exercise-type').value;
  const bodyPart = document.getElementById('exercise-bodypart').value;
  const paused = document.getElementById('exercise-paused').checked;
  const fileInput = document.getElementById('exercise-video');

  if (!name) {
    alert('Please enter an exercise name.');
    return;
  }

  let exercise;

  if (editingId) {
    exercise = exercises.find(e => e.id === editingId);
    exercise.name = name;
    exercise.restDays = restDays;
    exercise.location = location;
    exercise.exerciseType = exerciseType;
    exercise.bodyPart = bodyPart;
    exercise.paused = paused;
  } else {
    exercise = {
      id: generateId(),
      name: name,
      restDays: restDays,
      location: location,
      exerciseType: exerciseType,
      bodyPart: bodyPart,
      paused: paused,
      lastCompleted: null,
      videoBlob: null,
      videoName: null,
    };
    exercises.push(exercise);
  }

  // Handle video file
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    exercise.videoBlob = file;
    exercise.videoName = file.name;

    // Store as blob in IndexedDB
    const reader = new FileReader();
    reader.onload = async () => {
      exercise.videoBlob = new Blob([reader.result], { type: file.type });
      exercise.videoType = file.type;
      await dbPut('exercises', exercise);
      renderExerciseList();
      renderDueList();
    };
    reader.readAsArrayBuffer(file);
  } else {
    await dbPut('exercises', exercise);
  }

  closeExerciseModal();
  renderExerciseList();
  renderDueList();
});

// Delete exercise
document.getElementById('delete-exercise-btn').addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('Delete this exercise?')) return;

  exercises = exercises.filter(e => e.id !== editingId);
  await dbDelete('exercises', editingId);
  closeExerciseModal();
  renderExerciseList();
  renderDueList();
});

// ---- Plan: Copy & Share ----
document.getElementById('copy-plan-btn').addEventListener('click', () => {
  const text = document.getElementById('plan-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-plan-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy to Clipboard', 2000);
  }).catch(() => {
    // Fallback: select text
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('plan-text'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
});

document.getElementById('share-plan-btn').addEventListener('click', () => {
  const text = document.getElementById('plan-text').textContent;
  if (navigator.share) {
    navigator.share({ title: 'My Workout Plan', text: text });
  } else {
    // Fallback to copy
    navigator.clipboard.writeText(text).then(() => alert('Plan copied to clipboard!'));
  }
});

// ---- Data Export / Import ----
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

document.getElementById('export-btn').addEventListener('click', async () => {
  const btn = document.getElementById('export-btn');
  btn.textContent = 'Exporting...';
  btn.disabled = true;

  try {
    const exportData = [];
    for (const ex of exercises) {
      const entry = { ...ex };
      if (ex.videoBlob) {
        entry.videoBase64 = await blobToBase64(ex.videoBlob);
      }
      delete entry.videoBlob;
      exportData.push(entry);
    }

    const json = JSON.stringify(exportData);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workout-cycle-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Export failed: ' + err.message);
  }

  btn.textContent = 'Export Data';
  btn.disabled = false;
});

document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importedData = JSON.parse(text);

    if (!Array.isArray(importedData)) {
      alert('Invalid backup file.');
      return;
    }

    if (!confirm(`Import ${importedData.length} exercises? This will merge with your existing data (existing exercises with the same ID will be updated).`)) {
      return;
    }

    for (const ex of importedData) {
      // Restore video blob from base64 if present
      if (ex.videoBase64) {
        ex.videoBlob = base64ToBlob(ex.videoBase64);
        delete ex.videoBase64;
      }

      const existing = exercises.find(e => e.id === ex.id);
      if (existing) {
        // If import has a video, use it; otherwise keep existing
        const videoBlob = ex.videoBlob || existing.videoBlob;
        Object.assign(existing, ex, { videoBlob });
        await dbPut('exercises', existing);
      } else {
        if (!ex.videoBlob) ex.videoBlob = null;
        exercises.push(ex);
        await dbPut('exercises', ex);
      }
    }

    renderDueList();
    renderExerciseList();
    renderPlan();
    alert('Import complete!');
  } catch (err) {
    alert('Error reading backup file: ' + err.message);
  }

  e.target.value = '';
});

// ---- Utility ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Init ----
async function init() {
  await openDB();
  exercises = await dbGetAll('exercises');
  renderDueList();
  renderExerciseList();
}

init();

// ---- Service Worker Registration ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
