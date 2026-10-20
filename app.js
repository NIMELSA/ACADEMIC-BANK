/* =========================================================
   NIMELSA KDU Chapter — Academic Bank
   Vanilla JS, no build step. Talks directly to Supabase.
   No accounts: anyone can browse and submit; moderators
   manage submissions from the #admin panel.
   ========================================================= */

// ---------- CONFIG ----------
// Public project URL + publishable key. Safe in client-side code: they only
// allow what your Row Level Security policies permit. Never put a
// service_role / secret key here.
const SUPABASE_URL = "https://ukoaeqhgfztzggqtfvtp.supabase.co";
const SUPABASE_KEY = "sb_publishable_du_mWP5gY2H6maDdkOkHSQ_or01k3Ew";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- CONSTANTS ----------
const LEVELS = ["100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "Postgraduate"];
// Must match the resources.resource_type CHECK constraint exactly.
const RESOURCE_TYPES = ["Lecture Notes", "Handout", "Past Questions", "Practical", "Textbook", "Study Guide", "Diagram", "Other"];
const BUCKET = "resources";
const MAX_FILE_BYTES = 524288000; // 500 MB, matches DB check
const UPLOAD_PREFIX = "public-submissions"; // matches the storage policy
const PAGE_SIZE = 24;
const CACHE_TTL_MS = 60 * 1000;
const MODERATOR_ROLES = ["admin", "super_admin", "moderator"];

// ---------- STATE ----------
const filters = { level: "", type: "", q: "" };
let searchDebounce = null;
let loadSeq = 0;            // ignores stale responses when filters change quickly
let page = 0;               // current page for "Load more"
let totalCount = 0;
let isLoading = false;
const pageCache = new Map(); // cacheKey -> { at, data, count }

// ---------- TINY HELPERS ----------
const $ = (id) => document.getElementById(id);
const on = (el, evt, fn, opts) => { if (el) el.addEventListener(evt, fn, opts); };

// =========================================================
// INTRO SEQUENCE
// =========================================================
(function initIntro() {
  const intro = $("intro");
  if (!intro) return;
  const ball = intro.querySelector(".intro-ball");
  const skipBtn = $("introSkip");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    document.body.style.overflow = "";
    intro.classList.add("is-done");
  }

  if (reduceMotion || !ball) {
    finish();
    return;
  }

  document.body.style.overflow = "hidden";

  ball.addEventListener("animationend", () => {
    intro.classList.add("is-open");
    playZipSound();
    setTimeout(finish, 950);
  }, { once: true });

  on(skipBtn, "click", () => {
    intro.classList.add("is-open");
    finish();
  });

  // Safety nets in case animationend never fires
  setTimeout(() => {
    if (!intro.classList.contains("is-open")) { intro.classList.add("is-open"); playZipSound(); }
  }, 2200);
  setTimeout(finish, 3200);
})();

// Synthesized "zzzip" sound — no audio file to host or 404.
function playZipSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    const duration = 0.6;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 8;
    filter.frequency.setValueAtTime(700, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(4200, ctx.currentTime + duration * 0.92);

    const tremolo = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 46;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(tremolo.gain);
    tremolo.gain.value = 0.5;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.04);
    env.gain.setValueAtTime(1, ctx.currentTime + duration * 0.75);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    noise.connect(filter);
    filter.connect(tremolo);
    tremolo.connect(env);
    env.connect(master);

    lfo.start();
    noise.start();
    lfo.stop(ctx.currentTime + duration + 0.05);
    noise.stop(ctx.currentTime + duration + 0.05);

    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(160, ctx.currentTime + duration * 0.85);
    thump.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + duration + 0.15);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, ctx.currentTime + duration * 0.85);
    thumpGain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + duration * 0.9);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration + 0.25);
    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(ctx.currentTime + duration * 0.85);
    thump.stop(ctx.currentTime + duration + 0.3);

    setTimeout(() => ctx.close(), (duration + 0.5) * 1000);
  } catch (e) {
    // Audio is a nice-to-have; never let it break the page.
  }
}

