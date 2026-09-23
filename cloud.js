// Cloud sync untuk Bisnes Tracker: Login Google + Firestore.
// App tetap berfungsi tanpa login (data disimpan dalam browser sahaja).
// Selepas login, data akan disegerakkan antara telefon dan laptop.

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ---------- Kunci data yang disegerakkan ---------- */
const DATA_KEYS = [
  { name: "bizJobs",     storageKey: "biz-tracker-jobs-v1",     kind: "list" },
  { name: "bizSettings", storageKey: "biz-tracker-settings-v1", kind: "map" }
];
DATA_KEYS.forEach(entry => { entry.stampKey = `${entry.storageKey}::updatedAt`; });
const byStorageKey = new Map(DATA_KEYS.map(entry => [entry.storageKey, entry]));

/* ---------- Pintasan localStorage supaya setiap simpanan ditolak ke cloud ---------- */
const rawSetItem = Storage.prototype.setItem;
let applyingRemote = false;

Storage.prototype.setItem = function (key, value) {
  rawSetItem.call(this, key, value);
  if (applyingRemote || this !== window.localStorage) return;
  const entry = byStorageKey.get(key);
  if (!entry) return;
  rawSetItem.call(this, entry.stampKey, String(Date.now()));
  schedulePush(entry);
};

// Data yang sudah wujud sebelum sync dipasang perlu ada cap masa sendiri.
DATA_KEYS.forEach(entry => {
  if (!localStorage.getItem(entry.stampKey) && hasContent(entry, localStorage.getItem(entry.storageKey) || "")) {
    rawSetItem.call(localStorage, entry.stampKey, String(Date.now()));
  }
});

/* ---------- Firebase ---------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const provider = new GoogleAuthProvider();

let currentUser = null;
let unsubscribers = [];
const pushTimers = new Map();

/* ---------- Papan status + butang login ---------- */
const bar = document.createElement("div");
bar.className = "auth-bar";
bar.innerHTML = `
  <div class="auth-info"><span class="auth-dot"></span><span id="ftSyncStatus">Menyediakan sync…</span></div>
  <button type="button" id="ftAuthButton" class="auth-button">Login Google</button>`;
const anchor = document.querySelector(".page-nav") || document.querySelector(".topbar");
if (anchor) anchor.insertAdjacentElement("afterend", bar);
else document.querySelector(".app-shell")?.prepend(bar);

const statusText = bar.querySelector("#ftSyncStatus");
const authButton = bar.querySelector("#ftAuthButton");

function setStatus(message, state = "offline") {
  statusText.textContent = message;
  bar.dataset.state = state;
}

authButton.addEventListener("click", async () => {
  if (currentUser) {
    await signOut(auth);
    return;
  }
  authButton.disabled = true;
  setStatus("Membuka login Google…", "busy");
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, provider);
  } catch (error) {
    const popupIssue = ["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"];
    if (popupIssue.includes(error.code)) {
      try { await signInWithRedirect(auth, provider); return; } catch (redirectError) { showAuthError(redirectError); }
    } else {
      showAuthError(error);
    }
  } finally {
    authButton.disabled = false;
  }
});

function showAuthError(error) {
  console.error("[BisnesTracker] Login gagal:", error);
  const hint = error.code === "auth/unauthorized-domain"
    ? "Domain ini belum dibenarkan dalam Firebase Authentication."
    : error.code === "auth/operation-not-allowed"
      ? "Google Sign-in belum dihidupkan dalam Firebase Console."
      : error.code || "Ralat tidak diketahui";
  setStatus(`Login gagal — ${hint}`, "error");
}

getRedirectResult(auth).catch(showAuthError);

/* ---------- Aliran auth ---------- */
onAuthStateChanged(auth, user => {
  currentUser = user;
  stopSync();
  if (!user) {
    authButton.textContent = "Login Google";
    setStatus("Belum login — data hanya disimpan pada peranti ini", "offline");
    return;
  }
  authButton.textContent = "Logout";
  setStatus(`Menyegerak… (${user.email || "akaun Google"})`, "busy");
  startSync(user);
});

/* ---------- Enjin sync ---------- */
function docRef(uid, name) { return doc(db, "users", uid, "data", name); }

