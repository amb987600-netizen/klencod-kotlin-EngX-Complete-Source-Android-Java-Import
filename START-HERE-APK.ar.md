# EngX — اختَر Android (Java)

**من الاختيارات الأربعة في Klencod اختَر Android (Java) كتجربة استيراد.** المشروع React/TypeScript + Capacitor، ونقطة دخول Android هي `MainActivity.java`، مع إضافات Kotlin يجب الاحتفاظ بها. ليس Flutter ولا React Native، ولم يُحوَّل إلى Java خالص.

## ابدأ هنا

افتح [دليل اختيار النوع والاستيراد](KLENCOD-IMPORT.ar.md). جهّز الحزمة كاملة من المجلد الذي يحتوي `package.json`:

```bash
npm ci
npm run android:sync
```

ثم استورد مشروع Android الموجود واختر `android/` كمجلد Gradle إذا كان Klencod يتيح ذلك. لا تنشئ قالب Java جديدًا، ولا تنقل `android/` وحده؛ يحتاج الاعتماديات في `../node_modules`.

**اختيار Android (Java) هو الأقرب، وليس ضمانًا للعمل على Klencod.** إن كان الاستيراد ZIP فقط دون اختيار مجلد فرعي أو تجهيز npm، أو كان يبني قالبًا جديدًا بدل Gradle المرفق، فاستخدم المسار البديل أدناه. لا تضف `pubspec.yaml` ولا تستخدم `flutter create`.

## البناء بالأوامر

من المجلد الذي يحتوي `package.json`:

```bash
npm ci
npm run android:doctor
npm run android:apk
```

تحتاج Node 22+ وJDK 21 وAndroid SDK platform 35 وbuild-tools 35.0.0. الأمر الأخير يبني الويب، ثم يزامن Capacitor، ثم يطلب بناء debug APK عبر Gradle. الناتج المتوقع بعد النجاح فقط:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## البديل من الهاتف

فك الحزمة وارفع محتوياتها إلى جذر مستودعك، بما فيها المجلد المخفي `.github`. من GitHub اختر **Actions → Build EngX Android APK → Run workflow**، وليس workflow Flutter الذي قد يولّده Klencod. بعد نجاحه فقط نزّل **EngX-debug-APK** من Artifacts وفكّه. إعداد workflow وحده لا يثبت نجاح البناء؛ لم يُشغّل هنا على حسابك.

## ما تغير وحدود التحقق

- أُضيف دليل مستقل يشرح الأنواع الأربعة ويوصي بتجربة Android (Java)، مع التفريق بين جذر npm وجذر Gradle.
- حُدّث README ودليل Klencod؛ بقيت ملفات التطبيق والخادم وAndroid وiOS والميزات السابقة دون تحويل تقني أو تغيير في كودها.
- التحقق من هذا التعديل يخص سلامة الأرشيف والتعليمات وحفظ المصادر، لا تشغيل التطبيق أو تجميعه.
- **لم يُختبر استيراد أو بناء Klencod، ولم يُبنَ APK للتحقق من هذه النسخة، ولا تحتوي الحزمة على APK جاهز.** نسخة debug بعد بنائها للاختبار وليست إصدار متجر موقّعًا بمفتاحك.

راجع [دليل البناء التفصيلي](docs/KLENCOD-APK.ar.md) للمتطلبات وتشخيص الأخطاء. نتائج اختبارات سابقة مذكورة في وثائق المشروع لا تعني أنها أُعيدت لهذا التعديل ولا تثبت نجاح Android.