// =========================================================
// UTILITIES
// =========================================================
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024, i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return val.toFixed(val < 10 ? 1 : 0) + " " + units[i];
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const table = [[31536000, "y"], [2592000, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [secs, label] of table) {
    if (diff >= secs) return Math.floor(diff / secs) + label + " ago";
  }
  return "just now";
}

let toastTimer = null;
function toast(message, kind) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast is-visible" + (kind ? " is-" + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove("is-visible"); }, 4200);
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]+/g, "-").slice(-140);
}

// Strip characters that would break a PostgREST .or() filter or act as wildcards.
function cleanSearchTerm(q) {
  return q.replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim();
}

// Inject the few styles this script needs so no CSS edits are required.
(function injectStyles() {
  const css = `
    .skeleton-card{border-radius:16px;padding:20px;min-height:190px;display:flex;flex-direction:column;gap:12px;
      background:rgba(128,128,128,.10);border:1px solid rgba(128,128,128,.14)}
    .skeleton-card i{display:block;height:12px;border-radius:6px;background:rgba(128,128,128,.22);animation:sk-pulse 1.2s ease-in-out infinite}
    .skeleton-card i:nth-child(1){width:40%}.skeleton-card i:nth-child(2){width:85%;height:16px}
    .skeleton-card i:nth-child(3){width:60%}.skeleton-card i:nth-child(4){width:90%;margin-top:auto}
    @keyframes sk-pulse{0%,100%{opacity:.55}50%{opacity:1}}
    @media (prefers-reduced-motion: reduce){.skeleton-card i{animation:none}}
    .load-more-wrap{display:flex;justify-content:center;padding:24px 0}
    .load-more-wrap[hidden]{display:none}
    .upload-progress{height:6px;border-radius:999px;background:rgba(128,128,128,.25);overflow:hidden;margin-top:10px}
    .upload-progress>span{display:block;height:100%;width:0;background:currentColor;transition:width .15s linear}
    .card-enter{animation:card-in .25s ease both}
    @keyframes card-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    @media (prefers-reduced-motion: reduce){.card-enter{animation:none}}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();

// =========================================================
// NAVIGATION
// =========================================================
const mobileNav = $("mobileNav");
const mobileToggle = $("mobileToggle");

document.querySelectorAll("[data-nav]").forEach((el) => {
  on(el, "click", () => {
    const target = el.getAttribute("data-nav");
    if (mobileNav) mobileNav.classList.remove("is-open");
    if (target === "home") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    const section = $(target);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

on(mobileToggle, "click", (e) => {
  e.stopPropagation();
  if (mobileNav) mobileNav.classList.toggle("is-open");
});
// Close the mobile menu on outside tap or Escape
on(document, "click", (e) => {
  if (mobileNav && mobileNav.classList.contains("is-open") && !mobileNav.contains(e.target)) {
    mobileNav.classList.remove("is-open");
  }
});
on(document, "keydown", (e) => {
  if (e.key === "Escape" && mobileNav) mobileNav.classList.remove("is-open");
});

// =========================================================
// FILTER / SEARCH CONTROLS
// =========================================================
function buildFilterPills() {
  const levelGroup = $("levelFilters");
  const typeGroup = $("typeFilters");
  const frag1 = document.createDocumentFragment();
  const frag2 = document.createDocumentFragment();

  LEVELS.forEach((lvl) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "pill"; btn.dataset.value = lvl; btn.textContent = lvl;
    frag1.appendChild(btn);
  });
  RESOURCE_TYPES.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "pill"; btn.dataset.value = t; btn.textContent = t;
    frag2.appendChild(btn);
  });
  if (levelGroup) levelGroup.appendChild(frag1);
  if (typeGroup) typeGroup.appendChild(frag2);

  document.querySelectorAll(".filter-group").forEach((group) => {
    on(group, "click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      const key = group.dataset.filter === "level" ? "level" : "type";
      if (filters[key] === btn.dataset.value) return; // no-op: already selected

      // Instant visual feedback before the network responds
      group.querySelectorAll(".pill").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      filters[key] = btn.dataset.value;
      loadResources({ reset: true });
    });
  });
}

function populateFormSelects() {
  const levelSel = $("f_level");
  const typeSel = $("f_resource_type");
  if (levelSel) levelSel.innerHTML = '<option value="" disabled selected>Choose a level</option>' + LEVELS.map((l) => `<option value="${l}">${l}</option>`).join("");
  if (typeSel) typeSel.innerHTML = '<option value="" disabled selected>Choose a type</option>' + RESOURCE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
}

const heroSearch = $("heroSearch");
const heroSearchInput = $("heroSearchInput");

on(heroSearch, "submit", (e) => {
  e.preventDefault();
  clearTimeout(searchDebounce);
  filters.q = cleanSearchTerm(heroSearchInput.value);
  const browse = $("browse");
  if (browse) browse.scrollIntoView({ behavior: "smooth" });
  loadResources({ reset: true });
  heroSearchInput.blur(); // closes the on-screen keyboard on phones
});

on(heroSearchInput, "input", (e) => {
  clearTimeout(searchDebounce);
  const val = cleanSearchTerm(e.target.value);
  searchDebounce = setTimeout(() => {
    if (val === filters.q) return; // nothing changed, skip the request
    filters.q = val;
    loadResources({ reset: true });
  }, 300);
});

// =========================================================
// LOAD + RENDER RESOURCES
// =========================================================
const grid = $("resourceGrid");
const meta = $("resultsMeta");
const emptyState = $("emptyState");

// "Load more" button, created once and placed under the grid
const loadMoreWrap = document.createElement("div");
loadMoreWrap.className = "load-more-wrap";
loadMoreWrap.hidden = true;
const loadMoreBtn = document.createElement("button");
loadMoreBtn.type = "button";
loadMoreBtn.className = "btn btn-ghost";
loadMoreBtn.textContent = "Load more";
loadMoreWrap.appendChild(loadMoreBtn);
if (grid && grid.parentNode) grid.parentNode.insertBefore(loadMoreWrap, grid.nextSibling);
on(loadMoreBtn, "click", () => loadResources({ reset: false }));

function showSkeletons(count = 6) {
  if (!grid) return;
  grid.innerHTML = Array.from({ length: count }, () =>
    '<div class="skeleton-card" aria-hidden="true"><i></i><i></i><i></i><i></i></div>').join("");
  grid.setAttribute("aria-busy", "true");
}

function cacheKey(pageIndex) {
  return [filters.level, filters.type, filters.q, pageIndex].join("|");
}

async function fetchPage(pageIndex) {
  const key = cacheKey(pageIndex);
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const from = pageIndex * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = sb.from("resources")
    .select("*", { count: "exact" })
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.level) query = query.eq("level", filters.level);
  if (filters.type) query = query.eq("resource_type", filters.type);
  if (filters.q) {
    const q = filters.q;
    query = query.or(`title.ilike.%${q}%,course_name.ilike.%${q}%,course_code.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const result = { at: Date.now(), data: data || [], count: count ?? 0 };
  pageCache.set(key, result);
  return result;
}

async function loadResources({ reset = true } = {}) {
  if (!grid) return;
  const seq = ++loadSeq;
  const targetPage = reset ? 0 : page + 1;

  if (reset) {
    page = 0;
    loadMoreWrap.hidden = true;
    if (emptyState) emptyState.hidden = true;
    const hasCached = pageCache.has(cacheKey(0));
    if (!hasCached) { showSkeletons(); if (meta) meta.textContent = "Loading…"; }
  } else {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "Loading…";
  }
  isLoading = true;

  try {
    const result = await fetchPage(targetPage);
    if (seq !== loadSeq) return; // a newer request superseded this one

    totalCount = result.count;
    page = targetPage;

    if (reset) grid.innerHTML = "";
    grid.removeAttribute("aria-busy");

    if (reset && result.data.length === 0) {
      if (emptyState) emptyState.hidden = false;
      if (meta) meta.textContent = "0 results";
      return;
    }
    if (emptyState) emptyState.hidden = true;

    const frag = document.createDocumentFragment();
    result.data.forEach((r) => frag.appendChild(buildCard(r)));
    grid.appendChild(frag);

    const shown = grid.children.length;
    if (meta) meta.textContent = totalCount + (totalCount === 1 ? " result" : " results");
    loadMoreWrap.hidden = shown >= totalCount;
  } catch (error) {
    if (seq !== loadSeq) return;
    console.error(error);
    grid.removeAttribute("aria-busy");
    if (reset) grid.innerHTML = "";
    if (meta) meta.textContent = "";
    toast(navigator.onLine ? "Couldn't load the shelf — please try again." : "You're offline. Reconnect and try again.", "error");
  } finally {
    if (seq === loadSeq) {
      isLoading = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Load more";
    }
  }
}

function buildCard(r) {
  const card = document.createElement("article");
  card.className = "resource-card card-enter";
  card.dataset.type = r.resource_type;

  const bucket = sb.storage.from(BUCKET);
  const { data: pub } = bucket.getPublicUrl(r.file_path);
  const { data: dl } = bucket.getPublicUrl(r.file_path, { download: r.file_name });
  const viewUrl = pub ? pub.publicUrl : "#";
  const downloadUrl = dl ? dl.publicUrl : viewUrl;
  const byline = r.uploader_name ? `Shared by ${escapeHtml(r.uploader_name)} · ` : "";

  card.innerHTML = `
    <div class="card-top">
      <div class="card-badges">
        <span class="badge">${escapeHtml(r.level)}</span>
        <span class="badge">${escapeHtml(r.resource_type)}</span>
      </div>
    </div>
    <h3 class="card-title">${escapeHtml(r.title)}</h3>
    <p class="card-course">${escapeHtml(r.course_name)}${r.course_code ? " · " + escapeHtml(r.course_code) : ""}</p>
    <p class="card-desc">${r.description ? escapeHtml(r.description) : ""}</p>
    <div class="card-foot">
      <span class="card-meta">${byline}${formatBytes(r.file_size)} · ${timeAgo(r.created_at)}</span>
      <div class="card-actions">
        <a class="card-view" href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener">View</a>
        <button type="button" class="card-dl" data-url="${escapeHtml(downloadUrl)}" data-src="${escapeHtml(viewUrl)}" data-filename="${escapeHtml(r.file_name)}" data-size="${Number(r.file_size) || 0}" data-id="${escapeHtml(r.id)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Download
        </button>
      </div>
    </div>
  `;
  return card;
}

// One delegated listener for every card's Download button.
// Uses Supabase's `?download=` URL, which makes the server send the file as an
// attachment. The browser streams it straight to disk: instant start, no RAM
// spike, and it works for large files on phones (the old fetch-to-blob did not).
const BLOB_DOWNLOAD_LIMIT = 150 * 1024 * 1024; // above this, stream via the server's attachment link

function triggerSave(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  if (filename) a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Downloads the file to the person's device (their Downloads / Files app).
// Fetches the bytes, shows progress on the button, then saves a local copy
// under the original file name. Very large files, or any failure, fall back
// to the server's attachment link, which also saves rather than opens.
async function downloadToDevice(btn) {
  const filename = btn.dataset.filename || "download";
  const size = Number(btn.dataset.size) || 0;
  const attachmentUrl = btn.dataset.url;
  const originalHTML = btn.innerHTML;

  if (size > BLOB_DOWNLOAD_LIMIT) {
    triggerSave(attachmentUrl, filename);
    toast("Download started — check your Downloads.", "success");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Downloading…";
  try {
    const res = await fetch(btn.dataset.src);
    if (!res.ok) throw new Error("Download failed (" + res.status + ")");

    const total = Number(res.headers.get("Content-Length")) || size;
    let blob;
    if (res.body && total) {
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        btn.textContent = "Downloading " + Math.min(100, Math.round((received / total) * 100)) + "%";
      }
      blob = new Blob(chunks, { type: res.headers.get("Content-Type") || "application/octet-stream" });
    } else {
      blob = await res.blob();
    }

    const blobUrl = URL.createObjectURL(blob);
    triggerSave(blobUrl, filename);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    toast("Saved to your device.", "success");
  } catch (err) {
    console.error(err);
    triggerSave(attachmentUrl, filename); // server-side attachment fallback
    toast("Download started — check your Downloads.", "success");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

on(grid, "click", (e) => {
  const btn = e.target.closest(".card-dl");
  if (!btn || btn.disabled) return;
  downloadToDevice(btn);
  // Fire and forget — never block the download on the counter
  sb.rpc("increment_resource_download", { resource_id: btn.dataset.id }).then(() => {}, () => {});
});

// =========================================================
// STATS
// =========================================================
async function loadStats() {
  try {
    const [{ count }, { data: rows }] = await Promise.all([
      sb.from("resources").select("id", { count: "exact", head: true }).eq("status", "approved"),
      sb.from("resources").select("course_name, uploader_name").eq("status", "approved").limit(2000),
    ]);
    const elR = $("statResources"), elC = $("statCourses"), elU = $("statContributors");
    if (elR) elR.textContent = count ?? 0;
    if (rows) {
      const courses = new Set(rows.map((r) => (r.course_name || "").trim().toLowerCase()).filter(Boolean));
      const contributors = new Set(rows.map((r) => (r.uploader_name || "").trim().toLowerCase()).filter(Boolean));
      if (elC) elC.textContent = courses.size;
      if (elU) elU.textContent = contributors.size;
    }
  } catch (err) {
    console.error(err); // stats are decorative; fail quietly
  }
}

// =========================================================
// UPLOAD (open to everyone, no account needed)
// =========================================================
const fileInput = $("f_file");
const fileDrop = $("fileDrop");
const fileDropLabel = $("fileDropLabel");

function setFileLabel() {
  if (!fileInput || !fileDropLabel || !fileDrop) return;
  const f = fileInput.files[0];
  if (f) {
    fileDropLabel.textContent = `${f.name} (${formatBytes(f.size)})`;
    fileDrop.classList.add("has-file");
  } else {
    fileDropLabel.textContent = "Choose a file or drag it here";
    fileDrop.classList.remove("has-file");
  }
}
on(fileInput, "change", setFileLabel);
["dragover", "dragleave", "drop"].forEach((evt) => on(fileDrop, evt, (e) => e.preventDefault()));
on(fileDrop, "dragover", () => fileDrop.classList.add("is-dragging"));
on(fileDrop, "dragleave", () => fileDrop.classList.remove("is-dragging"));
on(fileDrop, "drop", (e) => {
  fileDrop.classList.remove("is-dragging");
  if (e.dataTransfer.files[0]) {
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event("change"));
  }
});

// Upload with real progress. supabase-js doesn't expose upload progress, so we
// talk to the Storage REST endpoint with XHR. Falls back to the SDK on network error.
async function uploadWithProgress(path, file, onProgress) {
  const { data: { session } } = await sb.auth.getSession();
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("apikey", SUPABASE_KEY);
      if (session) xhr.setRequestHeader("Authorization", "Bearer " + session.access_token);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("cache-control", "max-age=3600");
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let msg = "Upload failed (" + xhr.status + ")";
        try { msg = JSON.parse(xhr.responseText).message || msg; } catch (_) {}
        const err = new Error(msg); err.http = true; reject(err);
      };
      xhr.onerror = () => reject(new Error("network"));
      xhr.ontimeout = () => reject(new Error("network"));
      xhr.send(file);
    });
  } catch (err) {
    if (err.http) throw err;
    // Network-level failure: retry once through the SDK
    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream",
    });
    if (error) throw error;
    onProgress(1);
  }
}

