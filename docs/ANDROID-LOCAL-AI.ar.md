# الذكاء الاصطناعي المحلي على Android في EngX

## الحالة

يستخدم التطبيق إضافة Capacitor أصلية باسم `EngXLocalAI` مبنية بـ Kotlin وتعمل عبر **LiteRT-LM Android 0.18.0**. التكامل يستعمل `Engine` و`EngineConfig` و`ConversationConfig` و`Contents` و`sendMessage` المتزامن الرسمي، مع `Backend.CPU()` لتجنب اختلافات نماذج GPU. كل استدلال يتم داخل الجهاز ولا توجد طلبات شبكة أثناء `generate` أو أي خدمة سحابية أو مفاتيح سرية.

> المصدر المرجعي للـ API: [دليل LiteRT-LM الرسمي](https://developers.google.com/edge/litert-lm/android). يعتمد الإعداد على AGP 8.7.2 الموجود في المشروع، وJDK 21.

## الإعداد والبناء

1. افتح `android/` في Android Studio أو نفّذ البناء من بيئة Android كاملة.
2. اجعل Gradle قادراً على الوصول إلى Google Maven، ثم نفّذ البناء المعتاد للتطبيق.
3. أضيفت التبعية المثبتة صراحةً:

   `com.google.ai.edge.litertlm:litertlm-android:0.18.0`

   تم التحقق من بيانات Google Maven، ولم تُستخدم `latest.release`. أضيف Kotlin Android Gradle Plugin `2.2.21` إلى إعداد البناء.
4. سجّل `MainActivity` الإضافة الجديدة مع إبقاء `EngXPrinter` و`EngXWidgets` كما هما.

لم يتم تنزيل النموذج أو تضمينه في المستودع. يجب أن يطلب الواجهة موافقة المستخدم قبل استدعاء `download()`، وأن تبقي التطبيق مفتوحاً أثناء التنزيل؛ ليست هذه عملية تنزيل خلفية قابلة للاستئناف.

## النموذج والتحقق

التنزيل من الرابط القانوني المثبت على commit `41c5569623a7c189d6eec3e5225260c58cedbce7`:

`https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/41c5569623a7c189d6eec3e5225260c58cedbce7/gemma-4-E2B-it.litertlm`

- الاسم: Gemma 4 E2B
- الحجم الدقيق: `2,588,147,712` بايت
- SHA-256: `181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c`
- ملف مؤقت خاص بالتطبيق: `files/model.part`
- بعد اكتمال الحجم والـ SHA-256 فقط تتم إعادة التسمية الذرية إلى ملف النموذج.
- يُحذف الملف الجزئي عند الخطأ أو الإلغاء، ويُفحص توفر `الحجم + 512 MiB` قبل البدء.
- الاتصالات HTTPS فقط، والتحويلات لا تُقبل إلا إلى نطاقات Hugging Face / CAS / XetHub الموثوقة.

## واجهة الإضافة

- `status()` يرجع `supported`, `downloaded`, `downloading`, `progress`, `model`, `sizeBytes`, `version` و`error` عند الحاجة.
- `download()` يرجع الحالة بعد اكتمال التنزيل، ويصدر `downloadProgress` مع `downloadedBytes`, `totalBytes`, `progress`, `done`, و`error` عند الحاجة.
- `cancelDownload()` يلغي التنزيل ويحذف الملف الجزئي.
- `deleteModel()` يحذف النموذج المحلي.
- `generate({prompt})` يقبل نصاً لا يتجاوز 12000 حرفاً ويرجع `{text}`. الاستدلال محصور في executor واحد، لا يُسجّل prompt، ويُغلق `Engine` بعد كل طلب لتقليل تسرب الذاكرة.

التعليمات الداخلية عربية ومقيدة بتلخيص السجلات المعطاة مع الحفاظ على الملصقات؛ لا اختراع قيم أو فترات، ولا معلومات تعريفية للمرضى، ولا تصريح أو clearance طبي.

## القيود والتحقق

الدعم مقيد بأجهزة Android ذات ABI `arm64-v8a` وبحدود `minSdk 23` الخاصة بالمشروع. يستخدم CPU، وقد يكون بطيئاً ويحتاج أكثر من 2.58 GB مساحة بالإضافة إلى هامش. خطأ العتاد يُعرض بالعربية بوضوح ولا يوجد fallback مدفوع أو سحابي.

تم فحص وثائق Google وبيانات Maven ومصدر LiteRT-LM، لكن لم يُنفّذ بناء Android فعلياً في هذه البيئة؛ يتطلب التحقق النهائي Android SDK/NDK ومكونات Gradle المناسبة على جهاز المطور. لم يُعدّل iOS أو جذر المشروع، ولم يُنزّل ملف النموذج الكبير.
