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
   - Task Reminder & Browser Notifications (Web Notifications API)
   - LocalStorage persistence + data migration for old tasks
   ============================================================ */

"use strict";

// ─── 1. STATE ──────────────────────────────────────────────────────────────────

/**
 * @typedef {{ id:string, text:string, completed:boolean, createdAt:number,
 *             deadline:string|null, dueTime:string|null,
 *             priority:'high'|'medium'|'low', category:string,
 *             subtasks:Subtask[],
 *             reminderEnabled:boolean, reminderMinutesBefore:number,
 *             reminderAt:number|null, reminderSent:boolean }} Task
 * @typedef {{ id:string, text:string, completed:boolean }} Subtask
 */

const state = {
  tasks:           [],       // master task array (source of truth)
  filter:          "all",    // status filter: "all"|"active"|"completed"
  categoryFilter:  "all",    // category filter chip value
  searchQuery:     "",       // live search string
  sortMode:        "newest", // sort dropdown value
  editingId:       null,     // task ID being edited in modal (null = add mode)
  deletingId:      null,     // task ID awaiting delete confirmation
  modalSubtasks:   [],       // temp subtask list while modal is open
};

// ─── 2. CONSTANTS & DOM REFS ───────────────────────────────────────────────────

const STORAGE_KEY          = "tasklist_tasks";
const BANNER_DISMISS_KEY   = "tasklist_notif_banner_dismissed";
const PRIORITY_ORDER       = { high: 0, medium: 1, low: 2 };
const REMINDER_CHECK_MS    = 30_000; // check reminders every 30 seconds
let   reminderIntervalId   = null;

// Service Worker registration reference (set after SW registers)
let   swRegistration       = null;

// PWA install prompt event (captured from beforeinstallprompt)
let   pwaInstallPrompt     = null;

// Shorthand selectors
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Notification UI
const notifBanner        = $("#notif-banner");
const notifBannerMsg     = $("#notif-banner-msg");
const notifEnableBtn     = $("#notif-enable-btn");
const notifBannerDismiss = $("#notif-banner-dismiss");
const notifStatusBtn     = $("#notif-status-btn");
const offlineBanner      = $("#offline-banner");
const installBtn         = $("#install-btn");

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
const taskModal            = $("#task-modal");
const modalTitle           = $("#modal-title");
const modalTaskInput       = $("#modal-task-input");
const modalFormError       = $("#modal-form-error");
const modalPriority        = $("#modal-priority");
const modalCategory        = $("#modal-category");
const modalDeadline        = $("#modal-deadline");
const modalDueTime         = $("#modal-due-time");
const modalReminderEnabled = $("#modal-reminder-enabled");
const modalReminderOffset  = $("#modal-reminder-offset");
const reminderOptions      = $("#reminder-options");
const reminderPreview      = $("#reminder-preview");
const reminderNoDlWarn     = $("#reminder-no-deadline-warn");
const reminderPermWarn     = $("#reminder-perm-warn");
const reminderEnableNotif  = $("#reminder-enable-notif-btn");
const subtaskInput         = $("#subtask-input");
const subtaskAddBtn        = $("#subtask-add-btn");
const modalSubList         = $("#modal-subtask-list");
const modalSaveBtn         = $("#modal-save-btn");
const modalCancelBtn       = $("#modal-cancel-btn");
const modalCloseBtn        = $("#modal-close-btn");
const openAddModalBtn      = $("#open-add-modal-btn");

// --- Delete confirm modal
const deleteModal      = $("#delete-modal");
const deleteConfirmBtn = $("#delete-confirm-btn");
const deleteCancelBtn  = $("#delete-cancel-btn");

// ─── 3. PERSISTENCE ───────────────────────────────────────────────────────────

/** Load tasks from LocalStorage; migrate old task structures. */
function loadTasks() {
  try {
    const raw    = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    state.tasks  = parsed.map(migrateTask);
  } catch {
    state.tasks = [];
  }
}

