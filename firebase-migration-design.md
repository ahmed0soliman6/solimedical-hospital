# تصميم تحويل تطبيق مستشفى ميتالي إلى Firebase Firestore

## المبدأ العام

يُستخدم Firestore كمصدر البيانات الوحيد للتطبيق. تتصل الواجهة بطبقة بيانات واحدة، وتستخدم IndexedDB وlocalStorage ككاش محلي مؤقت عند ضعف الاتصال.

## نموذج البيانات المرحلي المتوافق مع التطبيق الحالي

لأن التطبيق الحالي يتعامل مع مصفوفات وجداول من خلال مفاتيح ثابتة، يبدأ الترحيل باستخدام Collections مسطحة تحافظ على نفس المعرفات والحقول. هذا يقلل إعادة كتابة الواجهة، ثم يمكن تطبيع المرضى والزيارات لاحقاً.

| مفتاح التطبيق | Collection المقترح | المعرّف | الغرض |
|---|---|---|---|
| `doctors` | `doctors` | `id` | بيانات الأطباء والتخصصات والحصص |
| `employees` | `employees` | `id` | الموظفون والرواتب والحالة |
| `visitsClinic` | `visits_clinic` | `id` | زيارات العيادات |
| `visitsDental` | `visits_dental` | `id` | حالات الأسنان |
| `visitsOperations` | `visits_operations` | `id` | العمليات |
| `visitsLabs` | `visits_labs` | `id` | التحاليل |
| `visitsRadiology` | `visits_radiology` | `id` | الأشعة |
| `income` | `income` | `id` | الوارد والتحصيل |
| `expense` | `expense` | `id` | المنصرف |
| `payroll` | `payroll` | `id` | المرتبات والمستحقات |
| `staffAccounts` | `staff_accounts` | `id` | ملف صلاحيات المستخدم، وليس كلمة المرور |
| `auditLog` | `audit_log` | `id` | سجل النشاط |
| `labExpenses` | `lab_expenses` | `id` | مصروفات التحاليل |
| `settings` | `settings/app` | `app` | الإعدادات العامة |
| `categories` | `settings/app` | `app.categories` | التصنيفات |
| `specialties` | `settings/app` | `app.specialties` | التخصصات |

## النموذج المنظم للمرضى والزيارات

النسخة الأولى يمكنها إبقاء اسم المريض داخل الزيارة حتى لا تتغير الواجهة، لكن النموذج الأفضل مستقبلاً هو:

```text
patients/{patientId}
patients/{patientId}/visits/{visitId}
visits/{visitId}
income/{incomeId}
```

يحتوي مستند المريض على الاسم والهاتف ورقم الملف. ويحتوي مستند الزيارة على `patientId` و`doctorId` و`date` و`total` و`paid` و`linkedIncomeId`. وجود Collection عامة للزيارات يساعد التقارير، بينما يتيح المسار الفرعي عرض ملف المريض بسرعة.

## التقارير المالية

Firestore لا ينفذ `JOIN` مثل PostgreSQL، لذلك لا ينبغي حساب التقارير الكبيرة من داخل الواجهة بقراءة كل السجلات. سنستخدم مستندات تجميعية شهرية:

```text
reports_monthly/{YYYY-MM}
reports_monthly/{YYYY-MM}/doctors/{doctorId}
reports_monthly/{YYYY-MM}/categories/{categoryId}
```

مثال مستند الطبيب:

```json
{
  "doctorId": "d1",
  "month": "2026-08",
  "visitsCount": 42,
  "grossAmount": 3500,
  "paidAmount": 2800,
  "remainingAmount": 700,
  "updatedAt": "server timestamp"
}
```

عند إنشاء أو تعديل أو حذف زيارة أو حركة مالية، تُحدّث الوثيقة الأصلية وتُحدّث التجميعات في Transaction أو Cloud Function. لا تُعتبر العملية مكتملة إلا بعد نجاح الاثنين، أو تُسجّل في طابور إعادة المحاولة.

## المصادقة والصلاحيات

لا ينبغي نقل كلمات المرور الحالية إلى Firestore. يجب استخدام Firebase Authentication، مع Collection ملف للمستخدم:

```text
users/{uid}
username_index/{normalizedUsername}
```

ويحتوي ملف المستخدم على `username` و`displayName` و`role` و`status` و`permissions`. كلمات المرور تبقى داخل Firebase Auth ولا تُخزّن في Firestore. لأن التطبيق الحالي يستخدم اسم مستخدم بدلاً من البريد، نحتاج إما إلى إضافة بريد لكل مستخدم، أو إنشاء طبقة خادم تحول اسم المستخدم إلى حساب Firebase Auth ثم تنفذ تسجيل الدخول بأمان.

## قواعد أمان أولية

لا يُسمح للواجهة بقراءة كل المستخدمين أو تعديل الصلاحيات اعتماداً على وجود زر في الواجهة فقط. يجب أن تعتمد Firestore Security Rules على `request.auth.uid` وملف المستخدم وصلاحياته. العمليات المالية والحذف الجماعي يجب أن تمر عبر قواعد تحقق أو Cloud Functions، خصوصاً عند وجود بيانات مرضى حقيقية.

## خطة التشغيل المرحلي

1. إنشاء Firebase Project وFirestore وAuthentication.
2. إنشاء طبقة `dataStore` مستقلة تدعم `getTable` و`saveTable` و`deleteRecord` و`subscribe`.
3. نقل البيانات التاريخية إلى Collections المسطحة في Firestore باستخدام مسار إداري آمن.
4. التحقق من أعداد السجلات ونتائج التقارير داخل Firestore.
5. تشغيل القراءة والكتابة والمزامنة اللحظية من Firestore.
6. نقل المستخدمين إلى Firebase Auth وإجبار تعيين كلمات مرور جديدة عند الحاجة.
7. اختبار المرضى والزيارات والوارد والمنصرف والحذف والتقارير قبل التشغيل الكامل.

## ملاحظة تشغيلية

إعداد Firebase client يمكن أن يكون في الواجهة، لكن العمليات الإدارية الجماعية وإنشاء المستخدمين دفعة واحدة وتحديث التجميعات الكبيرة ينبغي تنفيذها عبر بيئة خادم أو Cloud Functions، مع عدم وضع مفاتيح إدارية داخل المستودع أو داخل Electron.
