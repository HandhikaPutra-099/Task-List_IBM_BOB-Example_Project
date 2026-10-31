# Task List — Personal Task Manager

A fully client-side **Personal Task Management** application built with **HTML5**, **Tailwind CSS**, and **Vanilla JavaScript** — no frameworks, no backend, no build tools required.

---

## Features

### ✅ Task CRUD
- Create, read, update, and delete tasks via a unified modal form.
- Tasks are persisted to **LocalStorage** and survive page refreshes.

### 📅 Due Dates (Deadline)
- Optionally assign a deadline to any task.
- Deadline badges are auto-calculated on every render:
  | Status | Condition |
  |---|---|
  | **Overdue** | Deadline has passed and task is not completed |
  | **Due Today** | Deadline is today and task is not completed |
  | **Upcoming** | Deadline is in the future |
  | **No Deadline** | No date assigned |
  | **Completed** | Task has been marked as done |

### 🏷️ Priority
- Three levels: **High** (🔴), **Medium** (🟡), **Low** (🟢).
- Default: **Medium**.
- Displayed as a coloured pill badge on every task card.

### 📂 Category
- Six categories: **College**, **Personal**, **Work**, **Project**, **Organization**, **Other**.
- Default: **Other**.
- Filter tasks by category via the chip bar above the task list.

### 🔍 Search & Sort
**Search:** Live search by task name — results update as you type.

**Sort options:**
- Newest First / Oldest First
- Nearest Deadline / Farthest Deadline (tasks without a deadline appear last)
- Highest Priority / Lowest Priority

Search and sort work together with the status filter and category filter simultaneously — the original data is never mutated.

### 📊 Dashboard
Five stat cards updated automatically on every data change:
- **Total Tasks** — all tasks
- **Completed** — tasks marked done
- **Pending** — tasks not yet completed
- **Overdue** — incomplete tasks past their deadline
- **Due Today** — incomplete tasks due today

A **progress bar** shows the overall completion percentage.

### ✔️ Subtasks
- Add, remove, and toggle completion of subtasks within any task.
- Each subtask has its own checkbox and can be toggled directly from the task card.
- A mini **progress bar** on the task card shows `done / total` subtasks.
- The subtask list is collapsible to keep the UI tidy.
- Main task completion is managed independently from subtask completion.

### 🗂️ Status Filter
Tab-based filter for **All / Active / Completed** — each tab shows its live count.

---

## File Structure

```
├── index.html   — Semantic HTML markup, Tailwind CDN, component structure
├── style.css    — Custom CSS components (badges, chips, cards, modal, subtasks)
└── script.js    — Full application logic (state, CRUD, filters, render, migration)
```

---

## Data Model

Each task is stored as a JSON object:

```json
{
  "id":        "1735600000000-42391",
  "text":      "Write project report",
  "completed": false,
  "createdAt": 1735600000000,
  "deadline":  "2025-11-15",
  "priority":  "high",
  "category":  "College",
  "subtasks": [
    { "id": "...", "text": "Gather references", "completed": true },
    { "id": "...", "text": "Write introduction", "completed": false }
  ]
}
```

### Data Migration
Old tasks stored in LocalStorage (before v2) are automatically upgraded on load — any missing fields receive their default values. **No existing data is deleted.**

---

## Getting Started

1. Clone or download the repository.
2. Open `index.html` in any modern browser.
3. No install, no build step needed.

---

## Browser Compatibility

Works in all modern browsers that support ES2020+ and CSS custom properties (Chrome 80+, Firefox 75+, Safari 13.1+, Edge 80+).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 (semantic elements) |
| Styling | Tailwind CSS v3 (CDN) + custom CSS3 |
| Logic | Vanilla JavaScript (ES2020, strict mode) |
| Storage | Web LocalStorage API |
