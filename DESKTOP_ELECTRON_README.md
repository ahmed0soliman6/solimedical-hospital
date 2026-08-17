# تطبيق مستشفى ميت على لسطح المكتب

تمت إضافة غلاف Electron لتشغيل الموقع كتطبيق Windows مستقل. التطبيق يفتح نسخة `index.html` المحلية داخل نافذة آمنة، بينما يظل Firebase مصدر البيانات والمزامنة نفسه.

## التشغيل المحلي للتطوير

من داخل مجلد المشروع:

```bash
npm install
npm run desktop:start
```

## إنشاء مثبت Windows EXE

أمر البناء هو:

```bash
npm run desktop:dist
```

هذا الأمر يحتاج بيئة Windows أو Wine. في هذا المشروع، ملف GitHub Actions التالي ينفذ البناء على `windows-latest`:

```text
.github/workflows/build-windows-exe.yml
```

يمكن تشغيله يدويًا من GitHub عبر **Actions → Build Windows EXE → Run workflow**. بعد نجاح التشغيل، يُحمّل الملف من **Artifacts → Mitali-Hospital-Windows**. اسم المثبت يكون قريبًا من:

```text
Mitali-Hospital-Setup-1.3.22.exe
```

## ملاحظات التشغيل

التطبيق المحلي يستخدم Firebase Web SDK وIndexedDB و`syncQueue` كما في الموقع. لذلك يعمل محليًا عند انقطاع الإنترنت على الأجهزة التي سبق اعتمادها، ثم يرفع التغييرات عند عودة الاتصال. عمليات إدارة الحسابات الحساسة تحتاج اتصالًا بـ Firebase وواجهة API المنشورة، ولا يُعلن نجاحها قبل تأكيد الحفظ السحابي.

لأن النسخة المحلية تعمل عبر `file://`، تم جعل مسارات الموارد نسبية، وتم توجيه API الإدارة إلى `https://mitali1.vercel.app`. كما تم تعطيل Service Worker داخل `file://` فقط؛ لا يؤثر ذلك على IndexedDB أو outbox المحلي.

لا يحتوي ملف Electron على Service Account private key أو أي مفتاح إداري. Firebase Authentication وCloud Firestore يستمران في استخدام إعدادات العميل الحالية، وتبقى حماية المدير في endpoint الخادمي.

## الملفات الجديدة أو المعدلة

| الملف | الغرض |
|---|---|
| `desktop/main.cjs` | إنشاء نافذة Electron آمنة وفتح `index.html` المحلي |
| `desktop/preload.cjs` | جسر محدود يعرض معلومات سطح المكتب دون Node.js للواجهة |
| `desktop/icon.ico` | أيقونة Windows للمثبت والاختصار |
| `.github/workflows/build-windows-exe.yml` | بناء EXE ورفعه كـ Artifact على Windows |
| `package.json` و`package-lock.json` | إعداد Electron وelectron-builder وأوامر البناء |
| `firebase-store.js` | دعم عنوان API عند تشغيل النسخة المحلية |
| `index.html` | مسارات نسبية وتهيئة Electron وService Worker |
| `api/admin/account.js` | CORS محدود لـ `origin: null` الخاص بملفات Electron |

## التحقق

تم اجتياز `npm test`، وفحص صياغة ملفات Electron، وفحص diff. محاولة بناء NSIS على Linux جهزت الحزمة المحلية ثم توقفت لأن Wine غير مثبت؛ لذلك يتولى GitHub Actions بناء مثبت Windows النهائي على بيئة Windows أصلية.
