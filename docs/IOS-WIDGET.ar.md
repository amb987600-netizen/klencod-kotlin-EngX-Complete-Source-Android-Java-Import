# ودجت EngX الأصلية لـ iPhone

تمت إضافة WidgetKit native إلى مشروع iOS في `ios/App/` دون تعديل ملفات الواجهة أو Android.

## ما تم تنفيذه

- Capacitor plugin باسم `EngXWidgets` مسجل بجانب `EngXPrinterPlugin` داخل `AppDelegate.swift`.
- عقد JavaScript:

```ts
registerPlugin('EngXWidgets').update({
  enabled: boolean,
  openOrders: number,
  pmDue: number,
  upcoming: [{ title: string, date: string }],
  updatedAt: string
})
```

  يتم تنظيف الأعداد والعناوين والتواريخ، حفظ JSON في `UserDefaults(suiteName: "group.com.engx.app")` بالمفتاح `engx-widget-snapshot`، ثم استدعاء `WidgetCenter.shared.reloadTimelines(ofKind: "EngXWidget")`.
- الهدف `EngXWidget` موجود فعليًا في `App.xcodeproj/project.pbxproj`، مع `Widget.swift` و`Info.plist` ومرحلة Embed Foundation Extensions واعتمادية target صحيحة.
- يدعم iOS 14+ العائلتين Small وMedium. يعرض Medium حتى 3 مواعيد PM مع التواريخ المرسلة من التطبيق، وعدد الأوامر المفتوحة وPM المستحقة، وحداثة آخر snapshot.
- روابط الاختصارات: `engx://new-order` و`engx://scan`، والرابط الجذري للودجت `engx://home`.
- عند `enabled: false` لا يعرض الودجت أسماء الأصول/المستشفى ويعرض فقط: **افتح EngX لتفعيل الودجت**.
- الـ timeline يستخدم snapshot المخزن ويطلب إعادة تحديث بعد 30 دقيقة فقط. لا يدّعي جلب IndexedDB أو بيانات حالية أثناء عمل التطبيق في الخلفية؛ الكتابة تحدث فقط عندما يرسل التطبيق تحديثًا.

## إعداد Signing وApp Group في Xcode

لا يمكن إنشاء App Group أو ملفات provisioning مدفوعة من هذه البيئة. على جهاز macOS، افتح `ios/App/App.xcodeproj` في Xcode ثم:

1. اختر مشروع **App** ثم target **App** → **Signing & Capabilities**.
2. اختر **Development Team** الصحيح لحساب Apple Developer الخاص بالمنتج (لا يوجد Team ID فعلي محفوظ في المستودع).
3. اضغط **+ Capability** واختر **App Groups**، ثم أضف `group.com.engx.app`.
4. اختر target **EngXWidget** وكرر اختيار نفس Development Team وإضافة **App Groups** بالقيمة نفسها.
5. تأكد أن Bundle ID للامتداد هو `com.engx.app.EngXWidget`، وأن Bundle ID للتطبيق هو `com.engx.app`.
6. في Apple Developer → Certificates, Identifiers & Profiles، سجّل App Group `group.com.engx.app` واربطه بمعرّفي التطبيق والامتداد، ثم دع Xcode يجدد provisioning profiles.
7. اختر scheme **App**، ثبّت التطبيق ثم أضف **EngX Maintenance** من معرض الودجت في iPhone.

ملفات entitlement موجودة مسبقًا للهدفين وتحتوي المجموعة نفسها، لكن صلاحية الاستخدام الفعلية تعتمد على Team وProfiles أعلاه.

## ملاحظات الاختبار

- حدّث snapshot من التطبيق بعد تغيّر البيانات؛ لا تعتمد على background fetch أو قراءة مباشرة من IndexedDB.
- جرّب `enabled: false` للتأكد من عدم ظهور أسماء أصول المستشفى.
- جرّب الروابط الثلاثة بعد تثبيت التطبيق (`engx://home`, `engx://new-order`, `engx://scan`). مخطط `engx` موجود مسبقًا في `CFBundleURLTypes`.
- لا يمكن بناء أو تشغيل مشروع iOS/Xcode على Linux؛ يلزم macOS مع Xcode للتحقق من Swift compilation، signing، embedding، والتثبيت على iPhone. تم إجراء تحقق نصي هنا من توازن أقواس `project.pbxproj` ووجود target/build phases/settings المطلوبة فقط.
