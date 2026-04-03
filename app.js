// ==========================================
// My Physio Workouts - PWA App
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

// ---- Render: Due List (To Do tab) ----
function renderDueList() {
  const container = document.getElementById('due-list');
  const emptyMsg = document.getElementById('all-done');

  const dueExercises = exercises.filter(e => !e.paused && isDue(e) && matchesLocationFilter(e));

  if (dueExercises.length === 0) {
    container.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }

  emptyMsg.style.display = 'none';

  // Sort: never-completed first, then by longest overdue
  dueExercises.sort((a, b) => {
    if (!a.lastCompleted && b.lastCompleted) return -1;
    if (a.lastCompleted && !b.lastCompleted) return 1;
    if (!a.lastCompleted && !b.lastCompleted) return a.name.localeCompare(b.name);
    return new Date(a.lastCompleted) - new Date(b.lastCompleted);
  });

  container.innerHTML = dueExercises.map(ex => {
    const days = daysSinceCompleted(ex);
    let detail;
    if (days === null) {
      detail = 'Never done — start today!';
    } else {
      const overdueDays = days - ex.restDays;
      if (overdueDays > 1) {
        detail = `${overdueDays} days overdue`;
      } else {
        detail = 'Due today';
      }
    }
    const overdueClass = days !== null && (days - ex.restDays) > 1 ? 'overdue' : '';
    const loc = ex.location || 'both';
    return `
      <div class="exercise-card ${overdueClass}" data-id="${ex.id}">
        <div class="play-icon" onclick="playVideo('${ex.id}')">&#9654;</div>
        <div class="info" onclick="playVideo('${ex.id}')">
          <div class="name">${escapeHtml(ex.name)} <span class="location-badge ${loc}">${locationLabel(loc)}</span></div>
          <div class="detail">${detail}</div>
        </div>
        <button class="check-btn" onclick="markDone('${ex.id}', this)" title="Mark as done">&#10003;</button>
      </div>
    `;
  }).join('');
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
          <div class="name">${escapeHtml(ex.name)} <span class="location-badge ${loc}">${locationLabel(loc)}</span>${pausedBadge}</div>
          <div class="detail">Rest: ${ex.restDays} day${ex.restDays !== 1 ? 's' : ''} &middot; <span style="${statusColor}">${statusText}</span></div>
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

  function addExerciseToplan(ex, i) {
    const freq = ex.restDays === 0
      ? 'Daily'
      : ex.restDays === 1
        ? 'Every other day (~3-4x/week)'
        : `Every ${ex.restDays + 1} days (~${Math.round(7 / (ex.restDays + 1) * 10) / 10}x/week)`;

    lines.push(`${i + 1}. ${ex.name}`);
    lines.push(`   Location: ${locationLabel(ex.location || 'both')}`);
    lines.push(`   Frequency: ${freq}`);
    lines.push(`   Rest between sessions: ${ex.restDays} day${ex.restDays !== 1 ? 's' : ''}`);

    if (ex.lastCompleted) {
      const d = new Date(ex.lastCompleted);
      lines.push(`   Last completed: ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    } else {
      lines.push('   Last completed: Not yet');
    }
    lines.push('');
  }

  lines.push('ACTIVE EXERCISES');
  lines.push('-'.repeat(35));
  if (activeExercises.length === 0) {
    lines.push('(none)');
    lines.push('');
  } else {
    activeExercises.forEach((ex, i) => addExerciseToplan(ex, i));
  }

  if (pausedExercises.length > 0) {
    lines.push('PAUSED (OUT OF ROTATION)');
    lines.push('-'.repeat(35));
    pausedExercises.forEach((ex, i) => addExerciseToplan(ex, i));
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
  document.getElementById('exercise-paused').checked = false;
  document.getElementById('current-video-name').textContent = '';
  document.getElementById('delete-exercise-btn').style.display = 'none';
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
  document.getElementById('exercise-paused').checked = !!ex.paused;
  document.getElementById('current-video-name').textContent = ex.videoName ? `Current: ${ex.videoName}` : '';
  document.getElementById('delete-exercise-btn').style.display = 'block';
  document.getElementById('exercise-modal').style.display = 'flex';
}

function closeExerciseModal() {
  document.getElementById('exercise-modal').style.display = 'none';
  editingId = null;
}

document.getElementById('cancel-exercise-btn').addEventListener('click', closeExerciseModal);

// Save exercise
document.getElementById('save-exercise-btn').addEventListener('click', async () => {
  const name = document.getElementById('exercise-name').value.trim();
  const restDays = parseInt(document.getElementById('exercise-rest').value) || 0;
  const location = document.getElementById('exercise-location').value;
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
    exercise.paused = paused;
  } else {
    exercise = {
      id: generateId(),
      name: name,
      restDays: restDays,
      location: location,
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
