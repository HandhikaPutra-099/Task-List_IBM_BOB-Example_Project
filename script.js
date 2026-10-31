/* ============================================================
   script.js — Task List | Personal Task Manager
   Vanilla JavaScript — no external libraries.

   Features:
   - CRUD tasks with deadline, priority, category, subtasks
   - Status filter (All / Active / Completed)
   - Category filter
   - Search (live) + Sort (6 modes)
   - Dashboard stats + progress bar
   - Subtask management (add/edit/delete/toggle)
   - LocalStorage persistence + data migration for old tasks
   ============================================================ */

"use strict";

// ─── 1. STATE ──────────────────────────────────────────────────────────────────

/**
 * @typedef {{ id:string, text:string, completed:boolean, createdAt:number,
 *             deadline:string|null, priority:'high'|'medium'|'low',
 *             category:string, subtasks:Subtask[] }} Task
 * @typedef {{ id:string, text:string, completed:boolean }} Subtask
 */

const state = {
  tasks:           [],        // master task array (source of truth)
  filter:          "all",     // status filter: "all"|"active"|"completed"
  categoryFilter:  "all",     // category filter chip value
  searchQuery:     "",        // live search string
  sortMode:        "newest",  // sort dropdown value
  editingId:       null,      // task ID being edited in modal (null = add mode)
  deletingId:      null,      // task ID awaiting delete confirmation
  modalSubtasks:   [],        // temp subtask list while modal is open
};

// ─── 2. CONSTANTS & DOM REFS ───────────────────────────────────────────────────

const STORAGE_KEY    = "tasklist_tasks";
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// Shorthand selectors
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Dashboard
const statTotal     = $("#stat-total");
const statCompleted = $("#stat-completed");
const statPending   = $("#stat-pending");
const statOverdue   = $("#stat-overdue");
const statDueToday  = $("#stat-duetoday");
const progressBar   = $("#progress-bar");
const progressLabel = $("#progress-label");

// --- Search / Sort
const searchInput = $("#search-input");
const sortSelect  = $("#sort-select");

// --- Category filter
const categoryFilter = $("#category-filter");

// --- Status filter tabs
const filterTabs      = $$(".filter-tab");
const tabCountAll     = $("#tab-count-all");
const tabCountActive  = $("#tab-count-active");
const tabCountDone    = $("#tab-count-completed");

// --- Task list
const taskList    = $("#task-list");
const emptyState  = $("#empty-state");
const emptyTitle  = $("#empty-title");
const emptySub    = $("#empty-subtitle");
const listFooter  = $("#list-footer");
const activeCount = $("#active-count");
const clearBtn    = $("#clear-completed-btn");

// --- Task modal
const taskModal       = $("#task-modal");
const modalTitle      = $("#modal-title");
const modalTaskInput  = $("#modal-task-input");
const modalFormError  = $("#modal-form-error");
const modalPriority   = $("#modal-priority");
const modalCategory   = $("#modal-category");
const modalDeadline   = $("#modal-deadline");
const subtaskInput    = $("#subtask-input");
const subtaskAddBtn   = $("#subtask-add-btn");
const modalSubList    = $("#modal-subtask-list");
const modalSaveBtn    = $("#modal-save-btn");
const modalCancelBtn  = $("#modal-cancel-btn");
const modalCloseBtn   = $("#modal-close-btn");
const openAddModalBtn = $("#open-add-modal-btn");

// --- Delete confirm modal
const deleteModal      = $("#delete-modal");
const deleteConfirmBtn = $("#delete-confirm-btn");
const deleteCancelBtn  = $("#delete-cancel-btn");

// ─── 3. PERSISTENCE ───────────────────────────────────────────────────────────

/** Load tasks from LocalStorage; migrate old task structures. */
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Migrate: inject default values for properties added in v2
    state.tasks = parsed.map(migrateTask);
  } catch {
    state.tasks = [];
  }
}

/** Ensure a task object has all required v2 fields (backward-compat). */
function migrateTask(t) {
  return {
    id:        t.id        ?? generateId(),
    text:      t.text      ?? "",
    completed: t.completed ?? false,
    createdAt: t.createdAt ?? Date.now(),
    deadline:  t.deadline  ?? null,
    priority:  t.priority  ?? "medium",
    category:  t.category  ?? "Other",
    subtasks:  Array.isArray(t.subtasks) ? t.subtasks.map(migrateSubtask) : [],
  };
}

/** Ensure a subtask object has all required fields. */
function migrateSubtask(s) {
  return {
    id:        s.id        ?? generateId(),
    text:      s.text      ?? "",
    completed: s.completed ?? false,
  };
}

