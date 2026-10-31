// ============================================================
// supabase/functions/send-due-reminders/index.ts
// Supabase Edge Function — triggered by pg_cron every minute.
//
// Responsibilities:
//  1. Query tasks where reminder is due (reminder_at <= now, not yet sent,
//     task not completed).
//  2. For each task, fetch all push subscriptions belonging to that user.
//  3. Send a Web Push notification to each subscription using VAPID.
//  4. Mark reminder_sent_at on the task.
//  5. Remove expired / invalid push subscriptions (410 Gone).
//  6. Never send duplicate reminders (idempotent via reminder_sent_at).
//
// Environment variables required (set in Supabase Dashboard → Settings → Edge Functions):
//   SUPABASE_URL           — your project URL (auto-injected by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY — service role key (auto-injected)
//   VAPID_SUBJECT          — mailto:you@example.com or https://yourdomain.com
//   VAPID_PUBLIC_KEY       — base64url-encoded VAPID public key
//   VAPID_PRIVATE_KEY      — base64url-encoded VAPID private key  ← NEVER put in frontend
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

// ─── Supabase admin client (bypasses RLS) ─────────────────────────────────────
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

// ─── VAPID configuration ──────────────────────────────────────────────────────
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Only accept POST from Supabase Cron (or internal calls)
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Optional: verify a shared secret to reject unauthorized callers
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const now = new Date().toISOString();
  const stats = { checked: 0, sent: 0, skipped: 0, errors: 0, removed: 0 };

  try {
    // ── 1. Find all tasks with a due reminder ────────────────────────────────
    const { data: dueTasks, error: queryError } = await supabase
      .from("tasks")
      .select("id, user_id, title, due_at, reminder_at")
      .eq("completed", false)
      .eq("reminder_enabled", true)
      .lte("reminder_at", now)          // reminder_at <= now
      .is("reminder_sent_at", null)     // not yet sent
      .limit(100);                      // safety cap per invocation

    if (queryError) throw queryError;
    if (!dueTasks || dueTasks.length === 0) {
      return jsonResponse({ ok: true, message: "No reminders due.", stats });
    }

    stats.checked = dueTasks.length;

    // ── 2. Group by user_id to batch-fetch push subscriptions ────────────────
    const userIds = [...new Set(dueTasks.map((t: any) => t.user_id))];

    const { data: allSubs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds);

    if (subsError) throw subsError;

    // Build a map: user_id → [subscription, ...]
    const subsByUser: Record<string, any[]> = {};
    for (const sub of (allSubs ?? [])) {
      if (!subsByUser[sub.user_id]) subsByUser[sub.user_id] = [];
      subsByUser[sub.user_id].push(sub);
    }

    // ── 3. Send push notifications ──────────────────────────────────────────
    const staleSubIds: string[] = [];          // 410 Gone subs to remove
    const sentTaskIds: string[] = [];          // successfully notified tasks

    for (const task of dueTasks) {
      const subs = subsByUser[task.user_id] ?? [];

      if (subs.length === 0) {
        // No subscription for this user — still mark as sent to avoid retry spam
        sentTaskIds.push(task.id);
        stats.skipped++;
        continue;
      }

      const dueLabel = task.due_at
        ? `Due: ${new Date(task.due_at).toLocaleString("en-US", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}`
        : "";

      const payload = JSON.stringify({
        title: "Task List — Reminder",
        body:  `Your task "${task.title}" is due soon!${dueLabel ? " " + dueLabel : ""}`,
        tag:   `reminder-${task.id}`,
        url:   "/",
        taskId: task.id,
      });

      let atLeastOneSent = false;

      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 3600 }  // deliver within 1 hour or discard
          );
          atLeastOneSent = true;
          stats.sent++;

          // Update last_used_at (non-critical — ignore errors)
          supabase
            .from("push_subscriptions")
            .update({ last_used_at: now })
            .eq("id", sub.id)
            .then(() => {});

        } catch (err: any) {
          // HTTP 410 Gone: subscription is no longer valid
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            staleSubIds.push(sub.id);
            stats.removed++;
          } else {
            console.error(`[send-due-reminders] Push failed for sub ${sub.id}:`, err?.message);
            stats.errors++;
          }
        }
      }

      if (atLeastOneSent || subs.every((s: any) => staleSubIds.includes(s.id))) {
        sentTaskIds.push(task.id);
      }
    }

    // ── 4. Mark tasks as reminder sent ────────────────────────────────────────
    if (sentTaskIds.length > 0) {
      const { error: updateError } = await supabase
        .from("tasks")
        .update({ reminder_sent_at: now })
        .in("id", sentTaskIds);

      if (updateError) {
        console.error("[send-due-reminders] Failed to mark reminder_sent_at:", updateError.message);
      }
    }

    // ── 5. Remove stale push subscriptions ───────────────────────────────────
    if (staleSubIds.length > 0) {
      const { error: delError } = await supabase
        .from("push_subscriptions")
        .delete()
        .in("id", staleSubIds);

      if (delError) {
        console.error("[send-due-reminders] Failed to remove stale subs:", delError.message);
      }
    }

    return jsonResponse({ ok: true, stats });

  } catch (err: any) {
    console.error("[send-due-reminders] Fatal error:", err?.message);
    return jsonResponse({ ok: false, error: err?.message ?? "Unknown error" }, 500);
  }
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