const uploadForm = $("uploadForm");
on(uploadForm, "submit", async (e) => {
  e.preventDefault();

  const status = $("uploadStatus");
  const submitBtn = $("uploadSubmitBtn");
  const file = fileInput.files[0];
  if (submitBtn.disabled) return; // guards against double-taps

  status.className = "upload-status";
  if (!file) { status.textContent = "Choose a file first."; status.classList.add("is-error"); return; }
  if (file.size > MAX_FILE_BYTES) { status.textContent = "That file is over the 500 MB limit."; status.classList.add("is-error"); return; }
  if (!navigator.onLine) { status.textContent = "You're offline. Reconnect and try again."; status.classList.add("is-error"); return; }

  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  status.textContent = "Uploading… 0%";

  // Progress bar, created on demand
  let bar = status.parentNode.querySelector(".upload-progress");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "upload-progress";
    bar.innerHTML = "<span></span>";
    status.insertAdjacentElement("afterend", bar);
  }
  const barFill = bar.firstElementChild;
  barFill.style.width = "0";
  bar.hidden = false;

  const path = `${UPLOAD_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFileName(file.name)}`;

  try {
    await uploadWithProgress(path, file, (frac) => {
      const pct = Math.round(frac * 100);
      barFill.style.width = pct + "%";
      status.textContent = pct < 100 ? `Uploading… ${pct}%` : "Finishing up…";
      submitBtn.textContent = pct < 100 ? `Uploading ${pct}%` : "Saving…";
    });

    const payload = {
      title: $("f_title").value.trim(),
      description: $("f_description").value.trim() || null,
      course_name: $("f_course_name").value.trim(),
      course_code: $("f_course_code").value.trim() || null,
      level: $("f_level").value,
      resource_type: $("f_resource_type").value,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      uploaded_by: null,
      uploader_name: $("f_uploader_name").value.trim() || null,
      status: "approved",
    };

    const { error: insErr } = await sb.from("resources").insert(payload);
    if (insErr) {
      sb.storage.from(BUCKET).remove([path]); // clean up the orphaned file (best effort)
      throw insErr;
    }

    status.textContent = "Uploaded — it's live on the shelf now.";
    status.classList.add("is-success");
    toast("Thanks — it's live on the shelf.", "success");
    e.target.reset();
    setFileLabel();

    // Refresh the shelf + stats so the new item shows up without a reload
    pageCache.clear();
    loadResources({ reset: true });
    loadStats();
  } catch (err) {
    console.error(err);
    status.textContent = err.message || "Something went wrong. Try again.";
    status.classList.add("is-error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    setTimeout(() => { bar.hidden = true; }, 800);
  }
});

