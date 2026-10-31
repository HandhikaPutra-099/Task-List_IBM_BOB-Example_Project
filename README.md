# Task List — Personal Task Manager

A fully client-side **Personal Task Management** PWA built with **HTML5**, **Tailwind CSS**, and **Vanilla JavaScript**.
No frameworks, no build tools, no backend required for core functionality.

---

## Live Demo

Deploy to Vercel in one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## Features

| Feature | Description |
|---|---|
| **CRUD Tasks** | Create, read, update, delete via modal form |
| **Due Date & Time** | Assign a specific deadline date + time to any task |
| **Priority** | High / Medium / Low with coloured badges |
| **Category** | College / Personal / Work / Project / Organization / Other |
| **Search & Sort** | Live search; 6 sort modes including by deadline and priority |
| **Status Filter** | All / Active / Completed tabs with live counts |
| **Subtasks** | Add, edit, delete, toggle subtasks; progress bar per task |
| **Dashboard** | Total, Completed, Pending, Overdue, Due Today stats + progress bar |
| **Task Reminders** | Browser notification at configurable offset before deadline |
| **PWA** | Installable on Home Screen (Android, iOS, desktop) |
| **Offline Support** | Full offline access via Service Worker cache |
| **LocalStorage** | All data persisted locally; survives page refresh |
| **Data Migration** | Old tasks automatically upgraded to new schema |

---

## File Structure

```
├── index.html          — Markup, PWA meta tags, manifest link
├── style.css           — Component styles (Tailwind supplement)
├── script.js           — All application logic
├── manifest.json       — PWA web app manifest
├── service-worker.js   — Offline caching + push notification handler
├── vercel.json         — Vercel static deployment configuration
└── icons/
    ├── icon-192.png    — App icon 192 × 192
    └── icon-512.png    — App icon 512 × 512
```

---

## Deployment — Vercel

