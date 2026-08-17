// HUSBND — chores for a made-up currency called BJs.
// Vanilla JS, no build step. Talks directly to Firebase Firestore from the client.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, doc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const CONFIG_KEY = "husbnd.firebaseConfig";
const ROLE_KEY = "husbnd.role";

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const state = {
  firebaseConfig: null,
  role: null,          // "wife" | "husband"
  app: null,
  auth: null,
  db: null,
  chores: [],           // live list from Firestore
  connected: false,
  lastSyncError: null,
  activeTab: "chores",
  detailChoreId: null,
  detailCounterValue: 1,
  proposeValue: 5,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

function roleDisplayName(role) {
  return role === "wife" ? "Wife" : role === "husband" ? "Husband" : "—";
}

function otherRoleName(role) {
  return role === "wife" ? "Husband" : "Wife";
}

function bjLabel(n) {
  return `${n} BJ${n === 1 ? "" : "s"}`;
}

function formatDate(ms) {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function statusDisplayName(status) {
  switch (status) {
    case "proposed": return "Negotiating";
    case "accepted": return "To Do";
    case "completed": return "Awaiting Approval";
    case "approved": return "Approved";
    case "rejected": return "Declined";
    default: return status;
  }
}

function awaitsResponse(chore, role) {
  return chore.status === "proposed" && chore.proposedBy !== role;
}

// ---------------------------------------------------------------------------
// Parsing a pasted firebaseConfig snippet into a real object.
// Firebase's console gives you a whole code sample (imports, comments, the
// initializeApp() call, sometimes stray characters from copying rich text) —
// not just the object literal, and not JSON (unquoted keys). We locate the
// specific `{ ... }` that contains "apiKey" using brace-depth matching,
// rather than naively grabbing from the first "{" to the last "}" in the
// whole paste (the first "{" is usually the `import { initializeApp }` line).
// ---------------------------------------------------------------------------
function extractConfigObjectText(raw) {
  const anchorIdx = raw.indexOf("apiKey");
  if (anchorIdx === -1) {
    throw new Error('Couldn\'t find "apiKey" in what you pasted — copy the whole firebaseConfig object from Firebase.');
  }
  const braceStart = raw.lastIndexOf("{", anchorIdx);
  if (braceStart === -1) {
    throw new Error("Couldn't find the { that starts the firebaseConfig object — copy the whole snippet from Firebase.");
  }
  let depth = 0;
  let inString = null;
  for (let i = braceStart; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (c === "\\") { i++; continue; } // skip escaped char
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inString = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return raw.slice(braceStart, i + 1);
    }
  }
  throw new Error("Couldn't find the matching } for the firebaseConfig object — copy the whole snippet from Firebase.");
}

function parseFirebaseConfigSnippet(raw) {
  if (!raw || !raw.trim()) {
    throw new Error("Paste your firebaseConfig snippet first.");
  }
  let objText = extractConfigObjectText(raw);

  // Strip // line comments and /* block comments */
  objText = objText.replace(/\/\*[\s\S]*?\*\//g, "");
  objText = objText.replace(/(^|[^:])\/\/.*$/gm, "$1");

  // Quote bare object keys: apiKey: "..."  ->  "apiKey": "..."
  objText = objText.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');

  // Remove trailing commas before } or ]
  objText = objText.replace(/,\s*([}\]])/g, "$1");

  let parsed;
  try {
    parsed = JSON.parse(objText);
  } catch (e) {
    throw new Error("Couldn't understand that config. Make sure you copied the entire firebaseConfig object, including the { and }.");
  }
  if (!parsed.apiKey || !parsed.projectId) {
    throw new Error("That config is missing apiKey or projectId — copy the full snippet from Firebase's \"Add app\" screen.");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Firebase init + Firestore subscription
// ---------------------------------------------------------------------------
let unsubscribeChores = null;

async function connectFirebase(config) {
  state.app = initializeApp(config);
  state.auth = getAuth(state.app);
  state.db = getFirestore(state.app);

  await signInAnonymously(state.auth);

  if (unsubscribeChores) unsubscribeChores();
  const choresQuery = query(collection(state.db, "chores"), orderBy("createdAt", "desc"));
  unsubscribeChores = onSnapshot(
    choresQuery,
    (snapshot) => {
      state.connected = true;
      state.chores = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      hideConnectionBanner();
      renderAll();
    },
    (error) => {
      state.connected = false;
      state.lastSyncError =
        error.code === "permission-denied"
          ? "Permission denied — check your Firestore security rules (see the README)."
          : `${error.code || "error"}: ${error.message}`;
      console.error("Firestore listener error:", error);
      showConnectionBanner(
        error.code === "permission-denied"
          ? "Can't read chores — check your Firestore security rules (see the README)."
          : `Sync error: ${error.message}`
      );
      renderAll();
    }
  );
}

function showConnectionBanner(message) {
  const el = $("#connection-banner");
  el.textContent = message;
  el.style.display = "block";
}
function hideConnectionBanner() {
  $("#connection-banner").style.display = "none";
}

// ---------------------------------------------------------------------------
// Firestore write operations
// ---------------------------------------------------------------------------
async function proposeChore(title, notes, bjValue, proposedBy) {
  await addDoc(collection(state.db, "chores"), {
    title: title.trim(),
    notes: notes.trim(),
    bjValue,
    proposedBy,
    status: "proposed",
    createdAt: Date.now(),
    completedAt: null,
    approvedAt: null,
  });
}

async function counterPropose(chore, newValue, byRole) {
  await updateDoc(doc(state.db, "chores", chore.id), {
    bjValue: newValue,
    proposedBy: byRole,
    status: "proposed",
  });
}

async function acceptProposal(chore) {
  await updateDoc(doc(state.db, "chores", chore.id), { status: "accepted" });
}

async function declineChore(chore) {
  await updateDoc(doc(state.db, "chores", chore.id), { status: "rejected" });
}

async function markCompleted(chore) {
  await updateDoc(doc(state.db, "chores", chore.id), {
    status: "completed",
    completedAt: Date.now(),
  });
}

async function approveChore(chore) {
  await updateDoc(doc(state.db, "chores", chore.id), {
    status: "approved",
    approvedAt: Date.now(),
  });
}

async function sendBack(chore) {
  await updateDoc(doc(state.db, "chores", chore.id), {
    status: "accepted",
    completedAt: null,
  });
}

// ---------------------------------------------------------------------------
// Screen / tab switching
// ---------------------------------------------------------------------------
function showScreen(name) {
  ["setup", "role", "main"].forEach((n) => {
    $(`#screen-${n}`).classList.toggle("active", n === name);
  });
}

function showTab(name) {
  state.activeTab = name;
  $all(".tab-panel").forEach((el) => {
    el.style.display = el.id === `tab-${name}` ? "block" : "none";
  });
  $all(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderAll() {
  renderTopbar();
  renderChoresList();
  renderBalance();
  renderSettings();
  if (state.detailChoreId) renderDetailSheet();
}

function renderTopbar() {
  $("#topbar-role-pill").textContent = roleDisplayName(state.role);
}

function choreRowHtml(chore) {
  const statusLine =
    chore.status === "proposed"
      ? `${roleDisplayName(chore.proposedBy)} proposed this`
      : statusDisplayName(chore.status);
  return `
    <div class="chore-row" data-chore-id="${chore.id}">
      <div class="chore-main">
        <div class="chore-title">${escapeHtml(chore.title)}</div>
        ${chore.notes ? `<div class="chore-notes">${escapeHtml(chore.notes)}</div>` : ""}
        <div class="chore-status status-${chore.status}">${escapeHtml(statusLine)}</div>
      </div>
      <div class="chore-bj">${bjLabel(chore.bjValue)}</div>
    </div>
  `;
}

function renderChoresList() {
  const role = state.role;
  const chores = state.chores;
  const needsResponse = chores.filter((c) => awaitsResponse(c, role));
  const waiting = chores.filter((c) => c.status === "proposed" && c.proposedBy === role);
  const inProgress = chores.filter((c) => c.status === "accepted");
  const awaitingApproval = chores.filter((c) => c.status === "completed");
  const resolved = chores.filter((c) => c.status === "approved" || c.status === "rejected");

  let html = "";
  const section = (title, list) => {
    if (!list.length) return "";
    return `<h2 class="section-title">${title}</h2>` + list.map(choreRowHtml).join("");
  };

  html += section("Needs Your Response", needsResponse);
  html += section(`Waiting on ${otherRoleName(role)}`, waiting);
  html += section("In Progress", inProgress);
  html += section("Awaiting Approval", awaitingApproval);
  html += section("History", resolved);

  if (!chores.length) {
    html = `
      <div class="empty-state">
        <div class="emoji">✅</div>
        <div>${role === "wife" ? "No chores yet. Tap Propose to offer your first one." : "Nothing proposed yet. Check back later."}</div>
      </div>
    `;
  }

  $("#chores-list").innerHTML = html;
  $all("#chores-list .chore-row").forEach((row) => {
    row.addEventListener("click", () => openDetailSheet(row.dataset.choreId));
  });
}

function renderBalance() {
  const approved = state.chores
    .filter((c) => c.status === "approved")
    .sort((a, b) => (b.approvedAt || b.createdAt) - (a.approvedAt || a.createdAt));
  const total = approved.reduce((sum, c) => sum + c.bjValue, 0);

  $("#balance-total").textContent = total;

  if (!approved.length) {
    $("#balance-history").innerHTML = `
      <div class="empty-state" style="padding:24px 8px;">
        <div class="emoji">⭐️</div>
        <div>Get chores accepted, done, and approved to start earning.</div>
      </div>
    `;
    return;
  }

  $("#balance-history").innerHTML = approved
    .map(
      (c) => `
      <div class="history-row">
        <div>
          <div class="h-title">${escapeHtml(c.title)}</div>
          <div class="h-date">${formatDate(c.approvedAt)}</div>
        </div>
        <div class="h-amount">+${c.bjValue}</div>
      </div>
    `
    )
    .join("");
}

function renderSettings() {
  $("#settings-role").textContent = roleDisplayName(state.role);
  $("#settings-project-id").textContent = state.firebaseConfig?.projectId || "—";
  $("#settings-connection").textContent = state.connected ? "Connected" : "Not connected";
  const errEl = $("#settings-last-error");
  if (errEl) {
    if (!state.connected && state.lastSyncError) {
      errEl.textContent = state.lastSyncError;
      errEl.style.display = "block";
    } else {
      errEl.style.display = "none";
    }
  }
}

function renderDetailSheet() {
  const chore = state.chores.find((c) => c.id === state.detailChoreId);
  if (!chore) {
    closeDetailSheet();
    return;
  }
  const role = state.role;
  let rows = `
    <div class="detail-row"><span>Title</span><span>${escapeHtml(chore.title)}</span></div>
    ${chore.notes ? `<div class="detail-row"><span>Notes</span><span>${escapeHtml(chore.notes)}</span></div>` : ""}
    <div class="detail-row"><span>Current Offer</span><span>${bjLabel(chore.bjValue)}</span></div>
    <div class="detail-row"><span>Status</span><span>${statusDisplayName(chore.status)}</span></div>
    <div class="detail-row"><span>Proposed</span><span>${formatDate(chore.createdAt)}</span></div>
    ${chore.completedAt ? `<div class="detail-row"><span>Marked Done</span><span>${formatDate(chore.completedAt)}</span></div>` : ""}
    ${chore.approvedAt ? `<div class="detail-row"><span>Approved</span><span>${formatDate(chore.approvedAt)}</span></div>` : ""}
  `;

  let actions = "";

  if (awaitsResponse(chore, role)) {
    actions += `
      <div class="banner">${roleDisplayName(chore.proposedBy)} proposed ${bjLabel(chore.bjValue)}</div>
      <div class="actions">
        <button class="btn btn-primary" id="detail-accept">Accept ${bjLabel(chore.bjValue)}</button>
        <div class="stepper">
          <button type="button" id="detail-counter-minus">−</button>
          <div class="stepper-value">Counter: <span id="detail-counter-value">${state.detailCounterValue}</span> BJ${state.detailCounterValue === 1 ? "" : "s"}</div>
          <button type="button" id="detail-counter-plus">+</button>
        </div>
        <button class="btn btn-secondary" id="detail-counter-submit" ${state.detailCounterValue === chore.bjValue ? "disabled" : ""}>Send Counter-Offer</button>
        <button class="btn btn-destructive" id="detail-decline">Decline Chore</button>
      </div>
    `;
  } else if (chore.status === "proposed") {
    actions += `
      <div class="banner">Waiting for ${otherRoleName(role)} to respond to your offer of ${bjLabel(chore.bjValue)}.</div>
      <div class="actions">
        <button class="btn btn-destructive" id="detail-withdraw">Withdraw Offer</button>
      </div>
    `;
  } else if (role === "husband" && chore.status === "accepted") {
    actions += `
      <div class="actions">
        <button class="btn btn-primary" id="detail-mark-done">Mark as Done</button>
      </div>
    `;
  } else if (role === "wife" && chore.status === "accepted") {
    actions += `<div class="banner">He's working on this.</div>`;
  } else if (role === "wife" && chore.status === "completed") {
    actions += `
      <div class="actions">
        <button class="btn btn-primary" id="detail-approve">Approve & Pay Out ${bjLabel(chore.bjValue)}</button>
        <button class="btn btn-destructive" id="detail-send-back">Send Back (Not Done Yet)</button>
      </div>
    `;
  } else if (role === "husband" && chore.status === "completed") {
    actions += `<div class="banner">Waiting for ${otherRoleName(role)} to approve.</div>`;
  } else if (chore.status === "approved") {
    actions += `<div class="banner">✅ Approved — BJs banked.</div>`;
  } else if (chore.status === "rejected") {
    actions += `<div class="banner">This chore was declined.</div>`;
  }

  $("#detail-content").innerHTML = `
    <h3>${escapeHtml(chore.title)}</h3>
    ${rows}
    ${actions}
  `;

  // Wire up whichever buttons exist for this state
  const bind = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  };
  bind("detail-accept", () => runDetailAction(() => acceptProposal(chore)));
  bind("detail-decline", () => runDetailAction(() => declineChore(chore)));
  bind("detail-withdraw", () => runDetailAction(() => declineChore(chore)));
  bind("detail-mark-done", () => runDetailAction(() => markCompleted(chore)));
  bind("detail-approve", () => runDetailAction(() => approveChore(chore)));
  bind("detail-send-back", () => runDetailAction(() => sendBack(chore)));
  bind("detail-counter-submit", () => runDetailAction(() => counterPropose(chore, state.detailCounterValue, role)));
  bind("detail-counter-minus", () => {
    state.detailCounterValue = Math.max(1, state.detailCounterValue - 1);
    renderDetailSheet();
  });
  bind("detail-counter-plus", () => {
    state.detailCounterValue = Math.min(100, state.detailCounterValue + 1);
    renderDetailSheet();
  });
}

async function runDetailAction(fn) {
  try {
    await fn();
    closeDetailSheet();
  } catch (e) {
    console.error(e);
    alert("Something went wrong: " + e.message);
  }
}

function openDetailSheet(choreId) {
  state.detailChoreId = choreId;
  const chore = state.chores.find((c) => c.id === choreId);
  state.detailCounterValue = chore ? chore.bjValue : 1;
  renderDetailSheet();
  $("#detail-overlay").classList.add("active");
}

function closeDetailSheet() {
  state.detailChoreId = null;
  $("#detail-overlay").classList.remove("active");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Wiring up static UI (tabs, forms, screens)
// ---------------------------------------------------------------------------
function wireStaticUI() {
  // Tab bar
  $all(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // Detail sheet dismiss on backdrop tap
  $("#detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") closeDetailSheet();
  });

  // Setup screen
  $("#setup-save-btn").addEventListener("click", async () => {
    const raw = $("#setup-config-input").value;
    const errEl = $("#setup-error");
    errEl.style.display = "none";
    try {
      const config = parseFirebaseConfigSnippet(raw);
      $("#setup-save-btn").disabled = true;
      $("#setup-save-btn").textContent = "Connecting…";
      await connectFirebase(config);
      state.firebaseConfig = config;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      proceedAfterConfig();
    } catch (e) {
      console.error(e);
      let msg = e.message || "Something went wrong.";
      if (e.code === "auth/operation-not-allowed") {
        msg = "Anonymous sign-in isn't enabled on this Firebase project yet. In the Firebase console go to Authentication → Sign-in method → Anonymous → Enable, then try again.";
      } else if (e.code === "auth/configuration-not-found") {
        msg = "This Firebase project doesn't have Authentication set up yet. Go to Authentication → Get started in the Firebase console, enable Anonymous sign-in, then try again.";
      }
      errEl.textContent = msg;
      errEl.style.display = "block";
    } finally {
      $("#setup-save-btn").disabled = false;
      $("#setup-save-btn").textContent = "Save & Continue";
    }
  });

  // Role screen
  $("#role-wife-btn").addEventListener("click", () => chooseRole("wife"));
  $("#role-husband-btn").addEventListener("click", () => chooseRole("husband"));
  $("#role-back-to-setup").addEventListener("click", () => {
    localStorage.removeItem(CONFIG_KEY);
    state.firebaseConfig = null;
    showScreen("setup");
  });

  // Propose tab stepper
  $("#propose-minus").addEventListener("click", () => {
    state.proposeValue = Math.max(1, state.proposeValue - 1);
    $("#propose-value").textContent = state.proposeValue;
  });
  $("#propose-plus").addEventListener("click", () => {
    state.proposeValue = Math.min(100, state.proposeValue + 1);
    $("#propose-value").textContent = state.proposeValue;
  });
  $("#propose-submit").addEventListener("click", async () => {
    const title = $("#propose-title").value;
    const notes = $("#propose-notes").value;
    if (!title.trim()) {
      alert("Give the chore a title first.");
      return;
    }
    const btn = $("#propose-submit");
    btn.disabled = true;
    try {
      await proposeChore(title, notes, state.proposeValue, state.role);
      $("#propose-title").value = "";
      $("#propose-notes").value = "";
      state.proposeValue = 5;
      $("#propose-value").textContent = "5";
      showTab("chores");
    } catch (e) {
      alert("Couldn't propose the chore: " + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Settings
  $("#settings-switch-role").addEventListener("click", () => {
    localStorage.removeItem(ROLE_KEY);
    state.role = null;
    showRoleScreenReset();
    showScreen("role");
  });
  $("#settings-change-project").addEventListener("click", () => {
    if (unsubscribeChores) unsubscribeChores();
    localStorage.removeItem(CONFIG_KEY);
    state.firebaseConfig = null;
    $("#setup-config-input").value = "";
    showScreen("setup");
  });
}

function showRoleScreenReset() {
  // no-op placeholder for symmetry / future reset logic
}

function chooseRole(role) {
  state.role = role;
  localStorage.setItem(ROLE_KEY, role);
  $("#tabbtn-propose").style.display = role === "wife" ? "flex" : "none";
  showTab("chores");
  showScreen("main");
  renderAll();
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
async function proceedAfterConfig() {
  const storedRole = localStorage.getItem(ROLE_KEY);
  if (storedRole === "wife" || storedRole === "husband") {
    chooseRole(storedRole);
  } else {
    showScreen("role");
  }
}

async function boot() {
  wireStaticUI();

  const storedConfigRaw = localStorage.getItem(CONFIG_KEY);
  if (!storedConfigRaw) {
    showScreen("setup");
    return;
  }

  let config;
  try {
    config = JSON.parse(storedConfigRaw);
  } catch {
    localStorage.removeItem(CONFIG_KEY);
    showScreen("setup");
    return;
  }

  state.firebaseConfig = config;
  showScreen("setup"); // shown briefly if connect fails
  try {
    await connectFirebase(config);
    proceedAfterConfig();
  } catch (e) {
    console.error(e);
    $("#setup-error").textContent = "Couldn't reconnect to Firebase: " + e.message;
    $("#setup-error").style.display = "block";
  }
}

boot();
