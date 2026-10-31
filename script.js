/* ============================================================
   script.js — Task List App
   Vanilla JavaScript — no external libraries required.
   Features: CRUD, toggle complete, filter (All/Active/Completed),
             LocalStorage persistence, modal edit.
   ============================================================ */

"use strict";

// ─── 1. STATE ─────────────────────────────────────────────────────────────────

/**
 * Application state object.
 * @type {{ tasks: Task[], filter: string, editingId: string|null }}
 *
 * @typedef {{ id: string, text: string, completed: boolean, createdAt: number }} Task
 */
const state = {
  tasks: [],          // Array of task objects
  filter: "all",      // Current active filter: "all" | "active" | "completed"
  editingId: null,    // ID of the task currently being edited in the modal
};

// ─── 2. CONSTANTS & DOM REFS ──────────────────────────────────────────────────

const STORAGE_KEY = "tasklist_tasks";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Form elements
const taskForm      = $("#task-form");
const taskInput     = $("#task-input");
const formError     = $("#form-error");

// List & UI elements
const taskList      = $("#task-list");
const emptyState    = $("#empty-state");
const emptyTitle    = $("#empty-title");
const emptySubtitle = $("#empty-subtitle");
const listFooter    = $("#list-footer");
const taskCounter   = $("#task-counter");
const activeCount   = $("#active-count");
const clearBtn      = $("#clear-completed-btn");

// Filter tabs
const filterTabs      = $$(".filter-tab");

// Tab count badges
const tabCountAll       = $("#tab-count-all");
const tabCountActive    = $("#tab-count-active");
const tabCountCompleted = $("#tab-count-completed");

// Modal elements
const editModal     = $("#edit-modal");
const editInput     = $("#edit-input");
const editError     = $("#edit-error");
const editSaveBtn   = $("#edit-save-btn");
const editCancelBtn = $("#edit-cancel-btn");

// ─── 3. PERSISTENCE (LocalStorage) ───────────────────────────────────────────

/**
 * Load tasks from LocalStorage into state.
 */
function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    state.tasks = stored ? JSON.parse(stored) : [];
  } catch {
    state.tasks = [];
  }
}

/**
 * Persist current tasks array to LocalStorage.
 */
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

// ─── 4. DATA HELPERS ──────────────────────────────────────────────────────────

/**
 * Generate a simple unique ID based on timestamp + random suffix.
 * @returns {string}
 */
function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Return tasks filtered according to the current state.filter value.
 * @returns {Task[]}
 */
function getFilteredTasks() {
  switch (state.filter) {
    case "active":    return state.tasks.filter((t) => !t.completed);
    case "completed": return state.tasks.filter((t) =>  t.completed);
    default:          return state.tasks;
  }
}

/**
 * Count tasks that are not yet completed.
 * @returns {number}
 */
function countActive() {
  return state.tasks.filter((t) => !t.completed).length;
}

/**
 * Count tasks that are completed.
 * @returns {number}
 */
function countCompleted() {
  return state.tasks.filter((t) => t.completed).length;
}

// ─── 5. RENDER ────────────────────────────────────────────────────────────────

/**
 * Main render function — rebuilds the task list and updates all UI counters.
 * Called after every state change.
 */
function render() {
  const filtered = getFilteredTasks();

  // ── Clear & rebuild task list
  taskList.innerHTML = "";

  if (filtered.length === 0) {
    // Show contextual empty-state message
    showEmptyState();
  } else {
    emptyState.classList.add("hidden");
    emptyState.classList.remove("flex");
    filtered.forEach((task) => {
      taskList.appendChild(createTaskElement(task));
    });
  }

  // ── Update header counter (always shows total)
  const total     = state.tasks.length;
  const numActive = countActive();
  const numDone   = countCompleted();
  taskCounter.textContent = `${total} ${total === 1 ? "task" : "tasks"}`;

  // ── Update filter tab counts — reuse already-computed values
  tabCountAll.textContent       = `(${total})`;
  tabCountActive.textContent    = `(${numActive})`;
  tabCountCompleted.textContent = `(${numDone})`;

  // ── Update footer
  if (state.tasks.length > 0) {
    listFooter.classList.remove("hidden");
    listFooter.classList.add("flex");
    activeCount.textContent = `${numActive} ${numActive === 1 ? "item" : "items"} left`;
    clearBtn.disabled = numDone === 0;
  } else {
    listFooter.classList.add("hidden");
    listFooter.classList.remove("flex");
  }
}

/**
 * Display the empty-state panel with a message appropriate for the active filter.
 */
function showEmptyState() {
  emptyState.classList.remove("hidden");
  emptyState.classList.add("flex");

  const messages = {
    all:       { title: "No tasks yet",            subtitle: "Add a task above to get started." },
    active:    { title: "No active tasks",          subtitle: "All caught up! Great work 🎉" },
    completed: { title: "No completed tasks",       subtitle: "Complete a task to see it here." },
  };

  const msg = messages[state.filter];
  emptyTitle.textContent    = msg.title;
  emptySubtitle.textContent = msg.subtitle;
}

/**
 * Create and return a <li> DOM element for a single task.
 * @param {Task} task
 * @returns {HTMLLIElement}
 */