/** Save current tasks array to LocalStorage. */
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

// ─── 4. DATE HELPERS ──────────────────────────────────────────────────────────

/** Return today's date as "YYYY-MM-DD" in local time. */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Compute deadline status for a task.
 * @param {Task} task
 * @returns {"completed"|"overdue"|"duetoday"|"upcoming"|"none"}
 */
function deadlineStatus(task) {
  if (task.completed) return "completed";
  if (!task.deadline) return "none";
  const today = todayISO();
  if (task.deadline < today) return "overdue";
  if (task.deadline === today) return "duetoday";
  return "upcoming";
}

/**
 * Format a "YYYY-MM-DD" string to a human-readable date like "Oct 31, 2025".
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  if (!iso) return "";
  // Parse as local date to avoid UTC offset shifting the day
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── 5. UNIQUE ID ──────────────────────────────────────────────────────────────

function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// ─── 6. DATA PIPELINE (filter → search → sort) ────────────────────────────────

/**
 * Apply status filter, category filter, search query, and sort to state.tasks.
 * Does NOT mutate the original array.
 * @returns {Task[]}
 */
function getDisplayTasks() {
  let tasks = [...state.tasks];

  // ── Status filter
  if (state.filter === "active")    tasks = tasks.filter((t) => !t.completed);
  if (state.filter === "completed") tasks = tasks.filter((t) =>  t.completed);

  // ── Category filter
  if (state.categoryFilter !== "all") {
    tasks = tasks.filter((t) => t.category === state.categoryFilter);
  }

  // ── Search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    tasks = tasks.filter((t) => t.text.toLowerCase().includes(q));
  }

  // ── Sort
  tasks = sortTasks(tasks, state.sortMode);

  return tasks;
}

/**
 * Sort a tasks array by the given mode. Returns a new array.
 * @param {Task[]} tasks
 * @param {string} mode
 * @returns {Task[]}
 */
function sortTasks(tasks, mode) {
  const copy = [...tasks];
  switch (mode) {
    case "newest":
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case "oldest":
      return copy.sort((a, b) => a.createdAt - b.createdAt);
    case "deadline-asc":
      return copy.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;   // no deadline → last
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      });
    case "deadline-desc":
      return copy.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return b.deadline.localeCompare(a.deadline);
      });
    case "priority-high":
      return copy.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    case "priority-low":
      return copy.sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);
    default:
      return copy;
  }
}

// ─── 7. STATS HELPERS ──────────────────────────────────────────────────────────

function countActive()    { return state.tasks.filter((t) => !t.completed).length; }
function countCompleted() { return state.tasks.filter((t) =>  t.completed).length; }
function countOverdue()   { return state.tasks.filter((t) => deadlineStatus(t) === "overdue").length; }
function countDueToday()  { return state.tasks.filter((t) => deadlineStatus(t) === "duetoday").length; }

// ─── 8. RENDER ─────────────────────────────────────────────────────────────────

/** Master render — rebuilds list + dashboard + counters after every state change. */
function render() {
  renderDashboard();
  renderTabCounts();
  renderTaskList();
  renderFooter();
}

/** Update all dashboard stat cards and progress bar. */
function renderDashboard() {
  const total     = state.tasks.length;
  const completed = countCompleted();
  const pending   = countActive();           // not completed
  const overdue   = countOverdue();
  const dueToday  = countDueToday();
  const pct       = total === 0 ? 0 : Math.round((completed / total) * 100);

  statTotal.textContent     = total;
  statCompleted.textContent = completed;
  statPending.textContent   = pending;
  statOverdue.textContent   = overdue;
  statDueToday.textContent  = dueToday;
  progressBar.style.width   = `${pct}%`;
  progressLabel.textContent = `${pct}%`;
}

/** Update the count inside each status filter tab. */
function renderTabCounts() {
  const total     = state.tasks.length;
  const numActive = countActive();
  const numDone   = countCompleted();

  tabCountAll.textContent    = `(${total})`;
  tabCountActive.textContent = `(${numActive})`;
  tabCountDone.textContent   = `(${numDone})`;
}

/** Build the visible task list from the data pipeline result. */
function renderTaskList() {
  const visible = getDisplayTasks();
  taskList.innerHTML = "";

  if (visible.length === 0) {
    showEmptyState();
    return;
  }

  emptyState.classList.add("hidden");
  emptyState.classList.remove("flex");
  visible.forEach((task) => taskList.appendChild(createTaskElement(task)));
}

