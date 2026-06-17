# DIFFERENCES — v1.1.3 → v1.2.0

> Bu dosya, yapılan tüm değişiklikleri gelecekte (örneğin Opus 4.8'e döndüğünüzde)
> bağlamı hızlıca anlamanız için yazılmıştır.

---

## 🔒 Güvenlik İyileştirmeleri

### Content Security Policy (CSP)
**Dosya:** `electron-main.js`

`contextIsolation: true` + `preload.js` geçişi planlanmıştı ancak uygulama mimarisi
buna uygun değil: `main.js` hem Adobe CEP hem Electron'da çalışan paylaşımlı bir dosya
ve `fs`, `path`, `os`, `child_process` modüllerini doğrudan `spawn()` ile kullanıyor.
`contextBridge` bu complex Node.js nesnelerini (stream'ler, ChildProcess) geçiremiyor.

**Yapılan:** Bunun yerine CSP eklendi — dışarıdan script yüklenmesini engelliyor:
```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: file:; media-src 'self' file: blob:; connect-src 'self' https:
```
Bu, asıl XSS saldırı vektörünü (dışarıdan enjekte edilen scriptler) önler.

### Sessiz Hata Yutma Düzeltmeleri
**Dosyalar:** `electron-main.js`, `desktop-app.js`

Tüm `catch(e) {}` ve `catch(() => {})` blokları `console.error/warn` ile loglanıyor.
Bu debug sırasında sorunların görünmesini sağlar.

---

## 🔧 Whisper.cpp İyileştirmeleri (`js/whispercpp.js`)

### Model Bütünlük Doğrulaması
İndirme sonrası doğrulama eklendi:
- **Minimum dosya boyutu kontrolü**: Her model için beklenen minimum boyut
- **GGML magic bytes kontrolü**: Dosyanın ilk 4 byte'ı geçerli GGML formatında mı
- Başarısız doğrulamada dosya silinir ve kullanıcıya açıklayıcı hata gösterilir

Yeni sabitler: `GGML_MIN_SIZES` map
Yeni fonksiyon: `verifyModel(filepath, modelKey)`

### İptal Mekanizması (AbortController)
- `transcribeWav()` artık `opts.signal` (AbortSignal) kabul ediyor
- `toWav16k()` artık opsiyonel `signal` parametresi alıyor
- Abort sinyali geldiğinde child process (`whisper-cli` / `ffmpeg`) kill ediliyor
- Desktop tarafında (`desktop-app.js`): `_transcribeAbort` AbortController, `window.cancelTranscription()` fonksiyonu eklendi

### Async Logging
- `fs.appendFileSync` → buffered `fs.appendFile` + 200ms flush timer
- Transkripsiyon sırasında I/O stuttering'i önler
- Yeni export: `flushLog()`

### Startup Temp Cleanup
- Uygulama başlangıcında 1 saatten eski `.part` dosyaları temizlenir
- Crash sonrası disk birikimini önler
- Yeni fonksiyon: `cleanupStaleDownloads()`

### Thread Count
- Sabit `Math.min(8, cpus)` limiti kaldırıldı → tüm CPU çekirdekleri kullanılabilir
- `opts.threads` dışarıdan geçilebilir (0 = auto)

---

## 🐛 Bug Düzeltmeleri

### `applyTheme()` Çift Çağrı (`main.js`)
**Eski:** `init()` fonksiyonunda `applyTheme()` iki kez çağrılıyordu (satır 2778 ve 2781).
**Yeni:** Sadece `applyIcons()` sonrasında bir kez çağrılır.

### Stderr Limiti (`main.js`)
**Eski:** `STDERR_CAP = 8000` — uzun hata mesajları kesiliyordu.
**Yeni:** `STDERR_CAP = 32000` — 4 kat artırıldı.

---

## 🍎 macOS DMG "Hasar Görmüş" Düzeltmesi

### Hardened Runtime + Entitlements
**Dosya:** `package.json` → `build.mac` bölümü

Eklenen:
```json
"hardenedRuntime": true,
"gatekeeperAssess": false,
"entitlements": "build/entitlements.mac.plist",
"entitlementsInherit": "build/entitlements.mac.plist"
```

### Entitlements Dosyası
**Yeni dosya:** `build/entitlements.mac.plist`

İzinler:
- `com.apple.security.cs.allow-jit` — V8 JIT derleme
- `com.apple.security.cs.allow-unsigned-executable-memory` — whisper.cpp çalıştırma
- `com.apple.security.cs.disable-library-validation` — dinamik kütüphaneler
- `com.apple.security.device.audio-input` — mikrofon erişimi (gelecek için)
- `com.apple.security.cs.allow-dyld-environment-variables` — dyld değişkenleri

> **Not:** Bu düzeltmeler imzasız (ad-hoc signed) app'ler için en iyi sonucu verir.
> Tam notarization için Apple Developer ID gerekir. Kullanıcılar hâlâ ilk açılışta
> `xattr -cr /Applications/Subsper.app` çalıştırması gerekebilir.

---

## ⚙️ Yeni Ayar: CPU Thread Sayısı

### UI Eklentisi (`index.html`)
Engine Settings bölümüne slider eklendi:
- `0` = Auto (tüm CPU çekirdekleri)
- `1-32` arası manuel seçim

### Settings (`main.js`)
`DEFAULT_SETTINGS` → `threads: 0` eklendi

### Entegrasyon (`desktop-app.js`)
`transcribeViaCpp()` → `WCPP.transcribeWav()` çağrısına `threads: settings.threads` geçiliyor

---

## 🔨 Build & CI Güncellemeleri (`.github/workflows/build.yml`)

- **Node.js 20 → 22**: Node.js 20 deprecation uyarısı kaldırıldı
- **macOS runner: macos-14 → macos-15**: Güncel Apple Silicon runner

---

## 📋 Versiyon

`1.1.3` → `1.2.0`

---

## 📁 Değişen Dosyalar Özeti

| Dosya | Değişiklik |
|---|---|
| `electron-main.js` | CSP ekleme, sessiz catch düzeltme |
| `js/whispercpp.js` | Model doğrulama, iptal, async logging, temp cleanup, thread |
| `js/main.js` | Double applyTheme fix, stderr cap, thread setting |
| `js/desktop-app.js` | Sessiz catch fix, iptal desteği, thread count, temp cleanup |
| `index.html` | Thread count slider |
| `package.json` | Version bump, hardenedRuntime, entitlements |
| `build/entitlements.mac.plist` | **YENİ** — macOS entitlements |
| `.github/workflows/build.yml` | Node 22, macos-15 |
| `DIFFERENCES.md` | **YENİ** — bu dosya |
| `README.md` | xattr talimatı ekleme |
