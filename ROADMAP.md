# Subsper — Yapılacaklar Yol Haritası (Gemini için uygulama rehberi)

Bu dosya, sıradaki özellikleri **Gemini'ye (veya başka bir AI'a) verip uygulatabilmen**
için yazıldı. Her madde: **Ne / Neden / Dokunulacak dosyalar / Nasıl (adımlar) / Hazır Gemini promptu / Bitti sayılır**.

---

## 0) ŞU AN ELİMİZDE NE VAR (analiz — v1.6.7)

**Mimari:** Tek repo (`subsper`) — Desktop kökte, Premiere eklentisi `extension/`'da.
Ortak motor **whisper.cpp + ffmpeg gömülü** (sıfır kurulum). Eklenti, kurulu Desktop'ın
motorunu kullanıyor.

**Çalışan özellikler:**
- Yerleşik transcribe (whisper.cpp), model ilk kullanımda iner; tüm timeline / In-Out
- Akıllı bölme, karaoke (.ass), sözlük, dolgu-kelime temizleme, küfür filtresi
- Edit: sessizlik kes (ripple), Auto Zoom · Audio: denoise + EBU R128
- Export: SRT / VTT / ASS / TXT · Premiere'e caption/MOGRT gönderme
- **AI Paneli (çok sağlayıcılı: Gemini / OpenAI / Anthropic / custom):**
  başlık+açıklama, viral Shorts, B-roll önerisi, etiket/hashtag, İngilizce çeviri, dilbilgisi düzeltme
- Konuşmacı etiketleri (WhisperX, opsiyonel Pro)

**Açık uçlar / riskler (önce bunlara bak):**
1. **Gemini model adı `gemini-3.5-flash`** — bu ID geçerli olmayabilir. AI çağrıları 404
   verirse sebebi budur. Google AI Studio'da geçerli bir ID ile değiştir (ör. `gemini-2.5-flash`).
2. **Windows GPU (Vulkan)** kodu var ama CI'da `SKIP_WHISPER_GPU=1` ile **kapalı** (binary üretilmiyor).
3. **macOS x64 (Rosetta)** build — yavaş + arch karmaşası. Native arm64'e geçmek daha iyi.
4. **Eklenti tek-tık `.zxp` değil** (klasör-kopya + PlayerDebugMode).
5. Lisans/aktivasyon, kod imzalama, auto-update **yok**.

---

## A) ÜCRETSİZ / YEREL ÖZELLİKLER

### A1) 🔥 Hardsub — altyazıyı videoya yakma (EN ÖNCELİKLİ)
**Ne:** Düzenlenen altyazıyı, seçilen stille videonun üstüne **kalıcı yakıp** yeni mp4 export et.
**Neden:** TikTok/Reels/Shorts için olmazsa olmaz; ffmpeg zaten gömülü, maliyet yok.
**Dosyalar:** `js/whispercpp.js` (yeni `burnSubtitles()`), `js/desktop-app.js` (buton+akış),
`index.html` (Export menüsüne "Burn into video (MP4)").
**Nasıl:**
1. Mevcut segmentleri geçici `.ass` dosyasına yaz (stil presetiyle — bkz. A2). Var olan
   `segmentsToASS()` fonksiyonunu kullan.
2. ffmpeg ile yak (bundled ffmpeg yolu = `ffmpegBin(appDir)`):
   ```
   ffmpeg -i <input> -vf "ass=<altyazi.ass>" -c:a copy -c:v libx264 -preset fast -crf 18 <output.mp4>
   ```
   (Sadece düz stil istenirse `subtitles=<srt>:force_style='...'` da olur.)