/** Show contextual empty-state copy based on active filters. */
function showEmptyState() {
  emptyState.classList.remove("hidden");
  emptyState.classList.add("flex");

  if (state.searchQuery) {
    emptyTitle.textContent = "No tasks match your search";
    emptySub.textContent   = "Try a different keyword.";
    return;
  }

  const msgs = {
    all:       { title: "No tasks yet",         sub: "Click 'New Task' to get started." },
    active:    { title: "No active tasks",       sub: "All caught up! Great work 🎉" },
    completed: { title: "No completed tasks",    sub: "Complete a task to see it here." },
  };
  const m = msgs[state.filter] ?? msgs.all;
  emptyTitle.textContent = m.title;
  emptySub.textContent   = m.sub;
}

/** Update the footer bar (item count + clear-completed button). */
function renderFooter() {
  if (state.tasks.length === 0) {
    listFooter.classList.add("hidden");
    listFooter.classList.remove("flex");
    return;
  }
  listFooter.classList.remove("hidden");
  listFooter.classList.add("flex");

  const left = countActive();
  activeCount.textContent = `${left} ${left === 1 ? "item" : "items"} left`;
  clearBtn.disabled = countCompleted() === 0;
}

// ─── 9. CREATE TASK ELEMENT ────────────────────────────────────────────────────

/**
 * Build a complete <li> element for a single task.
 * @param {Task} task
 * @returns {HTMLLIElement}
 */
function createTaskElement(task) {
  const li = document.createElement("li");
  li.className = "task-item task-enter";
  li.dataset.id = task.id;
  if (task.completed) li.classList.add("completed");

  const status       = deadlineStatus(task);
  const dlBadge      = buildDeadlineBadge(task, status);
  const priBadge     = buildPriorityBadge(task.priority);
  const catBadge     = buildCategoryBadge(task.category);
  const subtaskMeta  = buildSubtaskMeta(task);

  li.innerHTML = `
    <input type="checkbox" class="task-checkbox" aria-label="Toggle task completion" ${task.completed ? "checked" : ""} />
    <div class="flex-1 min-w-0">
      <!-- Task text -->
      <span class="task-text">${escapeHtml(task.text)}</span>
      <!-- Badges row -->
      <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
        ${priBadge}
        ${dlBadge}
        ${catBadge}
      </div>
      ${subtaskMeta}
    </div>
    <!-- Action buttons -->
    <div class="flex items-center gap-1 flex-shrink-0 self-start mt-0.5" role="group" aria-label="Task actions">
      <button class="action-btn edit-btn"   aria-label="Edit task"   title="Edit">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z"/>
        </svg>
      </button>
      <button class="action-btn delete-btn" aria-label="Delete task" title="Delete">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
      </button>
    </div>
  `;

  // -- Checkbox toggle
  li.querySelector(".task-checkbox").addEventListener("change", () => toggleTask(task.id));

  // -- Edit / Delete
  li.querySelector(".edit-btn").addEventListener("click",   () => openTaskModal(task.id));
  li.querySelector(".delete-btn").addEventListener("click", () => openDeleteModal(task.id));

  // -- Subtask checkboxes (rendered inline in the task card)
  li.querySelectorAll(".subtask-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => toggleSubtask(task.id, cb.dataset.subId));
  });

  // -- Subtask toggle visibility button
  const toggleBtn = li.querySelector(".toggle-subtask-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const section = li.querySelector(".subtask-section");
      const isHidden = section.style.display === "none";
      section.style.display = isHidden ? "block" : "none";
      toggleBtn.textContent  = isHidden ? "▲ Subtasks" : "▼ Subtasks";
    });
  }

  return li;
}

/** Build the HTML string for the priority badge. */
function buildPriorityBadge(priority) {
  const labels = { high: "High", medium: "Medium", low: "Low" };
  const cls    = `priority-badge priority-${priority}`;
  return `<span class="${cls}" aria-label="Priority: ${labels[priority]}">${labels[priority]}</span>`;
}

/** Build the HTML string for the deadline badge. */
function buildDeadlineBadge(task, status) {
  const map = {
    completed: { cls: "deadline-completed", label: "Completed" },
    overdue:   { cls: "deadline-overdue",   label: `Overdue · ${formatDate(task.deadline)}` },
    duetoday:  { cls: "deadline-duetoday",  label: `Due Today · ${formatDate(task.deadline)}` },
    upcoming:  { cls: "deadline-upcoming",  label: formatDate(task.deadline) },
    none:      { cls: "deadline-none",      label: "No Deadline" },
  };
  const { cls, label } = map[status] ?? map.none;
  return `<span class="deadline-badge ${cls}" aria-label="Deadline: ${label}">${label}</span>`;
}

