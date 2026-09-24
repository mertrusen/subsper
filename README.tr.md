# Subsper — Türkçe kullanım kılavuzu

[English README](README.md)

Subsper, konuşmayı düzenlenebilir altyazıya dönüştürür. Bu depoda aynı altyazı çekirdeğini paylaşan **masaüstü uygulaması** ve **Adobe Premiere Pro eklentisi** bulunur. Transkripsiyon, düzenleme ve dışa aktarma bilgisayarında çalışır. İsteğe bağlı çevrimiçi özelliklerin hangi veriyi gönderdiği [Gizlilik belgesinde](PRIVACY.md) açıklanır.

**Güncel yayın:** [1.4.0 Preview 1](https://github.com/mertrusen/subsper/releases/tag/preview-1.4.0-preview.1) içinde Premiere `.zxp` paketi ve kaynak kod vardır. Bu sürümde masaüstü kurulum dosyası yoktur. `v1.3` kurulum dosyaları eski arayüze aittir. Yeni Windows ve macOS yükleyicileri için kod imzalama kurulumu gerekir; ayrıntılar [imzalama belgesinde](docs/SIGNING.md).

## Neler yapabilirsin?

- Video/ses dosyasını veya Premiere sekansını yerel whisper.cpp motoruyla yazıya dökebilir, mevcut SRT'yi içe aktarabilirsin.
- Altyazı metnini ve zamanını düzenleyebilir; masaüstünde dalga biçimi üzerinde konuma gidebilir, yakınlaştırabilir ve kaydırabilirsin.
- Yazı tipi, renk, konum ve stil seçebilir; ASS veya videoya gömülü çıktı için fade, pop ve bounce animasyonlarını kullanabilirsin. Paket içindeki Inter, Montserrat, Oswald ve Bebas Neue fontlarının lisansları [üçüncü taraf bildirimlerinde](THIRD-PARTY-NOTICES.md) yer alır.
- SRT, VTT, ASS, TXT, videoya gömülü MP4 ve masaüstünde dikey 9:16 video oluşturabilirsin. `.subsper` proje dosyası çalışmana geri dönmeni sağlar; medya dosyasının kendisini içermez.
- **Araçlar** bölümünde sessizlik kesme, tekrar/dolgu tespiti, ses iyileştirme ve başka işlemler bulunur. Premiere'e özel araçlar sekansı değiştirebilir; sonucu kullanmadan önce gözden geçir.

İlk transkripsiyonda seçilen konuşma modeli indirilir. Sonraki kullanımlarda yerel model kullanılabilir. Çeviri, dil düzeltme ve bazı içerik araçları ancak kendi API anahtarını ayarlarsan altyazı **metnini** seçtiğin sağlayıcıya gönderebilir. Medya gönderimi ve diğer ağ kullanımı için [PRIVACY.md](PRIVACY.md) belgesini oku.

## Masaüstü uygulamasını çalıştır

Güncel sürümde yeni bir masaüstü yükleyicisi bulunmadığından kaynak koddan çalıştırmak gerekir. Node.js, Git, CMake ve C/C++ derleme araçları kurulu olmalı. macOS FFmpeg derlemesi için `pkg-config` de gerekir. Windows'ta varsayılan GPU motoru için Vulkan SDK gerekir; yalnız CPU ile geliştirme yapacaksan `SKIP_WHISPER_GPU=1` ayarlayabilirsin. macOS paket hedefi Apple Silicon, Windows hedefi x64'tür. Yerel motorun hazırlanması zaman ve disk alanı kullanabilir.

```bash
git clone https://github.com/mertrusen/subsper.git
cd subsper
npm install
npm run prep
npm start
```

1. **Video / Ses Dosyası Aç** düğmesiyle dosya seç veya pencereye bir dosya sürükle. Birden fazla medya dosyası sürüklemek toplu transkripsiyonu başlatır.
2. Altyazı başlığının yanındaki ayar kontrolünden model ve dili seçip **Transcribe File** düğmesine bas. İlk çalıştırmada model indirilir. Dilersen mevcut bir `.srt` dosyasını yükle.
3. Metni değiştirmek için altyazıya çift tıkla. Bir altyazının konumuna gitmek videoyu oraya taşır; video duraklatılmışsa oynatma başlamaz. **Boşluk** oynat/duraklat, **Cmd/Ctrl+Z** düzenlemeyi geri alır. **Alt+Sol/Sağ** seçili altyazının başlangıcını 0,1 saniye kaydırır; **Shift** de basılıysa bitişini kaydırır.
4. Dalga biçiminde tıkla veya oynatma imlecini sürükle. Tekerlek yakınlaştırır; dalga biçimini sürükleyerek veya **Shift+tekerlek** ile yatay kaydırabilirsin. **+**, **−**, **Sığdır** düğmeleri de kullanılabilir. Oynatma sırasında görünüm imleci takip eder.
5. Bir kelimeye tıklayarak altyazıyı o kelimeden önce böl; **↑** ile önceki altyazıyla birleştir veya altyazı numarasını komşu altyazıya sürükle. **Cmd/Ctrl+Z** ile geri al. İsteğe bağlı satır önizlemesi için fontu, puntoyu ve kutu genişliğini ayarla. **Görünüm** bölümünden çıktı stilini ve animasyonu seç.
6. **Çıktı al** bölümünden altyazı biçimini, videoya gömme seçeneğini veya **Projeyi kaydet** eylemini seç. Proje dosyası medyanın bir kopyasını değil yolunu saklar.

### Hangi çıktı uygun?

| Biçim | Ne taşır? | Ne zaman kullanılır? |
| --- | --- | --- |
| **SRT** | Metin ve zamanlama; font/animasyon güvenilir biçimde taşınmaz. | CapCut veya başka editörde altyazıyı düzenlemek için. |
| **VTT** | Metin ve zamanlama; Subsper görsel stilini eklemez. | Web altyazısı için. |
| **ASS** | Font, renk, konum, karaoke ve desteklenen animasyon. | ASS destekleyen oynatıcı ve işleyiciler için. Font hedef cihazda bulunmalı. |
| **Videoya gömülü MP4** | Görünüm videonun içine işlenir. | Her yerde aynı görünüm için; altyazı artık ayrı metin olarak düzenlenemez. |
| **TXT** | Yalnızca metin. | Düz transkript için. |

**CapCut:** altyazıların düzenlenebilir kalması için SRT aktar ve font/animasyonu CapCut içinde seç. CapCut'un [belgelenen içe aktarma yolu](https://www.capcut.com/help/how-to-import-subtitles) ASS'yi listelemiyor. Subsper'daki görünüm aynı kalsın istiyorsan altyazı gömülü videoyu CapCut'a aktar.

### Komut satırı

Motor hazırlandıktan sonra CLI, her dosyanın yanına bir SRT kaydeder:

```bash
npm run cli -- video.mp4
npm run cli -- video1.mp4 video2.mp4 --model small --lang tr
npm run cli -- --help
```

CLI görsel stil içermez; düz SRT üretir.

## Premiere eklentisini kullan

1. [Güncel yayından](https://github.com/mertrusen/subsper/releases/tag/preview-1.4.0-preview.1) `Subsper-Premiere-1.4.0-preview.1.zxp` dosyasını indir, kendinden imzalı CEP eklentilerini yükleyebilen bir ZXP yükleyiciyle kur ve Premiere'i yeniden başlat.
2. Yerel `whisper-cli` ve `ffmpeg` motorunu sağla. Bu önizlemede yeni masaüstü yükleyicisi yok; sistemindeki uyumlu motoru veya [eklenti kaynak kurulumunu](extension/README.md) kullan.
3. Premiere'de **Window → Extensions → Subsper** panelini aç. Sekansı seç; yalnızca bir kısmını yazıya dökmek istiyorsan önce In/Out belirle.
4. **Altyazı Oluştur → Ayarlar** içinde konuşma dilini ve gerekirse konuşmanın bulunduğu ses track'ini seç. Otomatik kaynak önce video sesini kullanır; ayrı mikrofon için doğru A1/A2 track'ini seç. Satır önizlemesini açıp kapatabilir; fontu listeden seçip puntoyu, kalınlığı, harf aralığını ve altyazı kutusunun genişliğini ayarlayabilirsin. Varsayılan örnek Helvetica Bold 50'dir. Olası üçüncü satırın başladığı **tek kelime** kırmızı işaretlenir. İstersen yeni transkripsiyonları bu kelimeden otomatik bölmeyi aç veya mevcut altyazıları ayarlardaki düğmeyle böl. Bu ölçüm tahminidir; Premiere farklı dizebilir. İstediğin kelimeye tıklayarak böl. **↑** ile veya altyazı numarasını komşu altyazıya sürükleyerek birleştir. **Cmd/Ctrl+Z** ile geri al. Önizleme gönderimi engellemez.
5. **Çıktı al** bölümünden Premiere'e **yeni bir caption track** gönder veya SRT/VTT/TXT kaydet. Eski track korunur. Yeni track Premiere'in varsayılan altyazı fontunu kullanır. CEP betik API'si kayıtlı Track Style'ı okuyup otomatik uygulayamadığı için kayıtlı stilini yeni track'e Premiere içinde uygula. Masaüstüne ait font/animasyon paneli eklentide gösterilmez.

## Geliştirme ve doğrulama

Paylaşılan kodun asıl kaynağı depo köküdür. `js/`, `css/`, `index.html` veya fontları değiştirdikten sonra eklenti kopyasını güncelle:

```bash
bash scripts/sync-to-extension.sh
```

Gerekli kontroller:

```bash
bash dev/test/run.sh
bash dev/test/ffmpeg-smoke.sh
bash dev/test/check-mirror.sh
node dev/test/host-captions.test.js
node dev/v2-harness.js
python3 dev/test/ui-audit.py
python3 dev/test/settings-audit.py
```

Chrome/Chromium varsa `dev/test/dom-harness.sh` ve `dev/test/page-isolation.sh` tarayıcı etkileşimlerini denetler. Birim testleri gerçek Premiere sekansı ve yükleyici testinin yerini tutmaz. Yerel paket denemeleri için Windows'ta `npm run dist:win`, macOS'ta `npm run dist:mac` kullanılır; bunlar yayın yapmaz. `v*` etiketli yayın iş akışı imzalı kurulum dosyaları gerektirir. [İmzalama açıklaması](docs/SIGNING.md) ve [lisans bildirimleri](THIRD-PARTY-NOTICES.md) ayrıntıları içerir.

## Sorun giderme

- **Motor bulunamadı:** kaynak kurulumunda `npm run prep` çalıştır; Premiere için [eklenti açıklamasındaki](extension/README.md) arama yollarını kontrol et.
- **İlk transkripsiyon bekliyor:** modelin indirilmesi gerekir. İnternet bağlantısını ve boş alanı kontrol et.
- **SRT'de font/animasyon kayboldu:** görünüm için ASS veya altyazı gömülü video kullan.
- **Proje videosuz açıldı:** `.subsper` medya dosyasını içermez; özgün dosyayı geri getir veya yeniden aç.
- **Premiere sonucu farklı görünüyor:** yerel altyazılar Premiere'in kendi stilini kullanır; timeline sonucunu incele.

Hata ve istekler için [GitHub Issues](https://github.com/mertrusen/subsper/issues) kullan. Sürümü, işletim sistemini, tekrar adımlarını ve çıktı biçimini yaz; özel medya veya API anahtarını herkese açık mesaja ekleme.

Lisans ve veri işleme: [LICENSE](LICENSE) · [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) · [PRIVACY.md](PRIVACY.md)
