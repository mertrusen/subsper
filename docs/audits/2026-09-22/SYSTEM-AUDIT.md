# Subsper sistem analizi — 22 Eylül 2026

İncelenen sürüm: **1.3.0**, ana depo başlangıcı `1ae291b9a8e75a1b722c14bd86b8dfcb62f31b82`. Çalışma kökü: `/Users/mertrusen/Documents/subsper-new`. Masaüstü uygulaması, aynı depodaki Premiere CEP eklentisi, ExtendScript köprüsü, yerel motorlar, testler ve dağıtım akışı incelendi. Bu çalışma uygulama kodunu değiştirmez; bir düzeltme veya yayın değildir.

## Karar

Çekirdeği çalışan, fakat özellikler arasındaki veri aktarımı güvenilir hale gelmemiş bir ürün var. Yerel konuşma çözümleme ve temel FFmpeg işlemleri gerçekten çalışıyor. En büyük açık yeni özellik eksikliği değil: **medya, altyazı metni, kelime zamanları, proje kaydı ve Premiere timeline'ının aynı durumu temsil etmemesi.**

Sıfırdan yeniden yazmak gerekmiyor. Önce veri kaybı ve yanlış çıktı riskleri giderilmeli; sonra masaüstünde temel akış tamamlanmalı. Ortak çekirdek değişiklikleri eklentiye de yansıtılmalı ve belirli aşamalarda gerçek Premiere projesinde denenmeli. Premiere'i sona kadar bekletmek, timeline sorunlarının geç fark edilmesine yol açar. Şu an yeni genel sürüm yayımlamayı önermiyorum.

## Kanıt nasıl okunmalı?

- **Gerçek çalışma:** yerel motor veya FFmpeg gerçekten çalıştırıldı.
- **Kontrollü yeniden üretim:** gerçek uygulama fonksiyonu çalıştırıldı; dosya sistemi, Electron veya Premiere sınırı güvenli taklitlerle değiştirildi. Kullanıcının Premiere projesi üzerinde yıkıcı işlem yapılmadı.
- **Kaynak bulgusu:** bağlantı/koşul kaynak koddan gösterildi; ilgili ortamda uçtan uca doğrulanmadı.
- **Ürün önerisi:** nesnel hata iddiası değil; kapsam ve kullanım kolaylığı değerlendirmesi.

Native Electron penceresi bu ortamda başlatılamadı. Depodaki Electron kurulumu eksik; izole resmi runtime denemesi de 137 koduyla kapandı. Bunun tek bir kök nedeni doğrulanmadı. Bu sonuç dağıtılmış uygulamanın her bilgisayarda açılmadığı anlamına gelmez. Gerçek Premiere ve Windows uçtan uca testleri yapılmadı. DOM testleri görünüm, GPU ve Adobe davranışı için kanıt değildir.

## Sistem haritası

| Katman | Mevcut sorumluluk | Ana sorun |
|---|---|---|
| `electron-main.js` | Masaüstü pencere, dosya/Node erişimi, güncelleme | Renderer geniş yetkili; güncelleme paketleri eksik |
| `js/main.js` | Altyazı, ayarlar, AI, export, proje, CEP bağlantısı | Çok sayıda ortak global durum ve birbirini saran fonksiyon |
| `js/features-v2.js` | Ek düzenleme araçları, galeri, batch, sosyal araçlar | Ana akışlarla örtüşen ikinci yollar; gecikmeli başlangıç |
| `js/ui-v2.js` | Araç kaydı ve gezinme | Araç uygulaması ile görünür rotalar her zaman eşleşmiyor |
| `js/desktop-app.js` | Medya, oynatıcı, yerel I/O, masaüstü override'ları | Proje/medya yaşam döngüsü ayrışmış |
| `js/whispercpp.js` | Model indirme, FFmpeg, whisper.cpp | Önbellek doğrulama, iptal ve timeline boşluğu sorunları |
| `extension/jsx/host.jsx` | Premiere sequence, klip toplama, import, QE işlemleri | Kaynak sesi seçimi ve yıkıcı işlem güvenliği |
| `extension/js`, `extension/css` | Paylaşılan kodun eklenti kopyaları | Elle eşleme; ikinci kaynak oluşması riski |
| Python yardımcıları | Alternatif motorlar/diarization | Ortam ve özellik eşitliği ayrıca doğrulanmalı |

Temel çalışma akışı: medya veya sequence → ses çıkarma → transkripsiyon → segment/kelime düzenleme → stil → dosya veya Premiere aktarımı. Proje kaydı ve iş yönetimi bu zincirin tamamını kapsamalı; bugün kısmen birbirinden bağımsız.

## Öncelikli bulgular