/** Build the HTML string for the category badge. */
function buildCategoryBadge(category) {
  return `<span class="category-badge" aria-label="Category: ${escapeHtml(category)}">${escapeHtml(category)}</span>`;
}

/**
 * Build the subtask summary HTML for the task card.
 * Shows a progress bar + collapsible list when subtasks exist.
 */
function buildSubtaskMeta(task) {
  if (!task.subtasks || task.subtasks.length === 0) return "";

  const total = task.subtasks.length;
  const done  = task.subtasks.filter((s) => s.completed).length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

  const items = task.subtasks.map((s) => `
    <li class="subtask-item ${s.completed ? "completed" : ""}">
      <input type="checkbox" class="subtask-checkbox" data-sub-id="${s.id}"
        aria-label="${escapeHtml(s.text)}" ${s.completed ? "checked" : ""}/>
      <span class="subtask-text">${escapeHtml(s.text)}</span>
    </li>
  `).join("");

  return `
    <div class="mt-1.5">
      <button class="toggle-subtask-btn" type="button" aria-label="Toggle subtask list">▼ Subtasks</button>
    </div>
    <div class="subtask-section">
      <div class="subtask-progress-bar">
        <div class="subtask-progress-fill" style="width:${pct}%"></div>
      </div>
      <p class="text-xs text-gray-400 mb-1.5">${done} / ${total} subtasks complete</p>
      <ul>${items}</ul>
    </div>
  `;
}

// ─── 10. CRUD ──────────────────────────────────────────────────────────────────

/** CREATE or UPDATE a task from the modal form. */
function saveTask() {
  const text = modalTaskInput.value.trim();
  if (!text) {
    modalFormError.classList.remove("hidden");
    modalTaskInput.focus();
    return;
  }
  modalFormError.classList.add("hidden");

  if (state.editingId) {
    // ── UPDATE
    const task = state.tasks.find((t) => t.id === state.editingId);
    if (task) {
      task.text     = text;
      task.priority = modalPriority.value;
      task.category = modalCategory.value;
      task.deadline = modalDeadline.value || null;
      task.subtasks = [...state.modalSubtasks];
    }
  } else {
    // ── CREATE
    /** @type {Task} */
    const newTask = {
      id:        generateId(),
      text,
      completed: false,
      createdAt: Date.now(),
      deadline:  modalDeadline.value || null,
      priority:  modalPriority.value,
      category:  modalCategory.value,
      subtasks:  [...state.modalSubtasks],
    };
    state.tasks.unshift(newTask);
  }

  saveTasks();
  closeTaskModal();
  render();
}

/** Toggle a task's completed state. */
function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  render();
}

/** Delete task by ID (called after confirmation). */
function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  saveTasks();
  render();
}

/** Clear all completed tasks. */
function clearCompleted() {
  state.tasks = state.tasks.filter((t) => !t.completed);
  saveTasks();
  render();
}

/** Toggle a subtask's completed state on the task card (not in modal). */
function toggleSubtask(taskId, subId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const sub = task.subtasks.find((s) => s.id === subId);
  if (!sub) return;
  sub.completed = !sub.completed;
  saveTasks();
  render();
}

// ─── 11. FILTERS ───────────────────────────────────────────────────────────────

