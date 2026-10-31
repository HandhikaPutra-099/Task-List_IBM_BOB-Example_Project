# Task List — Personal Task Manager

A **Personal Task Management PWA** built with **HTML5**, **Tailwind CSS**, and **Vanilla JavaScript**.
No frontend frameworks. Backend powered by **Supabase** (PostgreSQL, Auth, Realtime, Edge Functions).

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
| **Cross-Device Sync** | Supabase Realtime — changes propagate instantly across all devices |
| **Authentication** | Email + password auth via Supabase Auth |
| **Password Reset** | Full forgot-password → email link → set-new-password flow |
| **Email Confirmation** | Auto-login after clicking the confirmation link |
| **PWA** | Installable on Home Screen (Android, iOS, desktop) |
| **Offline Support** | Full offline access via Service Worker cache |
| **Data Migration** | One-click import of legacy LocalStorage tasks into Supabase |
| **Web Push (closed app)** | Push notifications via Supabase Edge Function + pg_cron |

---

## File Structure

```
├── index.html                          — Markup, PWA meta tags, manifest link, auth overlay
├── style.css                           — Component styles (Tailwind supplement)
├── script.js                           — All application logic (Supabase + CRUD + PWA)
├── manifest.json                       — PWA web app manifest
├── service-worker.js                   — Offline caching + push notification handler
├── vercel.json                         — Vercel static deployment configuration
├── icons/
│   ├── icon-192.png                    — App icon 192 × 192
│   └── icon-512.png                    — App icon 512 × 512
└── supabase/
    ├── schema.sql                      — Run once in the Supabase SQL Editor
    ├── config.toml                     — Supabase CLI project config
    └── functions/
        └── send-due-reminders/
            └── index.ts               — Edge Function: sends Web Push for due reminders
```

---

## Quick Start (5 steps)

### 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New Project**.
2. Choose a region close to your users.
3. Save the auto-generated **database password** somewhere safe.
4. Wait ~2 minutes for provisioning.

### 2 — Run the database schema

1. In the Supabase Dashboard → **SQL Editor** → **New query**.
2. Paste the contents of `supabase/schema.sql` and click **Run**.
3. This creates the `tasks` and `push_subscriptions` tables, all RLS policies, indexes, and triggers.

### 3 — Generate VAPID keys for Web Push

Run this once on any machine with Node.js:

```bash
npx web-push generate-vapid-keys
```

You will get two lines:

```
Public Key:  BExamplePublicKeyHere...
Private Key: ExamplePrivateKeyHere...
```

Keep the **private key** secret — it is used only in the Edge Function.
The **public key** goes into the frontend (`script.js`).

### 4 — Deploy the Edge Function

Install the Supabase CLI if you haven't already:

```bash
npm install -g supabase
```

Log in and link your project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Set the Edge Function secrets (replace with your actual values):

```bash
supabase secrets set VAPID_PUBLIC_KEY="BExamplePublicKeyHere..."
supabase secrets set VAPID_PRIVATE_KEY="ExamplePrivateKeyHere..."
supabase secrets set VAPID_SUBJECT="mailto:you@example.com"
```

Deploy:

```bash
supabase functions deploy send-due-reminders
```

### 5 — Set up pg_cron to call the Edge Function every minute

1. In the Supabase Dashboard → **SQL Editor** → **New query**.
2. Run:

```sql
-- Enable the pg_cron extension (only needed once per project)
create extension if not exists pg_cron;

-- Schedule the Edge Function to run every minute
-- Replace YOUR_PROJECT_REF and YOUR_ANON_KEY with your actual values
select cron.schedule(
  'send-due-reminders',           -- job name (must be unique)
  '* * * * *',                    -- every minute
  $$
    select net.http_post(
      url    := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-due-reminders',
      headers := '{"Authorization": "Bearer YOUR_ANON_KEY", "Content-Type": "application/json"}'::jsonb,
      body   := '{}'::jsonb
    )
  $$
);
```

> **Note:** `pg_net` (the HTTP extension used by pg_cron) is pre-installed on all Supabase projects.
> If you get an error, enable it in **Database → Extensions → pg_net**.

---

## Deployment — Vercel