// =========================================================
// ADMIN PANEL — not linked anywhere public. Visit yoursite/#admin
// Sign-in only works for an account whose profiles.role is admin,
// super_admin or moderator; everyone else just sees a permission message.
// =========================================================
function checkAdminRoute() {
  const panel = $("admin");
  if (!panel) return;
  if (window.location.hash === "#admin") {
    panel.hidden = false;
    refreshAdminUI();
    panel.scrollIntoView({ behavior: "auto" });
  } else {
    panel.hidden = true;
  }
}
on(window, "hashchange", checkAdminRoute);

on($("adminSignInBtn"), "click", async () => {
  const email = $("adm_email").value.trim();
  const password = $("adm_password").value;
  const status = $("adminAuthStatus");
  const btn = $("adminSignInBtn");
  status.className = "auth-status";
  status.textContent = "";
  if (!email || !password) { status.textContent = "Enter your email and password."; status.classList.add("is-error"); return; }

  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) { status.textContent = error.message; status.classList.add("is-error"); return; }
  $("adm_password").value = "";
  refreshAdminUI();
});

on($("adminSignOutBtn"), "click", async () => {
  await sb.auth.signOut();
  refreshAdminUI();
});

let adminFilterStatus = "pending";

async function refreshAdminUI() {
  const signedOutView = $("adminSignedOut");
  const signedInView = $("adminSignedIn");
  if (!signedOutView || !signedInView) return;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    signedOutView.hidden = false;
    signedInView.hidden = true;
    return;
  }

  const { data: profile } = await sb.from("profiles")
    .select("full_name, email, role")
    .eq("id", session.user.id)
    .maybeSingle();

  const isMod = !!profile && MODERATOR_ROLES.includes(profile.role);
  if (!isMod) {
    await sb.auth.signOut();
    signedOutView.hidden = false;
    signedInView.hidden = true;
    const status = $("adminAuthStatus");
    if (status) {
      status.className = "auth-status is-error";
      status.textContent = "This account doesn't have moderator access.";
    }
    return;
  }

  signedOutView.hidden = true;
  signedInView.hidden = false;
  const who = $("adminUserLabel") || $("adminWho");
  if (who) who.textContent = profile.full_name || profile.email || session.user.email;
  loadAdminList();
}

