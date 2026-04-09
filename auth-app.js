import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const FUNPAY_URL = "https://funpay.com/users/11584581/";
const LAUNCHER_URL =
  "https://www.dropbox.com/scl/fi/tjknmoxpg1px555ta25zj/loader.exe?rlkey=kdkrw6kg1v88pekdy1sabgxqe&st=6dsefa8z&dl=1";

function tierDurationMs(tier) {
  if (tier === "14d") return 14 * 86400000;
  if (tier === "1y") return 365 * 86400000;
  return 0;
}

function computeSubscription(prev, tier, bonusMs) {
  if (tier === "lifetime") {
    return { tier: "lifetime", lifetime: true, expiresAt: null };
  }
  const add = tierDurationMs(tier) + bonusMs;
  const now = Date.now();
  let base = now;
  if (prev && !prev.lifetime && prev.expiresAt) {
    const exp =
      typeof prev.expiresAt.toMillis === "function"
        ? prev.expiresAt.toMillis()
        : prev.expiresAt;
    if (exp > base) base = exp;
  }
  return {
    tier,
    lifetime: false,
    expiresAt: Timestamp.fromMillis(base + add),
  };
}

function formatSub(sub) {
  if (!sub || (!sub.expiresAt && !sub.lifetime)) return "Нет активной подписки";
  if (sub.lifetime) return "Навсегда";
  try {
    const d = sub.expiresAt.toDate ? sub.expiresAt.toDate() : new Date(sub.expiresAt);
    return "До " + d.toLocaleString("ru-RU");
  } catch {
    return "Активна";
  }
}

function hasActiveSubscription(sub) {
  if (!sub) return false;
  if (sub.lifetime === true) return true;
  if (!sub.expiresAt) return false;
  try {
    const t = sub.expiresAt.toMillis ? sub.expiresAt.toMillis() : new Date(sub.expiresAt).getTime();
    return t > Date.now();
  } catch {
    return false;
  }
}

function randomKey(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  let s = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
  return s;
}

