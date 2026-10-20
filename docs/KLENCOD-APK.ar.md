# بناء EngX APK: إصلاح خطأ Flutter في Klencod

## سبب الخطأ الذي ظهر لك

السجل المرفق يشغّل `Setup Flutter` ثم `flutter pub get`، وبعده يظهر:

```text
Expected to find project root in current working directory.
Process completed with exit code 1.
```

**EngX ليس مشروع Flutter.** هو React + TypeScript + Vite داخل Capacitor 7، ومشروع Android الأصلي موجود في `android/`. لذلك لا يوجد `pubspec.yaml` ولا كود Dart، وهذا مقصود. الأمر `flutter pub get` يبحث عن مشروع Flutter غير موجود؛ تغيير المجلد وحده لن يحل المشكلة. كذلك السجل يجهز Java 17، بينما مسار البناء المعتمد لهذه الحزمة يحتاج **JDK 21**.

لا تضف `pubspec.yaml` وهميًا، ولا تشغّل `flutter create` أو `flutter build apk`، ولا تحوّل التطبيق إلى React Native. هذه الخطوات لا تصلح مشروع Capacitor وقد تخلط ملفات Android أو تستبدلها.

## افتح الجذر الصحيح

هذه النسخة من ZIP تضع **محتويات المشروع مباشرة في جذر الأرشيف** دون مجلد `EngX/` إضافي. بعد فك الضغط يجب أن ترى:

```text
package.json
package-lock.json
capacitor.config.ts
src/
android/
scripts/android-apk.mjs
.github/workflows/android-apk.yml
```

اختر المجلد الذي يحتوي هذه الملفات. لا ترفع ملف ZIP كما هو إلى مستودع GitHub ولا تفتح `dist/` باعتباره المصدر. يجب نسخ المجلد المخفي `.github` أيضًا. لا تحتوي الحزمة على `node_modules`؛ ثبّته باستخدام `npm ci`.

## ماذا تفعل في Klencod؟

**من الخيارات الأربعة التي ظهرت لك اختَر Android (Java) كتجربة استيراد للمشروع الموجود.** نقطة الدخول هي `android/app/src/main/java/com/engx/app/MainActivity.java`. المشروع مختلط Java/Kotlin، لذلك أبقِ إضافة Kotlin وملفات `.kt`. لا تختَر Flutter أو React Native؛ ووجود Kotlin في الإضافات لا يتطلب اختيار قالب Android (Kotlin) بدلًا من المشروع الموجود.

راجِع [دليل الاختيار والاستيراد](../KLENCOD-IMPORT.ar.md): جذر npm هو المجلد الذي يحتوي `package.json`، وجذر Gradle هو `android/`. جهّز المشروع من جذر npm بـ`npm ci` ثم `npm run android:sync`، وحدِّد `android/` عند طلب مجلد Android إن كانت الواجهة تسمح بذلك. لا تنقل `android/` وحده، لأن إعداداته تشير إلى `../node_modules`. لا تسمح لقالب جديد باستبدال ملفات المشروع.

هذه توصية بأقرب نوع من المعروض، وليست تأكيدًا أن Klencod يدعم Capacitor. إن كان يتيح استيراد مشروع موجود وتشغيل أوامر مخصصة بأدوات Node وJava وAndroid SDK، استخدم الأوامر أدناه. إذا كان يقبل ZIP بجذر Gradle فقط دون اختيار مجلد فرعي أو تجهيز npm، فالحزمة الكاملة قد لا تناسب مستورده. اختيار Java/Kotlin وحده لا يكفي إذا كانت عملية البناء تتجاهل npm أو لا تتيح تعديل الأوامر. لم يُختبر استيراد Klencod أو بناء APK لهذه النسخة.

**إذا ظل السجل يعرض `Setup Flutter` أو `flutter pub get`، فالمنصة لا تزال تشغّل workflow الخطأ.** تعديل الملفات داخل ZIP لا يمكنه إجبار زر Flutter في Klencod على تشغيل Capacitor. أوقف محاولة Flutter واستخدم workflow المرفق من GitHub Actions مباشرة، أو Android Studio. وإذا كان Klencod يولد workflow آخر داخل المستودع، لا تشغّله لهذا المشروع؛ اختر `Build EngX Android APK` تحديدًا.

## أسرع مسار من الهاتف: GitHub Actions

1. فك ZIP وارفع محتوياته إلى جذر مستودعك، بما فيها `.github/`. عند تحديث مستودع قائم، استبدل workflow القديم الخاص بهذا المشروع ولا تعتمد على قالب Flutter المولّد. لا تحذف workflows أخرى لا تخصه.
2. تأكد أن الملف `.github/workflows/android-apk.yml` موجود في الفرع الافتراضي للمستودع، حتى يظهر التشغيل اليدوي.
3. افتح GitHub → **Actions → Build EngX Android APK → Run workflow**. إذا طلب GitHub تمكين Actions في مستودعك، فعّلها وفق صلاحياتك.
4. المسار الصحيح يجهز **Node 22 وJava 21 وAndroid SDK 35**، ثم يثبت الحزم ويشغّل الفحص والاختبارات وبناء الويب ومزامنة Capacitor وGradle. لا توجد به خطوة Flutter.
5. بعد نجاح جميع الخطوات، افتح **Artifacts → EngX-debug-APK**، ونزّل الأرشيف وفكّه للحصول على `app-debug.apk`.

