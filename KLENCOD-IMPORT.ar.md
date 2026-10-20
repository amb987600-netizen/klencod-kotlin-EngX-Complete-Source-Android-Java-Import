# EngX — اختَر Android (Java) في Klencod

**من الاختيارات الأربعة الظاهرة لك، اختَر Android (Java).** هذا أقرب مسار لتجربة استيراد مشروع Android الموجود، وليس ضمانًا بأن Klencod يدعم Capacitor.

## لماذا هذا الاختيار؟

| الاختيار | هل تختاره لهذه الحزمة؟ |
| --- | --- |
| Flutter | لا؛ لا يوجد Dart أو `pubspec.yaml`. |
| Android (Java) | **الاختيار المقترح للتجربة**؛ نقطة الدخول `MainActivity.java` ومشروع Gradle موجودان في `android/`. |
| Android (Kotlin) | ليس الاختيار المقترح؛ وجود إضافات Kotlin لا يحوّل التطبيق إلى قالب Kotlin. مشروع Android نفسه مختلط Java/Kotlin. |
| React Native | لا؛ واجهة React/TypeScript تعمل عبر Capacitor، وليست React Native. |

لا تعِد إنشاء التطبيق بقالب جديد، ولا تستبدل `MainActivity.java` أو ملفات Gradle. احتفظ بإضافة Kotlin وملفات `.kt`؛ اختيار Java لا يعني حذف Kotlin.

## خطوات الاستيراد المقترحة

1. فك ضغط الحزمة كاملة. احتفظ بالمجلدات بجوار بعضها؛ لا تنقل `android/` وحده، لأنه يعتمد على `../node_modules`.
2. من المجلد الذي يحتوي `package.json`، جهّز الاعتماديات والأصول:

   ```bash
   npm ci
   npm run android:sync
   ```

3. في Klencod اختَر **Android (Java)**، واستخدم استيراد مشروع موجود إن كانت الواجهة تسمح به، لا إنشاء قالب Java جديد.
4. إذا طلب مجلد مشروع Android أو مسار Gradle، حدِّد **`android/`**؛ يحتوي `settings.gradle` و`build.gradle` و`gradlew` و`app/`. جذر الحزمة الكامل هو جذر npm، وليس جذر Gradle.
5. اضبط بيئة البناء على **JDK 21 وAndroid SDK platform 35 وbuild-tools 35.0.0**. تجهيز الويب ومزامنته يحتاجان Node 22+ وnpm. هذه متطلبات المشروع، وليست تأكيدًا أن Klencod يتيح ضبطها.
6. إذا أتاح Klencod أوامر مخصصة من جذر الحزمة، استخدم:

   ```bash
   npm ci
   npm run android:doctor
   npm run android:apk
   ```

   أما إذا كان يبني Gradle فقط، فبعد التجهيز في الخطوة 2 يشغّل البناء من `android/`:

   ```bash
   sh ./gradlew --no-daemon assembleDebug
   ```

   يجب بقاء `node_modules` بجوار `android/` أثناء البناء. إذا نقلت المشروع لبيئة أخرى، أعد `npm ci` هناك. الأصول المضمنة لا تعوّض مكتبات Capacitor الأصلية.

## إذا كان الاستيراد يقبل ZIP فقط

هذه حزمة المصدر الكاملة: `package.json` في الجذر، ومشروع Android داخل `android/`. لا نفترض أن Klencod يكتشف هذا التخطيط تلقائيًا. إذا لم يسمح باختيار `android/` أو تجهيز npm، أو إذا استبدل ملفات Gradle بقالب من عنده، فاختيار **Android (Java)** وحده لن يكفي. لا ترفع `android/` منفردًا كحل؛ ستفقد روابط الاعتماديات.

عندها استخدم ملف GitHub Actions المرفق: ارفع محتويات الحزمة كاملة، بما فيها `.github/`، إلى جذر مستودعك، ثم **Actions → Build EngX Android APK → Run workflow**. بعد نجاح البناء فقط نزّل **EngX-debug-APK** من Artifacts. أو افتح `android/` في Android Studio بعد تجهيز npm والمزامنة. التفاصيل في [دليل البناء](docs/KLENCOD-APK.ar.md).

## حدود التعديل

التعديل يوضح نوع الاستيراد والمسارات والمتطلبات؛ **لم يُحوَّل EngX إلى تطبيق Java خالص أو Flutter أو React Native**. لم يُختبر الاستيراد أو البناء داخل Klencod، ولم يُبنَ APK للتحقق من هذه النسخة، ولم يُشغَّل GitHub Actions على حسابك. لا تحتوي الحزمة على APK جاهز. مسار الناتج المتوقع **بعد نجاح البناء فقط** هو:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
