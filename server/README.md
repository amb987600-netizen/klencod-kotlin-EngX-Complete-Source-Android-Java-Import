# خادم EngX

خادم Express/Node.js مستقل لتطبيق الصيانة، يستخدم SQLite عبر `better-sqlite3`، JWT، Google ID token، وscrypt لكلمات المرور. جميع البيانات مقيدة بمساحة العمل، وسجل التدقيق authoritative وappend-only (تمنع SQLite triggers التعديل والحذف).

## التشغيل
```bash
cp .env.example .env
# غيّر JWT_SECRET إلى قيمة عشوائية طويلة، واضبط CORS_ORIGIN وGOOGLE_CLIENT_ID عند الحاجة
npm install
npm test
npm start
```

`DATABASE_PATH` و`BACKUP_DIR` مساران محليان. لا يملك الخادم مفتاح تشفير النسخة الاحتياطية؛ يستقبل فقط النص المشفر ويخزنه. احمِ ملف SQLite ومجلد النسخ بتصاريح النظام، واستخدم تشفير القرص ونسخاً خارجية دورية.

## النشر الآمن
شغّل Node خلف Nginx/Caddy مع HTTPS فقط، واجعل proxy يمرر `Authorization`، واضبط `CORS_ORIGIN` على أصل الواجهة الحقيقي (ليس `*`). استخدم مدير أسرار لحقن `JWT_SECRET` و`GOOGLE_CLIENT_ID`. حدّث الاعتماديات، وشغّل migrations/نسخ SQLite بعملية احتياطية، وراقب السجلات والمساحة.

## نقاط العقد
- التسجيل/الدخول/Google تعيد `token,user,workspace,membership`.
- `/api/me` يحتاج Bearer token ويعيد بيانات المستخدم/المساحة/العضوية (بدون token فعلي).
- `/api/sync` ينفذ العمليات ذرياً لكل طلب، ويرفض تعارض الإصدار صراحةً (`VERSION_CONFLICT`)، يفرض idempotency على `op.id`، ويعيد accepted/rejected/records/audit/cursor.
- الأدوار: `owner`, `admin`, `technician`, `viewer`. العرض لا يكتب؛ الدعوات وإدارة الفريق للمالك/المشرف، نقل الملكية للمالك فقط.
- إغلاق الطلب لا يقبل checklist غير مؤكد أو دون approval، والطلب المغلق غير قابل للتعديل. أجهزة `asset_code` فريدة داخل المساحة. إدخال usage السالب مرفوض؛ يجب أن ترسل الواجهة عمليات مخزون صريحة عند الحاجة لمنع السباق بصورة أقوى.

## ملاحظات التوافق
السجل العام يستخدم `records.data` كـ JSON ويحفظ الأنواع `device,order,part,usage,plan,event,attachment,comment,checklist`. `since` في sync هو cursor زمني مبسط (والاستجابة تعيد `Date.now()`)، بينما audit يعاد معه. تحقق المخزون الكامل بين عدة عمليات ليس ممكناً من generic records وحدها؛ الخادم يرفض الكميات السالبة ويترك الرصيد/الحجز للمعاملة المتخصصة في الواجهة أو endpoint مستقبلي.