3. İlerleme: ffmpeg stderr'deki `time=` değerini parse edip yüzde göster.
4. Bitince kaydet dialogu (desktop'ta `ipcRenderer.invoke("dialog:saveFile")`).
**Hazır Gemini promptu:**
> "Subsper'a hardsub özelliği ekle. `js/whispercpp.js`'e `burnSubtitles({appDir, inputVideo, assPath, outPath, onProgress})` ekle: bundled ffmpeg ile `-vf ass=` filtresi kullanarak altyazıyı videoya yaksın, ffmpeg `time=` çıktısından ilerleme yüzdesi versin. Desktop'ta Export menüsüne 'Burn into video (MP4)' butonu ekle; segmentleri `segmentsToASS()` ile .ass'e yazıp `burnSubtitles`'ı çağır, kaydet dialoguyla çıktıyı kaydet."
**Bitti sayılır:** Bir video + altyazı → "Burn" → altyazı gömülü mp4 çıkıyor.

### A2) 🔥 Altyazı stil presetleri (font/renk/kontur/konum)
**Ne:** Hazır şablonlar (TikTok, Podcast, Minimal, Sarı-klasik) + özelleştirme; export/hardsub/karaoke ortak kullanır.
**Dosyalar:** `index.html` (Subtitles→Settings'e stil bölümü), `js/main.js` (`settings.subStyle` + `.ass` üreticide stili uygula).
**Nasıl:**
1. `settings.subStyle = { font, size, primaryColor, outlineColor, outline, shadow, position, bold }`.
2. `segmentsToASS()` içindeki `[V4+ Styles]` satırını bu değerlerden üret.
3. UI: font (select), renk (color input), boyut (range), konum (alt/orta/üst), kontur kalınlığı.
4. 4-5 hazır preset butonu (tıklayınca settings'i doldurur) + canlı önizleme (video üstüne CSS overlay).
**Hazır Gemini promptu:**
> "Subsper'a altyazı stil ayarları ekle: `settings.subStyle` (font, size, primaryColor, outlineColor, outline, shadow, position, bold). Subtitles→Settings'e font/renk/boyut/konum kontrolleri + 4 hazır preset (TikTok, Podcast, Minimal, Klasik) koy. `segmentsToASS()`'i bu stille üret ki hem ASS export hem hardsub aynı stili kullansın. Video önizlemesinde CSS overlay ile canlı önizleme göster."

### A3) Toplu işlem (batch)
**Ne:** Bir klasördeki tüm videoları sıraya alıp otomatik altyazıla + (opsiyonel) hardsub/SRT yaz.
**Dosyalar:** `js/desktop-app.js` (çoklu dosya seçimi + kuyruk), `electron-main.js` (`dialog:openMedia` çoklu).
**Nasıl:** Dosya listesi → her biri için: media→16k wav→transcribe→export. İlerleme satırı + iptal.

### A4) Windows GPU (Vulkan) — yarım kalmışı bitir
**Ne:** `whisper-cli-gpu` (Vulkan) binary'sini CI'da gerçekten üret, GPU varsa kullan (3-10x hız).
**Durum:** Kod var (`whispercpp.js` GPU seçim + CPU fallback), `fetch-binaries.mjs` Vulkan derliyor,
ama `build.yml`'de `SKIP_WHISPER_GPU=1` ile kapalı.
**Nasıl:** Vulkan derlemesi CI'da kararlı çalışınca `SKIP_WHISPER_GPU`'yu kaldır; `whisper-cli-gpu.exe`
+ gerekli DLL'leri (varsa) `bin/win-x64/`'e koy; mevcut fallback zaten GPU çökerse CPU'ya düşüyor.
**Dikkat:** GPU binary'si dinamik Vulkan loader'a bağlı olabilir → kullanıcıda GPU sürücüsü yoksa
CPU'ya düşmeli (zaten var). Önce küçük modelle test et.

### A5) macOS native arm64 + imzalama (Rosetta'yı bırak)
**Ne:** Mac build'i x64 (Rosetta) yerine arm64 yap → hızlı + `arch -arm64` juggling'i gereksiz kalır.
**Dosyalar:** `package.json` (`mac.target.arch: ["arm64"]`), `build.yml` (FORCE_MAC_X64 kaldır), ad-hoc imza.
**Nasıl:** Gatekeeper "hasarlı" uyarısı için: build sonrası `codesign --deep --force --sign - <app>`
(ad-hoc) + kullanıcıya `xattr -dr com.apple.quarantine` notu. Gerçek çözüm: Apple Developer
sertifikası ($99/yıl) ile imza + notarization (sonra).

---

## B) YAPAY ZEKÂ (mevcut AI panelinin üstüne)

> Altyapı hazır: `askAi(type)` (main.js) prompt kurar, sağlayıcıya gönderir, `ai-output`'a yazar;
> `applyAiToSubtitles()` sonucu segmentlere uygular. Yeni AI özelliği = yeni `type` + buton.

### B1) 🔥 Her dile çeviri (sadece İngilizce değil)
**Ne:** Hedef dil seçici (TR, EN, DE, ES, FR, AR…) → çeviri → **çevrilmiş SRT export** veya segmentlere uygula.
**Dosyalar:** `index.html` (AI paneline dil select), `js/main.js` (`askAi("translate")` hedef dili alsın).
**Nasıl:** Mevcut `translate_en` promptunu genelle: `Translate ... into ${targetLangName}. Preserve timecodes exactly.`
Sonra `applyAiToSubtitles()` ile uygula veya "Export translated SRT".
**Hazır Gemini promptu:**
> "AI paneline hedef dil dropdown'ı ekle (TR/EN/DE/ES/FR/IT/AR/RU). `askAi('translate')` seçilen dile çevirsin, timecode'ları birebir korusun. Sonucu hem segmentlere uygulanabilir yap (applyAiToSubtitles) hem de 'Çevrilmiş SRT indir' butonu ekle."

### B2) Otomatik bölümler (YouTube chapters)
**Ne:** Transkriptten anlamlı bölümler + başlıklar + `00:00 Giriş` formatı (YouTube açıklamasına yapıştırılır).
**Nasıl:** Yeni `type="chapters"`: `Generate YouTube chapters as 'MM:SS Title' lines, min 10s apart, cover the whole video.` Çıktıyı `ai-output`'a yaz + "Kopyala".

### B3) "Videoyla sohbet" / Q&A
**Ne:** Serbest soru kutusu → transkript bağlamında cevap (özet, "şu konu nerede geçiyor", not çıkar).
**Nasıl:** `askAi("chat", userQuestion)` — prompt = transkript + kullanıcı sorusu. Panelde input + gönder.

### B4) Emoji caption + ton/stil yeniden yazımı
**Ne:** Caption'lara bağlama uygun emoji ekle; veya tonu değiştir (samimi/resmi/kısalt). `applyAiToSubtitles` ile uygula.

### B5) AI küfür sansürü (bip)
**Ne:** AI küfürlerin timecode'larını bulur → ffmpeg ile o aralıkları sustur/bip'le (`volume=0` veya bip sesi `amix`).
**Dosyalar:** `whispercpp.js` (ffmpeg mute ranges), `main.js` (AI'dan küfür timecode listesi).

> **Tüm AI özellikleri için ortak iyileştirme:** `applyAiToSubtitles()`'in timecode parse'ını
> sağlamlaştır (AI bazen markdown/ekstra metin döndürür — zaten `strip AI timecodes` commit'i var,
> ama her dilde test et).

---

## C) SATILABİLİR / TİCARİ

### C1) Eklenti için imzalı .zxp installer
**Ne:** `extension/`'ı tek-tık kurulabilir imzalı `.zxp` yap, aynı release'e ekle.
**Nasıl:** CI'da `ZXPSignCmd` indir → self-signed sertifika üret → `extension/`'ı (içine win+mac
binary'leri koyarak) imzala → `Subsper-Extension-x.zxp` olarak release'e yükle. Kullanıcı ZXP
Installer ile çift tıkla kurar. (Binary'ler için: ya tüm platformları .zxp'ye göm, ya da ilk
kullanımda indir.)

### C2) Lisans / aktivasyon
**Ne:** Ücretli sürüm için lisans anahtarı doğrulama.
**Nasıl:** Gumroad / Lemon Squeezy ile sat → uygulama açılışta anahtarı online doğrula (basit fetch),
sonucu cache'le. Freemium: ücretsiz çekirdek + ücretli Pro (AI toplu, hardsub batch, stiller).

### C3) Kod imzalama + notarization
**Ne:** "Bilinmeyen geliştirici / hasarlı" uyarılarını tamamen kaldır (güven = satış).
**Nasıl:** Win: Authenticode sertifikası (EV/OV). Mac: Apple Developer ID + `notarytool`.

### C4) Auto-update
**Ne:** Uygulama kendini güncellesin.
**Nasıl:** `electron-updater` + GitHub Releases provider. `electron-main.js`'e `autoUpdater.checkForUpdatesAndNotify()`.

---

## ÖNCELİK SIRASI (tavsiye)
1. **A1 Hardsub** + **A2 Stil presetleri** → ücretsiz, anında "vay be", sosyal medya.
2. **B1 Her dile çeviri** + **B2 Chapters** → AI panelinde en büyük pazar.
3. **A4 GPU'yu aç** (hız) · **A5 mac arm64** (kalite/temizlik).
4. **C1 .zxp** · **C2 lisans** · **C3 imza** · **C4 auto-update** → ticarileştirme.

> Önce **A1 + A2**'yi yap; ürün bir anda "pro" hisseder.