Önceliklerin anlamı: **P0:** güvenlik/veri kaybı nedeniyle yayın öncesi engel. **P1:** temel çıktının doğruluğu ve iş akışı. **P2:** ürün tutarlılığı, bakım ve kapsam. Aşağıdaki sıralama önerilen müdahale sırasıdır; her satır bağımsız bir özellik talebi değildir.

### F01 · P0 · Premiere altyazı aktarımı eski içeriği erken siliyor

**Kontrollü yeniden üretim.** `extension/jsx/host.jsx:875` içindeki aktarımda yeni SRT yazılıyor; `931–940` civarında ortak “Whisper Captions” bin'i kaldırılıyor; yeni import başarısız olabiliyor. Testte olay sırası `new-srt-written → old-bin-deleted → new-import-failed`; sonuç buna rağmen `success:true, autoAdded:false`. Aynı klasördeki eski `whisper_*.srt` dosyaları da temizleniyor. Ortak bin başka sequence'lerin kullandığı içeriği barındırabilir.

**Yapılacak:** Yeni dosyayı ve proje öğesini doğrulamadan eskisini kaldırma. Aktarımları sequence/proje kimliği ile ayır; eski kullanıcı içeriğini koru; kısmi sonucu tam başarı gibi sunma. **Kabul:** import hatasında mevcut bin, klipler ve dosyalar korunmalı; tekrar aktarım yalnız hedef altyazıyı değiştirmeli.

### F02 · P0 · Proje içeriğinden arayüze HTML enjekte edilebiliyor

**DOM ile yeniden üretim + kaynak bulgusu.** `main.js:4730` proje ayarlarını geniş biçimde kabul ediyor. Galeride `features-v2.js:864` ve `881` civarında font gibi alanlar HTML'e kaçışsız ekleniyor. Zararsız bir proje alanıyla gerçek DOM'da ek bir `img` öğesi oluşturuldu. OS komutu veya veri dışarı aktarımı denenmedi. `electron-main.js:18` çevresindeki `nodeIntegration:true` ve `contextIsolation:false`, renderer enjeksiyonunun etkisini büyütüyor.

**Yapılacak:** Proje şeması ve alan izin listesi; metinleri güvenli DOM API'leriyle oluşturma; stil değerlerini doğrulama; ardından preload/IPC ile yetki sınırı. Proje dosyası AI sağlayıcısını ve endpoint'ini de sessizce değiştirmemeli. API anahtarları düz localStorage yerine uygun işletim sistemi saklama mekanizmasına taşınmalı. **Kabul:** zararsız enjeksiyon örneği metin olarak kalmalı; proje açmak uygulama genelindeki servis ayarlarını değiştirmemeli.

### F03 · P1 · Medya değiştirme, proje açma ve otomatik kayıt aynı durumu taşımıyor

**Yeniden üretildi.** `desktop-app.js:63` yeni medya yüklerken önceki altyazıları bırakıyor. `main.js:4730` kayıtlı medya yolunu geri yüklemiyor. Masaüstü proje açma yolu (`desktop-app.js:1136`) bunu tamamlamıyor. `__SUBSPER_MEDIA__` yalnız manuel kayıtta güncellendiği için (`1150`) ilk otomatik kayıtta medya boş, daha sonra eski dosyaya ait olabilir. `_projectData` (`main.js:4720`) pozisyon, genişlik ve konuşmacı renklerini tam saklamıyor. Boş altyazı durumunda otomatik kayıt güncellenmediğinden temizlenen içerik geri gelebilir.

**Yapılacak:** Tek bir ProjectSession: medya kimliği/yolu, segmentler, kelimeler, zaman tabanı, stil, seçim ve değişiklik durumu. Medya değişiminde kaydet/temizle yaşam döngüsü; eksik medyada yeniden bağlama. **Kabul:** A dosyasından B'ye geçiş, kaydet/aç ve kapanma sonrası kurtarma birbirinin verisini karıştırmamalı.

### F04 · P1 · Metin düzenleniyor, kelime verisi eski kalıyor

**DOM ile yeniden üretildi.** Normal düzenleme (`main.js:3092`), sözlük (`1699`), filler temizleme (`1724`) ve AI uygulama (`2219`) segment metnini değiştirirken `words` verisini senkron tutmuyor. `buildWordSRT` (`4113`) ve karaoke (`3275`) eski kelimelerden çıktı üretiyor. Testte ekranda düzeltilmiş metne karşılık kelime SRT ve karaoke ASS “original” yazdı. Dalga formunda/nudge ile zaman değişimi de kelime zamanlarını birlikte taşımıyor.

**Yapılacak:** Segment/kelime düzenlemeleri için ortak işlemler; kelime hizası geçersizleştiğinde açık durum ve yeniden hizalama veya güvenli düz metin çıktısı. **Kabul:** tüm çıktı türlerinde son metin görünmeli, zaman aralıkları geçerli kalmalı. Çeviride yeni kelimelere eski kelime zamanları körlemesine verilmemeli.