function init() {
  const cfg = typeof window !== "undefined" ? window.__FIREBASE_CONFIG__ : null;
  const banner = document.getElementById("firebase-banner");

  if (!cfg || !cfg.apiKey || cfg.apiKey.includes("ВАШ")) {
    if (banner) {
      banner.hidden = false;
      banner.textContent =
        "Firebase: заполните firebase-config.js ключами из консоли Firebase.";
    }
    document.querySelectorAll(".modal input, .modal button, #account-dashboard input, #account-dashboard button").forEach(function (el) {
      if (el.matches("input")) el.disabled = true;
    });
    return;
  }

  if (banner) banner.hidden = true;

  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const el = {
    headerDownload: document.getElementById("header-download-btn"),
    headerGuest: document.getElementById("header-auth-guest"),
    headerUser: document.getElementById("header-auth-user"),
    headerLogout: document.getElementById("header-logout"),
    accountGuestHint: document.getElementById("account-guest-hint"),
    accountDashboard: document.getElementById("account-dashboard"),
    userEmail: document.getElementById("user-email"),
    userDisplayName: document.getElementById("user-displayname"),
    subStatus: document.getElementById("sub-status"),
    adminBadge: document.getElementById("admin-badge"),
    adminPanel: document.getElementById("admin-panel"),
    regEmail: document.getElementById("reg-email"),
    regPass: document.getElementById("reg-pass"),
    regName: document.getElementById("reg-name"),
    regPromo: document.getElementById("reg-promo"),
    btnReg: document.getElementById("btn-register"),
    loginEmail: document.getElementById("login-email"),
    loginPass: document.getElementById("login-pass"),
    btnLogin: document.getElementById("btn-login"),
    keyInput: document.getElementById("redeem-key"),
    promoInput: document.getElementById("redeem-promo"),
    btnRedeem: document.getElementById("btn-redeem"),
    authMsg: document.getElementById("auth-msg"),
    modalLogin: document.getElementById("modal-login"),
    modalRegister: document.getElementById("modal-register"),
    adminKeyTier: document.getElementById("admin-key-tier"),
    adminGenKey: document.getElementById("admin-gen-key"),
    adminKeyOut: document.getElementById("admin-key-out"),
    adminPromoCode: document.getElementById("admin-promo-code"),
    adminPromoBonus: document.getElementById("admin-promo-bonus"),
    adminPromoMax: document.getElementById("admin-promo-max"),
    adminSavePromo: document.getElementById("admin-save-promo"),
  };

  if (el.headerDownload) el.headerDownload.href = LAUNCHER_URL;

  function showMsg(text, ok) {
    if (!el.authMsg) return;
    el.authMsg.textContent = text;
    el.authMsg.className =
      "auth-msg auth-msg--wide" +
      (ok === false ? " auth-msg--err" : ok === true ? " auth-msg--ok" : "");
  }

  async function ensureBootstrapAdmin(uid) {
    await runTransaction(db, async function (transaction) {
      const ref = doc(db, "config", "bootstrap");
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        transaction.set(ref, {
          adminUid: uid,
          createdAt: serverTimestamp(),
        });
      }
    });
  }

  async function loadIsAdmin(uid) {
    const snap = await getDoc(doc(db, "config", "bootstrap"));
    if (!snap.exists()) return false;
    return snap.data().adminUid === uid;
  }

  function setDownloadVisible(show) {
    if (!el.headerDownload) return;
    el.headerDownload.hidden = !show;
  }

  async function refreshProfile(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.data() || {};
    const sub = data.subscription;
    if (el.subStatus) el.subStatus.textContent = formatSub(sub);
    if (el.userDisplayName) {
      el.userDisplayName.textContent = data.displayName || "—";
    }
    setDownloadVisible(hasActiveSubscription(sub));

    const isAdm = await loadIsAdmin(uid);
    if (el.adminBadge) el.adminBadge.hidden = !isAdm;
    if (el.adminPanel) el.adminPanel.hidden = !isAdm;
    return { sub, isAdm, data };
  }

  function openModal(name) {
    const m = name === "login" ? el.modalLogin : el.modalRegister;
    if (!m) return;
    m.hidden = false;
    document.body.style.overflow = "hidden";
    const focusEl = m.querySelector("input");
    if (focusEl) focusEl.focus();
  }

  function closeModals() {
    if (el.modalLogin) el.modalLogin.hidden = true;
    if (el.modalRegister) el.modalRegister.hidden = true;
    document.body.style.overflow = "";
  }

  document.querySelectorAll("[data-open-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openModal(btn.getAttribute("data-open-modal"));
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (node) {
    node.addEventListener("click", closeModals);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModals();
  });

  onAuthStateChanged(auth, async function (user) {
    closeModals();
    if (user) {
      try {
        await ensureBootstrapAdmin(user.uid);
      } catch (err) {
        console.warn("bootstrap", err);
      }
      if (el.headerGuest) el.headerGuest.hidden = true;
      if (el.headerUser) el.headerUser.hidden = false;
      if (el.accountGuestHint) el.accountGuestHint.hidden = true;
      if (el.accountDashboard) el.accountDashboard.hidden = false;
      if (el.userEmail) el.userEmail.textContent = user.email || "";
      try {
        await refreshProfile(user.uid);
      } catch (e) {
        if (el.subStatus) el.subStatus.textContent = "Ошибка загрузки";
        setDownloadVisible(false);
      }
    } else {
      if (el.headerGuest) el.headerGuest.hidden = false;
      if (el.headerUser) el.headerUser.hidden = true;
      if (el.accountGuestHint) el.accountGuestHint.hidden = false;
      if (el.accountDashboard) el.accountDashboard.hidden = true;
      setDownloadVisible(false);
      showMsg("");
    }
  });

  if (el.headerLogout) {
    el.headerLogout.addEventListener("click", function () {
      signOut(auth);
    });
  }

  if (el.btnReg) {
    el.btnReg.addEventListener("click", async function () {
      showMsg("");
      const email = (el.regEmail && el.regEmail.value) || "";
      const pass = (el.regPass && el.regPass.value) || "";
      const name = (el.regName && el.regName.value) || "";
      const promo = (el.regPromo && el.regPromo.value.trim()) || "";
      if (pass.length < 6) {
        showMsg("Пароль не короче 6 символов.", false);
        return;
      }
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await setDoc(doc(db, "users", cred.user.uid), {
          email: email,
          displayName: name,
          signupPromo: promo || null,
          createdAt: serverTimestamp(),
        });
        await ensureBootstrapAdmin(cred.user.uid);
        closeModals();
        showMsg("Аккаунт создан.", true);
      } catch (e) {
        showMsg(e.message || "Ошибка регистрации", false);
      }
    });
  }

  if (el.btnLogin) {
    el.btnLogin.addEventListener("click", async function () {
      showMsg("");
      const email = (el.loginEmail && el.loginEmail.value) || "";
      const pass = (el.loginPass && el.loginPass.value) || "";
      try {
        await signInWithEmailAndPassword(auth, email, pass);
        closeModals();
        showMsg("Добро пожаловать.", true);
      } catch (e) {
        showMsg(e.message || "Ошибка входа", false);
      }
    });
  }

  if (el.btnRedeem) {
    el.btnRedeem.addEventListener("click", async function () {
      showMsg("");
      const user = auth.currentUser;
      if (!user) {
        showMsg("Войдите в аккаунт.", false);
        return;
      }
      const keyId = ((el.keyInput && el.keyInput.value) || "").trim();
      const promoRaw = ((el.promoInput && el.promoInput.value) || "").trim();
      const promoCode = promoRaw ? promoRaw.toUpperCase() : "";

      if (keyId.length < 16) {
        showMsg("Введите полный ключ (не короче 16 символов).", false);
        return;
      }

      try {
        let promoWarning = "";
        await runTransaction(db, async function (transaction) {
          const keyRef = doc(db, "licenseKeys", keyId);
          const userRef = doc(db, "users", user.uid);
          const keySnap = await transaction.get(keyRef);
          if (!keySnap.exists()) throw new Error("Ключ не найден.");
          const kd = keySnap.data();
          if (kd.used) throw new Error("Ключ уже активирован.");

          let bonusMs = 0;
          if (promoCode) {
            const prRef = doc(db, "promoCodes", promoCode);
            const prSnap = await transaction.get(prRef);
            if (!prSnap.exists()) {
              promoWarning = "Промокод не найден — без бонуса.";
            } else {
              const p = prSnap.data();
              const now = Date.now();
              const expOk =
                !p.expiresAt ||
                (p.expiresAt.toMillis && p.expiresAt.toMillis() > now);
              if (
                p.active &&
                typeof p.uses === "number" &&
                typeof p.maxUses === "number" &&
                p.uses < p.maxUses &&
                expOk
              ) {
                bonusMs = (Number(p.bonusDays) || 0) * 86400000;
                transaction.update(prRef, { uses: p.uses + 1 });
              } else {
                promoWarning = "Промокод недействителен.";
              }
            }
          }

          const userSnap = await transaction.get(userRef);
          const prev = userSnap.exists() ? userSnap.data().subscription : null;
          const nextSub = computeSubscription(prev, kd.tier, bonusMs);

          transaction.update(keyRef, {
            used: true,
            usedBy: user.uid,
            usedAt: serverTimestamp(),
          });
          transaction.set(
            userRef,
            { subscription: nextSub, email: user.email },
            { merge: true }
          );
        });
        showMsg("Подписка активирована. " + (promoWarning || ""), true);
        if (el.keyInput) el.keyInput.value = "";
        if (el.promoInput) el.promoInput.value = "";
        await refreshProfile(user.uid);
      } catch (e) {
        showMsg(e.message || "Не удалось активировать ключ", false);
      }
    });
  }

  if (el.adminGenKey) {
    el.adminGenKey.addEventListener("click", async function () {
      showMsg("");
      const user = auth.currentUser;
      if (!user) return;
      const ok = await loadIsAdmin(user.uid);
      if (!ok) {
        showMsg("Нет прав администратора.", false);
        return;
      }
      const tier = (el.adminKeyTier && el.adminKeyTier.value) || "14d";
      const key = randomKey(24);
      try {
        await setDoc(doc(db, "licenseKeys", key), {
          tier: tier,
          used: false,
          createdAt: serverTimestamp(),
        });
        if (el.adminKeyOut) {
          el.adminKeyOut.textContent = key;
          el.adminKeyOut.hidden = false;
        }
        showMsg("Ключ создан.", true);
      } catch (e) {
        showMsg(e.message || "Ошибка создания ключа", false);
      }
    });
  }

  if (el.adminSavePromo) {
    el.adminSavePromo.addEventListener("click", async function () {
      showMsg("");
      const user = auth.currentUser;
      if (!user) return;
      const ok = await loadIsAdmin(user.uid);
      if (!ok) {
        showMsg("Нет прав администратора.", false);
        return;
      }
      const code = ((el.adminPromoCode && el.adminPromoCode.value) || "")
        .trim()
        .toUpperCase();
      const bonus = parseInt((el.adminPromoBonus && el.adminPromoBonus.value) || "0", 10) || 0;
      const maxUses = parseInt((el.adminPromoMax && el.adminPromoMax.value) || "100", 10) || 100;
      if (code.length < 3) {
        showMsg("Код промокода не короче 3 символов.", false);
        return;
      }
      try {
        await setDoc(doc(db, "promoCodes", code), {
          active: true,
          bonusDays: bonus,
          maxUses: maxUses,
          uses: 0,
          createdAt: serverTimestamp(),
        });
        showMsg("Промокод «" + code + "» сохранён.", true);
      } catch (e) {
        showMsg(e.message || "Ошибка", false);
      }
    });
  }

  document.querySelectorAll("[data-funpay]").forEach(function (a) {
    a.setAttribute("href", FUNPAY_URL);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