async function loadAdminList() {
  const list = $("adminList");
  if (!list) return;
  list.innerHTML = '<p class="muted">Loading…</p>';

  let query = sb.from("resources").select("*").order("created_at", { ascending: false }).limit(100);
  if (adminFilterStatus !== "all") query = query.eq("status", adminFilterStatus);
  const { data, error } = await query;

  if (error) { list.innerHTML = ""; toast(error.message, "error"); return; }
  if (!data.length) { list.innerHTML = '<p class="muted">Nothing here.</p>'; return; }

  list.innerHTML = data.map((r) => `
    <div class="admin-row" data-id="${escapeHtml(r.id)}" data-path="${escapeHtml(r.file_path)}">
      <div class="admin-row-main">
        <strong>${escapeHtml(r.title)}</strong>
        <span class="muted">${escapeHtml(r.course_name)} · ${escapeHtml(r.level)} · ${escapeHtml(r.resource_type)} · ${escapeHtml(r.status)}</span>
      </div>
      <div class="admin-row-actions">
        ${r.status !== "approved" ? '<button type="button" data-act="approve" class="btn btn-small">Approve</button>' : ""}
        ${r.status !== "rejected" ? '<button type="button" data-act="reject" class="btn btn-small btn-ghost">Reject</button>' : ""}
        <button type="button" data-act="delete" class="btn btn-small btn-ghost">Delete</button>
      </div>
    </div>`).join("");
}

