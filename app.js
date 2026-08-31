/* =========================================================
   NIMELSA KDU Chapter — Academic Bank
   Vanilla JS, no build step. Talks directly to Supabase.
   No accounts: anyone can browse and submit; a moderator
   approves submissions from the Supabase dashboard.
   ========================================================= */

// ---------- CONFIG ----------
// Public project URL + publishable key. These are safe to expose in
// client-side code — they only allow what your Row Level Security
// policies permit. Never put a service_role / secret key here.
const SUPABASE_URL = "https://gawqpqunhonuxnzylzvq.supabase.co";
const SUPABASE_KEY = "sb_publishable_FSqMDZmKxxn4oPpbMIJ2ew_NZDWuMEI";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- CONSTANTS ----------
const LEVELS = ["100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "Postgraduate"];
// Must match the resources.resource_type CHECK constraint exactly.
const RESOURCE_TYPES = ["Lecture Notes", "Handout", "Past Questions", "Practical", "Textbook", "Study Guide", "Diagram", "Other"];
const BUCKET = "resources";
const MAX_FILE_BYTES = 524288000; // 500 MB, matches DB check
const UPLOAD_PREFIX = "public-submissions"; // matches the storage policy

// ---------- STATE ----------
let filters = { level: "", type: "", q: "" };
let searchDebounce = null;

// =========================================================
// INTRO SEQUENCE
// =========================================================
(function initIntro() {
  const intro = document.getElementById("intro");
  const ball = intro.querySelector(".intro-ball");
  const skipBtn = document.getElementById("introSkip");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    document.body.style.overflow = "";
    intro.classList.add("is-done");
  }

  if (reduceMotion) {
    finish();
    return;
  }

  document.body.style.overflow = "hidden";

  ball.addEventListener("animationend", () => {
    intro.classList.add("is-open");
    playZipSound();
    setTimeout(finish, 950);
  }, { once: true });

  skipBtn.addEventListener("click", () => {
    intro.classList.add("is-open");
    finish();
  });

  // Safety net in case the animationend event never fires
  setTimeout(() => { if (!intro.classList.contains("is-open")) { intro.classList.add("is-open"); playZipSound(); } }, 2200);
  setTimeout(finish, 3200);
})();

// Synthesize a quick "zzzip" sound with the Web Audio API — no audio
// file needed, so there's nothing extra to host or that can 404.
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
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast is-visible" + (kind ? " is-" + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove("is-visible"); }, 4200);
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]+/g, "-").slice(-140);
}

// =========================================================
// NAVIGATION
// =========================================================
document.querySelectorAll("[data-nav]").forEach((el) => {
  el.addEventListener("click", () => {
    const target = el.getAttribute("data-nav");
    document.getElementById("mobileNav").classList.remove("is-open");
    if (target === "home") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    const section = document.getElementById(target);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

document.getElementById("mobileToggle").addEventListener("click", () => {
  document.getElementById("mobileNav").classList.toggle("is-open");
});

// =========================================================
// FILTER / SEARCH CONTROLS
// =========================================================
function buildFilterPills() {
  const levelGroup = document.getElementById("levelFilters");
  LEVELS.forEach((lvl) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "pill"; btn.dataset.value = lvl; btn.textContent = lvl;
    levelGroup.appendChild(btn);
  });
  const typeGroup = document.getElementById("typeFilters");
  RESOURCE_TYPES.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "pill"; btn.dataset.value = t; btn.textContent = t;
    typeGroup.appendChild(btn);
  });

  document.querySelectorAll(".filter-group").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      group.querySelectorAll(".pill").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      const key = group.dataset.filter === "level" ? "level" : "type";
      filters[key] = btn.dataset.value;
      loadResources();
    });
  });
}

function populateFormSelects() {
  const levelSel = document.getElementById("f_level");
  const typeSel = document.getElementById("f_resource_type");
  levelSel.innerHTML = '<option value="" disabled selected>Choose a level</option>' + LEVELS.map((l) => `<option value="${l}">${l}</option>`).join("");
  typeSel.innerHTML = '<option value="" disabled selected>Choose a type</option>' + RESOURCE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
}

const heroSearch = document.getElementById("heroSearch");
heroSearch.addEventListener("submit", (e) => {
  e.preventDefault();
  filters.q = document.getElementById("heroSearchInput").value.trim();
  document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
  loadResources();
});
document.getElementById("heroSearchInput").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const val = e.target.value.trim();
  searchDebounce = setTimeout(() => { filters.q = val; loadResources(); }, 350);
});

