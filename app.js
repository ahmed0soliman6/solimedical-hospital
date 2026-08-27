"use strict";

const LOCAL_AUTH = Object.freeze({
  username: "admin",
  displayName: "مدير النظام",
  role: "مدير",
  salt: "solimedical-local-admin-v1",
  // PBKDF2-SHA-256, 120000 iterations. The plain password is not stored here.
  verifier: "085521de8bd3847d6b9e17c51cd0381caa818b570cf5ff477d4fdd62e22e6c11",
});

const SESSION_KEY = "solimedical-demo-session-v1";
const FAILURES_KEY = "solimedical-demo-login-guard-v1";
const MAX_FAILURES = 5;
const LOCK_MS = 60 * 1000;
const app = document.getElementById("app");

const icons = {
  dashboard: "⌂",
  patients: "♙",
  calendar: "▦",
  doctors: "⚕",
  reports: "▤",
  settings: "⚙",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const session = raw ? JSON.parse(raw) : null;
    if (!session || Number(session.expiresAt) <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch (_) {
    return null;
  }
}

function saveSession() {
  const session = {
    username: LOCAL_AUTH.username,
    displayName: LOCAL_AUTH.displayName,
    role: LOCAL_AUTH.role,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function loginGuard() {
  try {
    const guard = JSON.parse(localStorage.getItem(FAILURES_KEY) || "{}");
    if (Number(guard.lockedUntil) > Date.now()) return guard;
    return { failures: 0, lockedUntil: 0 };
  } catch (_) {
    return { failures: 0, lockedUntil: 0 };
  }
}

function registerFailure() {
  const guard = loginGuard();
  guard.failures = Number(guard.failures || 0) + 1;
  if (guard.failures >= MAX_FAILURES) {
    guard.failures = 0;
    guard.lockedUntil = Date.now() + LOCK_MS;
  }
  localStorage.setItem(FAILURES_KEY, JSON.stringify(guard));
}

function clearFailures() {
  localStorage.removeItem(FAILURES_KEY);
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveVerifier(password, salt) {
  if (!window.crypto?.subtle) throw new Error("secure-context-required");
  const key = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await window.crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

function brandMarkup(compact = false) {
  return `<div class="${compact ? "side-brand" : "brand-lockup"}">
    <div class="brand-mark">+</div>
    <div><span class="brand-name">SoliMedical</span><span class="brand-sub">نظام إدارة المستشفى</span></div>
  </div>`;
}

function renderLogin(error = "") {
  app.innerHTML = `<main class="login-shell">
    <section class="login-visual">
      <div class="visual-content">
        ${brandMarkup()}
        <h1>رعاية أفضل،<br>بإدارة أبسط.</h1>
        <p>نسخة تجريبية محلية لمنصة SoliMedical لإدارة بيانات المستشفى والعيادات بطريقة واضحة وآمنة وقابلة للتطوير.</p>
        <div class="feature-list">
          <div class="feature-chip"><b>✓</b><span>ملفات المرضى</span></div>
          <div class="feature-chip"><b>✓</b><span>تنظيم المواعيد</span></div>
          <div class="feature-chip"><b>✓</b><span>إدارة الأطباء</span></div>
          <div class="feature-chip"><b>✓</b><span>تقارير تشغيلية</span></div>
        </div>
      </div>
    </section>
    <section class="login-panel">
      <div class="login-card">
        <div class="mobile-brand">${brandMarkup()}</div>
        <h2>مرحبًا بعودتك</h2>
        <p class="intro">سجّل الدخول إلى لوحة إدارة SoliMedical التجريبية.</p>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="username">اسم المستخدم</label>
            <input id="username" name="username" type="text" autocomplete="username" placeholder="أدخل اسم المستخدم" required>
          </div>
          <div class="field">
            <label for="password">كلمة المرور</label>
            <div class="input-wrap">
              <input id="password" name="password" type="password" autocomplete="current-password" placeholder="أدخل كلمة المرور" required>
              <button class="password-toggle" type="button" id="toggle-password">إظهار</button>
            </div>
          </div>
          <div class="error-box" id="login-error"${error ? ' style="display:block"' : ""}>${escapeHtml(error)}</div>
          <button class="login-btn" type="submit">تسجيل الدخول</button>
        </form>
        <div class="local-note"><span>●</span><div><strong>وضع تجريبي محلي</strong>لا يوجد اتصال بـ Firebase أو أي قاعدة بيانات خارجية. البيانات تحفظ على هذا المتصفح فقط.</div></div>
        <div class="login-footer">SoliMedical Hospital · Local Preview</div>
      </div>
    </section>
  </main>`;

  document.getElementById("toggle-password").addEventListener("click", () => {
    const input = document.getElementById("password");
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    document.getElementById("toggle-password").textContent = visible ? "إظهار" : "إخفاء";
  });

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = document.getElementById("username").value.trim().toLowerCase();
    const password = document.getElementById("password").value;
    const errorBox = document.getElementById("login-error");
    const button = event.currentTarget.querySelector("button[type=submit]");
    const guard = loginGuard();
    if (guard.lockedUntil > Date.now()) {
      const seconds = Math.ceil((guard.lockedUntil - Date.now()) / 1000);
      renderLogin(`تم إيقاف المحاولات مؤقتًا. حاول بعد ${seconds} ثانية.`);
      return;
    }
    if (!username || !password) {
      errorBox.textContent = "يرجى إدخال اسم المستخدم وكلمة المرور.";
      errorBox.style.display = "block";
      return;
    }
    button.disabled = true;
    button.textContent = "جارٍ التحقق...";
    try {
      const verifier = await deriveVerifier(password, LOCAL_AUTH.salt);
      if (username !== LOCAL_AUTH.username || verifier !== LOCAL_AUTH.verifier) {
        registerFailure();
        renderLogin("اسم المستخدم أو كلمة المرور غير صحيحة.");
        return;
      }
      clearFailures();
      saveSession();
      renderDashboard();
    } catch (_) {
      button.disabled = false;
      button.textContent = "تسجيل الدخول";
      errorBox.textContent = "افتح الصفحة عبر HTTPS أو localhost لتفعيل التحقق المحلي الآمن.";
      errorBox.style.display = "block";
    }
  });
}

function renderDashboard() {
  const session = getSession();
  if (!session) return renderLogin();
  app.innerHTML = `<main class="app-shell">
    <aside class="sidebar">
      ${brandMarkup(true)}
      <div class="side-label">القائمة الرئيسية</div>
      <nav class="nav-list">
        ${[
          ["dashboard", "الرئيسية"], ["patients", "المرضى"], ["calendar", "المواعيد"], ["doctors", "الأطباء"], ["reports", "التقارير"], ["settings", "الإعدادات"],
        ].map(([key, label], index) => `<button class="nav-item${index === 0 ? " active" : ""}" data-demo-action="${key}"><span class="nav-icon">${icons[key]}</span><span>${label}</span></button>`).join("")}
      </nav>
      <div class="sidebar-bottom">
        <div class="user-mini"><div class="avatar">أ</div><div><strong>${escapeHtml(session.displayName)}</strong><span>مدير النظام</span></div></div>
        <button class="logout-btn" id="logout">تسجيل الخروج</button>
      </div>
    </aside>
    <section class="main">
      <header class="topbar">
        <div><div class="eyebrow">لوحة التحكم</div><h2>صباح الخير، ${escapeHtml(session.displayName)}</h2><p>إليك ملخص التشغيل في النسخة التجريبية المحلية.</p></div>
        <div class="status-pill"><span class="status-dot"></span> محلي فقط · متصل</div>
      </header>
      <section class="stats">
        <article class="stat-card"><div class="stat-top"><span>إجمالي المرضى</span><span class="stat-icon">♙</span></div><strong>1,284</strong><small>بيانات تجريبية للعرض</small></article>
        <article class="stat-card"><div class="stat-top"><span>مواعيد اليوم</span><span class="stat-icon">▦</span></div><strong>36</strong><small>8 مواعيد قادمة</small></article>
        <article class="stat-card"><div class="stat-top"><span>الأطباء النشطون</span><span class="stat-icon">⚕</span></div><strong>24</strong><small>في 5 أقسام</small></article>
        <article class="stat-card"><div class="stat-top"><span>نسبة الحضور</span><span class="stat-icon">↗</span></div><strong>89%</strong><small>خلال هذا الأسبوع</small></article>
      </section>
      <div class="content-grid">
        <section class="section-card">
          <div class="section-heading"><h3>الوحدات الأساسية</h3><span>نسخة العرض</span></div>
          <div class="module-grid">
            ${[
              ["♙", "ملفات المرضى", "سجل الزيارات والمعلومات الأساسية"], ["▦", "المواعيد", "تقويم وتنظيم مواعيد العيادات"], ["⚕", "الأطباء والفروع", "إدارة الفرق والتخصصات"], ["▤", "التقارير", "ملخصات تشغيلية ومالية"], ["▣", "التحاليل والأشعة", "متابعة الخدمات الطبية"], ["◈", "الخزينة", "الوارد والمنصرف والمستحقات"],
            ].map(([icon, title, description], index) => `<button class="module" data-demo-action="module-${index}"><span class="module-icon">${icon}</span><strong>${title}</strong><span>${description}</span></button>`).join("")}
          </div>
          <div class="notice"><span>✓</span><div><b>بيئة آمنة للتجربة</b><br>كل ما تراه الآن تجريبي ومحفوظ محليًا على جهازك فقط، وسيتم ربطه بقاعدة البيانات عند اعتماد Firebase لاحقًا.</div></div>
        </section>
        <section class="section-card">
          <div class="section-heading"><h3>مواعيد قادمة</h3><span>اليوم</span></div>
          <div class="appointment-list">
            ${[
              ["09:00", "أحمد محمد", "عيادة الباطنة", "مؤكد"], ["10:30", "سارة علي", "عيادة الأسنان", "مؤكد"], ["12:00", "محمد حسن", "الأشعة", "جديد"], ["13:30", "مريم خالد", "التحاليل", "مؤكد"],
            ].map(([time, name, department, tag]) => `<div class="appointment"><span class="time">${time}</span><div class="person"><strong>${name}</strong><span>${department}</span></div><span class="tag">${tag}</span></div>`).join("")}
          </div>
        </section>
      </div>
    </section>
  </main>`;

  document.getElementById("logout").addEventListener("click", () => {
    clearSession();
    renderLogin();
  });
  document.querySelectorAll("[data-demo-action]").forEach((element) => {
    element.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      if (element.classList.contains("nav-item")) element.classList.add("active");
      showToast("هذه وحدة تجريبية وستُفعّل في المرحلة التالية.");
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  if (getSession()) renderDashboard();
  else renderLogin();
});
