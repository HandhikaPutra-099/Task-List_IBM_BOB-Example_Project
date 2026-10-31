/* ============================================================
   script.js — Task List | Personal Task Manager
   Vanilla JavaScript + Supabase backend.

   Features:
   - Supabase Auth (login, register, logout, session)
   - Supabase PostgreSQL as primary data store
   - Supabase Realtime for live cross-device sync
   - Web Push subscription management
   - LocalStorage → Supabase migration for existing users
   - Full CRUD with deadline, priority, category, subtasks
   - Status filter, category filter, search, sort
   - Dashboard stats + progress bar
   - PWA: Service Worker, install prompt, offline banner
   ============================================================ */

"use strict";

// ─── 1. SUPABASE CLIENT ────────────────────────────────────────────────────────
// IMPORTANT: Replace these values with your own project credentials.
// These are the ANON (public) key — safe to expose in frontend code.
// Never put your service_role key here.
const SUPABASE_URL  = window.ENV_SUPABASE_URL  || "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON = window.ENV_SUPABASE_ANON || "YOUR_ANON_KEY";
const VAPID_PUBLIC  = window.ENV_VAPID_PUBLIC  || "YOUR_VAPID_PUBLIC_KEY";

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── 2. STATE ──────────────────────────────────────────────────────────────────

/**
 * @typedef {{ id:string, text:string, completed:boolean, createdAt:number,
 *             deadline:string|null, dueTime:string|null,
 *             priority:'high'|'medium'|'low', category:string,
 *             subtasks:Array<{id:string,text:string,completed:boolean}>,
 *             reminderEnabled:boolean, reminderMinutesBefore:number,
 *             reminderAt:number|null, reminderSent:boolean }} Task
 */

const state = {
  tasks:          [],        // master task array (source of truth)
  filter:         "all",     // "all" | "active" | "completed"
  categoryFilter: "all",
  searchQuery:    "",
  sortMode:       "newest",
  editingId:      null,      // task ID in modal (null = add mode)
  deletingId:     null,
  modalSubtasks:  [],
  user:           null,      // Supabase User object when logged in
  realtimeChannel: null,     // active Realtime subscription
};

// ─── 3. CONSTANTS ──────────────────────────────────────────────────────────────

const STORAGE_KEY           = "tasklist_tasks";          // legacy LS key
const MIGRATION_DONE_KEY    = "tasklist_migration_done"; // LS flag after import
const BANNER_DISMISS_KEY    = "tasklist_notif_banner_dismissed";
const PRIORITY_ORDER        = { high: 0, medium: 1, low: 2 };
const REMINDER_CHECK_MS     = 30_000;

let reminderIntervalId  = null;
let swRegistration      = null;
let pwaInstallPrompt    = null;

// ─── 4. DOM REFS ───────────────────────────────────────────────────────────────

const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Auth overlay
const authOverlay        = $("#auth-overlay");
const authTabSwitcher    = $("#auth-tab-switcher");
const authTagline        = $("#auth-tagline");
const tabLogin           = $("#tab-login");
const tabRegister        = $("#tab-register");
const panelLogin         = $("#panel-login");
const panelRegister      = $("#panel-register");
const panelResetPassword = $("#panel-reset-password");
const loginEmail         = $("#login-email");
const loginPassword      = $("#login-password");
const loginBtn           = $("#login-btn");
const loginError         = $("#login-error");
const forgotBtn          = $("#forgot-btn");
const regEmail           = $("#reg-email");
const regPassword        = $("#reg-password");
const regPassword2       = $("#reg-password2");
const registerBtn        = $("#register-btn");
const registerError      = $("#register-error");
const resetPasswordInput = $("#reset-password");
const resetPassword2     = $("#reset-password2");
const resetSaveBtn       = $("#reset-save-btn");
const resetError         = $("#reset-error");
const authStatus         = $("#auth-status");

// Migration banner
const migrationBanner    = $("#migration-banner");
const migrationCount     = $("#migration-count");
const migrationImportBtn = $("#migration-import-btn");
const migrationSkipBtn   = $("#migration-skip-btn");

// Header
const userMenuBtn       = $("#user-menu-btn");
const userDropdown      = $("#user-dropdown");
const userEmailDisplay  = $("#user-email-display");
const logoutBtn         = $("#logout-btn");
const installBtn        = $("#install-btn");
const notifStatusBtn    = $("#notif-status-btn");
const offlineBanner     = $("#offline-banner");
const notifBanner       = $("#notif-banner");
const notifBannerMsg    = $("#notif-banner-msg");
const notifEnableBtn    = $("#notif-enable-btn");
const notifBannerDismiss = $("#notif-banner-dismiss");

// Dashboard
const statTotal     = $("#stat-total");
const statCompleted = $("#stat-completed");
const statPending   = $("#stat-pending");
const statOverdue   = $("#stat-overdue");
const statDueToday  = $("#stat-duetoday");
const progressBar   = $("#progress-bar");
const progressLabel = $("#progress-label");

// Search / Sort / Filters
const searchInput    = $("#search-input");
const sortSelect     = $("#sort-select");
const categoryFilter = $("#category-filter");
const filterTabs     = $$(".filter-tab");
const tabCountAll    = $("#tab-count-all");
const tabCountActive = $("#tab-count-active");
const tabCountDone   = $("#tab-count-completed");

// Task list
const taskList    = $("#task-list");
const emptyState  = $("#empty-state");
const emptyTitle  = $("#empty-title");
const emptySub    = $("#empty-subtitle");
const listFooter  = $("#list-footer");
const activeCount = $("#active-count");
const clearBtn    = $("#clear-completed-btn");

// Task modal
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

// Delete modal
const deleteModal      = $("#delete-modal");
const deleteConfirmBtn = $("#delete-confirm-btn");
const deleteCancelBtn  = $("#delete-cancel-btn");

// ─── 5. DATE & ID HELPERS ──────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
}

function formatTime(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

/**
 * Convert a local deadline + dueTime to a UTC ISO string for Supabase.
 * Returns null when either part is missing.
 */
function buildDueAt(deadline, dueTime) {
  if (!deadline || !dueTime) return null;
  const [y, mo, d] = deadline.split("-").map(Number);
  const [h, mi]    = dueTime.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0).toISOString();
}