function createTaskElement(task) {
  const li = document.createElement("li");
  li.className = "task-item task-enter";
  li.dataset.id = task.id;
  if (task.completed) li.classList.add("completed");

  li.innerHTML = `
    <!-- Toggle Checkbox -->
    <input
      type="checkbox"
      class="task-checkbox"
      aria-label="Mark task as ${task.completed ? "active" : "completed"}"
      ${task.completed ? "checked" : ""}
    />

    <!-- Task Text -->
    <span class="task-text">${escapeHtml(task.text)}</span>

    <!-- Action Buttons -->
    <div class="flex items-center gap-1" role="group" aria-label="Task actions">
      <!-- Edit Button -->
      <button class="action-btn edit-btn" aria-label="Edit task" title="Edit">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
        </svg>
      </button>

      <!-- Delete Button -->
      <button class="action-btn delete-btn" aria-label="Delete task" title="Delete">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  `;

  // ── Attach event listeners directly on the element
  const checkbox  = li.querySelector(".task-checkbox");
  const editBtn   = li.querySelector(".edit-btn");
  const deleteBtn = li.querySelector(".delete-btn");

  checkbox.addEventListener("change", () => toggleTask(task.id));
  editBtn.addEventListener("click",   () => openEditModal(task.id));
  deleteBtn.addEventListener("click", () => deleteTask(task.id));

  return li;
}

// ─── 6. CRUD OPERATIONS ───────────────────────────────────────────────────────

/**
 * CREATE — Add a new task from the input field value.
 */
function addTask() {
  const text = taskInput.value.trim();

  // Validate — field must not be empty
  if (!text) {
    showFormError(true);
    taskInput.focus();
    return;
  }

  showFormError(false);

  /** @type {Task} */
  const newTask = {
    id:        generateId(),
    text:      text,
    completed: false,
    createdAt: Date.now(),
  };

  state.tasks.unshift(newTask);  // Newest task at the top
  saveTasks();
  taskInput.value = "";
  render();
}

/**
 * TOGGLE — Switch a task between completed and active.
 * @param {string} id
 */
function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;

  task.completed = !task.completed;
  saveTasks();
  render();
}

/**
 * UPDATE — Save the edited text from the modal to the matching task.
 */
function saveEdit() {
  const newText = editInput.value.trim();

  if (!newText) {
    editError.classList.remove("hidden");
    editInput.focus();
    return;
  }

  editError.classList.add("hidden");

  const task = state.tasks.find((t) => t.id === state.editingId);
  if (task) {
    task.text = newText;
    saveTasks();
    render();
  }

  closeEditModal();
}

/**
 * DELETE — Remove a task by its ID.
 * @param {string} id
 */
function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  saveTasks();
  render();
}

/**
 * DELETE ALL COMPLETED — Remove every completed task at once.
 */
function clearCompleted() {
  state.tasks = state.tasks.filter((t) => !t.completed);
  saveTasks();
  render();
}

// ─── 7. FILTER ────────────────────────────────────────────────────────────────

/**
 * Update the active filter and re-render the list.
 * @param {string} filter - "all" | "active" | "completed"
 */
function setFilter(filter) {
  state.filter = filter;

  // Update tab active styles
  filterTabs.forEach((tab) => {
    const isActive = tab.dataset.filter === filter;
    tab.classList.toggle("active-tab", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  render();
}

// ─── 8. MODAL HELPERS ─────────────────────────────────────────────────────────

/**
 * Open the edit modal pre-filled with the task's current text.
 * @param {string} id
 */
function openEditModal(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;

  state.editingId    = id;
  editInput.value    = task.text;
  editError.classList.add("hidden");

  editModal.classList.remove("hidden");
  editInput.focus();
  editInput.select();
}

/**
 * Close the edit modal and reset editing state.
 */
function closeEditModal() {
  state.editingId = null;
  editModal.classList.add("hidden");
  editInput.value = "";
}

// ─── 9. UTILITY ───────────────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent XSS when injecting user text.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return str.replace(/[&<>"']/g, (ch) => map[ch]);
}

/**
 * Show or hide the inline form validation error.
 * @param {boolean} show
 */
function showFormError(show) {
  formError.classList.toggle("hidden", !show);
}

// ─── 10. EVENT LISTENERS ──────────────────────────────────────────────────────

// Add task on form submit
taskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addTask();
});

// Clear form error as soon as user types
taskInput.addEventListener("input", () => {
  if (taskInput.value.trim()) showFormError(false);
});

// Filter tab clicks
filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => setFilter(tab.dataset.filter));
});

// Clear completed tasks
clearBtn.addEventListener("click", clearCompleted);

// Modal — Save button
editSaveBtn.addEventListener("click", saveEdit);

// Modal — Cancel button
editCancelBtn.addEventListener("click", closeEditModal);

// Modal — Save on Enter key, close on Escape
editInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter")  saveEdit();
  if (e.key === "Escape") closeEditModal();
});

// Modal — Click on backdrop to close
editModal.addEventListener("click", (e) => {
  if (e.target === editModal) closeEditModal();
});

// ─── 11. INIT ─────────────────────────────────────────────────────────────────

/**
 * Bootstrap the application:
 * 1. Load persisted tasks from LocalStorage
 * 2. Render the initial state
 */
function init() {
  loadTasks();
  render();
}

// Run on DOMContentLoaded
document.addEventListener("DOMContentLoaded", init);
