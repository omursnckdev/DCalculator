# AOS_DCalculator — Yapılanların Özeti

Bu belge, projede baştan bu yana yapılan her şeyi tek yerde anlatır: ne eklendi, nasıl çalışıyor, hangi varsayımlar var, nerede bulunur.
Ayrıntılı formüller ve açık sorular için [PLAN.md](PLAN.md), kullanım için [../README.md](../README.md), Windows kurulumu için [KURULUM-WINDOWS.txt](KURULUM-WINDOWS.txt) dosyalarına bakın.

> Tüm sonuçlar **ön tasarım tahminidir**; nihai mühendislik çalışmasının, üretici verisinin ve ilgili standartların yerini tutmaz.

---

## 1. Uygulama nedir?

Tarayıcıda çalışan, sunucusuz bir **veri merkezi güç zinciri ve ısıl yük analiz aracıdır**. Şemayı çizersiniz (şebeke → trafo → panolar → UPS → yükler, jeneratör, soğutma ekipmanı);
uygulama gücü yükten kaynağa doğru toplar, kayıpları, ısıl yükü, PUE'yi, doluluğu, arıza durumlarını ve çeşitli mühendislik çalışmalarını hesaplar. Proje IndexedDB'de otomatik saklanır, JSON olarak
kaydedilir/yüklenir.

**Teknoloji:** Vite, React 19, TypeScript, @xyflow/react (şema), Zustand (durum), Tailwind, vitest (test), ExcelJS (Excel), html-to-image (PNG), Web Worker (ağır taramalar).
Hesap motoru (`src/engine`) saf TypeScript'tir; React'tan bağımsız ve testlidir.