### F05 · P1 · Premiere ses kaynağı seçimi dış mikrofonu dışarıda bırakabiliyor

**Host fonksiyonuyla yeniden üretildi.** `host.jsx:62–166` klipleri topluyor; video varsa yalnız video listesini kullanıyor. Kamera + ayrı `voice.wav` örneğinde yalnız kamera döndü. `155` civarındaki tekilleştirme anahtarında timeline konumu yok: aynı kaynak aralığının iki farklı yerde kullanımı tek klibe indi. Hız değişimi, reverse, mute/disable, nested sequence ve efektli ses için de kaynak zamanı varsayımları var; bunlar gerçek Premiere'de ayrıca denenmeli.

**Yapılacak:** İşitilen sequence sesi ile kaynak klip sesini açıkça ayır; ses track seçimi veya sequence mix render yaklaşımı belirle. Klip örneğini timeline kimliğiyle koru. **Kabul:** harici mikrofon, tekrar kullanılan klip ve in/out aralığı doğru ses ve zaman üretmeli.

### F06 · P1 · Tek klipte timeline başındaki boşluk kayboluyor

**Gerçek FFmpeg ile doğrulandı.** `whispercpp.js:473–485` tek klip kısa yolu timeline offset'ini korumuyor. Sekiz saniyelik aralıkta beşinci saniyede başlayan üç saniyelik klip, beklenen beş saniye sessizlik + üç saniye ses yerine üç saniye çıktı verdi. Python ses çıkarma yolunda da aynı kısa yol yaklaşımı var.

**Yapılacak:** Her yolda ortak zaman tabanı; baş/ara/son boşluklarını koru veya dönüşüm haritası taşı. **Kabul:** transkripsiyon zamanı timeline'da doğru klibin üstüne oturmalı; tek ve çok klip yolları eşdeğer olmalı.

### F07 · P1 · Metinden kesme hem yanlış aralık üretebiliyor hem normal akışa bağlanmamış

**Fonksiyon ve DOM ile yeniden üretildi.** `main.js:5100` orta nokta yaklaşımı, 0–10 saniyelik parçanın 0–4 kısmı tutulduğunda tüm 0–10'u kesilecek saydı; 4–10 tutulduğunda gerekli kesimi kaçırdı. Masaüstü butonu (`desktop-app.js:591`), daha sonra sarılan transkripsiyon fonksiyonunun önceki sürümünü tutuyor; başarılı transkripsiyondan sonra `_originalSegments` boş kaldı. Düzenleme kartının araç rotası da eksik. Masaüstü kesilmiş kopyayı üretirken kaynak/zaman haritasını güncellememesi sonraki kesimlerde ek risk.

**Yapılacak:** Açık silinen aralıklar ve kaynak→çıktı zaman haritası; merkezi iş tamamlandı olayı; görünür rota; kesim önizlemesi. **Kabul:** kısmi silme, iki ardışık kesim, geri alma ve export korunacak içeriği silmemeli.

### F08 · P1 · Batch başarısız işi başarılı sayıp eski altyazıyı yazabiliyor

**Kontrollü yeniden üretim.** `features-v2.js:2589` sequence kimliğini sayıya çeviriyor; `host.jsx:1765` sıkı eşitlik kullanıyor. String kimlikli örnek bulunamadı. Başarısız transkripsiyon sonrası eski segmentlerle yeni dosya yazılması ve “1 SRT” başarı mesajı da üretildi. Masaüstü batch ayrı durum bayrağı kullanıyor, iptal sinyali aktarmıyor ve tekli akıştaki motor/son işleme tercihleriyle tam eşleşmiyor. Aynı adlı kaynaklar çıktı çakışmasına açık.

**Yapılacak:** Her işin kendi girdisi, sonucu, hatası ve iptali olsun; çıktı yalnız o işin başarılı sonucundan yazılsın. Sequence kimliğini opak değer olarak taşı. **Kabul:** başarılı–başarısız–başarılı üçlüde yalnız iki doğru çıktı; isim çakışmasında açık politika.

### F09 · P1 · Timeline kesme kullanıcı track kilitlerini değiştirebiliyor

**Host taklidiyle yeniden üretildi.** `host.jsx:1372`, `1414`, `1536` kilitleri geçici değiştirip önceki durum yerine `false` değerine döndürüyor. Başlangıçta kilitli track, işlem sonunda açık kaldı. Hız işlemi (`1627` civarı) benzer risk taşıyor. Bazı QE hataları yakalanıp sessiz geçildiği için kısmi işlemin sonucu belirsizleşiyor.

