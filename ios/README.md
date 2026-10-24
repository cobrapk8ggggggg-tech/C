# صدى · Sada

تطبيق SwiftUI أصلي لـ iPhone وiPad، iOS 17+. تصميم عربي أسود وأبيض مستوحى من الصور: مكتبة، درج جانبي، مشغّل مصغر، ومشغّل كامل. الملفات المحفوظة محلية؛ التشغيل يستخدم AVAudioPlayer، مع Audio Session من نوع playback وأوامر شاشة القفل، والتالي والسابق والتقديم. التحميل يستخدم background URLSession.

## البناء

على macOS مع Xcode وXcodeGen:

```sh
cd ios
xcodegen generate
open Sada.xcodeproj
```

مسار **Sada Simulator Tests** مستقل عن **Sada Unsigned IPA**. الأول يشغّل XCTest وواجهة المستخدم ويحفظ xcresult ولقطة شاشة ضمن المرفقات. الثاني يبني للجهاز ويحفظ IPA غير موقع. لتثبيته تحتاج توقيعه. يلزم عند التوقيع تفعيل App Groups للتطبيق والامتداد بنفس المجموعة `group.com.sada.audio`؛ يمكن تغيير معرّفات الحزمة والمجموعة معاً لحساب المطور.

## مشاركة يوتيوب

اختر «حفظ في صدى» من قائمة مشاركة الرابط، ثم افتح صدى. يحفظ الامتداد الرابط في App Group، ويبدأ التطبيق التحميل عند تفعيله. فتح التطبيق تلقائياً من Share Extension ليس مضموناً بواجهات Apple المسموحة؛ لا يستخدم المشروع حيل responder-chain. المشاركة تحتاج توقيعاً يسمح بالمجموعة المشتركة.

## ما تحققنا منه في المصدر المرفق

- نقل طلب `watch?pbj=1` إلى Swift مع قراءة JSON أو `ytInitialPlayerResponse` في HTML.
- اختيار رابط `audio/mp4` مباشر، ثم فحص الملف بواسطة AVAudioPlayer قبل إضافته للمكتبة.
- لا يُعامل `serverAbrStreamingUrl` كملف M4A. إلحاق `itag` به كما في العينة لا يحوّله إلى ملف صوت.
- اختبار طلب `api.thejeu.com/.../songs/batch-info` من المرفق أعاد HTTP 200 وبيانات الأغنية، لكن `playUrl` كان رابط صفحة يوتيوب. روابط MP4 الأخرى كانت خلفيات مرئية؛ لذلك لا يُنزّلها التطبيق على أنها الأغنية.
- كوكيز ومعرّفات الجلسة في العينة لم تُضمّن في المستودع.

**حد عملي:** إذا لم يعط يوتيوب رابط MP4 صوت مباشراً (توقيع مشفّر أو SABR أو حظر)، يعرض التطبيق خطأ. لم نثبت تنزيل فيديو حقيقي من البداية للنهاية؛ لا توجد مكتبة لفك تواقيع أو خدمة استخراج إضافية. البحث الحالي في المكتبة المحلية. قوائم التشغيل والبحث على يوتيوب غير منفذة.

تشغيل الملفات المحفوظة لا يحتاج الإنترنت. استخراج رابط جديد وتنزيله يحتاجان الإنترنت؛ URLSession يدعم استمرار النقل في الخلفية لكن iOS يدير الجدولة، وإغلاق التطبيق بالقوة قد يوقف النقل. امتداد المشاركة يحتفظ برابط واحد منتظر.

## مراجع البحث

- [Apple: background downloads](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background)
- [Apple: playback audio session](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback)
- [Apple: Share extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- [Apple: MPRemoteCommandCenter](https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter)

لا تزال تجربة جهاز موقّع ضرورية للتحقق من App Groups والمشاركة وشاشة القفل واستعادة النقل بعد إنهاء العملية. اختبارات المحاكي لا تثبت هذه الوظائف على جهاز حقيقي.