الـworkflow يدعم وجود المصدر في جذر المستودع أو في `EngX/`، لكن ملف الـworkflow نفسه يجب أن يبقى داخل `.github/workflows/` في **جذر المستودع** حتى يكتشفه GitHub. إذا رفعت مجلد EngX كاملًا ومعه `.github` داخله، انقل `.github` إلى جذر المستودع.

البناء عبر GitHub يحتاج اتصالًا بالشبكة وصلاحية تشغيل Actions. تم تضمين workflow، لكن لم يُشغّل على حسابك أو داخل Klencod هنا. لا يوجد APK مبني في الحزمة، ولا تُعد نتيجة اختبار الويب إثباتًا لنجاح تجميع Android.

## البناء محليًا أو بأوامر Klencod المخصصة

تحتاج Node.js 22 أو أحدث (المسار المرفق يستخدم 22)، وnpm، و**JDK 21**، وAndroid SDK platform 35 وbuild-tools 35.0.0، واتصالًا لتنزيل الاعتمادات في أول بناء. Gradle Wrapper المرفق يستخدم Gradle 8.11.1؛ لا تحتاج تثبيت Gradle عالميًا.

من جذر المشروع:

```bash
npm ci
npm run android:doctor
npm run android:apk
```

`android:doctor` يفحص الجذر واعتمادات npm وJava ومجلد SDK والمنصة وأدوات البناء، ولا يبني APK. `android:apk` يعيد نفس الفحص ثم ينفّذ:

```bash
npm run android:sync
# أي: npm run build ثم cap sync android
cd android
# Linux/macOS:
sh ./gradlew --no-daemon assembleDebug
# Windows، بدل السطر السابق:
# gradlew.bat --no-daemon assembleDebug
```

مكان الناتج بعد نجاح Gradle:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

هذا **مسار الناتج المتوقع**، وليس إثباتًا أن APK بُني في هذه البيئة. يستخدم السكربت مساره الخاص لتحديد الجذر، ولا يعتمد على مجلد تشغيل الطرفية عند استدعائه مباشرة. أوامر npm نفسها يجب تشغيلها في المجلد الذي يحتوي `package.json`.

## ضبط Java وSDK

اجعل `JAVA_HOME` وGradle JDK في IDE يشيران إلى **JDK 21 نفسه**. لا تستخدم Java 17 كما في السجل لهذه الحزمة. شغّل `java -version` للتشخيص.

اضبط `ANDROID_HOME` إلى مجلد Android SDK الحقيقي في جهاز البناء، أو أنشئ `android/local.properties` محليًا مع `sdk.dir` الصحيح. لا تنسخ مسار جهاز آخر، ولا ترفع `local.properties` إلى المستودع. فحص السكربت يعطي أولوية لـ`sdk.dir` إن وجد، كما يفعل Gradle. ثبّت حزم SDK المطلوبة باستخدام SDK Manager أو:

```bash
sdkmanager 'platforms;android-35' 'build-tools;35.0.0'
```

في Android Studio: بعد `npm ci` و`npm run android:sync` افتح `android/`، واضبط Gradle JDK ثم نفّذ Gradle Sync وبناء debug. لا تحذف `android/` ولا تعاود إنشاء المنصة؛ فيها إضافات EngX الأصلية والودجت والذكاء المحلي.

## لو ظهر خطأ جديد

- `flutter pub get`: workflow خاطئ، وليس اعتمادًا ناقصًا في EngX. اختر المسار المرفق بدل قالب Flutter.
- `package.json` غير موجود أو npm ENOENT: أنت خارج جذر المصدر، أو رفعت ZIP دون فكّه.
- حزم Capacitor مفقودة: نفّذ `npm ci` من الجذر أولًا، ثم أعد المزامنة. `dist/` وحده لا يكفي لبناء Android.
- JDK/SDK ناقص: عالج البند الذي يطبعه `npm run android:doctor`، ولا تغيّر إصدارات Gradle أو المكتبات عشوائيًا.
- Gradle يفشل بعد نجاح sync: احفظ السجل الجديد؛ الخطأ الأصلي كان قبل الوصول إلى Gradle، وإصلاحه لا يضمن عدم وجود مشكلة مستقلة في اعتماد Android أو الشبكة.
- واجهة APK قديمة: أعد `npm run android:apk` بعد تعديل React، لأنه يعيد بناء `dist/` ونسخها عبر Capacitor قبل Gradle.

نسخة debug موقعة تلقائيًا بمفتاح الاختبار وليست إصدار متجر؛ إصدار release يحتاج مفاتيحك وتهيئة توقيع منفصلة. لا توجد مفاتيح توقيع شخصية في الحزمة. إعدادات Google والخادم والذكاء المحلي تبقى كما هي وتحتاج تهيئة واختبارًا على جهاز فعلي بحسب أدلتها.