function startSync(user) {
  DATA_KEYS.forEach(entry => {
    const ref = docRef(user.uid, entry.name);
    const unsubscribe = onSnapshot(
      ref,
      snapshot => {
        handleSnapshot(user.uid, entry, ref, snapshot);
        setStatus(`Disegerakkan · ${user.email || "akaun Google"}`, "online");
      },
      error => {
        console.error("[BisnesTracker] Sync gagal:", error);
        setStatus(`Sync gagal — ${error.code || "ralat"}`, "error");
      }
    );
    unsubscribers.push(unsubscribe);
  });
}

function stopSync() {
  unsubscribers.forEach(unsubscribe => unsubscribe());
  unsubscribers = [];
  pushTimers.forEach(timer => clearTimeout(timer));
  pushTimers.clear();
}

function handleSnapshot(uid, entry, ref, snapshot) {
  const localRaw = localStorage.getItem(entry.storageKey) || "";
  const localStamp = Number(localStorage.getItem(entry.stampKey) || 0);

  if (!snapshot.exists()) {
    if (hasContent(entry, localRaw)) pushNow(entry, ref, localRaw, localStamp || Date.now());
    return;
  }

  const remoteRaw = snapshot.data().payload || "";
  const remoteStamp = Number(snapshot.data().updatedAt || 0);

  // Kali pertama peranti ini sync dengan akaun ini: gabungkan supaya tiada rekod hilang.
  const mergeFlag = `biz-tracker-merged::${uid}::${entry.name}`;
  if (!localStorage.getItem(mergeFlag)) {
    rawSetItem.call(localStorage, mergeFlag, "1");
    if (hasContent(entry, localRaw) && hasContent(entry, remoteRaw) && localRaw !== remoteRaw) {
      const merged = mergeData(entry, localRaw, remoteRaw);
      const stamp = Date.now();
      applyLocal(entry, merged, stamp);
      pushNow(entry, ref, merged, stamp);
      return;
    }
  }

  if (remoteRaw !== localRaw) {
    if (remoteStamp > localStamp) applyLocal(entry, remoteRaw, remoteStamp);
    else if (localStamp > remoteStamp) pushNow(entry, ref, localRaw, localStamp);
  }
}

function applyLocal(entry, raw, stamp) {
  applyingRemote = true;
  rawSetItem.call(localStorage, entry.storageKey, raw);
  rawSetItem.call(localStorage, entry.stampKey, String(stamp));
  applyingRemote = false;
  document.dispatchEvent(new CustomEvent("ft-cloud-data", { detail: { name: entry.name } }));
}

function schedulePush(entry) {
  if (!currentUser) return;
  clearTimeout(pushTimers.get(entry.name));
  pushTimers.set(entry.name, setTimeout(() => {
    const raw = localStorage.getItem(entry.storageKey) || "";
    const stamp = Number(localStorage.getItem(entry.stampKey) || Date.now());
    pushNow(entry, docRef(currentUser.uid, entry.name), raw, stamp);
  }, 600));
}

function pushNow(entry, ref, raw, stamp) {
  setDoc(ref, { payload: raw, updatedAt: stamp }, { merge: true })
    .catch(error => {
      console.error("[BisnesTracker] Gagal simpan ke cloud:", error);
      setStatus(`Gagal simpan ke cloud — ${error.code || "ralat"}`, "error");
    });
}

/* ---------- Pembantu data ---------- */
function parse(raw, fallback) { try { return JSON.parse(raw) ?? fallback; } catch { return fallback; } }

function hasContent(entry, raw) {
  if (!raw) return false;
  if (entry.kind === "list") return parse(raw, []).length > 0;
  const value = parse(raw, {});
  if (entry.kind === "map") return Object.keys(value).length > 0;
  return Object.values(value).some(list => Array.isArray(list) && list.length > 0);
}

function mergeData(entry, localRaw, remoteRaw) {
  if (entry.kind === "map") return JSON.stringify({ ...parse(remoteRaw, {}), ...parse(localRaw, {}) });
  if (entry.kind === "list") {
    const merged = new Map();
    parse(remoteRaw, []).forEach(item => item && item.id && merged.set(item.id, item));
    parse(localRaw, []).forEach(item => item && item.id && merged.set(item.id, item));
    return JSON.stringify([...merged.values()]);
  }
  const local = parse(localRaw, {});
  const remote = parse(remoteRaw, {});
  const result = {};
  new Set([...Object.keys(local), ...Object.keys(remote)]).forEach(type => {
    result[type] = [...new Set([...(remote[type] || []), ...(local[type] || [])])];
  });
  return JSON.stringify(result);
}