**Yapılacak:** Önceki durumu kaydet ve `finally` içinde aynen geri yükle; kısmi başarısızlığı raporla; desteklenen işlemlerde undo grubu/geri dönüş stratejisi. **Kabul:** başarı, hata ve iptal sonunda kullanıcının kilitleri ve hedef dışı track'leri aynı kalmalı.

### F10 · P1 · İş yönetimi ve iptal tüm yolları kapsamıyor

**Kaynak bulgusu.** Model indirme, Python çalıştırma, batch, Premiere işleri ve export aynı iptal mekanizmasını kullanmıyor. Masaüstü iptal daha çok `_abortCpp` yoluna bağlı; model indirme sinyal almıyor, batch null sinyal iletiyor. Transkripsiyon sırasında medya değişirse sonucun başka dosyanın ekranına yazılması için de durum koruması yetersiz. Hata sonrasında geçici WAV temizliği her yolda garanti değil.

**Yapılacak:** Job kimliği, durum makinesi, abort, tek finalizasyon ve kaynak temizliği. **Kabul:** her aşamada iptal; dosya değişimi ve ardışık başlatma; eski işin geç gelen sonucu yeni oturuma yazılmamalı.

### F11 · P1 · Mac otomatik güncelleme için gereken ZIP yok

**Kaynak ve kurulu bağımlılık incelemesi.** `package.json` mac hedefi DMG; yayın akışı ZIP yüklemiyor. Kurulu `electron-updater/out/MacUpdater.js:81–83` ZIP arıyor. Resmi electron-builder belgesi de Mac güncellemeleri için ZIP gerektiğini belirtiyor. Ayrıca otomatik indirme ile özel güncelleme arayüzünün “atla” davranışı aynı yaşam döngüsüne bağlı değil.

**Yapılacak:** DMG + güncelleme ZIP'i + uyumlu metadata, imza/notarization ve gerçek sürümden sürüme prova. **Kabul:** yüklü eski sürüm yeni sürüme güncellenebilmeli; atla/sonra tercihi açık davranmalı.

### F12 · P1 · Bağımlılıklar ve lockfile tutarsız

**npm audit sonucu.** Lockfile üzerinde 13 etkilenmiş bağımlılık girdisi: 12 high, 1 critical; critical geçişli `tar`. Bu sayı 13 ayrı uygulama açığı veya sömürü kanıtı değildir. Electron 31 hattında; güncelleme planı gerekli. `package.json` içindeki `electron-updater` lockfile kök bağımlılıklarıyla eşleşmiyor; audit kapsamı bu nedenle manifestin tamamını temsil etmiyor.

**Yapılacak:** Lockfile'ı kontrollü yeniden üret; runtime ve build bağımlılıklarını ayırarak güncelle; major sürümü zorla otomatik düzeltme yerine regresyonla doğrula. **Kabul:** temiz kurulum tekrarlanabilir, audit sonucu açıklanmış, masaüstü ve CEP ayrı doğrulanmış olmalı.

### F13 · P1 · Zaman biçimleme ve export seçenekleri tutarsız

**Yeniden üretildi.** `main.js:2611` 59.9996 saniyeyi `00:00:59,1000`; ASS biçimleme (`3225`) 59.999'u `0:00:59.100` yaptı. Yuvarlama üst saniyeye taşınmıyor. Boşluk doldurma açıkken aynı segment SRT'de 1. saniyede, VTT'de 2. saniyede bitti (`3211`, `3240`).

**Yapılacak:** Önce tam milisaniye/centisecond'a yuvarla, sonra böl; tüm export'lar ortak normalize edilmiş segmentleri kullansın. **Kabul:** dakika/saat sınırları, sıfır süre, negatif değerler ve formatlar arası zaman eşitliği.

### F14 · P1 · AI zamanları ve uygulanacak sonuçlar yeterince doğrulanmıyor

**Kaynak bulgusu.** `main.js:2070` bazı istemlerde göreli `start`, `5223` başka yolda mutlak `seqStart` kullanıyor; klip uygulama tarafı aynı zaman tabanını garanti etmiyor. In/out sıfırdan başlamadığında yanlış konum riski var. Aralık ayrıştırma (`4842`) medya sınırları, çakışmalar ve kare hizasını tam doğrulamıyor. Altyazıya AI sonucu uygulama (`2219`) satır sayısı/uyum doğrulaması olmadan kısmi değişiklik yapabiliyor. İsteklerde iptal, timeout ve uzun metin bölme tamamlanmalı.

**Yapılacak:** Tipli sonuç şeması, tek zaman tabanı, sınır denetimi ve değişiklik önizlemesi. **Kabul:** eksik/hatalı AI yanıtı mevcut altyazıyı bozmasın; AI önerisi onay öncesi timeline'ı değiştirmesin. Ücretli API testi yapılmadı.