on($("adminList"), "click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const row = btn.closest(".admin-row");
  const id = row.dataset.id;
  const act = btn.dataset.act;

  if (act === "delete" && !confirm("Delete this resource and its file permanently?")) return;
  btn.disabled = true;

  let error = null;
  if (act === "approve") ({ error } = await sb.from("resources").update({ status: "approved" }).eq("id", id));
  else if (act === "reject") ({ error } = await sb.from("resources").update({ status: "rejected" }).eq("id", id));
  else if (act === "delete") {
    ({ error } = await sb.from("resources").delete().eq("id", id));
    if (!error) sb.storage.from(BUCKET).remove([row.dataset.path]);
  }

  if (error) { btn.disabled = false; toast(error.message, "error"); return; }

  row.remove(); // instant UI update; no full reload needed
  toast("Done.", "success");
  pageCache.clear();
  loadResources({ reset: true });
  loadStats();
});

// Optional status filter for the admin list, if present in the HTML
on($("adminStatusFilter"), "change", (e) => { adminFilterStatus = e.target.value; loadAdminList(); });

// =========================================================
// CONNECTIVITY
// =========================================================
on(window, "offline", () => toast("You're offline.", "error"));
on(window, "online", () => { toast("Back online.", "success"); if (!grid || !grid.children.length) loadResources({ reset: true }); });

// =========================================================
// INIT
// =========================================================
buildFilterPills();
populateFormSelects();
loadResources({ reset: true });
loadStats();
checkAdminRoute();