/**
 * Compute the reminder UTC ISO string given dueAt and offsetMinutes.
 * Returns null when dueAt is missing.
 */
function buildReminderAt(dueAt, offsetMinutes) {
  if (!dueAt) return null;
  return new Date(new Date(dueAt).getTime() - offsetMinutes * 60_000).toISOString();
}

/**
 * Extract local "YYYY-MM-DD" and "HH:MM" parts from a UTC ISO timestamp.
 * @returns {{ deadline: string|null, dueTime: string|null }}
 */
function splitDueAt(dueAtISO) {
  if (!dueAtISO) return { deadline: null, dueTime: null };
  const d = new Date(dueAtISO);
  const deadline = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dueTime  = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { deadline, dueTime };
}

// ─── 6. TASK ↔ DB ROW MAPPING ─────────────────────────────────────────────────

/**
 * Convert a Supabase DB row to the internal Task shape used by the UI.
 * @param {object} row
 * @returns {Task}
 */
function rowToTask(row) {
  const { deadline, dueTime } = splitDueAt(row.due_at);
  const reminderAt = row.reminder_at ? new Date(row.reminder_at).getTime() : null;
  return {
    id:                    row.id,
    text:                  row.title,
    completed:             row.completed,
    createdAt:             new Date(row.created_at).getTime(),
    deadline,
    dueTime,
    priority:              row.priority    ?? "medium",
    category:              row.category    ?? "Other",
    subtasks:              Array.isArray(row.subtasks) ? row.subtasks : [],
    reminderEnabled:       row.reminder_enabled        ?? false,
    reminderMinutesBefore: row.reminder_minutes_before ?? 30,
    reminderAt,
    reminderSent:          !!row.reminder_sent_at,
  };
}

/**
 * Convert the internal Task shape to a Supabase DB row for upsert.
 * @param {Task} task
 * @param {string} userId
 * @returns {object}
 */
function taskToRow(task, userId) {
  const dueAt     = buildDueAt(task.deadline, task.dueTime);
  const remAt     = task.reminderEnabled ? buildReminderAt(dueAt, task.reminderMinutesBefore) : null;
  return {
    id:                     task.id,
    user_id:                userId,
    title:                  task.text,
    completed:              task.completed,
    due_at:                 dueAt,
    priority:               task.priority,
    category:               task.category,
    subtasks:               task.subtasks,
    reminder_enabled:        task.reminderEnabled,
    reminder_minutes_before: task.reminderMinutesBefore,
    reminder_at:             remAt,
    // Reset reminder_sent_at to null when reminder settings change (edge function will re-fire)
    reminder_sent_at:        task.reminderSent ? new Date(task.reminderAt!).toISOString() : null,
  };
}

// ─── 7. SUPABASE DB OPERATIONS ────────────────────────────────────────────────

/** Load all tasks for the current user from Supabase. */
async function loadTasksFromDB() {
  const { data, error } = await db
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) { console.error("[DB] loadTasks:", error.message); return; }
  state.tasks = (data ?? []).map(rowToTask);
}

/** Insert or update a single task in Supabase. */
async function upsertTaskToDB(task) {
  if (!state.user) return;
  const row = taskToRow(task, state.user.id);
  const { error } = await db.from("tasks").upsert(row, { onConflict: "id" });
  if (error) console.error("[DB] upsertTask:", error.message);
}

/** Delete a task from Supabase by ID. */
async function deleteTaskFromDB(id) {
  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) console.error("[DB] deleteTask:", error.message);
}

/** Delete all completed tasks from Supabase. */
async function deleteCompletedFromDB() {
  const ids = state.tasks.filter((t) => t.completed).map((t) => t.id);
  if (!ids.length) return;
  const { error } = await db.from("tasks").delete().in("id", ids);
  if (error) console.error("[DB] deleteCompleted:", error.message);
}

// ─── 8. REALTIME SYNC ─────────────────────────────────────────────────────────

/**
 * Subscribe to Supabase Realtime changes on the tasks table.
 * Applies INSERT / UPDATE / DELETE events directly to state.tasks
 * without a full reload, preventing flicker and data races.
 */
function subscribeRealtime() {
  if (state.realtimeChannel) {
    db.removeChannel(state.realtimeChannel);
  }

  state.realtimeChannel = db
    .channel("tasks-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${state.user.id}` },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (eventType === "INSERT") {
          // Only add if not already present (guards against echoing own writes)
          if (!state.tasks.find((t) => t.id === newRow.id)) {
            state.tasks.unshift(rowToTask(newRow));
          }
        } else if (eventType === "UPDATE") {
          const idx = state.tasks.findIndex((t) => t.id === newRow.id);
          if (idx !== -1) state.tasks[idx] = rowToTask(newRow);
          else state.tasks.unshift(rowToTask(newRow));
        } else if (eventType === "DELETE") {
          state.tasks = state.tasks.filter((t) => t.id !== oldRow.id);
        }

        render();
      }
    )
    .subscribe();
}