### Prerequisites
- A [Vercel account](https://vercel.com) (free tier is sufficient)
- Git repository (GitHub, GitLab, or Bitbucket)

### Steps

1. Open `script.js` and set your credentials at the top of the file:

```js
const SUPABASE_URL  = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON = "YOUR_ANON_KEY";
const VAPID_PUBLIC  = "BExamplePublicKeyHere...";
```

> These three values are all **public / safe to include in frontend code**.
> Never put your `service_role` key or VAPID private key here.

2. **Push the repository** to GitHub (or any Git host).
3. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
4. **Framework Preset** → select **Other** (no build step needed).
5. **Root Directory** → leave as `/`.
6. **Build Command** → leave **empty**.
7. **Output Directory** → leave **empty**.
8. Click **Deploy**.

### What `vercel.json` does

| Rule | Purpose |
|---|---|
| `Service-Worker-Allowed: /` | Allows the SW to control the entire origin |
| `Cache-Control: no-cache` on `service-worker.js` | Always fetches the latest SW |
| `Content-Type: application/manifest+json` | Required for browsers to recognise the manifest |
| Security headers | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` on all routes |

---

## Auth Flows

### Normal sign-in / registration

1. Open the app → the auth overlay is shown.
2. **Sign In** tab: enter email + password → click **Sign In**.
3. **Create Account** tab: fill in email + password + confirm → click **Create Account**.
   - If Supabase requires email confirmation, a message is shown.
   - When the user clicks the confirmation link in their inbox, the browser opens the app, detects the confirmation hash, and auto-signs the user in.

### Password reset

1. On the Sign In panel click **Forgot password?**.
2. Enter the registered email → a reset link is emailed.
3. Clicking the link opens the app; the app detects `#type=recovery` in the URL hash and shows the **Set New Password** form.
4. The user enters and confirms a new password → clicking **Set New Password** calls `supabase.auth.updateUser()` and immediately signs the user in and opens the app.
5. The recovery hash is removed from the URL (`history.replaceState`) so a page refresh does not re-trigger the form.

---

## Supabase Realtime Sync

After login, `script.js` opens a Supabase Realtime channel filtered to the current user's tasks. Any INSERT / UPDATE / DELETE that occurs on another device is reflected in the UI without a page refresh.

Each write is echoed back by the Realtime channel; the code guards against applying its own writes twice by checking whether the task ID is already present in `state.tasks` before inserting.

---

## Web Push Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ pg_cron (every minute)                                               │
│   → HTTP POST to Edge Function /send-due-reminders                  │
│       → query tasks WHERE reminder_at <= now AND reminder_sent_at IS NULL │
│       → for each task: fetch push_subscriptions for that user        │
│           → send Web Push message via VAPID                          │
│           → set reminder_sent_at = now()                             │
│       → remove stale subscriptions (410 Gone)                        │
└──────────────────────────────────────────────────────────────────────┘
         ▼  Web Push message
┌─────────────────────────┐
│ Push Service (FCM / etc)│
└────────────┬────────────┘
             ▼ push event
┌─────────────────────────┐
│ service-worker.js       │
│ self.registration       │
│   .showNotification()   │
└─────────────────────────┘
             ▼ visible notification
       User's device 📱
```

**While the tab is open:** A `setInterval` in `script.js` checks every 30 seconds and fires local notifications as a fallback.

**While the app is closed:** pg_cron triggers the Edge Function, which sends a Web Push message that wakes the Service Worker.

---

## PWA Installation

### Android (Chrome / Edge)
1. Open the deployed URL in Chrome or Edge.
2. Tap the **Install App** button in the header, or use the browser menu → "Add to Home Screen".

### iOS (Safari)
1. Open the deployed URL in Safari.
2. Tap the **Share** button → "Add to Home Screen".

> **Note:** On iOS, notifications require iOS 16.4+ with Safari PWA mode.
> The `beforeinstallprompt` event is not supported on iOS.

### Desktop (Chrome / Edge)
1. Click the install icon in the address bar, or the **Install App** button.

---

## Offline Support

The Service Worker uses two strategies:

| Strategy | Applied To |
|---|---|
| **Cache-First** | Shell assets: `index.html`, `style.css`, `script.js`, `manifest.json`, icons |
| **Network-First** | All other requests (external fonts, CDN scripts) |

After the first load, the app works fully offline. Data is read from the in-memory `state.tasks` array (populated on login). Writes queue to Supabase and sync when connectivity is restored through Realtime.

---

## LocalStorage → Supabase Migration

If the user had tasks saved in LocalStorage from before they created an account:

1. After the first login on that device, a **migration banner** appears.
2. Clicking **Import Tasks** bulk-upserts all LocalStorage tasks into Supabase (old fields receive safe defaults).
3. The flag `tasklist_migration_done` is written to LocalStorage to prevent re-prompting.
4. LocalStorage data is **never deleted automatically** — users can clear it manually once satisfied.

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

Supabase DB columns map via `rowToTask()` / `taskToRow()` in `script.js`.

---

## Security Notes

| Concern | Mitigation |
|---|---|
| ANON key exposed in frontend | Intended — it is a **public** key. RLS on all tables ensures users can only read/write their own data. |
| Service role key | Never exposed — used only in Edge Functions via environment secrets. |
| VAPID private key | Never exposed — stored as a Supabase secret, used only in the Edge Function. |
| Recovery hash in URL | Stripped immediately with `history.replaceState` after the reset form loads. |
| XSS | All user-supplied content rendered via `escapeHtml()` before being set as `innerHTML`. |

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
| Auth | Supabase Auth (email + password) |
| Database | Supabase PostgreSQL (with RLS) |
| Realtime | Supabase Realtime (`postgres_changes`) |
| Push Notifications | Web Push API + VAPID + Supabase Edge Functions |
| Scheduling | Supabase pg_cron (every minute) |
| PWA | Web App Manifest + Service Worker API |
| Deployment | Vercel (static, HTTPS, global CDN) |