### F15 · P1 · Model dosyası var diye sağlam kabul ediliyor

**İzole yeniden üretim.** `whispercpp.js:218` mevcut model için doğrulamayı atlıyor. Üç baytlık sahte önbellekte `modelExists=true`, `ensureModel` başarılı; ayrı `verifyModel` ise boyut hatası verdi. Gerçek kullanıcı modeli değiştirilmedi. Rename hatasının yalnız loglanması ve eski `.part` dosyası temizliğinin uzun indirmeyi ertesi gün sürdürmeyi bozması da kaynakta görülüyor.

**Yapılacak:** Boyut/hash manifesti, atomik tamamlama, bozuk dosyayı onarma seçeneği ve gerçek indirme iptali. **Kabul:** yarım/bozuk model transkripsiyona geçirilmesin; kesintiden devam ve disk dolması açık hata versin.

### F16 · P1 · Multicam mevcut veri sözleşmesiyle ilerleyemiyor

**Kaynakta yapısal çelişki.** `features-v2.js:1191` en az iki audio ve iki video klip bekliyor. Host'un klip çıktısı video varsa yalnız video, yoksa yalnız audio dönüyor. Bu sözleşmeyle gerekli iki liste birlikte oluşmuyor.

**Yapılacak:** F05 ile birlikte audio/video listelerini ayrı sun; gerçek çok kameralı sequence örneğiyle doğrula. **Kabul:** tarama, eşleme ve geri alınabilir uygulama çalışmadan özellik tamamlanmış sayılmasın.

### F17 · P2 · Profil yükleme model ve dili geri getirmiyor

**DOM ile doğrulandı.** `main.js:4159` profil anahtarları `model/language`; kullanılan ayarlar `whisperModel/spokenLang`. Tiny/TR kaydedip Large/EN'e geçtikten sonra profil yükleme Large/EN bıraktı.

**Yapılacak:** Sürümlü profil şeması, doğru alanlar ve geçiş. Proje stili ile uygulama profili kapsamını ayır. **Kabul:** profil önizlemesinde hangi ayarların değişeceği ve gerçek geri yükleme aynı olmalı.

### F18 · P2 · Dil değişimi ekranın tamamını yenilemiyor

**DOM ile doğrulandı.** Bazı araç kartları yalnız başlangıçta çevriliyor. EN→TR sonrası tekrar bulma butonu “Find & Cut Repeats” kaldı. Statik denetim dokuz kısmi/erişilemeyen dil sözlüğü buldu.

**Yapılacak:** Tek çeviri yaşam döngüsü; tamamlanmayan dilleri görünür destek vaadinden çıkar veya tamamla. **Kabul:** tüm görünür başlık, hata, tooltip ve sonradan açılan ekran aynı dilde olmalı.

### F19 · P2 · Viral, AI klip ve sosyal paket akışları örtüşüyor

**Kaynak + ürün değerlendirmesi.** Heuristik viral puanı noktalama, anahtar kelime ve süre gibi basit işaretlere dayanıyor; etkileşim tahmini değil. Viral aracı çoğunlukla aralık/marker, başka AI yolu gerçek klip export'u üretiyor. Masaüstü sosyal paket SRT üretebiliyor; 9:16 komutu ise seçilen öneriler yerine tüm medyayı işliyor. Bazı yazma hataları sessiz yakalanıyor.

**Yapılacak:** Tek “Klip oluştur” akışı: öneri → önizleme → seçili aralık → kadraj → altyazı → çıktı. “Viral” yerine “klip önerisi” gibi doğrulanabilir ad. **Kabul:** kullanıcı hangi dosyaların üretileceğini görsün; her dosyanın gerçek sonucu raporlansın.

### F20 · P2 · Video export genel medya çeşitliliği için doğrulanmamış

**Kaynak riski; standart FFmpeg örnekleri geçti.** `desktop-app.js:1297` dikey kırpma, zaten 9:16'dan daha dar girdide geçersiz genişlik üretebilir. ASS koordinatları ile son çıktı boyutu birlikte ele alınmalı. Audio copy farklı container/codec çiftlerinde başarısız olabilir. `whispercpp.js:678` encoder seçimi gerçek donanım encode denemesi yerine mevcut encoder listesine dayanıyor; Windows'ta GPU/driver bulunmayabilir.

**Yapılacak:** Crop/pad politikası, hedef çözünürlüğe göre stil, codec uyumluluğu ve yazılım fallback. **Kabul:** yatay, kare, dikey, dar dikey, HDR ve farklı ses codec'leriyle sonuç dosyası oynatılabilmeli.

### F21 · P2 · Kaydetme iptali ve çıktı çakışmaları tutarlı değil