**Çalıştırma:** `npm install` → `npm run dev` (http://localhost:5173). Windows'ta `baslat.bat` çift tıklanır. Testler: `npm test`, tür denetimi: `npm run typecheck`, derleme: `npm run build`.

---

## 2. Geliştirme aşamaları (kronolojik)

| Aşama | Yapılan |
|---|---|
| **Faz 1** | Sürükle-bırak şema, ekipman paleti, kablo/busbar hatları, özellik paneli, IndexedDB otomatik kayıt, JSON kaydet/yükle |
| **Faz 2** | Yük toplama (IT/mekanik/kayıp), kVA ve akım, kapasite doluluğu (yeşil/sarı/kırmızı), hat akımı ve gerilim düşümü, UPS verimi, canlı doğrulama, tablo görünümü, "nasıl hesaplandı" adımları |
| **Faz 3** | Trafo, kablo ve busbar kayıpları, UPS verim eğrisi, ısıyı bırakma yeri (salon / elektrik odası / dış), mekân bazında ısıl yük (kW, TR), PUE, diversity, Excel ve PNG çıktısı |
| **Faz 4** | Hat anahtar durumu, ATS/STS, bara kuplajı, arızada yükün sağlam hatlara aktarılması (2N, yedek jeneratör), N-1 taraması, kaydedilebilir senaryolar ve karşılaştırma |
| **Faz 4 eki** | Canlı simülasyon: akan enerji animasyonu, otomatik bypass, senkron panosu, UPS bataryası, arızanın adım adım izlenmesi, arızanın giderilmesi (geri transfer, jeneratör soğutma ve duruş) |
| **Faz 5** | Kısa devre, toplam gerilim düşümü, soğutma yeterliliği, harmonik, yedeklilik, bakım modu, yük profili ve maliyet, batarya enerjisi, sıralı arıza, grafik, geri al/yinele, çoklu seçim, arama, gruplama, şablonlar, PDF raporu |
| **Ekipman kütüphanesi** | 20 yeni tip (chiller, CRAH, CRAC, fan wall, in-row, RDHx, kuru soğutucu, soğutma kulesi, pompa, AHU, fan, nemlendirici, rack, depolama, güvenlik, yangın, asansör, yük bankası, ofis, RPP) |
| **Faz G** | İklim, COP(T), free-cooling, mevsimsel PUE, soğutma zinciri, salon sıcaklığı, WUE, CO₂ |
| **Faz H** | Erişilebilirlik ve güvenilirlik (MTBF/MTTR, kaç dokuz, topoloji karşılaştırma) |
| **Faz I** | Koruma seçiciliği (TCC) ve ark flaşı |
| **Faz J** | Kablo seçim yardımcısı |
| **Faz K** | Jeneratör yakıt özerkliği, yük atma, sıralı yük alma ve gerilim çökmesi |
| **Faz M** | Ekipman kataloğu ve Excel/CSV toplu içe aktarma |
| **Faz L** | Dokümantasyon, tarayıcı doğrulaması, push |
| **3D-9** | Katlı bina (zemin gri / 1. kat beyaz), dış merdiven ve katlı yürüme, jeneratörler dışarıda, ayrıntılı pano ve şalterler |
| **3D-1…5** | 3D yerleşim görünümü: veri modeli, otomatik yerleşim, sürükle-bırak, renk modları, ısı haritası, simülasyon, kablo güzergâhı ve uzunluk, görünümler, PNG/PDF |

---

## 3. Kullanıcı geri bildirimleriyle şekillenen davranışlar

Aşağıdakiler isteğiniz üzerine eklendi veya düzeltildi:

- **Jeneratör acil kaynaktır:** normal kaynak (şebeke/trafo) varken yük almaz; yalnızca normal kaynak kalmayınca devreye girer. Trafo aktifse jeneratör yükte değildir.
- **ATS/STS tercih edilen kaynak:** hat üzerindeki "pay" ile belirlenir; ATS/STS aynı anda tek girişi aktif tutar.
- **Ekipman başına giriş/çıkış sayısı** ayarlanabilir (port sayısı, en çok 24).
- **HDC02 PL1 şeması:** DXF'ten 122 ekipmanlı model (`examples/hdc02-pl1.dcalc.json`); değerler şemadan, yükler ve bazı cihaz değerleri **varsayım** (düğüm notlarında "Varsayım:" yazar).
- **İkon + ad görünümü** varsayılan; ayrıntılı kart görünümü seçilebilir.
- **UPS hard bypass ve jeneratör %70 kademelendirme:** otomatik kapanan bypass kesicileri ve senkron panosu kuralı.
- **Canlı simülasyon:** arıza uygulanır, adım adım oynatılır.
- **Arıza iptali:** "Arızayı gider" düğmesi; giderme adımları yalnız bu düğmeyle gelir, kendiliğinden tekrar oynamaz (geri transfer ~5 dk, jeneratör soğuması ~5 dk, sonra duruş).
- **Seçmeli arıza giderme:** birden çok arıza varken yalnız seçilen ekipmanın arızası giderilir.
- **Pano ve busbar ısı yükü:** `P = 3·I²·R·L / 1000`; pano iç bara uzunluğu ve direnci girilir (direnç 0 ise nominal akımdan tahmin).
- **Kayıp dökümü:** her kablo, busbar, pano, trafo, UPS kalem kalem (Isıl özet sekmesi, tablo, Excel "Kayıplar" sayfası).
- **MDB yatay boyutlandırma** ve **şemadan arıza listesine ekleme** düğmesi; birden çok ekipmanı isimle aramak yerine **Ctrl+K arama** ve seçim kutusu.
- **Windows kurulumu:** `baslat.bat` ve adım adım `KURULUM-WINDOWS.txt`.

---

## 4. Özellik özeti (sekmeler ve araçlar)

### 4.1 Şema ve düzenleme
Sürükle-bırak palet, hat çizme, özellik paneli, geri al/yinele (Ctrl+Z / Ctrl+Y, 100 adım), seçim kutusu ve çoklu seçim, **gruplama** (grup çerçeveleri), **Ctrl+K arama**,
hazır **şablonlar** (tek hat N, jeneratörlü N+1, 2N tam yedekli), Excel/PNG/JSON/PDF çıktıları.

### 4.2 Analiz (Isıl özet, Tablo, Doğrulama)
Yük toplama, doluluk, hat akımı, gerilim düşümü, kayıplar, PUE, mekân bazında ısıl yük, grup bazında güç özeti, doğrulama uyarıları.
**Kısa devre (Isc)** ve **kaynaktan düğüme toplam gerilim düşümü** (trafo dahil), kesici kesme kapasitesi kontrolü.
**Harmonik / K-faktörü:** trafo ek kaybı ve kullanılabilir kapasite düşüşü. **Soğutma yeterliliği:** kapasite − ihtiyaç, açıkta salon ısınma süresi.

### 4.3 Senaryo ve simülasyon
Senaryolar (arızalı ekipman, hat/kesici durumları), N-1 taraması, senaryo karşılaştırma. Canlı simülasyon aşamaları: arıza anı → STS → bypass → jeneratör → senkron kademelendirme →
batarya tükenmesi → (yük atma) → (yakıt tükenmesi) → salon sıcaklığı sınırı. Ayrıca batarya şarj durumu, **ek arıza** (sıralı arıza), **grafik** görünümü, **arıza raporu (PDF)**.

### 4.4 Yedeklilik sekmesi
Tek arıza taraması: N-1, jeneratör N+1, UPS N+1, trafo doluluğu, soğutma yedekliliği, tekil arıza noktaları; **bakım modu** (planlı bakımda ikinci arıza taraması). Web Worker'da çalışır.

### 4.5 Enerji ve maliyet sekmesi
24 saatlik IT/mekanik yük profili, günlük/yıllık kWh, ortalama PUE, maliyet, hedef PUE'ye göre tasarruf.
**İklim:** 12 aylık sıcaklık ve genlik (veya 8760 saatlik veri). **COP(T)**, **free-cooling**, **mevsimsel PUE**, **WUE**, **CO₂ ayak izi**.

### 4.6 Soğutma zinciri ve salon sıcaklığı
Soğuk su / kondenser **pompası** ve **ısı atım** ekipmanı (kuru soğutucu, kule) arızalanınca chiller kapasitesi hidrolik zincir çarpanıyla düşer (yedek pompa "Görev: yedek" ile).
Simülasyonda salon sıcaklığı dakika dakika modellenir; izinli sınır aşılınca ayrı adım üretilir.

### 4.7 Güvenilirlik sekmesi
MTBF/MTTR'den **erişilebilirlik**, yılda kesinti dakikası, **"kaç dokuz"**, asgari kesit kümeleri (tek arıza noktaları dahil), N/N+1/2N topoloji karşılaştırması, Tier göstergesi.

### 4.8 Elektrik çalışmaları sekmesi
1. **Koruma seçiciliği:** ACB/MCCB açma eğrileri (TCC grafiği), üst/alt kesici seçicilik limiti.
2. **Ark flaşı:** IEEE 1584-2002 basitleştirilmiş olay enerjisi, PPE kategorisi.
3. **Kablo seçimi:** IEC 60364-5-52 tipik değerleriyle kesit/paralel kablo önerisi, tek tıkla hatta uygula.
4. **Jeneratör:** yakıt özerkliği (saat), sıralı yük alma, motor kalkışında gerilim çökmesi, yük öncelik ve kalkış katı tablosu.

### 4.9 Yük atma ve yakıt (simülasyon)
Jeneratör nominal gücünün üzerinde yüklenirse yük, öncelik 5'ten 2'ye doğru atılır (öncelik 1 = kritik, atılmaz). "Simülasyonda yakıt tükenmesini de göster" açıksa
tank bitince jeneratör durur, yük kalan kaynaklara kalır (varsayılan kapalı; açık olunca her senaryo saatler sonra yakıt bitişiyle sona ererdi).

### 4.10 Ekipman kütüphanesi, katalog ve içe aktarma
- **Palet:** işlevlerine göre gruplu; tüm yük tipleri ortak alanlara sahip (kurulu kW, PF, DF, kategori, gerilim, ısı konumu, THD, öncelik, kalkış katı).
- **Katalog:** üretici-bağımsız **tipik** boyutlar (trafo 630–3150 kVA, jeneratör 500–2500 kVA, UPS, ACB/MCCB, chiller, CRAH, CRAC, fan wall, pompa, kule, rack, PDU, MDB); tıkla veya sürükle.
  Seçili ekipmanı **kendi kataloğunuza** kaydedebilirsiniz (tarayıcıda).
- **Liste içe aktar (Excel/CSV):** başlıklar Türkçe/İngilizce tanınır (Ad, Tip, kVA, kW, Soğutma kW, Gerilim, Grup, Adet, Besleyen, Öncelik ve tipin tüm alan adları);
  önizleme ve uyarılar; "Besleyen" sütunu hatları oluşturur; şablon CSV indirilebilir.

### 4.12 3D yerleşim görünümü
Ayrıntılı istek: [3D-MODEL-ISTEKLERI.md](3D-MODEL-ISTEKLERI.md); kararlar ve varsayımlar: PLAN.md madde 67–75.
- **Sekme:** "3D" (three.js, yalnız bu sekme açılınca yüklenir). Sürükle-bırak (palet ve katalog), taşı/döndür/sil, ızgara ve hizalama kılavuzları, çakışma uyarısı, servis boşluğu, arama (Ctrl+K), çoklu seçim, ölçüm, kayıtlı görünümler.
- **Tek veri modeli:** ekipman 2D ve 3D'de aynı düğümdür; konum `yerlesim3d` alanında saklanır; geri al/yinele ve JSON/IndexedDB kaydı kapsar; eski dosyalar otomatik yerleşimle açılır.
- **Analiz görselleştirme:** renk modları, ısı haritası (yaklaşık), hat kalınlığı/rengi/akış noktaları, üzerine gelince ad-kW-doluluk-Isc-yakıt, soğutma açığında zincir vurgusu.
- **Simülasyon 3D'de:** adım değiştikçe arıza, enerjisiz, atılan yük, çalışan jeneratör, batarya ve salon sıcaklığı güncellenir.
- **Kablo güzergâhı:** ortogonal otomatik güzergâh, sürüklenebilir ara noktalar, "uzunluk 3D'den" seçeneği (kayıp ve gerilim düşümü gerçek mesafeyle).
- **Çıktı:** 3D PNG ve PDF raporunda "3D yerleşim" bölümü.
- **Performans ve arayüz:** birleştirilmiş geometri ve toplu hatlarla çizim çağrısı ≈ 3,7× azaldı (HDC02: 611 → 163), memo'lu ekipman, ~30 kare/sn animasyon, kalite seçeneği, GPU tespiti ve "Yazılım render" uyarısı, gruplanmış araç çubuğu, lejant, kısayol kartı (PLAN 77–78).
- **Yürüme modu ve düzenleme (PLAN 79–81):** gizlenebilir paneller, birinci şahıs yürüme (WASD/oklar, çarpışma), seçim kutusu, hizala/eşit aralık, kopyala, kesicilerin panoyla taşınması.
- **Şalterler panoda, ayrıntılı modeller, simülasyon şeridi (PLAN 82–84):** şalterler ana ekipmanın ön yüzüne oturur ve onunla taşınır/döner; ayrıntılı ekipman modelleri; simülasyon şeridi sürüklenerek boyutlandırılır, ayrı sayfada açılabilir.
- **Kablo tavası ve boru hatları (PLAN 85–89):** tava çizimi, kabloların tavaya yönlendirilmesi (gerçek yol uzunluğu hesaplara girer), tava doluluğu, otomatik soğuk su/kondenser boruları (debi, DN, hız, Δp), pompa/chiller arızasında boru durumu, rapor bölümü.
- **Katlı bina, merdiven, daha ayrıntılı pano/şalter (PLAN 90–93):** zemin kat (gri) elektrik odası, 1. kat (beyaz, 4,5 m) veri salonu; jeneratör ve dış ekipman binanın dışındaki avluda; dış merdivenden yürüme modunda 1. kata çıkılır (kenardan düşülmez); Kat süzgeci (Tümü/Zemin/1. kat); katlar arası kablolar kat şaftından geçer; ACB/MCCB/ayırıcı/ölçü elemanları ve panolar çok daha ayrıntılı (ekran, ON/OFF, butonlar, kollar, kadranlar, kapı/menteşe/etiket), açık kesici modelde açık görünür.
- **3D'de senaryo:** Senaryo ve bakım paneli ile canlı simülasyon şeridi (PLAN 76).
- **Sınırlar:** mimari (duvar çarpışması, kapı/pencere), CFD, glTF yükleme yok; yalnız iki katlı otomatik bina ve türetilmiş tek dış merdiven var; ekipman boyutları tipik yer tutucudur.

### 4.11 Raporlama
Yazdırılabilir **PDF raporu** (özet, şema görüntüsü, kayıplar, doluluk, doğrulama, yedeklilik, enerji, simülasyon, güvenilirlik, elektrik çalışmaları + jeneratör).
**Excel**: Ekipman, Hatlar, Özet, Kayıplar, Simülasyon sayfaları. **PNG** şema görüntüsü. **JSON** proje dosyası.

---

## 5. Kod yapısı

| Yol | İçerik |
|---|---|
| `src/model` | Tipler, proje şeması (`schemaVersion` 7), ayarlar (`settings.ts`) |
| `src/library` | Ekipman kütüphanesi (`equipment.ts`), şablonlar, güvenilirlik verileri, **katalog** (`catalog.ts`) |
| `src/engine` | `analyze` (çekirdek), `networkStudies` (Isc, gerilim düşümü, soğutma, yakıt), `simulate`, `automation`, `energize`, `energy`, `climate`, `cooling*`, `redundancy`, `reliability*`, `protection`, `cableSizing`, `harmonics`, **`generator`**, `worker` |
| `src/layout3d` | 3D saf mantık (testli): boyutlar, geometri/çakışma, otomatik yerleşim, güzergâh/uzunluk, ısı haritası, renkler, şekiller |
| `src/ui3d` | 3D sahne (R3F): ekipman, kablolar, odalar/ısı haritası, sürükleme, kamera, etiket katmanı, 3D sekmesi |
| `src/import` | **`equipmentImport.ts`** (CSV/Excel ayrıştırma, tip/başlık eşleme, hat ve yerleşim üretimi) |
| `src/store` | Zustand durumu, geri al/yinele, IndexedDB kalıcılığı |
| `src/ui` | Canvas, Palette (katalog dahil), PropertiesPanel, sekme görünümleri, SimulationPanel, ImportDialog, Toolbar |
| `src/export` | Excel, PNG, yazdırılabilir rapor |
| `examples` / `scripts` | HDC02 PL1 örneği ve üretim betiği |

**Veri modeli:** şema v7; ayarlar `Project.ayarlar` içinde, eksik/bozuk alanlar varsayılana düşer; ekipman tipleri eklemelidir, eski dosyalar aynen açılır.

**Test:** 24 test dosyası, 374 test (motor, kütüphane, şablonlar, HDC02 örneği, rapor, Excel, içe aktarma, depo). Yeni tipler için testler her alanın varsayılanını ve anahtar benzersizliğini zorunlu kılar.

---

## 6. Faz G–M ayrıntıları ve varsayımlar

- **İklim / COP / free-cooling:** COP nominal sıcaklıktan itibaren %2,5/K (ayarlanabilir) değişir (çarpan 0,3–1,4); free-cooling payı alt/üst sıcaklık arasında doğrusal; free-cooling'de yalnız pompa/fan gücü harcanır.
  Varsayılan iklim ılıman kıyı tipik değerleridir — **lokasyonunuza göre değiştirin**.
- **WUE / CO₂:** WUE = kule suyu / IT kWh (1,8 L/kWh yer tutucu); CO₂ emisyon faktörü 0,45 kg/kWh **yer tutucu**.
- **Soğutma zinciri:** asıl görevli pompa/atım birimlerinin enerjili oranı chiller kapasitesini çarpar; basınç/debi eğrisi yok. Salon ısıl kütlesi: 1,2 kJ/m³K × hacim × kütle çarpanı.
- **Güvenilirlik:** bağımsız bileşenler, U = MTTR/(MTBF+MTTR), asgari kesit kümeleri (3. derece bileşen ≤ 40 ise), nadir olay yaklaşımı; jeneratör kalkış hatası %1,5. MTBF/MTTR **tipik varsayımdır**.
  Tier göstergesi yalnız hesaplanan erişilebilirliğin eşiklerle karşılaştırılmasıdır, sertifikasyon değildir.
- **Koruma:** ACB uzun/kısa gecikme + ani; MCCB ani. Seçicilik marjı 1,3× + 50 ms. Ark flaşı IEEE 1584-2002 basitleştirilmiş (455 mm, 32 mm); üretici eğrileri ve 1584-2018 ile doğrulanmalı.
- **Kablo:** XLPE Cu çok damarlı, tava; sıcaklık düzeltmesi √((90−T)/60); ΔU ve k=143 ısıl dayanım; en az paralel kablo önce. Busbar kapsam dışı.
- **Jeneratör yakıtı:** özgül tüketim eğrisi (%10→350 … %100→210 g/kWh), 840 g/L; tank dolu varsayılır; ikmal yok.
- **Yük atma / sıralı alma:** atma yalnız simülasyonda; sıralı alma `yukAlmaAraligi` (10 sn) arayla öncelik grupları; gerilim çökmesi ≈ S_kalkış/(S_kalkış + Σ Sn/Xd″). Ön tahmindir, ayrıntılı motor kalkış analizi değildir.
- **Katalog / içe aktarma:** katalog **gerçek üretici modeli değil**, tipik boyuttur; içe aktarılan hatlar varsayılan kablo (10 m, 630 A) olarak gelir, sonradan düzenlenmelidir.

---

## 7. Çözülen önemli hatalar

- Soğutma özetinde chiller + CRAH çift sayımı → rol bazlı zincir (üretim / hava / doğrudan).
- Yedeklilik taramasında soğutma birimlerinin kendi kaybı tekil arıza sayılıyordu → soğutma sistemi ayrıldı, %2 açık eşiği.
- Bataryadaki UPS'in aşağısındaki yükler ısı üretmiyordu (salon sıcaklığı sabit kalıyordu) → batarya UPS'i kaynak gibi ağırlıklandı.
- Kablo seçiminde 1×185 yerine 4×35 mm² seçiliyordu → önce en az paralel kablo.
- HDC02 catcher 500 MVA gerçek dışı Isc/ark enerjisi veriyordu → 30 MVA.
- Geri al/yinele, seçmeli giderme, arızayı gider sonrası kendiliğinden tekrar oynama ve ATS/panel tutma hataları düzeltildi.

---

## 8. Sınırlar (bilinçli olarak kapsam dışı)

Geçici rejim (dinamik) simülasyonu, ayrıntılı motor kalkış/dinamik analiz, yük akışı optimizasyonu, motor katkılı kısa devre, nötr/3. harmonik etkisi, basınç/debi hidroliği, yakıt ikmali, bakım/ömür modeli,
üretici katalog verisi ve standartlara tam uyum. Bu alanlarda sonuçlar yalnızca ön tasarım içindir.

## 9. Git geçmişi

Çalışma `claude/new-session-734v27` dalında, her faz ayrı commit olarak tutulur (`git log --oneline`). Pull request açılmamıştır.
