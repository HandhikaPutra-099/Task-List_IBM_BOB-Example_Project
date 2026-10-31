/* ============================================================
   service-worker.js — Task List PWA
   Strategy: Cache-First for shell assets, Network-First for
             everything else, with graceful offline fallback.

   Versioning: bump CACHE_VERSION to force a fresh cache on deploy.
   ============================================================ */

"use strict";

const CACHE_VERSION = "tasklist-v1";
const CACHE_NAME    = `${CACHE_VERSION}-shell`;

/**
 * Files that form the application shell — always cached on install.
 * Use root-relative paths so they resolve correctly on any origin
 * (Vercel deployment, GitHub Pages, custom domain, localhost).
 */
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ─── INSTALL ───────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache what we can; don't fail install if a single asset is missing
      return Promise.allSettled(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch(() =>
            console.warn(`[SW] Could not cache: ${url}`)
          )
        )
      );
    })
  );
  // Activate immediately without waiting for old clients to close
  self.skipWaiting();
});

// ─── ACTIVATE ──────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log(`[SW] Deleting old cache: ${key}`);
            return caches.delete(key);
          })
      )
    )
  );
  // Take control of all open clients immediately
  self.clients.claim();
});

// ─── FETCH — Cache-First for shell, Network-First for everything else ──────────

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests from our own origin
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Treat the bare root "/" the same as "/index.html"
  const pathname       = url.pathname === "/" ? "/index.html" : url.pathname;
  const isShellAsset   = SHELL_ASSETS.some((asset) => {
    const normalized = asset === "/" ? "/index.html" : asset;
    return pathname === normalized || pathname.endsWith(normalized);
  });

  if (isShellAsset) {
    // Cache-First: serve from cache, update in background
    event.respondWith(cacheFirst(request));
  } else {
    // Network-First: try network, fall back to cache
    event.respondWith(networkFirst(request));
  }
});

/**
 * Cache-First strategy.
 * Returns the cached response if available; fetches and caches on miss.
 * Falls back to the root shell on network failure.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Serve the cached shell as the offline fallback
    return (
      (await caches.match("/index.html")) ??
      (await caches.match("/")) ??
      new Response("Offline — open Task List while connected first.", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      })
    );
  }
}

/**
 * Network-First strategy.
 * Tries the network first; falls back to cache, then offline shell.
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    return (
      cached ??
      (await caches.match("/index.html")) ??
      (await caches.match("/")) ??
      new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

// ─── NOTIFICATION CLICK ────────────────────────────────────────────────────────

/**
 * When a notification is clicked, focus an existing client tab or open a new one.
 * The notification data.url field (if present) navigates to a specific page.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Build an absolute URL so openWindow works correctly on any origin
  const rawUrl    = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : "/";
  const targetUrl = rawUrl.startsWith("http")
    ? rawUrl
    : new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus an already-open tab at the same origin
        for (const client of clients) {
          const clientOrigin = new URL(client.url).origin;
          if (clientOrigin === self.location.origin && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// ─── PUSH EVENT (Web Push) ─────────────────────────────────────────────────────

/**
 * Handle incoming push messages from a server (requires VAPID + backend).
 * Payload should be JSON: { title, body, tag, url }
 */
self.addEventListener("push", (event) => {
  let data = { title: "Task List — Reminder", body: "You have a task due soon!" };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body:               data.body,
    tag:                data.tag    ?? "tasklist-reminder",
    icon:               "/icons/icon-192.png",
    badge:              "/icons/icon-192.png",
    requireInteraction: false,
    data:               { url: data.url ?? "/" },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ─── MESSAGE — SW update communication ─────────────────────────────────────────

/**
 * The main page can send { type: "SKIP_WAITING" } to force the new SW to activate.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