function unsubscribeRealtime() {
  if (state.realtimeChannel) {
    db.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
}

// ─── 9. LOCALSTORAGE MIGRATION ────────────────────────────────────────────────

/**
 * Read legacy tasks from LocalStorage.
 * Returns an empty array when nothing is found or already migrated.
 */
function readLocalTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Check whether we should offer the migration prompt. */
function shouldOfferMigration() {
  if (localStorage.getItem(MIGRATION_DONE_KEY)) return false;
  return readLocalTasks().length > 0;
}

/**
 * Import LocalStorage tasks into Supabase.
 * - Uses upsert to avoid duplicates on retry.
 * - Marks migration as done only after all rows are confirmed.
 */
async function importLocalTasks() {
  const localTasks = readLocalTasks();
  if (!localTasks.length || !state.user) return;

  migrationImportBtn.disabled = true;
  migrationImportBtn.textContent = "Importing…";

  const rows = localTasks.map((t) => {
    // Migrate old shape to new
    const task = migrateOldTask(t);
    return taskToRow(task, state.user.id);
  });

  const { error } = await db.from("tasks").upsert(rows, { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    console.error("[Migration] Import failed:", error.message);
    migrationImportBtn.disabled = false;
    migrationImportBtn.textContent = "Retry Import";
    return;
  }

  localStorage.setItem(MIGRATION_DONE_KEY, "1");
  hideMigrationBanner();
  await loadTasksFromDB();
  render();
}

function hideMigrationBanner() {
  migrationBanner.classList.add("hidden");
}

function showMigrationBanner() {
  const tasks = readLocalTasks();
  if (!tasks.length) return;
  migrationCount.textContent = tasks.length;
  migrationBanner.classList.remove("hidden");
}

/**
 * Ensure old LocalStorage task objects have all v3 fields.
 */
function migrateOldTask(t) {
  return {
    id:                    t.id        ?? generateId(),
    text:                  t.text      ?? "",
    completed:             t.completed ?? false,
    createdAt:             t.createdAt ?? Date.now(),
    deadline:              t.deadline  ?? null,
    dueTime:               t.dueTime   ?? null,
    priority:              t.priority  ?? "medium",
    category:              t.category  ?? "Other",
    subtasks:              Array.isArray(t.subtasks) ? t.subtasks : [],
    reminderEnabled:       t.reminderEnabled       ?? false,
    reminderMinutesBefore: t.reminderMinutesBefore ?? 30,
    reminderAt:            t.reminderAt            ?? null,
    reminderSent:          t.reminderSent          ?? false,
  };
}

// ─── 10. AUTH ─────────────────────────────────────────────────────────────────

/** Show the main app; hide the auth overlay. */
function showApp(user) {
  state.user = user;
  authOverlay.classList.add("hidden");
  userMenuBtn.classList.remove("hidden");
  userEmailDisplay.textContent = user.email ?? "";

  if (shouldOfferMigration()) showMigrationBanner();
}

/** Hide the app content and show the auth overlay. */
function showAuthOverlay() {
  state.user   = null;
  state.tasks  = [];
  authOverlay.classList.remove("hidden");
  userMenuBtn.classList.add("hidden");
  userDropdown.classList.add("hidden");
  hideMigrationBanner();
  unsubscribeRealtime();
  render();
}

/**
 * Show the "Set New Password" panel when arriving from a password-reset link.
 * Hides the tab switcher and the tagline so only the reset form is visible.
 */
function showResetPasswordPanel() {
  authOverlay.classList.remove("hidden");
  authTabSwitcher.classList.add("hidden");
  authTagline.classList.add("hidden");
  panelLogin.classList.add("hidden");
  panelRegister.classList.add("hidden");
  panelResetPassword.classList.remove("hidden");
  setTimeout(() => resetPasswordInput.focus(), 50);
}

/**
 * Handle submission of the "Set New Password" form.
 * Calls Supabase updateUser to commit the new password,
 * then signs the user in and shows the app.
 */
async function handleSetNewPassword() {
  const pass  = resetPasswordInput.value;
  const pass2 = resetPassword2.value;

  resetError.classList.add("hidden");

  if (pass.length < 8) {
    resetError.textContent = "Password must be at least 8 characters.";
    resetError.classList.remove("hidden");
    return;
  }
  if (pass !== pass2) {
    resetError.textContent = "Passwords do not match.";
    resetError.classList.remove("hidden");
    return;
  }

  resetSaveBtn.disabled     = true;
  resetSaveBtn.textContent  = "Saving…";

  const { data, error } = await db.auth.updateUser({ password: pass });

  resetSaveBtn.disabled    = false;
  resetSaveBtn.textContent = "Set New Password";

  if (error) {
    resetError.textContent = error.message;
    resetError.classList.remove("hidden");
    return;
  }

  // Restore auth UI to normal state
  authTabSwitcher.classList.remove("hidden");
  authTagline.classList.remove("hidden");
  panelResetPassword.classList.add("hidden");

  // Sign the user in (updateUser returns a session on success)
  if (data?.user) {
    await onAuthSuccess(data.user);
  } else {
    // Fallback: ask user to sign in manually
    authStatus.textContent = "Password updated! Please sign in with your new password.";
    authStatus.classList.remove("hidden");
    switchAuthTab("login");
  }

  // Clear the recovery hash from the URL so a refresh doesn't re-trigger the form
  history.replaceState(null, "", window.location.pathname);
}

function setAuthLoading(btnEl, loading) {
  btnEl.disabled = loading;
  btnEl.textContent = loading ? "Please wait…" : btnEl.dataset.label;
}

function showAuthError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearAuthErrors() {
  [loginError, registerError].forEach((el) => {
    el.textContent = "";
    el.classList.add("hidden");
  });
  authStatus.classList.add("hidden");
}

async function handleLogin() {
  clearAuthErrors();
  const email = loginEmail.value.trim();
  const pass  = loginPassword.value;

  if (!email || !pass) { showAuthError(loginError, "Email and password are required."); return; }

  setAuthLoading(loginBtn, true);
  const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
  setAuthLoading(loginBtn, false);

  if (error) { showAuthError(loginError, error.message); return; }

  await onAuthSuccess(data.user);
}

async function handleRegister() {
  clearAuthErrors();
  const email = regEmail.value.trim();
  const pass  = regPassword.value;
  const pass2 = regPassword2.value;

  if (!email)           { showAuthError(registerError, "Email is required."); return; }
  if (pass.length < 8)  { showAuthError(registerError, "Password must be at least 8 characters."); return; }
  if (pass !== pass2)   { showAuthError(registerError, "Passwords do not match."); return; }

  setAuthLoading(registerBtn, true);
  const { data, error } = await db.auth.signUp({ email, password: pass });
  setAuthLoading(registerBtn, false);

  if (error) { showAuthError(registerError, error.message); return; }

  if (data.session) {
    await onAuthSuccess(data.user);
  } else {
    // Email confirmation required
    authStatus.textContent = "Account created! Check your email to confirm your address, then sign in.";
    authStatus.classList.remove("hidden");
  }
}

async function handleForgotPassword() {
  const email = loginEmail.value.trim();
  if (!email) { showAuthError(loginError, "Enter your email address first."); return; }

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  if (error) { showAuthError(loginError, error.message); return; }
  authStatus.textContent = "Password reset link sent — check your inbox.";
  authStatus.classList.remove("hidden");
}

async function handleLogout() {
  await db.auth.signOut();
  showAuthOverlay();
}

/**
 * Called after successful login or registration.
 * Loads tasks, starts realtime, registers push subscription.
 */
async function onAuthSuccess(user) {
  showApp(user);
  await loadTasksFromDB();
  render();
  subscribeRealtime();
  await registerPushSubscription();
  updateNotifUI();
  startReminderScheduler();
}

// ─── 11. AUTH TAB SWITCH ──────────────────────────────────────────────────────

function switchAuthTab(tab) {
  const isLogin = tab === "login";
  tabLogin.classList.toggle("active-auth-tab", isLogin);
  tabRegister.classList.toggle("active-auth-tab", !isLogin);
  tabLogin.setAttribute("aria-selected", isLogin ? "true" : "false");
  tabRegister.setAttribute("aria-selected", isLogin ? "false" : "true");
  panelLogin.classList.toggle("hidden", !isLogin);
  panelRegister.classList.toggle("hidden", isLogin);
  // Always hide the reset panel when switching tabs normally
  panelResetPassword.classList.add("hidden");
  // Ensure tab switcher and tagline are restored
  authTabSwitcher.classList.remove("hidden");
  authTagline.classList.remove("hidden");
  clearAuthErrors();
}

// ─── 12. DATA PIPELINE ────────────────────────────────────────────────────────

function getDisplayTasks() {
  let tasks = [...state.tasks];

  if (state.filter === "active")    tasks = tasks.filter((t) => !t.completed);
  if (state.filter === "completed") tasks = tasks.filter((t) =>  t.completed);
  if (state.categoryFilter !== "all") tasks = tasks.filter((t) => t.category === state.categoryFilter);
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    tasks = tasks.filter((t) => t.text.toLowerCase().includes(q));
  }
  return sortTasks(tasks, state.sortMode);
}

function sortTasks(tasks, mode) {
  const copy = [...tasks];
  switch (mode) {
    case "newest":        return copy.sort((a, b) => b.createdAt - a.createdAt);
    case "oldest":        return copy.sort((a, b) => a.createdAt - b.createdAt);
    case "deadline-asc":  return copy.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1; if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
    case "deadline-desc": return copy.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1; if (!b.deadline) return -1;
      return b.deadline.localeCompare(a.deadline);
    });
    case "priority-high": return copy.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    case "priority-low":  return copy.sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);
    default:              return copy;
  }
}

