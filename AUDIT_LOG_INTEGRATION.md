# دمج Audit Log آمن في Mitali Hospital

## ما تم تنفيذه

الحل يتكون من مسارين متكاملين:

1. `functions/index.js` يراقب تغييرات Firestore في مجموعات النظام ويسجل الإنشاء والتعديل والحذف تلقائيًا.
2. `api/_lib/firebase-admin.js` يسجل العمليات الإدارية التي لا تظهر ككتابة عميل مباشرة، مثل إنشاء الحسابات وحذفها ومسح بيانات العمل.
3. `firestore.rules` يجعل مجموعة `audit_log` للقراءة من المدير فقط ويمنع عميل المتصفح من الإنشاء أو التعديل أو الحذف.
4. `index.html` لم يعد يحاول حفظ سجل النشاط من العميل، وأزيل زر حذف السجل، وأضيف تحديث لحظي لصفحة السجل.

السجل لا يحفظ `oldValue` أو `newValue` للبيانات الطبية أو المالية. يحفظ فقط نوع العملية، المجموعة، مسار المستند، معرف المنفذ، الحقول التي تغيرت، والوقت. هذا يقلل تسريب البيانات الحساسة داخل سجل التدقيق.

## الملفات

| الملف | الوظيفة |
|---|---|
| `functions/index.js` | Triggers من Cloud Functions الجيل الثاني لكل مجموعة مراقبة |
| `functions/audit.js` | تنقية البيانات، حساب الحقول المتغيرة، وتسجيل العمليات الإدارية |
| `functions/package.json` | اعتماديات Cloud Functions وFirebase Admin |
| `firestore.rules` | منع كتابة audit_log من أي عميل |
| `api/_lib/firebase-admin.js` | دالة `recordAdminAudit` للعمليات الإدارية الخادمية |
| `api/admin/account.js` | تسجيل إنشاء/تعديل/حذف الحسابات ومسار الاسترداد |
| `api/admin/data.js` | تسجيل مسح بيانات العمل |
| `index.html` | إيقاف الحفظ العميل للسجل وإضافة realtime لصفحة السجل |

## التثبيت والنشر

من جذر المشروع:

```bash
cd functions
npm install
npm run lint
cd ..
firebase deploy --only functions,firestore:rules
```

إذا كان المشروع يستخدم مشروع Firebase مختلفًا للتجربة، يجب اختيار المشروع الصحيح قبل النشر باستخدام Firebase CLI، وعدم نشر القواعد مباشرة على الإنتاج قبل اختبارها في Emulator أو مشروع staging.

## ملاحظات مهمة

قواعد Firestore لا تتحكم في عمليات Cloud Functions التي تستخدم Admin SDK؛ لذلك يجب مراجعة كود Functions بنفس عناية مراجعة القواعد.[1]

تستخدم triggers سياق المصادقة `onDocumentWrittenWithAuthContext` عندما يكون متاحًا، ولذلك يمكن حفظ `authId` للكتابة التي قام بها مستخدم. أما عمليات الخادم أو المسح الإداري فتُسجل من endpoint نفسه باستخدام `managerUid` الذي تم استخراجه من ID Token.[2]

الأحداث قد تصل أكثر من مرة أو بترتيب مختلف. لذلك يستخدم الحل `eventId` ثابتًا ومعرف مستند حتميًا مع `create()` بدل `set()` لمنع إعادة المحاولة من استبدال سجل قديم.[2]

## ما لا يعنيه الحل

هذا الحل يجعل `audit_log` غير قابل للتلاعب من مستخدم Firebase العادي أو من واجهة المتصفح. لكنه لا يمنع مدير مشروع Google Cloud أو حساب خدمة يملك صلاحية Admin SDK من تعديل البيانات؛ وللحاجة إلى سجل عالي الحساسية يمكن إضافة تصدير إلى Cloud Logging أو BigQuery أو تخزين append-only منفصل.

كما أن وجود سجل تدقيق لا يمنع الموظف من تعديل بيانات العمل إذا كانت قواعد مجموعات العمل نفسها تسمح بذلك. يجب أن تستمر قواعد الصلاحيات الحالية في حماية مجموعات المرضى والزيارات والمالية، مع اختبار كل دور عبر Firebase Emulator.

## الاختبار المقترح

يجب اختبار الحالات التالية بحسابات منفصلة:

| الاختبار | النتيجة المتوقعة |
|---|---|
| موظف يحاول إنشاء مستند في `audit_log` | رفض `permission-denied` |
| موظف يحاول تعديل سجل سابق | رفض |
| موظف يحاول حذف سجل سابق | رفض |
| مدير يفتح صفحة سجل النشاط | يسمح بالقراءة فقط |
| إنشاء زيارة من مستخدم مسجل | يظهر سجل `create` |
| تعديل زيارة | يظهر سجل `update` مع أسماء الحقول فقط |
| حذف زيارة | يظهر سجل `delete` |
| إعادة إرسال نفس الحدث | لا ينشئ سجلًا مكررًا |
| استدعاء مسح بيانات العمل | يظهر سجل إداري باسم المدير دون حفظ كلمة المرور أو عبارة التأكيد |

## مراجع

[1] [Firebase: بدء استخدام قواعد أمان Cloud Firestore](https://firebase.google.com/docs/firestore/security/get-started)

[2] [Firebase: Cloud Firestore triggers](https://firebase.google.com/docs/functions/firestore-events)

[3] [Firebase: Callable Functions](https://firebase.google.com/docs/functions/callable)

[4] [Firebase: App Check مع Cloud Functions](https://firebase.google.com/docs/app-check/cloud-functions)