**Kaynak bulgusu.** CEP export/proje kaydetmede (`main.js:3355`, `4742`) kullanıcı iptali ile diyalog kullanılamaması ayrılmadığı için Desktop fallback devreye girebilir. Batch/sosyal/B-roll yollarında sabit konumlar ve aynı isimler mevcut; bazı yazma hataları başarı mesajına rağmen yutuluyor. CLI kısmi başarısızlıkta başarı çıkış kodu verebiliyor.

**Yapılacak:** Ortak çıktı servisi: iptal, klasör seçimi, çakışma, atomik yazma ve sonuç listesi. **Kabul:** iptal sıfır dosya yazmalı; başarısız yazma başarı sayılmamalı; üzerine yazma politikası açık olmalı.

### F22 · P1 · Mevcut testler sürüm güvenini olduğundan yüksek gösterebilir

**Çalıştırıldı.** 91 birim kontrolü ve 16 FFmpeg kontrolü geçti. Ancak çoğu test uçtan uca proje yaşam döngüsünü kapsamıyor; yukarıdaki hatalar bu kontroller yeşilken mevcut. Eski v2 harness 6 hata verdi; önceki commit'te de üretildi. Bunların önemli kısmı güncel UI/lisans davranışına uymayan harness varsayımları ve eksik stub'lar; “6 bozuk özellik” sayılmamalı. DOM harness 34 assertion geçirdi fakat 3 yakalanmamış `$ is not defined` hatası üretti.

**Yapılacak:** Eski test beklentilerini güncelle; ürün hatasını gizlemek için gate kaldırma. Proje roundtrip, metin/kelime eşitliği, kaynak offset, import hata güvenliği ve batch başarısızlığı testleri ekle. Native masaüstü ve gerçek Premiere kabul testleri gerekli.

### F23 · P2 · Yayın ve build tam tekrarlanabilir değil

**Kaynak/konfigürasyon bulgusu.** whisper.cpp hareketli HEAD, bazı binary indirmeleri latest üzerinden; kaynak sürümü ve checksum sabitlenmeli. Cache anahtarı tüm derleme girdilerini temsil etmiyor. Windows SDK kurulumu/cache sırası ve Mac'in Windows'a bağımlılığı gereksiz iş üretebilir. İmza kontrolleri pahalı build'den önce yapılmalı. GitHub secret listesi bu incelemede boş döndü; mevcut imza gate'i yapılandırılmadan tag yayını başarılı beklenmemeli.

**Yapılacak:** Sürüm/hash manifesti, doğru cache anahtarları, erken preflight ve platforma göre bağımsız işler. Release yalnız hazır sürüm etiketinde kalsın; her commit için büyük artifact üretmeyelim. **Kabul:** temiz checkout'tan aynı kaynaklarla imzalı paket; update metadata ve eklenti paketi doğrulanmış.

### F24 · P2 · İki depo ve sync yönü kaynak karışıklığı yaratıyor

**Doğrulandı.** Ana depo yeni baseline'da, ayrı `whisper-studio-premiere` deposu `589bfbd03ff45bf9f714617e58fb8e8f3d2f83ec` sürümünde ve artık daha eski. Aynı depodaki mevcut mirror kontrolü geçiyor; ancak `panel.css` bu kontrolün kapsamına dahil değil. `scripts/sync-from-extension.sh` varsayılan olarak kurulu CEP klasöründen okuyabiliyor; eski kullanıcı kurulumunu kaynak sanma riski var. Build'in oluşturabileceği `.zxp-tools` sertifika dosyaları için ignore/secret hijyeni de tamamlanmalı.

**Yapılacak:** Tek kaynak `subsper-new`; eklenti ortak modüllerden üretilsin. Geçişte sync kaynağı açık parametre olsun ve tüm paylaşılan dosyalar denetlensin. Ayrı repo gerekiyorsa yalnız dağıtım aynası, elle geliştirilen ikinci kopya değil.

### F25 · P2 · Mimari özellik ekledikçe kırılganlaşıyor

**Kaynak + doğrulanmış F07 örneği.** Global `segments/settings/isRunning`, gecikmeli UI kurulumları ve sonradan fonksiyon sarma; çağıran kodun eski referansı tutmasına yol açabiliyor. Büyük dosyalarda domain, UI, host ve I/O birleşmiş durumda.

**Yapılacak:** Önce ortak subtitle domain ve proje şeması; sonra job yönetimi; ardından DesktopHost/PremiereHost adaptörleri; en son UI modülleri ve ortak build. Büyük yeniden yazım yerine çalışan akışları küçük adımlarla taşı. **Kabul:** aynı domain girdisi her iki host'ta aynı altyazı sonucunu üretmeli; UI başlangıcı timeout sırasına bağlı olmamalı.

### F26 · P2 · Tamamlanmış ürün gibi sunulmaması gereken parçalar var