// ─── 13. STATS ────────────────────────────────────────────────────────────────

function deadlineStatus(task) {
  if (task.completed) return "completed";
  if (!task.deadline) return "none";
  const today = todayISO();
  if (task.deadline < today)   return "overdue";
  if (task.deadline === today) return "duetoday";
  return "upcoming";
}

function countActive()    { return state.tasks.filter((t) => !t.completed).length; }
function countCompleted() { return state.tasks.filter((t) =>  t.completed).length; }
function countOverdue()   { return state.tasks.filter((t) => deadlineStatus(t) === "overdue").length; }
function countDueToday()  { return state.tasks.filter((t) => deadlineStatus(t) === "duetoday").length; }

// ─── 14. RENDER ───────────────────────────────────────────────────────────────

function render() {
  renderDashboard();
  renderTabCounts();
  renderTaskList();
  renderFooter();
}

function renderDashboard() {
  const total     = state.tasks.length;
  const completed = countCompleted();
  const pct       = total === 0 ? 0 : Math.round((completed / total) * 100);

  statTotal.textContent     = total;
  statCompleted.textContent = completed;
  statPending.textContent   = countActive();
  statOverdue.textContent   = countOverdue();
  statDueToday.textContent  = countDueToday();
  progressBar.style.width   = `${pct}%`;
  progressLabel.textContent = `${pct}%`;
}

function renderTabCounts() {
  tabCountAll.textContent    = `(${state.tasks.length})`;
  tabCountActive.textContent = `(${countActive()})`;
  tabCountDone.textContent   = `(${countCompleted()})`;
}

function renderTaskList() {
  const visible = getDisplayTasks();
  taskList.innerHTML = "";

  if (visible.length === 0) { showEmptyState(); return; }

  emptyState.classList.add("hidden");
  emptyState.classList.remove("flex");
  visible.forEach((task) => taskList.appendChild(createTaskElement(task)));
}

function showEmptyState() {
  emptyState.classList.remove("hidden");
  emptyState.classList.add("flex");
  if (state.searchQuery) {
    emptyTitle.textContent = "No tasks match your search";
    emptySub.textContent   = "Try a different keyword.";
    return;
  }
  const msgs = {
    all:       { title: "No tasks yet",       sub: "Click 'New Task' to get started." },
    active:    { title: "No active tasks",     sub: "All caught up! Great work 🎉" },
    completed: { title: "No completed tasks",  sub: "Complete a task to see it here." },
  };
  const m = msgs[state.filter] ?? msgs.all;
  emptyTitle.textContent = m.title;
  emptySub.textContent   = m.sub;
}

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

// ─── 15. TASK CARD BUILDER ────────────────────────────────────────────────────