// =========================================================
// LOAD + RENDER RESOURCES
// =========================================================
async function loadResources() {
  const grid = document.getElementById("resourceGrid");
  const meta = document.getElementById("resultsMeta");
  const empty = document.getElementById("emptyState");
  meta.textContent = "Loading…";

  let query = sb.from("resources").select("*").eq("status", "approved").order("created_at", { ascending: false }).limit(60);
  if (filters.level) query = query.eq("level", filters.level);
  if (filters.type) query = query.eq("resource_type", filters.type);
  if (filters.q) {
    const q = filters.q.replace(/[%,]/g, "");
    query = query.or(`title.ilike.%${q}%,course_name.ilike.%${q}%,course_code.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    meta.textContent = "";
    toast("Couldn't load the shelf — check your connection and try again.", "error");
    console.error(error);
    return;
  }

  grid.innerHTML = "";
  if (!data || data.length === 0) {
    empty.hidden = false;
    meta.textContent = "0 results";
    return;
  }
  empty.hidden = true;
  meta.textContent = data.length + (data.length === 60 ? "+ result" : " result") + (data.length === 1 ? "" : "s");
  data.forEach((r) => grid.appendChild(buildCard(r)));
}

function buildCard(r) {
  const card = document.createElement("article");
  card.className = "resource-card";
  card.dataset.type = r.resource_type;

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(r.file_path);
  const url = pub ? pub.publicUrl : "#";
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
    ${r.description ? `<p class="card-desc">${escapeHtml(r.description)}</p>` : `<p class="card-desc"></p>`}
    <div class="card-foot">
      <span class="card-meta">${byline}${formatBytes(r.file_size)} · ${timeAgo(r.created_at)}</span>
      <div class="card-actions">
        <a class="card-view" href="${url}" target="_blank" rel="noopener">View</a>
        <button type="button" class="card-dl" data-url="${url}" data-filename="${escapeHtml(r.file_name)}" data-id="${r.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Download
        </button>
      </div>
    </div>
  `;
  card.querySelector(".card-dl").addEventListener("click", (e) => {
    forceDownload(e.currentTarget);
    sb.rpc("increment_resource_download", { resource_id: r.id }).then(() => {});
  });
  return card;
}

// Fetches the file as data and hands the browser an actual local blob to
// save — this is what makes it a real "download" instead of just opening
// the file in a tab (which is what a plain link does for PDFs etc).
async function forceDownload(btn) {
  const url = btn.dataset.url;
  const filename = btn.dataset.filename || "download";
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Downloading…";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Download failed (" + res.status + ")");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
  } catch (err) {
    console.error(err);
    // Fetch can fail on flaky mobile connections — fall back to a direct
    // link so the person can still get the file, just not force-saved.
    toast("Couldn't download directly — opening it instead.", "error");
    window.open(url, "_blank", "noopener");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

// =========================================================
// STATS
// =========================================================
async function loadStats() {
  const [{ count }, { data: rows }] = await Promise.all([
    sb.from("resources").select("id", { count: "exact", head: true }).eq("status", "approved"),
    sb.from("resources").select("course_name, uploader_name").eq("status", "approved"),
  ]);
  document.getElementById("statResources").textContent = count ?? 0;
  if (rows) {
    const courses = new Set(rows.map((r) => (r.course_name || "").trim().toLowerCase()).filter(Boolean));
    const contributors = new Set(rows.map((r) => (r.uploader_name || "").trim().toLowerCase()).filter(Boolean));
    document.getElementById("statCourses").textContent = courses.size;
    document.getElementById("statContributors").textContent = contributors.size;
  }
}

// =========================================================
// UPLOAD (open to everyone, no account needed)
// =========================================================
const fileInput = document.getElementById("f_file");
const fileDrop = document.getElementById("fileDrop");
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) {
    document.getElementById("fileDropLabel").textContent = fileInput.files[0].name;
    fileDrop.classList.add("has-file");
  } else {
    document.getElementById("fileDropLabel").textContent = "Choose a file or drag it here";
    fileDrop.classList.remove("has-file");
  }
});
["dragover", "dragleave", "drop"].forEach((evt) => {
  fileDrop.addEventListener(evt, (e) => e.preventDefault());
});
fileDrop.addEventListener("drop", (e) => {
  if (e.dataTransfer.files[0]) {
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event("change"));
  }
});

document.getElementById("uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const status = document.getElementById("uploadStatus");
  const submitBtn = document.getElementById("uploadSubmitBtn");
  const file = fileInput.files[0];

  status.className = "upload-status";
  if (!file) { status.textContent = "Choose a file first."; status.classList.add("is-error"); return; }
  if (file.size > MAX_FILE_BYTES) { status.textContent = "That file is over the 500 MB limit."; status.classList.add("is-error"); return; }

  submitBtn.disabled = true;
  status.textContent = "Uploading…";

  const path = `${UPLOAD_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFileName(file.name)}`;

  try {
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
    if (upErr) throw upErr;

    const payload = {
      title: document.getElementById("f_title").value.trim(),
      description: document.getElementById("f_description").value.trim() || null,
      course_name: document.getElementById("f_course_name").value.trim(),
      course_code: document.getElementById("f_course_code").value.trim() || null,
      level: document.getElementById("f_level").value,
      resource_type: document.getElementById("f_resource_type").value,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      uploaded_by: null,
      uploader_name: document.getElementById("f_uploader_name").value.trim() || null,
      status: "approved",
    };

    const { error: insErr } = await sb.from("resources").insert(payload);
    if (insErr) {
      await sb.storage.from(BUCKET).remove([path]); // clean up the orphaned file
      throw insErr;
    }

    status.textContent = "Uploaded — it's live on the shelf now.";
    status.classList.add("is-success");
    toast("Thanks — it's live on the shelf.", "success");
    e.target.reset();
    document.getElementById("fileDropLabel").textContent = "Choose a file or drag it here";
    fileDrop.classList.remove("has-file");
  } catch (err) {
    console.error(err);
    status.textContent = err.message || "Something went wrong. Try again.";
    status.classList.add("is-error");
  } finally {
    submitBtn.disabled = false;
  }
});