**Kaynak/ürün değerlendirmesi.** MOGRT şablonu uygulamada hazır paket değil, kullanıcı kurulumu gerektiriyor; ASS ile aynı stil/karaoke kapasitesi varsayılmamalı. Ticari lisans altyapısı kapalı ve servis/anahtar alanları boş; ücretsiz kullanımın hatası değil, ücretli ürün için eksik. Alternatif Python motorları ve diarization yolları izole/pinlenmiş ortam ve gerçek test istiyor. Eski roadmap bazı tamamlanan işleri hâlâ eksik gösteriyor; güncel gerçekliği temsil etmiyor. Gemini 3.5 Flash model adı resmi belgede mevcut: bunu geçersiz model diye hata listesine almak yanlış olur.

**Yapılacak:** Gerçek destek matrisi, onboarding ve gereksinimler; roadmap'i çalışan/deneysel/planlanan olarak yeniden yaz. Ticari lisans, MOGRT ve gelişmiş motorları çekirdek stabil olmadan ana geliştirme odağı yapma.

## Özellik envanteri ve ürün sadeleştirme

| Alan | Bugünkü değerlendirme | Öneri |
|---|---|---|
| Yerel transkripsiyon | Gerçek örnekte çalıştı | Ürünün çekirdeği; koru |
| Medya/proje/otomatik kayıt | Veri bağlama sorunları | İlk masaüstü önceliği |
| Altyazı düzenleme/kelime/karaoke | Tekil davranışlar çalışıyor; veri tutarsız | Birlikte onar |
| Stil/galeri/favori/profil | Kapsamlar örtüşüyor; profile bug var | Stil preset'i ile iş profili ayrımını netleştir |
| SRT/VTT/ASS | Temel çıktı mevcut; sınır/tutarlılık hataları | Tek export modeli |
| Video üstüne altyazı | Temel FFmpeg kontrolü geçti | Medya matrisiyle tamamla |
| Silence/repeat/filler | Yararlı; yanlış pozitif ve kesim riski | Önizleme + geri alma; otomatik karar verme |
| Metinden video kesme | Algoritma ve bağlantı hataları | Düzelene kadar deneysel/gizli |
| Multicam | Veri sözleşmesi engeli | Düzelene kadar tamamlanmış sunma |
| Zoom/marker cut/resize/ducking | Premiere host'a bağlı | Gerçek Premiere kabul testi; desktop ana ekranda pasif kart kalabalığını azalt |
| Beep/enhance | FFmpeg altyapısı mevcut | Metin/kelime doğruluğu ve kaynak eşleme ile doğrula |
| Batch | Yanlış çıktı riski | F08 tamamlanana kadar sınırlı/deneysel |
| AI düzeltme/çeviri | Servis yolları mevcut; canlı API denenmedi | Sonuç doğrulama ve değişiklik önizlemesi |
| Chapters | AI ve araç yolları örtüşüyor | Tek bölüm üretme ekranı |
| Viral/shorts/social | Çıktı beklentileri farklı | Tek klip üretme akışı |
| Pace/istatistik | Faydalı ikincil bilgi | Ayrı ana araç yerine analiz bölümüne taşı |
| B-roll | Anahtar kelime/harici arama odaklı | İleri aşamaya bırak; otomatik kurgu vaadi verme |
| MOGRT | Şablon ve host gereksinimleri var | Ayrı Premiere gelişmiş özelliği |
| Lisans/aktivasyon | Kapalı/eksik konfigürasyon | Ürün stabil olana kadar ertele |
| Güncelleme/dağıtım | Mac paket zinciri eksik | Yayın öncesi tamamla |

“Saçma” diye kaldırılması gereken çekirdek özellik görmedim. Sorun, henüz temel proje güvenilirliği tamamlanmadan çok sayıda yardımcı aracın aynı seviyede sunulması. 19 araç kartı ve ana transkripsiyon akışı yerine **Dosya → Transkripsiyon → Düzenle → Stil → Dışa aktar** ana omurgası daha anlaşılır. İleri araçlar bağlama göre açılmalı. Filler sözcükler bazı cümlelerde anlam taşır; tekrar seçimi akıcılığı anlayan bir değerlendirme değildir; kullanıcıya önizleme ve geri alma sunulmalı.

## Çalıştırılan kontroller