/** Ensure a task object has all required v3 fields (backward-compat). */
function migrateTask(t) {
  return {
    id:                    t.id                    ?? generateId(),
    text:                  t.text                  ?? "",
    completed:             t.completed             ?? false,
    createdAt:             t.createdAt             ?? Date.now(),
    deadline:              t.deadline              ?? null,
    dueTime:               t.dueTime               ?? null,
    priority:              t.priority              ?? "medium",
    category:              t.category              ?? "Other",
    subtasks:              Array.isArray(t.subtasks) ? t.subtasks.map(migrateSubtask) : [],
    reminderEnabled:       t.reminderEnabled       ?? false,
    reminderMinutesBefore: t.reminderMinutesBefore ?? 30,
    reminderAt:            t.reminderAt            ?? null,
    reminderSent:          t.reminderSent          ?? false,
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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Zero-pad a number to at least 2 digits. */
function pad(n) { return String(n).padStart(2, "0"); }

/**
 * Compute deadline status for a task.
 * @param {Task} task
 * @returns {"completed"|"overdue"|"duetoday"|"upcoming"|"none"}
 */
function deadlineStatus(task) {
  if (task.completed) return "completed";
  if (!task.deadline) return "none";
  const today = todayISO();
  if (task.deadline < today)  return "overdue";
  if (task.deadline === today) return "duetoday";
  return "upcoming";
}

/**
 * Format a "YYYY-MM-DD" string → "Oct 31, 2025".
 * Uses local time to avoid UTC-offset day-shift.
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

/**
 * Format a "HH:MM" string → "10:30 AM".
 * @param {string} time  "HH:MM"
 * @returns {string}
 */
function formatTime(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12    = h % 12 || 12;
  return `${h12}:${pad(m)} ${period}`;
}

/**
 * Given a task's deadline + dueTime, compute the Unix timestamp (ms)
 * at which the reminder should fire.
 * Returns null when deadline or dueTime is missing.
 * @param {Task|object} t - may be partial (modal form values)
 * @returns {number|null}
 */
function computeReminderAt(t) {
  if (!t.deadline || !t.dueTime) return null;
  const [y, mo, d]  = t.deadline.split("-").map(Number);
  const [h, mi]     = t.dueTime.split(":").map(Number);
  const deadlineMs  = new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
  const offsetMs    = (t.reminderMinutesBefore ?? 0) * 60_000;
  return deadlineMs - offsetMs;
}

// ─── 5. UNIQUE ID ──────────────────────────────────────────────────────────────

function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

// ─── 6. DATA PIPELINE (filter → search → sort) ────────────────────────────────

/**
 * Apply status filter, category filter, search, and sort to state.tasks.
 * Does NOT mutate the original array.
 * @returns {Task[]}
 */
function getDisplayTasks() {
  let tasks = [...state.tasks];

  // Status filter
  if (state.filter === "active")    tasks = tasks.filter((t) => !t.completed);
  if (state.filter === "completed") tasks = tasks.filter((t) =>  t.completed);

  // Category filter
  if (state.categoryFilter !== "all") {
    tasks = tasks.filter((t) => t.category === state.categoryFilter);
  }

  // Search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    tasks = tasks.filter((t) => t.text.toLowerCase().includes(q));
  }

  // Sort
  tasks = sortTasks(tasks, state.sortMode);
  return tasks;
}

/**
 * Sort tasks by the given mode. Returns a new array.
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
        if (!a.deadline) return 1;
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
  const pending   = countActive();
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

/** Update the count badge inside each status filter tab. */
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

/** Show a contextual empty-state message based on active filters. */
function showEmptyState() {
  emptyState.classList.remove("hidden");
  emptyState.classList.add("flex");

  if (state.searchQuery) {
    emptyTitle.textContent = "No tasks match your search";
    emptySub.textContent   = "Try a different keyword.";
    return;
  }
  const msgs = {
    all:       { title: "No tasks yet",        sub: "Click 'New Task' to get started." },
    active:    { title: "No active tasks",      sub: "All caught up! Great work 🎉" },
    completed: { title: "No completed tasks",   sub: "Complete a task to see it here." },
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
  clearBtn.disabled       = countCompleted() === 0;
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

  const status      = deadlineStatus(task);
  const dlBadge     = buildDeadlineBadge(task, status);
  const priBadge    = buildPriorityBadge(task.priority);
  const catBadge    = buildCategoryBadge(task.category);
  const remBadge    = buildReminderBadge(task);
  const subtaskMeta = buildSubtaskMeta(task);

  li.innerHTML = `
    <input type="checkbox" class="task-checkbox" aria-label="Toggle task completion"
      ${task.completed ? "checked" : ""} />
    <div class="flex-1 min-w-0">
      <span class="task-text">${escapeHtml(task.text)}</span>
      <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
        ${priBadge}
        ${dlBadge}
        ${catBadge}
        ${remBadge}
      </div>
      ${subtaskMeta}
    </div>
    <div class="flex items-center gap-1 flex-shrink-0 self-start mt-0.5" role="group" aria-label="Task actions">
      <button class="action-btn edit-btn" aria-label="Edit task" title="Edit">
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

  li.querySelector(".task-checkbox").addEventListener("change", () => toggleTask(task.id));
  li.querySelector(".edit-btn").addEventListener("click",   () => openTaskModal(task.id));
  li.querySelector(".delete-btn").addEventListener("click", () => openDeleteModal(task.id));

  li.querySelectorAll(".subtask-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => toggleSubtask(task.id, cb.dataset.subId));
  });

  const toggleBtn = li.querySelector(".toggle-subtask-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const section  = li.querySelector(".subtask-section");
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
  return `<span class="priority-badge priority-${priority}" aria-label="Priority: ${labels[priority]}">${labels[priority]}</span>`;
}

/** Build the HTML string for the deadline badge. */
function buildDeadlineBadge(task, status) {
  const timeStr = task.dueTime ? `, ${formatTime(task.dueTime)}` : "";
  const map = {
    completed: { cls: "deadline-completed", label: "Completed" },
    overdue:   { cls: "deadline-overdue",   label: `Overdue · ${formatDate(task.deadline)}${timeStr}` },
    duetoday:  { cls: "deadline-duetoday",  label: `Due Today${timeStr}` },
    upcoming:  { cls: "deadline-upcoming",  label: `${formatDate(task.deadline)}${timeStr}` },
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
 * Build the reminder indicator badge shown on the task card.
 * Only shown when reminder is enabled.
 * @param {Task} task
 * @returns {string}
 */
function buildReminderBadge(task) {
  if (!task.reminderEnabled) return "";

  // Determine sub-label
  let label = "Reminder";
  if (task.reminderAt) {
    const now = Date.now();
    if (task.reminderSent) {
      label = "Sent";
    } else if (task.reminderAt <= now) {
      label = "Sent";
    } else {
      // Show relative time until reminder fires
      const diffMin = Math.round((task.reminderAt - now) / 60_000);
      if (diffMin < 60)       label = `Reminder in ${diffMin}m`;
      else if (diffMin < 1440) label = `Reminder in ${Math.round(diffMin / 60)}h`;
      else                     label = `Reminder in ${Math.round(diffMin / 1440)}d`;
    }
  }

  const sentCls = task.reminderSent ? "reminder-badge-sent" : "reminder-badge-active";
  return `
    <span class="reminder-badge ${sentCls}" aria-label="${label}">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
      </svg>
      ${label}
    </span>`;
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

  const reminderEnabled       = modalReminderEnabled.checked;
  const reminderMinutesBefore = parseInt(modalReminderOffset.value, 10) || 0;
  const deadline              = modalDeadline.value || null;
  const dueTime               = modalDueTime.value  || null;

  // Compute reminderAt timestamp; reset reminderSent when settings change
  const reminderAt = reminderEnabled
    ? computeReminderAt({ deadline, dueTime, reminderMinutesBefore })
    : null;

  if (state.editingId) {
    // ── UPDATE
    const task = state.tasks.find((t) => t.id === state.editingId);
    if (task) {
      const reminderChanged =
        task.reminderEnabled       !== reminderEnabled       ||
        task.reminderMinutesBefore !== reminderMinutesBefore ||
        task.deadline              !== deadline              ||
        task.dueTime               !== dueTime;

      task.text                  = text;
      task.priority              = modalPriority.value;
      task.category              = modalCategory.value;
      task.deadline              = deadline;
      task.dueTime               = dueTime;
      task.subtasks              = [...state.modalSubtasks];
      task.reminderEnabled       = reminderEnabled;
      task.reminderMinutesBefore = reminderMinutesBefore;
      task.reminderAt            = reminderAt;
      // If any reminder-related field changed, reset the sent flag so it fires again
      if (reminderChanged) task.reminderSent = false;
    }
  } else {
    // ── CREATE
    /** @type {Task} */
    const newTask = {
      id:                    generateId(),
      text,
      completed:             false,
      createdAt:             Date.now(),
      deadline,
      dueTime,
      priority:              modalPriority.value,
      category:              modalCategory.value,
      subtasks:              [...state.modalSubtasks],
      reminderEnabled,
      reminderMinutesBefore,
      reminderAt,
      reminderSent:          false,
    };
    state.tasks.unshift(newTask);
  }

  saveTasks();
  closeTaskModal();
  render();
}

/** Toggle a task's completed state.
 *  When a task is completed, cancel its pending reminder. */
function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  // If task is now completed, mark reminder as sent (suppress future notifications)
  if (task.completed && task.reminderEnabled) task.reminderSent = true;
  // If task is re-opened, recalculate reminderAt and reset sent flag
  if (!task.completed && task.reminderEnabled && task.reminderAt) {
    const now = Date.now();
    // Only reset if the scheduled time is still in the future
    if (task.reminderAt > now) task.reminderSent = false;
  }
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

/** Toggle a subtask's completed state directly on the task card. */
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
 * @param {string|null} id — null = Add mode, string = Edit mode
 */
function openTaskModal(id = null) {
  state.editingId = id;
  modalFormError.classList.add("hidden");

  if (id) {
    // Edit mode — prefill form
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    modalTitle.textContent             = "Edit Task";
    modalSaveBtn.textContent           = "Save Changes";
    modalTaskInput.value               = task.text;
    modalPriority.value                = task.priority;
    modalCategory.value                = task.category;
    modalDeadline.value                = task.deadline         ?? "";
    modalDueTime.value                 = task.dueTime          ?? "";
    modalReminderEnabled.checked       = task.reminderEnabled  ?? false;
    modalReminderOffset.value          = String(task.reminderMinutesBefore ?? 30);
    state.modalSubtasks                = task.subtasks.map((s) => ({ ...s }));
  } else {
    // Add mode — reset form
    modalTitle.textContent             = "New Task";
    modalSaveBtn.textContent           = "Save Task";
    modalTaskInput.value               = "";
    modalPriority.value                = "medium";
    modalCategory.value                = "Other";
    modalDeadline.value                = "";
    modalDueTime.value                 = "";
    modalReminderEnabled.checked       = false;
    modalReminderOffset.value          = "30";
    state.modalSubtasks                = [];
  }

  // Sync reminder options visibility and preview
  syncReminderUI();
  renderModalSubtasks();
  taskModal.classList.remove("hidden");
  setTimeout(() => modalTaskInput.focus(), 50);
}

/** Close and reset the task modal. */
function closeTaskModal() {
  taskModal.classList.add("hidden");
  state.editingId     = null;
  state.modalSubtasks = [];
  modalSubList.innerHTML = "";
}

// ─── 13. REMINDER UI SYNC (modal) ─────────────────────────────────────────────

/**
 * Sync the reminder options panel and preview text based on current form values.
 * Called whenever the reminder toggle, deadline, time, or offset changes.
 */
function syncReminderUI() {
  const enabled = modalReminderEnabled.checked;

  // Show / hide options panel
  if (enabled) {
    reminderOptions.classList.remove("hidden");
  } else {
    reminderOptions.classList.add("hidden");
    return;
  }

  const deadline = modalDeadline.value;
  const dueTime  = modalDueTime.value;
  const offset   = parseInt(modalReminderOffset.value, 10) || 0;

  // Permission warning
  const perm = Notification.permission;
  if (perm !== "granted") {
    reminderPermWarn.classList.remove("hidden");
  } else {
    reminderPermWarn.classList.add("hidden");
  }

  if (!deadline || !dueTime) {
    reminderNoDlWarn.classList.remove("hidden");
    reminderPreview.textContent = "";
    return;
  }
  reminderNoDlWarn.classList.add("hidden");

  // Compute and display when reminder fires
  const reminderAt = computeReminderAt({ deadline, dueTime, reminderMinutesBefore: offset });
  if (reminderAt) {
    const fireDate = new Date(reminderAt);
    const now      = Date.now();
    if (reminderAt <= now) {
      reminderPreview.textContent = "⚠ This reminder time is already in the past.";
    } else {
      reminderPreview.textContent =
        `🔔 Reminder at ${fireDate.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}, ` +
        `${fireDate.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" })}`;
    }
  } else {
    reminderPreview.textContent = "";
  }
}

// ─── 14. MODAL SUBTASK MANAGEMENT ──────────────────────────────────────────────

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

// ─── 15. DELETE CONFIRM MODAL ──────────────────────────────────────────────────

function openDeleteModal(id) {
  state.deletingId = id;
  deleteModal.classList.remove("hidden");
}

function closeDeleteModal() {
  state.deletingId = null;
  deleteModal.classList.add("hidden");
}

// ─── 16. BROWSER NOTIFICATIONS ─────────────────────────────────────────────────

/** True when the Notifications API is available in this browser. */
const notificationsSupported = ("Notification" in window);

/**
 * Update the notification status button icon and the permission banner
 * to reflect the current Notification.permission value.
 */
function updateNotifUI() {
  if (!notificationsSupported) {
    notifStatusBtn.innerHTML = iconBellOff();
    notifStatusBtn.title     = "Browser notifications are not supported";
    notifStatusBtn.style.color = "#9ca3af";
    return;
  }

  const perm = Notification.permission;

  // -- Status button in header
  if (perm === "granted") {
    notifStatusBtn.innerHTML   = iconBellOn();
    notifStatusBtn.title       = "Notifications enabled";
    notifStatusBtn.style.color = "#22c55e";  // green
  } else if (perm === "denied") {
    notifStatusBtn.innerHTML   = iconBellOff();
    notifStatusBtn.title       = "Notifications blocked — change in browser settings";
    notifStatusBtn.style.color = "#ef4444";  // red
  } else {
    // "default"
    notifStatusBtn.innerHTML   = iconBellSleep();
    notifStatusBtn.title       = "Click to enable notifications";
    notifStatusBtn.style.color = "#f97316";  // orange
  }

  // -- Banner (only show when not granted AND not dismissed by user)
  const dismissed = sessionStorage.getItem(BANNER_DISMISS_KEY);
  if (perm !== "granted" && !dismissed) {
    notifBanner.classList.remove("hidden");
    if (perm === "denied") {
      notifBannerMsg.textContent  = "Notifications are blocked. Allow them in your browser settings to receive reminders.";
      notifEnableBtn.textContent  = "How to enable";
      notifEnableBtn.onclick      = () => { /* just inform — can't trigger settings */ alert("To enable notifications, click the lock icon in your browser's address bar and set Notifications to 'Allow'."); };
    } else {
      notifBannerMsg.textContent  = "Enable browser notifications to receive task reminders.";
      notifEnableBtn.textContent  = "Enable Notifications";
      notifEnableBtn.onclick      = requestNotifPermission;
    }
  } else {
    notifBanner.classList.add("hidden");
  }
}

/**
 * Request notification permission from the user.
 * Must be called from a user gesture (button click).
 */
async function requestNotifPermission() {
  if (!notificationsSupported) return;
  try {
    const result = await Notification.requestPermission();
    updateNotifUI();
    if (result === "granted") {
      // Confirm to the user with a quick test notification
      showSystemNotification(
        "Notifications Enabled 🎉",
        "You'll now receive task reminders from Task List.",
        null
      );
    }
  } catch (err) {
    console.warn("Notification permission request failed:", err);
  }
}

/**
 * Show a system notification.
 * Prefers ServiceWorkerRegistration.showNotification() (works on mobile/Android)
 * and falls back to new Notification() for desktop browsers.
 * @param {string}      title
 * @param {string}      body
 * @param {string|null} tag   — unique tag prevents duplicate notifications
 */
async function showSystemNotification(title, body, tag) {
  if (!notificationsSupported || Notification.permission !== "granted") return;

  const options = {
    body,
    icon:               "/icons/icon-192.png",
    badge:              "/icons/icon-192.png",
    tag:                tag ?? undefined,
    requireInteraction: false,
    data:               { url: "/" },
  };

  try {
    // Prefer SW-based notification (required for mobile / background delivery)
    if (swRegistration && "showNotification" in swRegistration) {
      await swRegistration.showNotification(title, options);
    } else {
      // Fallback: direct Notification API
      const notif = new Notification(title, options);
      notif.onclick = () => { window.focus(); notif.close(); };
    }
  } catch (err) {
    console.warn("showSystemNotification failed:", err);
  }
}

// ─── 17. REMINDER SCHEDULER ────────────────────────────────────────────────────

/**
 * Check all tasks for due reminders and fire system notifications.
 * Called on an interval. Safe to call frequently — uses reminderSent flag
 * to prevent duplicate notifications.
 */
function checkReminders() {
  if (!notificationsSupported || Notification.permission !== "granted") return;

  const now     = Date.now();
  let   changed = false;

  state.tasks.forEach((task) => {
    // Skip: no reminder, already sent, or task completed
    if (!task.reminderEnabled)  return;
    if (task.reminderSent)      return;
    if (task.completed)         return;
    if (!task.reminderAt)       return;

    // Fire if the reminder time has arrived (within a 2-minute grace window
    // to handle cases where the tab was in the background)
    const GRACE_MS = 2 * 60_000;
    if (now >= task.reminderAt && now <= task.reminderAt + GRACE_MS) {
      const dateStr = task.deadline
        ? `Due: ${formatDate(task.deadline)}${task.dueTime ? " at " + formatTime(task.dueTime) : ""}`
        : "";

      showSystemNotification(
        "Task List — Task Reminder",
        `Your task "${task.text}" is due soon!${dateStr ? "\n" + dateStr : ""}`,
        `reminder-${task.id}`
      );

      task.reminderSent = true;
      changed = true;
    }
  });

  if (changed) {
    saveTasks();
    render(); // update reminder badge (sent state)
  }
}

/** Start the periodic reminder checker. Clears any existing interval first. */
function startReminderScheduler() {
  if (reminderIntervalId !== null) clearInterval(reminderIntervalId);
  reminderIntervalId = setInterval(checkReminders, REMINDER_CHECK_MS);
  // Also check immediately on start (handles reminders missed while the tab was closed)
  checkReminders();
}

// ─── 18. NOTIFICATION ICON HELPERS ────────────────────────────────────────────

function iconBellOn() {
  return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`;
}
function iconBellOff() {
  return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.172 9.172a4 4 0 015.656 5.656M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-.653-2.727M15 17H9m6 0v1a3 3 0 11-6 0v-1m0 0H4l1.405-1.405A2.032 2.032 0 006 14.158V11c0-1.485.542-2.84 1.432-3.876M3 3l18 18"/></svg>`;
}
function iconBellSleep() {
  return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/><line x1="19" y1="5" x2="21" y2="5" stroke-linecap="round"/><line x1="17" y1="3" x2="21" y2="3" stroke-linecap="round"/></svg>`;
}

// ─── 19. UTILITY ───────────────────────────────────────────────────────────────

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(str) {
  const map = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" };
  return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

// ─── 20. EVENT LISTENERS ───────────────────────────────────────────────────────

// Header — open Add modal
openAddModalBtn.addEventListener("click", () => openTaskModal(null));

// Header — notification status button
notifStatusBtn.addEventListener("click", () => {
  if (!notificationsSupported) return;
  if (Notification.permission === "default") requestNotifPermission();
  else if (Notification.permission === "denied") {
    alert("Notifications are blocked. Please allow them in your browser settings (click the lock icon in the address bar).");
  }
  // If granted — clicking just gives info; nothing to do
});

// Banner — enable notifications button
notifEnableBtn.addEventListener("click", requestNotifPermission);

// Banner — dismiss
notifBannerDismiss.addEventListener("click", () => {
  sessionStorage.setItem(BANNER_DISMISS_KEY, "1");
  notifBanner.classList.add("hidden");
});

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

// Modal — clear error on typing
modalTaskInput.addEventListener("input", () => {
  if (modalTaskInput.value.trim()) modalFormError.classList.add("hidden");
});

// Reminder toggle
modalReminderEnabled.addEventListener("change", syncReminderUI);

// Reminder offset change — update preview
modalReminderOffset.addEventListener("change", syncReminderUI);

// Deadline/time change — update reminder preview
modalDeadline.addEventListener("change", syncReminderUI);
modalDueTime.addEventListener("change",  syncReminderUI);

// "Enable now" link inside reminder warning
reminderEnableNotif.addEventListener("click", (e) => {
  e.preventDefault();
  requestNotifPermission().then(() => syncReminderUI());
});

// Subtask — add via button
subtaskAddBtn.addEventListener("click", addModalSubtask);

// Subtask — add via Enter key
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

// Re-check permission UI if the user changes browser settings and switches back
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateNotifUI();
    checkReminders(); // catch any reminders that fired while tab was hidden
  }
});

// ─── 21. SERVICE WORKER & PWA ──────────────────────────────────────────────────

/**
 * Register the Service Worker and wire up lifecycle events.
 * - Captures the registration so SW-based notifications can be sent.
 * - Detects when a new SW is waiting and posts SKIP_WAITING after user prompt.
 */
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    // Register with explicit scope "/" so the SW covers the entire origin.
    // The Service-Worker-Allowed header in vercel.json permits this.
    const reg = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    swRegistration = reg;
    console.log("[App] Service Worker registered:", reg.scope);

    // Detect SW update available
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // A new version is ready — show a subtle update toast
          showUpdateToast(newWorker);
        }
      });
    });

    // When the controller changes (new SW took over), reload to get latest assets
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });

  } catch (err) {
    console.warn("[App] Service Worker registration failed:", err);
  }
}

/**
 * Show a non-intrusive update toast at the bottom of the screen.
 * Clicking "Reload" sends SKIP_WAITING to the waiting SW.
 * @param {ServiceWorker} newWorker
 */
function showUpdateToast(newWorker) {
  // Remove any existing toast first
  const existing = document.getElementById("sw-update-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id    = "sw-update-toast";
  toast.className = "sw-update-toast";
  toast.innerHTML = `
    <span>A new version of Task List is available.</span>
    <button id="sw-reload-btn" class="sw-reload-btn">Reload</button>
    <button id="sw-toast-close" class="sw-toast-close" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(toast);

  document.getElementById("sw-reload-btn").addEventListener("click", () => {
    newWorker.postMessage({ type: "SKIP_WAITING" });
    toast.remove();
  });
  document.getElementById("sw-toast-close").addEventListener("click", () => toast.remove());
}

// ─── 22. ONLINE / OFFLINE ──────────────────────────────────────────────────────

function updateOnlineStatus() {
  if (navigator.onLine) {
    offlineBanner.classList.add("hidden");
  } else {
    offlineBanner.classList.remove("hidden");
  }
}

// ─── 23. PWA INSTALL PROMPT ────────────────────────────────────────────────────

/**
 * Handle the browser's beforeinstallprompt event.
 * Store it so we can trigger it from our own Install button.
 */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  pwaInstallPrompt = e;
  installBtn.classList.remove("hidden");
});

/** If the app is installed from the browser, hide the install button. */
window.addEventListener("appinstalled", () => {
  pwaInstallPrompt = null;
  installBtn.classList.add("hidden");
  console.log("[App] PWA installed successfully.");
});

// ─── 24. INIT ──────────────────────────────────────────────────────────────────

function init() {
  loadTasks();
  render();
  updateNotifUI();
  startReminderScheduler();
  registerServiceWorker();
  updateOnlineStatus();
}

// Install button click handler
installBtn.addEventListener("click", async () => {
  if (!pwaInstallPrompt) return;
  pwaInstallPrompt.prompt();
  const { outcome } = await pwaInstallPrompt.userChoice;
  console.log(`[App] Install prompt outcome: ${outcome}`);
  pwaInstallPrompt = null;
  installBtn.classList.add("hidden");
});

// Online / offline events
window.addEventListener("online",  updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

document.addEventListener("DOMContentLoaded", init);