### Prerequisites
- A [Vercel account](https://vercel.com) (free tier is sufficient)
- Git repository (GitHub, GitLab, or Bitbucket)

### Steps

1. **Push the repository** to GitHub (or any Git host).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. **Framework Preset** → select **Other** (no build step needed).
4. **Root Directory** → leave as `/` (all files are at the root).
5. **Build Command** → leave **empty**.
6. **Output Directory** → leave **empty** (Vercel serves static files from root).
7. Click **Deploy**.

Vercel automatically provides HTTPS, which is required for:
- Service Worker registration
- Web Notifications API
- PWA installation
- Push API (future)

### What `vercel.json` does

| Rule | Purpose |
|---|---|
| `Service-Worker-Allowed: /` | Allows the SW to control the entire origin, not just the subfolder |
| `Cache-Control: no-cache` on `service-worker.js` | Ensures the browser always fetches the latest SW, preventing stale SW bugs |
| `Content-Type: application/manifest+json` | Required for browsers to recognise the manifest |
| Security headers | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` on all routes |

### Vercel + PWA Checklist

- [x] HTTPS served automatically
- [x] `manifest.json` accessible at `/manifest.json`
- [x] `service-worker.js` accessible at `/service-worker.js`
- [x] SW scope set to `/` via `Service-Worker-Allowed` header
- [x] Icons served from `/icons/`
- [x] All internal paths are root-relative (`/` not `./`)
- [x] `cleanUrls: true` — `/index` resolves to `/index.html`

---

## PWA Installation

### Android (Chrome / Edge)
1. Open the deployed URL in Chrome or Edge.
2. Tap the **Install App** button in the header, or use the browser menu → "Add to Home Screen".
3. The app opens in standalone mode (no browser chrome).

### iOS (Safari)
1. Open the deployed URL in Safari.
2. Tap the **Share** button → "Add to Home Screen".
3. Confirm the name and tap **Add**.

> **Note:** On iOS, notifications require iOS 16.4+ with Safari PWA mode.
> The `beforeinstallprompt` event is not supported on iOS — only the manual Share → Add flow works.

### Desktop (Chrome / Edge)
1. Click the install icon in the address bar, or use the **Install App** button.

---

## Offline Support

The Service Worker uses two strategies:

| Strategy | Applied To |
|---|---|
| **Cache-First** | Shell assets: `index.html`, `style.css`, `script.js`, `manifest.json`, icons |
| **Network-First** | All other requests (external fonts, CDN scripts) |

After the first load, the app works fully offline. LocalStorage data is unaffected by the network state.

**Important:** Each device has its own independent LocalStorage.
Tasks created on a laptop are **not visible** on a smartphone until a backend sync layer is added (see below).

---

## Reminder Notifications

### While the App is Open (Tab Active or Backgrounded)
Reminders fire via `ServiceWorkerRegistration.showNotification()` checked every 30 seconds by a `setInterval` in `script.js`. The `reminderSent` flag on each task prevents duplicate notifications.

### While the App is Closed — Web Push Architecture

To deliver notifications when the browser is closed, a **Web Push backend** is required. This is **not included** in the current frontend-only deployment, but the Service Worker is already wired to receive push messages.

#### Required Components

```
┌─────────────────────┐         VAPID keys          ┌──────────────────────┐
│   Task List (PWA)   │ ──── subscribe ────────────► │   Push Service       │
│  (browser / device) │                              │ (FCM / Mozilla, etc) │
└─────────────────────┘                              └──────────┬───────────┘
         ▲                                                       │ push message
         │  notification                                         ▼
         └───────────────────────────── ◄ ────────── ┌──────────────────────┐
                                                      │   Your Backend       │
                                                      │  (Node / Python etc) │
                                                      │  - Stores subscriptions│
                                                      │  - Schedules reminders│
                                                      │  - Sends push at time │
                                                      └──────────────────────┘
```

#### Implementation Steps (future)

1. **Generate VAPID keys** — `npx web-push generate-vapid-keys`
2. **Backend** (Node.js example):
   - `POST /api/subscribe` — store `PushSubscription` objects per user/device
   - `POST /api/tasks` — store task + reminder timestamp
   - Scheduler (e.g. BullMQ, node-schedule) sends push at `reminderAt` using `web-push` library
3. **Frontend** — call `swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })` and POST the subscription to the backend
4. **Service Worker** already handles the `push` event and calls `self.registration.showNotification()`

> **Do NOT use Vercel Cron (Hobby tier, 1/day)** for minute-precision reminders.
> Use a dedicated job queue (BullMQ + Redis) or a cron service (Railway, Render, Fly.io) that can schedule jobs at arbitrary timestamps.

---

## Cross-Device Data Synchronization

LocalStorage is **per-device, per-browser**. Data created on one device is not visible on another.

To synchronize data across devices:

| Layer | Requirement |
|---|---|
| **Auth** | User accounts (JWT / OAuth) to identify the same user across devices |
| **API** | REST or GraphQL backend to read/write tasks |
| **Database** | PostgreSQL / MongoDB to store tasks per user |
| **Sync** | Replace `saveTasks()` / `loadTasks()` calls with API calls; use LocalStorage as offline cache |
| **Conflict resolution** | Last-write-wins by `updatedAt` timestamp, or CRDT for concurrent edits |

The current data model already has `createdAt` on every task, which serves as a foundation for merge logic.

---

## Data Model (v3)

```json
{
  "id":                    "1735600000000-42391",
  "text":                  "Write project report",
  "completed":             false,
  "createdAt":             1735600000000,
  "deadline":              "2025-11-15",
  "dueTime":               "23:59",
  "priority":              "high",
  "category":              "College",
  "subtasks": [
    { "id": "...", "text": "Gather references", "completed": true },
    { "id": "...", "text": "Write introduction", "completed": false }
  ],
  "reminderEnabled":       true,
  "reminderMinutesBefore": 30,
  "reminderAt":            1731801540000,
  "reminderSent":          false
}
```

Old tasks missing any field are automatically upgraded with defaults on load — no data is deleted.

---

## Browser Compatibility

| Browser | PWA Install | Notifications | Service Worker | Offline |
|---|---|---|---|---|
| Chrome Android | ✅ | ✅ | ✅ | ✅ |
| Edge Android | ✅ | ✅ | ✅ | ✅ |
| Safari iOS 16.4+ | ✅ (manual) | ✅ (PWA only) | ✅ | ✅ |
| Chrome Desktop | ✅ | ✅ | ✅ | ✅ |
| Firefox Desktop | ❌ (no install) | ✅ | ✅ | ✅ |
| Safari macOS | ✅ | ✅ | ✅ | ✅ |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 (semantic elements) |
| Styling | Tailwind CSS v3 (CDN) + custom CSS3 |
| Logic | Vanilla JavaScript (ES2020, strict mode) |
| Storage | Web LocalStorage API |
| PWA | Web App Manifest + Service Worker API |
| Notifications | Web Notifications API + SW `showNotification()` |
| Deployment | Vercel (static, HTTPS, global CDN) |
