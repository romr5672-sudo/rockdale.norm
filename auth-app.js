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

function init() {
  const cfg = typeof window !== "undefined" ? window.__FIREBASE_CONFIG__ : null;
  const banner = document.getElementById("firebase-banner");
  const accountRoot = document.getElementById("account-root");

  if (!cfg || !cfg.apiKey || cfg.apiKey.includes("ВАШ")) {
    if (banner) {
      banner.hidden = false;
      banner.textContent =
        "Firebase: скопируйте firebase-config.example.js в firebase-config.js и вставьте ключи из консоли Firebase.";
    }
    if (accountRoot) {
      accountRoot.querySelectorAll("input, button, .auth-only").forEach(function (el) {
        if (el.matches("input,button")) el.disabled = true;
      });
    }
    return;
  }

  if (banner) banner.hidden = true;

  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const el = {
    authGuest: document.getElementById("auth-guest"),
    authUser: document.getElementById("auth-user"),
    userEmail: document.getElementById("user-email"),
    subStatus: document.getElementById("sub-status"),
    regEmail: document.getElementById("reg-email"),
    regPass: document.getElementById("reg-pass"),
    regName: document.getElementById("reg-name"),
    regPromo: document.getElementById("reg-promo"),
    btnReg: document.getElementById("btn-register"),
    loginEmail: document.getElementById("login-email"),
    loginPass: document.getElementById("login-pass"),
    btnLogin: document.getElementById("btn-login"),
    btnLogout: document.getElementById("btn-logout"),
    keyInput: document.getElementById("redeem-key"),
    promoInput: document.getElementById("redeem-promo"),
    btnRedeem: document.getElementById("btn-redeem"),
    authMsg: document.getElementById("auth-msg"),
  };

  function showMsg(text, ok) {
    if (!el.authMsg) return;
    el.authMsg.textContent = text;
    el.authMsg.className = "auth-msg" + (ok === false ? " auth-msg--err" : ok === true ? " auth-msg--ok" : "");
  }

  async function refreshProfile(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.data() || {};
    const sub = data.subscription;
    if (el.subStatus) el.subStatus.textContent = formatSub(sub);
  }

  onAuthStateChanged(auth, async function (user) {
    if (!el.authGuest || !el.authUser) return;
    if (user) {
      el.authGuest.hidden = true;
      el.authUser.hidden = false;
      if (el.userEmail) el.userEmail.textContent = user.email || "";
      try {
        await refreshProfile(user.uid);
      } catch (e) {
        if (el.subStatus) el.subStatus.textContent = "Не удалось загрузить профиль";
      }
    } else {
      el.authGuest.hidden = false;
      el.authUser.hidden = true;
      showMsg("");
    }
  });

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
        showMsg("Вошли.", true);
      } catch (e) {
        showMsg(e.message || "Ошибка входа", false);
      }
    });
  }

  if (el.btnLogout) {
    el.btnLogout.addEventListener("click", function () {
      signOut(auth);
    });
  }

  if (el.btnRedeem) {
    el.btnRedeem.addEventListener("click", async function () {
      showMsg("");
      const user = auth.currentUser;
      if (!user) {
        showMsg("Сначала войдите в аккаунт.", false);
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
              promoWarning = "Промокод не найден — подписка по ключу без бонуса.";
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
                promoWarning = "Промокод недействителен или закончился.";
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
