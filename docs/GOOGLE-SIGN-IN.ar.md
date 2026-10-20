# الدخول بحساب Google

زر جوجل مضاف بجانب الدخول بالبريد وكلمة المرور، ومرتبط بنفس خيار «تذكرني» والخروج. **الدخول الفعلي لن يكتمل قبل أن يضبط مالك التطبيق معرّفات OAuth الخاصة بمشروعه.** لا تتضمن الحزمة حساب Google أو Firebase جاهزًا أو مفاتيح سرية.

## القيم المطلوبة

من Google Cloud Console، جهّز شاشة الموافقة واختَر المستخدمين التجريبيين إذا كان المشروع في وضع الاختبار. أنشئ معرّفات OAuth في نفس المشروع:

- **Web application:** للويب ولجمهور التحقق على الخادم وAndroid. ضع هذا المعرف في `server/.env` كـ `GOOGLE_CLIENT_ID`، وفي `.env` بجذر التطبيق كـ `VITE_GOOGLE_WEB_CLIENT_ID`. أسماء Client ID عامة وليست أسرارًا.
- **Android:** باسم الحزمة `com.engx.app` مع SHA-1 لشهادة التوقيع. أنشئ معرّفًا لكل شهادة تستعملها: debug وrelease وشهادة Play App Signing عند النشر. لا تضع Android client ID بدل Web client ID في كود التطبيق.
- **iOS:** باسم Bundle ID `com.engx.app`. ضعه في ملف `.env` بالجذر كـ `VITE_GOOGLE_IOS_CLIENT_ID`.

الملف `.env.example` بالجذر يحوي المتغيرات فارغة. انسخه إلى `.env` واملأ قيمك؛ اضبط نسخة الخادم أيضًا ثم أعد تشغيله وبناء التطبيق. Firebase غير مطلوب لهذا المسار. لا تضع Client Secret أو Google access token في متغير `VITE_` أو داخل التطبيق.

## الويب وعناوين التحويل

يسمح Google Identity Services بالدخول من أصول ويب محددة. أضف أصل HTTPS الذي تنشر عليه الواجهة في **Authorized JavaScript origins**، مثل `https://your-app.example`، وأصل localhost الخاص بالتطوير عند الحاجة. الكود يستخدم زر GIS مع callback داخل الصفحة، وليس مسار OAuth redirect على الخادم؛ لذلك لا تضع مسار تحويل عشوائيًا. إذا عدّلت التدفق إلى redirect لاحقًا، يجب تسجيل مسار العودة الفعلي كما هو في **Authorized redirect URIs**. اضبط `CORS_ORIGIN` على الخادم لعنوان الواجهة المصرح به.

## Android

يستخدم التطبيق `@capgo/capacitor-social-login@7.20.0`، المتوافق مع Capacitor 7. توجيه `onActivityResult` والواجهة `ModifiedMainActivityForSocialLoginPlugin` مدمجان في `MainActivity.java` مع الإبقاء على بقية الملحقات. يحتاج الاختبار جهازًا أو محاكيًا بخدمات Google Play وحساب Google. بعد إدخال قيمك شغّل:

```bash
npm ci
npm run android:sync
npm run android:open
```

إذا رفض Google الإعداد، طابق اسم الحزمة وSHA-1 وWeb client ID والمشروع في Google Cloud؛ لا تتجاوز التحقق من الهوية كحل.

## iPhone

داخل `ios/App/App/Info.plist` استبدل:

```text
com.googleusercontent.apps.REPLACE_WITH_IOS_CLIENT_ID
```

بالـ **reversed iOS client ID** الخاص بمشروعك. حافظ على scheme `engx` ولا تضف مفتاح `CFBundleURLTypes` مكررًا. مسار العودة إلى `GIDSignIn` مدمج في `AppDelegate.swift` ويحافظ على روابط الأجهزة العادية. بعد ضبط بيئة البناء، شغّل `npm run ios:sync` ثم ابنِ ووقّع من Xcode على Mac. تأكد من حل حزمة GoogleSignIn بواسطة Swift Package Manager.

## الأمان وتذكرني

تطلب الإضافة `email` و`profile` فقط في وضع online. ترسل ID token إلى خادم EngX عبر HTTPS؛ الخادم يتحقق من التوقيع والجمهور والصلاحية والبريد المؤكد قبل إنشاء جلسة EngX. لا تُحفظ كلمة مرور جوجل، ولا تُحفظ access tokens في كود التطبيق أو النسخ الاحتياطية.

«تذكرني» تحفظ جلسة EngX باختيارك في Android Keystore أو iOS Keychain؛ على الويب تبقى الجلسة في تبويب المتصفح فقط، مع إمكانية حفظ معرف الحساب. الخروج يمسح جلسة EngX ويفصل جلسة الإضافة محليًا، ولا يحذف حساب Google من الهاتف ولا يلغي صلاحياته عالميًا.

الاختبارات الآلية تحاكي استجابة الإضافة وتتحقق من حواجز الإعداد. لم يتم دخول حقيقي بجوجل هنا لعدم وجود Client IDs لمشروعك؛ يجب اختبار الدخول والخروج وإلغاء نافذة جوجل على الأجهزة بعد الإعداد.

تفاصيل مزوّد الإضافة: [Android](https://capgo.app/docs/plugins/social-login/google/android/) و[iOS](https://capgo.app/docs/plugins/social-login/google/ios/) و[المستودع والتوافق](https://github.com/Cap-go/capacitor-social-login).