/** Set the status filter and re-render. */
function setStatusFilter(filter) {
  state.filter = filter;
  filterTabs.forEach((tab) => {
    const active = tab.dataset.filter === filter;
    tab.classList.toggle("active-tab", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  render();
}

/** Set the category filter and re-render. */
function setCategoryFilter(category) {
  state.categoryFilter = category;
  categoryFilter.querySelectorAll(".cat-chip").forEach((chip) => {
    chip.classList.toggle("active-chip", chip.dataset.category === category);
  });
  render();
}

// ─── 12. TASK MODAL ────────────────────────────────────────────────────────────

/**
 * Open the task modal.
 * @param {string|null} id — pass null for Add, task ID for Edit
 */
function openTaskModal(id = null) {
  state.editingId = id;
  modalFormError.classList.add("hidden");

  if (id) {
    // Edit mode — prefill form
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    modalTitle.textContent     = "Edit Task";
    modalSaveBtn.textContent   = "Save Changes";
    modalTaskInput.value       = task.text;
    modalPriority.value        = task.priority;
    modalCategory.value        = task.category;
    modalDeadline.value        = task.deadline ?? "";
    state.modalSubtasks        = task.subtasks.map((s) => ({ ...s }));
  } else {
    // Add mode — reset form
    modalTitle.textContent     = "New Task";
    modalSaveBtn.textContent   = "Save Task";
    modalTaskInput.value       = "";
    modalPriority.value        = "medium";
    modalCategory.value        = "Other";
    modalDeadline.value        = "";
    state.modalSubtasks        = [];
  }

  renderModalSubtasks();
  taskModal.classList.remove("hidden");
  setTimeout(() => modalTaskInput.focus(), 50);
}

/** Close and reset the task modal. */
function closeTaskModal() {
  taskModal.classList.add("hidden");
  state.editingId    = null;
  state.modalSubtasks = [];
  modalSubList.innerHTML = "";
}

// ─── 13. MODAL SUBTASK MANAGEMENT ──────────────────────────────────────────────

/** Add a subtask to the modal's temporary list. */
function addModalSubtask() {
  const text = subtaskInput.value.trim();
  if (!text) return;

  state.modalSubtasks.push({ id: generateId(), text, completed: false });
  subtaskInput.value = "";
  renderModalSubtasks();
  subtaskInput.focus();
}

/** Remove a subtask from the modal's temporary list by its ID. */
function removeModalSubtask(subId) {
  state.modalSubtasks = state.modalSubtasks.filter((s) => s.id !== subId);
  renderModalSubtasks();
}

/** Re-render the subtask list inside the modal. */
function renderModalSubtasks() {
  modalSubList.innerHTML = "";
  state.modalSubtasks.forEach((s) => {
    const li = document.createElement("li");
    li.className = "modal-subtask-item";
    li.innerHTML = `
      <span>${escapeHtml(s.text)}</span>
      <button class="modal-subtask-remove" aria-label="Remove subtask" title="Remove">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    `;
    li.querySelector(".modal-subtask-remove").addEventListener("click", () => removeModalSubtask(s.id));
    modalSubList.appendChild(li);
  });
}

// ─── 14. DELETE CONFIRM MODAL ──────────────────────────────────────────────────

function openDeleteModal(id) {
  state.deletingId = id;
  deleteModal.classList.remove("hidden");
}

function closeDeleteModal() {
  state.deletingId = null;
  deleteModal.classList.add("hidden");
}

// ─── 15. UTILITY ───────────────────────────────────────────────────────────────

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(str) {
  const map = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" };
  return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

// ─── 16. EVENT LISTENERS ───────────────────────────────────────────────────────

// Header — open Add modal
openAddModalBtn.addEventListener("click", () => openTaskModal(null));

// Modal — save / cancel / close
modalSaveBtn.addEventListener("click", saveTask);
modalCancelBtn.addEventListener("click", closeTaskModal);
modalCloseBtn.addEventListener("click", closeTaskModal);
taskModal.addEventListener("click", (e) => { if (e.target === taskModal) closeTaskModal(); });

// Modal — keyboard shortcuts
modalTaskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveTask(); }
  if (e.key === "Escape") closeTaskModal();
});

// Modal form — clear error on typing
modalTaskInput.addEventListener("input", () => {
  if (modalTaskInput.value.trim()) modalFormError.classList.add("hidden");
});

// Modal — add subtask via button
subtaskAddBtn.addEventListener("click", addModalSubtask);

// Modal — add subtask via Enter key in subtask input
subtaskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addModalSubtask(); }
});

// Delete modal — confirm / cancel
deleteConfirmBtn.addEventListener("click", () => {
  if (state.deletingId) deleteTask(state.deletingId);
  closeDeleteModal();
});
deleteCancelBtn.addEventListener("click", closeDeleteModal);
deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) closeDeleteModal(); });

// Status filter tabs
filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => setStatusFilter(tab.dataset.filter));
});

// Category filter chips
categoryFilter.addEventListener("click", (e) => {
  const chip = e.target.closest(".cat-chip");
  if (chip) setCategoryFilter(chip.dataset.category);
});

// Search — live update
searchInput.addEventListener("input", () => {
  state.searchQuery = searchInput.value.trim();
  render();
});

// Sort — change mode
sortSelect.addEventListener("change", () => {
  state.sortMode = sortSelect.value;
  render();
});

// Clear completed tasks
clearBtn.addEventListener("click", clearCompleted);

// Global Escape closes whichever modal is open
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!taskModal.classList.contains("hidden"))   closeTaskModal();
    if (!deleteModal.classList.contains("hidden")) closeDeleteModal();
  }
});

// ─── 17. INIT ──────────────────────────────────────────────────────────────────

function init() {
  loadTasks();
  render();
}

document.addEventListener("DOMContentLoaded", init);