| Kontrol | Sonuç | Kanıtın sınırı |
|---|---|---|
| Birim kontrolleri | 91 başarılı, 0 başarısız | İzole fonksiyon ağırlıklı |
| Gerçek FFmpeg smoke | 16 başarılı, 0 başarısız | Mac, oluşturulmuş örnek medya |
| JS/JSX sözdizimi + Python AST | Başarılı | İşlev doğruluğunu kanıtlamaz |
| Shared mirror | Başarılı | `panel.css` kapsam dışında |
| Settings audit | 49/49 bağlı | Kaydet/geri yükle semantiğini kanıtlamaz |
| UI statik audit | Yüksek önem bulgusu 0 | Dinamik sorunları kaçırıyor; kısmi diller var |
| Eski v2 harness | 6 başarısız | Eski varsayımlar/eksik stub; uygulama bug sayısı değildir |
| Tam frontend DOM başlangıcı | 0 JS hatası, 139 button | Electron/Adobe/engine sınırları taklit |
| Ayrı DOM harness | 34 assertion başarılı | 3 uncaught hata; temiz test geçişi sayılmaz |
| Gerçek transkripsiyon | 2 segment, 13 kelime; yaklaşık 8.4 saniye işlem | Tek İngilizce TTS örneği, mevcut turbo model; kalite benchmark'ı değil |
| Native Electron | Başlatılamadı | Ortam sorunu ayrıştırılmadı |
| Gerçek Premiere / Windows | Yapılmadı | Üretim uyumluluğu iddiası yok |
| npm audit | 12 high + 1 critical girdi | Lockfile tutarsız; exploit doğrulaması değil |

JSON sonuçları ve mevcut test logları [evidence](evidence/) klasöründe. Denemelerde ücretli API kullanılmadı, gerçek Premiere projesinde silme yapılmadı, kullanıcı model dosyaları değiştirilmedi.

## Önerilen çalışma sırası ve bitiş ölçütleri

1. **Yayın öncesi güvenlik/veri koruması:** F01, F02, F09. Import başarısızlığı hiçbir eski içeriği silemesin; proje dosyası çalıştırılabilir arayüz içeriği oluşturamasın; track durumu korunsun.
2. **Ortak veri modeli ve masaüstü yaşam döngüsü:** F03, F04, F07, F10, F13. Dosya aç → transkripsiyon → düzelt → kaydet/kapat/aç → tüm export'lar aynı son veriyi taşısın. Bu aşamada ortak çekirdek değişiklikleri eklentiye de aktarılır.
3. **Premiere zaman/ses sözleşmesi:** F05, F06, F08, F14, F16. Gerçek harici mikrofon, in/out, boşluklu timeline, tekrar klip ve çoklu sequence testleri. Masaüstü bitti diye varsaymadan ayrı kontrol noktası.
4. **Masaüstü ürün tamamlanması:** F15, F17–F21, F26. İlk kurulum/model, iptal, profil, dil, kaydetme, format matrisi; araç sadeleştirme.
5. **Tekrarlanabilir dağıtım:** F11, F12, F22–F25. Temiz kurulum, güncel testler, imzalı native paketler, gerçek güncelleme provası. Ancak bundan sonra sürüm etiketi ve release.

Bu adımların gün/saat tahminini doğrulanmış düzeltme kapsamı çıkmadan vermek sağlıklı olmaz. İlk düzeltme paketi küçük tutulmalı: güvenli Premiere import'u ve proje HTML doğrulaması; ardından medya/proje oturumu ile segment/kelime modeli.

## Asgari kabul matrisi

- Türkçe ve İngilizce kısa konuşma; 30+ dakikalık gerçek kayıt; sessiz/boş/bozuk dosya.
- Kamera sesi + ayrı mikrofon; başta 5 saniye boşluk; in/out sıfır dışı; aynı kaynağın iki konumda kullanımı.
- Premiere muted/disabled track, kilitli track, nested sequence, 1.5× hız ve reverse: desteklenenler doğru, desteklenmeyenler açık uyarılı.
- Kaydet/aç, medya taşındı/eksik, otomatik kurtarma, temizleme sonrası kurtarma, farklı dosyaya geçiş.
- Metin düzeltme/çeviri/split/merge/nudge → düz SRT, kelime SRT, VTT, ASS/karaoke ve video arasında tutarlılık.
- İndirmede/çözümlemede/export'ta iptal; disk dolması; izin hatası; aynı çıktı adı; başarısız batch öğesi.
- Windows Türkçe/boşluklu dosya yolu, donanımsız encoder fallback; Mac imzalı paket ve eski sürümden güncelleme.
- Premiere import hatası ve tekrar import: önceki kullanıcı içeriği, kilitler ve hedef dışı sequence'ler korunmalı.

## Dış kaynaklarla doğrulanan noktalar

- [Electron güvenlik önerileri](https://www.electronjs.org/docs/latest/tutorial/security): renderer yetkileri, Node integration ve context isolation için resmi kaynak.
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation): preload sınırı yaklaşımı.
- [electron-builder auto-update](https://www.electron.build/docs/features/auto-update/): Mac güncellemesinde ZIP gereksinimi.
- [Gemini 3.5 Flash resmi model belgesi](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash): mevcut model adını doğrulamak için; canlı API çağrısı yapılmadı.