function createTaskElement(task) {
  const li = document.createElement("li");
  li.className = "task-item task-enter";
  li.dataset.id = task.id;
  if (task.completed) li.classList.add("completed");

  const status      = deadlineStatus(task);
  const priBadge    = buildPriorityBadge(task.priority);
  const dlBadge     = buildDeadlineBadge(task, status);
  const catBadge    = buildCategoryBadge(task.category);
  const remBadge    = buildReminderBadge(task);
  const subtaskMeta = buildSubtaskMeta(task);

  li.innerHTML = `
    <input type="checkbox" class="task-checkbox" aria-label="Toggle completion" ${task.completed ? "checked" : ""} />
    <div class="flex-1 min-w-0">
      <span class="task-text">${escapeHtml(task.text)}</span>
      <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
        ${priBadge}${dlBadge}${catBadge}${remBadge}
      </div>
      ${subtaskMeta}
    </div>
    <div class="flex items-center gap-1 flex-shrink-0 self-start mt-0.5" role="group" aria-label="Task actions">
      <button class="action-btn edit-btn"   aria-label="Edit"   title="Edit">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z"/></svg>
      </button>
      <button class="action-btn delete-btn" aria-label="Delete" title="Delete">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    </div>`;

  li.querySelector(".task-checkbox").addEventListener("change", () => toggleTask(task.id));
  li.querySelector(".edit-btn").addEventListener("click",       () => openTaskModal(task.id));
  li.querySelector(".delete-btn").addEventListener("click",     () => openDeleteModal(task.id));
  li.querySelectorAll(".subtask-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => toggleSubtask(task.id, cb.dataset.subId));
  });
  const toggleBtn = li.querySelector(".toggle-subtask-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const sec = li.querySelector(".subtask-section");
      const hidden = sec.style.display === "none";
      sec.style.display = hidden ? "block" : "none";
      toggleBtn.textContent = hidden ? "▲ Subtasks" : "▼ Subtasks";
    });
  }
  return li;
}

function buildPriorityBadge(p) {
  const l = { high:"High", medium:"Medium", low:"Low" };
  return `<span class="priority-badge priority-${p}">${l[p]}</span>`;
}

function buildDeadlineBadge(task, status) {
  const ts = task.dueTime ? `, ${formatTime(task.dueTime)}` : "";
  const map = {
    completed: { cls:"deadline-completed", label:"Completed" },
    overdue:   { cls:"deadline-overdue",   label:`Overdue · ${formatDate(task.deadline)}${ts}` },
    duetoday:  { cls:"deadline-duetoday",  label:`Due Today${ts}` },
    upcoming:  { cls:"deadline-upcoming",  label:`${formatDate(task.deadline)}${ts}` },
    none:      { cls:"deadline-none",      label:"No Deadline" },
  };
  const { cls, label } = map[status] ?? map.none;
  return `<span class="deadline-badge ${cls}">${label}</span>`;
}

function buildCategoryBadge(cat) {
  return `<span class="category-badge">${escapeHtml(cat)}</span>`;
}

function buildReminderBadge(task) {
  if (!task.reminderEnabled) return "";
  let label = "Reminder";
  if (task.reminderAt) {
    const now = Date.now();
    if (task.reminderSent || task.reminderAt <= now) {
      label = "Sent";
    } else {
      const dm = Math.round((task.reminderAt - now) / 60_000);
      label = dm < 60 ? `Reminder in ${dm}m` : dm < 1440 ? `Reminder in ${Math.round(dm/60)}h` : `Reminder in ${Math.round(dm/1440)}d`;
    }
  }
  const cls = task.reminderSent ? "reminder-badge-sent" : "reminder-badge-active";
  return `<span class="reminder-badge ${cls}"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>${label}</span>`;
}

function buildSubtaskMeta(task) {
  if (!task.subtasks?.length) return "";
  const total = task.subtasks.length;
  const done  = task.subtasks.filter((s) => s.completed).length;
  const pct   = Math.round((done / total) * 100);
  const items = task.subtasks.map((s) => `
    <li class="subtask-item ${s.completed ? "completed" : ""}">
      <input type="checkbox" class="subtask-checkbox" data-sub-id="${s.id}" ${s.completed ? "checked" : ""}/>
      <span class="subtask-text">${escapeHtml(s.text)}</span>
    </li>`).join("");
  return `
    <div class="mt-1.5"><button class="toggle-subtask-btn" type="button">▼ Subtasks</button></div>
    <div class="subtask-section">
      <div class="subtask-progress-bar"><div class="subtask-progress-fill" style="width:${pct}%"></div></div>
      <p class="text-xs text-gray-400 mb-1.5">${done} / ${total} subtasks complete</p>
      <ul>${items}</ul>
    </div>`;
}

// ─── 16. CRUD ─────────────────────────────────────────────────────────────────

async function saveTask() {
  const text = modalTaskInput.value.trim();
  if (!text) { modalFormError.classList.remove("hidden"); modalTaskInput.focus(); return; }
  modalFormError.classList.add("hidden");

  const reminderEnabled       = modalReminderEnabled.checked;
  const reminderMinutesBefore = parseInt(modalReminderOffset.value, 10) || 0;
  const deadline              = modalDeadline.value || null;
  const dueTime               = modalDueTime.value  || null;

  if (state.editingId) {
    const task = state.tasks.find((t) => t.id === state.editingId);
    if (task) {
      task.text                  = text;
      task.priority              = modalPriority.value;
      task.category              = modalCategory.value;
      task.deadline              = deadline;
      task.dueTime               = dueTime;
      task.subtasks              = [...state.modalSubtasks];
      task.reminderEnabled       = reminderEnabled;
      task.reminderMinutesBefore = reminderMinutesBefore;
      task.reminderSent          = false; // reset so edge function can re-fire
      await upsertTaskToDB(task);
    }
  } else {
    const newTask = {
      id:                    generateId(),
      text,
      completed:             false,
      createdAt:             Date.now(),
      deadline, dueTime,
      priority:              modalPriority.value,
      category:              modalCategory.value,
      subtasks:              [...state.modalSubtasks],
      reminderEnabled,
      reminderMinutesBefore,
      reminderAt:            null,
      reminderSent:          false,
    };
    state.tasks.unshift(newTask);
    await upsertTaskToDB(newTask);
  }

  closeTaskModal();
  render();
}

async function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  if (task.completed) task.reminderSent = true;  // suppress future reminders
  else if (task.reminderAt && task.reminderAt > Date.now()) task.reminderSent = false;
  await upsertTaskToDB(task);
  render();
}

async function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  await deleteTaskFromDB(id);
  render();
}

async function clearCompleted() {
  await deleteCompletedFromDB();
  state.tasks = state.tasks.filter((t) => !t.completed);
  render();
}

async function toggleSubtask(taskId, subId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const sub = task.subtasks.find((s) => s.id === subId);
  if (!sub) return;
  sub.completed = !sub.completed;
  await upsertTaskToDB(task);
  render();
}

// ─── 17. FILTERS ──────────────────────────────────────────────────────────────