// =========================================================
// ADMIN PANEL — not linked anywhere public. Visit yoursite/#admin
// Sign-in only works for an account with role admin/moderator in
// the profiles table; everyone else gets a normal permission error.
// =========================================================
function checkAdminRoute() {
  const panel = document.getElementById("admin");
  if (window.location.hash === "#admin") {
    panel.hidden = false;
    refreshAdminUI();
    panel.scrollIntoView({ behavior: "instant" in window ? "instant" : "auto" });
  } else {
    panel.hidden = true;
  }
}
window.addEventListener("hashchange", checkAdminRoute);

document.getElementById("adminSignInBtn").addEventListener("click", async () => {
  const email = document.getElementById("adm_email").value.trim();
  const password = document.getElementById("adm_password").value;
  const status = document.getElementById("adminAuthStatus");
  status.className = "auth-status";
  status.textContent = "";
  if (!email || !password) { status.textContent = "Enter your email and password."; status.classList.add("is-error"); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { status.textContent = error.message; status.classList.add("is-error"); return; }
  document.getElementById("adm_password").value = "";
  refreshAdminUI();
});

document.getElementById("adminSignOutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  refreshAdminUI();
});

async function refreshAdminUI() {
  const { data: { session } } = await sb.auth.getSession();
  const signedOutView = document.getElementById("adminSignedOut");
  const signedInView = document.getElementById("adminSignedIn");

  if (!session) {
    signedOutView.hidden = false;
    signedInView.hidden = true;
    return;
  }

  const { data: profile } = await sb.from("profiles").select("full_name, email, role").eq("id", session.user.id).maybeSingle();
  const isMod = profile && (profile.role === "admin" || profile.role === "moderator");

  if (!isMod) {
    // Signed in, but this account has no moderator rights — sign back out
    // rather than leaving a confusing half-signed-in state.
    await sb.auth.signOut();
    const status = document.getElementById("adminAuthStatus");
    status.textContent = "That account doesn't have moderator access.";
    status.className = "auth-status is-error";
    signedOutView.hidden = false;
    signedInView.hidden = true;
    return;
  }

  signedOutView.hidden = true;
  signedInView.hidden = false;
  document.getElementById("adminWho").textContent = "Signed in as " + ((profile && profile.full_name) || session.user.email);
  loadPendingResources();
}

async function loadPendingResources() {
  const list = document.getElementById("adminList");
  const empty = document.getElementById("adminEmpty");
  const { data, error } = await sb.from("resources").select("*").eq("status", "approved").order("created_at", { ascending: false }).limit(200);
  if (error) { toast("Couldn't load the shelf.", "error"); console.error(error); return; }

  list.innerHTML = "";
  if (!data || data.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  data.forEach((r) => {
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(r.file_path);
    const url = pub ? pub.publicUrl : "#";
    const item = document.createElement("div");
    item.className = "admin-item";
    item.innerHTML = `
      <div class="admin-item-title">${escapeHtml(r.title)}</div>
      <div class="admin-item-meta">${escapeHtml(r.course_name)}${r.course_code ? " · " + escapeHtml(r.course_code) : ""} · ${escapeHtml(r.level)} · ${escapeHtml(r.resource_type)} · ${formatBytes(r.file_size)}${r.uploader_name ? " · from " + escapeHtml(r.uploader_name) : ""}</div>
      ${r.description ? `<div class="admin-item-desc">${escapeHtml(r.description)}</div>` : ""}
      <div class="admin-item-actions">
        <a href="${url}" target="_blank" rel="noopener">Preview file →</a>
        <button type="button" class="btn btn-reject" data-action="remove">Remove from shelf</button>
      </div>
    `;
    item.querySelector('[data-action="remove"]').addEventListener("click", () => moderateResource(r.id, "rejected", item));
    list.appendChild(item);
  });
}

async function moderateResource(id, newStatus, itemEl) {
  const { error } = await sb.from("resources").update({ status: newStatus }).eq("id", id);
  if (error) { toast("Couldn't update that — try again.", "error"); console.error(error); return; }
  itemEl.remove();
  toast("Removed from the shelf.", "success");
  loadStats();
  const list = document.getElementById("adminList");
  if (!list.children.length) document.getElementById("adminEmpty").hidden = false;
}

checkAdminRoute();

// =========================================================
// INIT
// =========================================================
buildFilterPills();
populateFormSelects();
loadResources();
loadStats();
