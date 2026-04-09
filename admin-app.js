import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

function randomKey(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  let s = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
  return s;
}

function init() {
  const cfg = window.__FIREBASE_CONFIG__;
  const status = document.getElementById("admin-status");
  const panel = document.getElementById("admin-panel");
  const loginBox = document.getElementById("admin-login");

  if (!cfg || !cfg.apiKey || cfg.apiKey.includes("ВАШ")) {
    if (status) status.textContent = "Подключите firebase-config.js";
    return;
  }

  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);

  function log(msg) {
    if (status) status.textContent = msg;
  }

  async function checkAdmin(uid) {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  }

  onAuthStateChanged(auth, async function (user) {
    if (!user) {
      if (loginBox) loginBox.hidden = false;
      if (panel) panel.hidden = true;
      log("Войдите аккаунтом, для которого в Firestore создан документ admins/{ваш uid}");
      return;
    }
    const ok = await checkAdmin(user.uid);
    if (!ok) {
      if (loginBox) loginBox.hidden = false;
      if (panel) panel.hidden = true;
      log("Этот аккаунт не в списке админов. В консоли Firebase → Firestore создайте коллекцию admins, документ ID = UID пользователя (копия из Authentication).");
      return;
    }
    if (loginBox) loginBox.hidden = true;
    if (panel) panel.hidden = false;
    log("Админ: " + user.email);
  });

  document.getElementById("admin-do-login")?.addEventListener("click", async function () {
    const email = document.getElementById("admin-email").value;
    const pass = document.getElementById("admin-pass").value;
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
      log(e.message);
    }
  });

  document.getElementById("admin-logout")?.addEventListener("click", function () {
    signOut(auth);
  });

  document.getElementById("gen-key")?.addEventListener("click", async function () {
    const tier = document.getElementById("key-tier").value;
    const out = document.getElementById("key-output");
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) return;
    const ok = await checkAdmin(uid);
    if (!ok) return;
    const key = randomKey(24);
    try {
      await setDoc(doc(db, "licenseKeys", key), {
        tier: tier,
        used: false,
        createdAt: serverTimestamp(),
      });
      if (out) {
        out.textContent = key;
        out.hidden = false;
      }
      log("Ключ создан и сохранён в licenseKeys.");
    } catch (e) {
      log(e.message);
    }
  });

  document.getElementById("save-promo")?.addEventListener("click", async function () {
    const code = document
      .getElementById("promo-code")
      .value.trim()
      .toUpperCase();
    const bonusDays = parseInt(document.getElementById("promo-bonus").value, 10) || 0;
    const maxUses = parseInt(document.getElementById("promo-max").value, 10) || 100;
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!code || code.length < 3) {
      log("Код промо не короче 3 символов.");
      return;
    }
    if (!uid) return;
    const ok = await checkAdmin(uid);
    if (!ok) return;
    try {
      await setDoc(doc(db, "promoCodes", code), {
        active: true,
        bonusDays: bonusDays,
        maxUses: maxUses,
        uses: 0,
        createdAt: serverTimestamp(),
      });
      log("Промокод «" + code + "» сохранён.");
    } catch (e) {
      log(e.message);
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