function setStatusFilter(filter) {
  state.filter = filter;
  filterTabs.forEach((tab) => {
    const active = tab.dataset.filter === filter;
    tab.classList.toggle("active-tab", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  render();
}

function setCategoryFilter(category) {
  state.categoryFilter = category;
  categoryFilter.querySelectorAll(".cat-chip").forEach((chip) => {
    chip.classList.toggle("active-chip", chip.dataset.category === category);
  });
  render();
}

// ─── 18. TASK MODAL ───────────────────────────────────────────────────────────

function openTaskModal(id = null) {
  state.editingId = id;
  modalFormError.classList.add("hidden");

  if (id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    modalTitle.textContent           = "Edit Task";
    modalSaveBtn.textContent         = "Save Changes";
    modalTaskInput.value             = task.text;
    modalPriority.value              = task.priority;
    modalCategory.value              = task.category;
    modalDeadline.value              = task.deadline ?? "";
    modalDueTime.value               = task.dueTime  ?? "";
    modalReminderEnabled.checked     = task.reminderEnabled ?? false;
    modalReminderOffset.value        = String(task.reminderMinutesBefore ?? 30);
    state.modalSubtasks              = task.subtasks.map((s) => ({ ...s }));
  } else {
    modalTitle.textContent           = "New Task";
    modalSaveBtn.textContent         = "Save Task";
    modalTaskInput.value             = "";
    modalPriority.value              = "medium";
    modalCategory.value              = "Other";
    modalDeadline.value              = "";
    modalDueTime.value               = "";
    modalReminderEnabled.checked     = false;
    modalReminderOffset.value        = "30";
    state.modalSubtasks              = [];
  }

  syncReminderUI();
  renderModalSubtasks();
  taskModal.classList.remove("hidden");
  setTimeout(() => modalTaskInput.focus(), 50);
}

function closeTaskModal() {
  taskModal.classList.add("hidden");
  state.editingId     = null;
  state.modalSubtasks = [];
  modalSubList.innerHTML = "";
}

// ─── 19. REMINDER UI SYNC ─────────────────────────────────────────────────────

function syncReminderUI() {
  const enabled = modalReminderEnabled.checked;
  if (!enabled) { reminderOptions.classList.add("hidden"); return; }
  reminderOptions.classList.remove("hidden");

  const perm = ("Notification" in window) ? Notification.permission : "denied";
  reminderPermWarn.classList.toggle("hidden", perm === "granted");

  const deadline = modalDeadline.value;
  const dueTime  = modalDueTime.value;
  if (!deadline || !dueTime) {
    reminderNoDlWarn.classList.remove("hidden");
    reminderPreview.textContent = "";
    return;
  }
  reminderNoDlWarn.classList.add("hidden");

  const offset     = parseInt(modalReminderOffset.value, 10) || 0;
  const dueAt      = buildDueAt(deadline, dueTime);
  const reminderAt = buildReminderAt(dueAt, offset);
  if (reminderAt) {
    const fireDate = new Date(reminderAt);
    reminderPreview.textContent = new Date(reminderAt) <= new Date()
      ? "⚠ This reminder time is already in the past."
      : `🔔 Reminder at ${fireDate.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}, ${fireDate.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}`;
  }
}

// ─── 20. MODAL SUBTASK MANAGEMENT ────────────────────────────────────────────

function addModalSubtask() {
  const text = subtaskInput.value.trim();
  if (!text) return;
  state.modalSubtasks.push({ id: generateId(), text, completed: false });
  subtaskInput.value = "";
  renderModalSubtasks();
  subtaskInput.focus();
}

function removeModalSubtask(subId) {
  state.modalSubtasks = state.modalSubtasks.filter((s) => s.id !== subId);
  renderModalSubtasks();
}

function renderModalSubtasks() {
  modalSubList.innerHTML = "";
  state.modalSubtasks.forEach((s) => {
    const li = document.createElement("li");
    li.className = "modal-subtask-item";
    li.innerHTML = `<span>${escapeHtml(s.text)}</span>
      <button class="modal-subtask-remove" aria-label="Remove subtask">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>`;
    li.querySelector(".modal-subtask-remove").addEventListener("click", () => removeModalSubtask(s.id));
    modalSubList.appendChild(li);
  });
}

// ─── 21. DELETE MODAL ────────────────────────────────────────────────────────

function openDeleteModal(id)  { state.deletingId = id; deleteModal.classList.remove("hidden"); }
function closeDeleteModal()   { state.deletingId = null; deleteModal.classList.add("hidden"); }

// ─── 22. WEB PUSH SUBSCRIPTION ───────────────────────────────────────────────

const notificationsSupported = ("Notification" in window);

/**
 * Subscribe this device to Web Push and save the subscription to Supabase.
 * Only runs when Notification permission is "granted".
 */
async function registerPushSubscription() {
  if (!notificationsSupported || Notification.permission !== "granted") return;
  if (!swRegistration) return;
  if (!state.user) return;

  try {
    const sub = await swRegistration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });

    const json    = sub.toJSON();
    const label   = navigator.userAgent.includes("Mobile") ? "Mobile" : "Desktop";

    await db.from("push_subscriptions").upsert({
      user_id:      state.user.id,
      endpoint:     json.endpoint,
      p256dh:       json.keys.p256dh,
      auth:         json.keys.auth,
      device_label: label,
      last_used_at: new Date().toISOString(),
    }, { onConflict: "user_id,endpoint" });

  } catch (err) {
    console.warn("[Push] Subscription failed:", err.message);
  }
}

/** Convert a URL-safe base64 VAPID public key to Uint8Array. */
function urlBase64ToUint8Array(base64String) {
  const padding  = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64   = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw      = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function requestNotifPermission() {
  if (!notificationsSupported) return;
  try {
    const result = await Notification.requestPermission();
    updateNotifUI();
    if (result === "granted") {
      await registerPushSubscription();
      showSystemNotification("Notifications Enabled 🎉", "You'll now receive task reminders from Task List.", null);
    }
  } catch (err) {
    console.warn("[Notif] Permission request failed:", err);
  }
}

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
    if (swRegistration && "showNotification" in swRegistration) {
      await swRegistration.showNotification(title, options);
    } else {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch (err) { console.warn("[Notif] showNotification failed:", err); }
}

function updateNotifUI() {
  if (!notificationsSupported) {
    notifStatusBtn.innerHTML   = iconBellOff();
    notifStatusBtn.style.color = "#9ca3af";
    return;
  }
  const perm = Notification.permission;
  if (perm === "granted") {
    notifStatusBtn.innerHTML   = iconBellOn();
    notifStatusBtn.style.color = "#22c55e";
  } else if (perm === "denied") {
    notifStatusBtn.innerHTML   = iconBellOff();
    notifStatusBtn.style.color = "#ef4444";
  } else {
    notifStatusBtn.innerHTML   = iconBellSleep();
    notifStatusBtn.style.color = "#f97316";
  }

  const dismissed = sessionStorage.getItem(BANNER_DISMISS_KEY);
  if (perm !== "granted" && !dismissed) {
    notifBanner.classList.remove("hidden");
    if (perm === "denied") {
      notifBannerMsg.textContent = "Notifications are blocked. Allow them in your browser settings to receive reminders.";
      notifEnableBtn.textContent = "How to enable";
      notifEnableBtn.onclick     = () => alert("Click the lock icon in your browser's address bar and set Notifications to 'Allow'.");
    } else {
      notifBannerMsg.textContent = "Enable browser notifications to receive task reminders.";
      notifEnableBtn.textContent = "Enable Notifications";
      notifEnableBtn.onclick     = requestNotifPermission;
    }
  } else {
    notifBanner.classList.add("hidden");
  }
}

// ─── 23. LOCAL REMINDER SCHEDULER (fallback while tab is open) ────────────────
// The primary mechanism is the Edge Function + pg_cron running server-side.
// This interval is a secondary fallback for when the user has the tab open.

function checkReminders() {
  if (!notificationsSupported || Notification.permission !== "granted") return;
  const now     = Date.now();
  let   changed = false;
  const GRACE   = 2 * 60_000;

  state.tasks.forEach((task) => {
    if (!task.reminderEnabled || task.reminderSent || task.completed || !task.reminderAt) return;
    if (now >= task.reminderAt && now <= task.reminderAt + GRACE) {
      const ds = task.deadline ? `Due: ${formatDate(task.deadline)}${task.dueTime ? " at " + formatTime(task.dueTime) : ""}` : "";
      showSystemNotification(
        "Task List — Reminder",
        `Your task "${task.text}" is due soon!${ds ? " " + ds : ""}`,
        `reminder-${task.id}`
      );
      task.reminderSent = true;
      // Persist the sent flag to DB so the edge function doesn't double-fire
      upsertTaskToDB(task);
      changed = true;
    }
  });

  if (changed) render();
}

function startReminderScheduler() {
  if (reminderIntervalId) clearInterval(reminderIntervalId);
  reminderIntervalId = setInterval(checkReminders, REMINDER_CHECK_MS);
  checkReminders();
}

// ─── 24. ICON HELPERS ────────────────────────────────────────────────────────

function iconBellOn()    { return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`; }
function iconBellOff()   { return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.172 9.172a4 4 0 015.656 5.656M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-.653-2.727M15 17H9m6 0v1a3 3 0 11-6 0v-1m0 0H4l1.405-1.405A2.032 2.032 0 006 14.158V11c0-1.485.542-2.84 1.432-3.876M3 3l18 18"/></svg>`; }
function iconBellSleep() { return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/><line x1="19" y1="5" x2="21" y2="5" stroke-linecap="round"/><line x1="17" y1="3" x2="21" y2="3" stroke-linecap="round"/></svg>`; }

// ─── 25. UTILITY ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const m = { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" };
  return String(str).replace(/[&<>"']/g, (c) => m[c]);
}

function updateOnlineStatus() {
  offlineBanner.classList.toggle("hidden", navigator.onLine);
}

// ─── 26. SERVICE WORKER & PWA ─────────────────────────────────────────────────

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    swRegistration = reg;

    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateToast(nw);
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
  } catch (err) {
    console.warn("[SW] Registration failed:", err);
  }
}

function showUpdateToast(newWorker) {
  const ex = document.getElementById("sw-update-toast");
  if (ex) ex.remove();
  const t = document.createElement("div");
  t.id = "sw-update-toast";
  t.className = "sw-update-toast";
  t.innerHTML = `<span>A new version of Task List is available.</span>
    <button id="sw-reload-btn" class="sw-reload-btn">Reload</button>
    <button id="sw-toast-close" class="sw-toast-close" aria-label="Dismiss">✕</button>`;
  document.body.appendChild(t);
  document.getElementById("sw-reload-btn").addEventListener("click", () => { newWorker.postMessage({ type: "SKIP_WAITING" }); t.remove(); });
  document.getElementById("sw-toast-close").addEventListener("click", () => t.remove());
}

// ─── 27. EVENT LISTENERS ─────────────────────────────────────────────────────

// Auth
loginBtn.dataset.label    = "Sign In";
registerBtn.dataset.label = "Create Account";

tabLogin.addEventListener("click",    () => switchAuthTab("login"));
tabRegister.addEventListener("click", () => switchAuthTab("register"));
loginBtn.addEventListener("click",    handleLogin);
registerBtn.addEventListener("click", handleRegister);
forgotBtn.addEventListener("click",   handleForgotPassword);
resetSaveBtn.addEventListener("click", handleSetNewPassword);
resetPasswordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); handleSetNewPassword(); } });
resetPassword2.addEventListener("keydown",     (e) => { if (e.key === "Enter") { e.preventDefault(); handleSetNewPassword(); } });

loginEmail.addEventListener("keydown",    (e) => { if (e.key === "Enter") loginPassword.focus(); });
loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
regEmail.addEventListener("keydown",      (e) => { if (e.key === "Enter") regPassword.focus(); });
regPassword.addEventListener("keydown",   (e) => { if (e.key === "Enter") regPassword2.focus(); });
regPassword2.addEventListener("keydown",  (e) => { if (e.key === "Enter") handleRegister(); });

// Header
openAddModalBtn.addEventListener("click",  () => openTaskModal(null));
userMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  userDropdown.classList.toggle("hidden");
});
document.addEventListener("click", () => userDropdown.classList.add("hidden"));
logoutBtn.addEventListener("click", handleLogout);

notifStatusBtn.addEventListener("click", () => {
  if (!notificationsSupported) return;
  if (Notification.permission === "default") requestNotifPermission();
  else if (Notification.permission === "denied") alert("Notifications are blocked. Allow them in your browser settings.");
});
notifEnableBtn.addEventListener("click",     requestNotifPermission);
notifBannerDismiss.addEventListener("click", () => {
  sessionStorage.setItem(BANNER_DISMISS_KEY, "1");
  notifBanner.classList.add("hidden");
});

// Install
installBtn.addEventListener("click", async () => {
  if (!pwaInstallPrompt) return;
  pwaInstallPrompt.prompt();
  const { outcome } = await pwaInstallPrompt.userChoice;
  pwaInstallPrompt = null;
  installBtn.classList.add("hidden");
});

// Migration
migrationImportBtn.addEventListener("click", importLocalTasks);
migrationSkipBtn.addEventListener("click", () => {
  localStorage.setItem(MIGRATION_DONE_KEY, "1");
  hideMigrationBanner();
});

// Modal
modalSaveBtn.addEventListener("click",    saveTask);
modalCancelBtn.addEventListener("click",  closeTaskModal);
modalCloseBtn.addEventListener("click",   closeTaskModal);
taskModal.addEventListener("click",       (e) => { if (e.target === taskModal) closeTaskModal(); });
modalTaskInput.addEventListener("keydown",(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveTask(); } if (e.key === "Escape") closeTaskModal(); });
modalTaskInput.addEventListener("input",  () => { if (modalTaskInput.value.trim()) modalFormError.classList.add("hidden"); });

modalReminderEnabled.addEventListener("change", syncReminderUI);
modalReminderOffset.addEventListener("change",  syncReminderUI);
modalDeadline.addEventListener("change",        syncReminderUI);
modalDueTime.addEventListener("change",         syncReminderUI);
reminderEnableNotif.addEventListener("click",   (e) => { e.preventDefault(); requestNotifPermission().then(() => syncReminderUI()); });

subtaskAddBtn.addEventListener("click",  addModalSubtask);
subtaskInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addModalSubtask(); } });

// Delete modal
deleteConfirmBtn.addEventListener("click", () => { if (state.deletingId) deleteTask(state.deletingId); closeDeleteModal(); });
deleteCancelBtn.addEventListener("click",  closeDeleteModal);
deleteModal.addEventListener("click",      (e) => { if (e.target === deleteModal) closeDeleteModal(); });

// Filters
filterTabs.forEach((tab) => tab.addEventListener("click", () => setStatusFilter(tab.dataset.filter)));
categoryFilter.addEventListener("click", (e) => { const chip = e.target.closest(".cat-chip"); if (chip) setCategoryFilter(chip.dataset.category); });
searchInput.addEventListener("input", () => { state.searchQuery = searchInput.value.trim(); render(); });
sortSelect.addEventListener("change",  () => { state.sortMode = sortSelect.value; render(); });
clearBtn.addEventListener("click", clearCompleted);

// Keyboard
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!taskModal.classList.contains("hidden"))   closeTaskModal();
    if (!deleteModal.classList.contains("hidden")) closeDeleteModal();
  }
});

// Online/offline
window.addEventListener("online",  updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

// Visibility change — re-check notifications & reminders when tab regains focus
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateNotifUI();
    checkReminders();
  }
});

// PWA install events
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  pwaInstallPrompt = e;
  installBtn.classList.remove("hidden");
});
window.addEventListener("appinstalled", () => {
  pwaInstallPrompt = null;
  installBtn.classList.add("hidden");
});

// ─── 28. INIT ─────────────────────────────────────────────────────────────────

/**
 * Parse the URL hash that Supabase appends to redirect URLs.
 * Returns { type, access_token, ... } or null when no relevant hash is present.
 */
function parseSupabaseHash() {
  const hash = window.location.hash.slice(1);   // strip leading #
  if (!hash) return null;
  const params = Object.fromEntries(new URLSearchParams(hash));
  // Supabase recovery / email-change / email-confirm hashes carry a "type" param
  return params.type ? params : null;
}

async function init() {
  updateOnlineStatus();
  await registerServiceWorker();
  updateNotifUI();

  // ── Handle Supabase redirect hashes (password reset, email confirmation) ──
  const hashParams = parseSupabaseHash();

  if (hashParams?.type === "recovery") {
    // User arrived via a password-reset link.
    // Supabase has already exchanged the token for a session internally;
    // we just show the "set new password" form instead of the normal app.
    showResetPasswordPanel();
    // Clean up the hash immediately for security (token should not persist)
    history.replaceState(null, "", window.location.pathname);
    // The onAuthStateChange listener below will fire a SIGNED_IN event;
    // we guard against auto-opening the app by checking for the reset panel.
    db.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") showAuthOverlay();
      if (event === "TOKEN_REFRESHED" && session?.user) state.user = session.user;
      // Ignore SIGNED_IN here — the reset panel handles the final step
    });
    return;
  }

  if (hashParams?.type === "email_confirmation" || hashParams?.type === "signup") {
    // User clicked the confirmation link from a registration email.
    // Supabase sets a session; we just wait for SIGNED_IN below.
    authStatus.textContent = "Email confirmed! Signing you in…";
    authStatus.classList.remove("hidden");
    history.replaceState(null, "", window.location.pathname);
  }

  // Check if a session already exists (e.g., user refreshed the page)
  const { data: { session } } = await db.auth.getSession();

  if (session?.user) {
    await onAuthSuccess(session.user);
  }
  // If no session, auth overlay stays visible (shown by default in HTML)

  // Listen for auth state changes (login from another tab, token refresh, email confirm, etc.)
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session?.user && !state.user) {
      await onAuthSuccess(session.user);
    } else if (event === "SIGNED_OUT") {
      showAuthOverlay();
    } else if (event === "TOKEN_REFRESHED" && session?.user) {
      state.user = session.user;
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
