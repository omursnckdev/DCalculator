# DCalculator — 3D Model Özelliği (İstek Belgesi)

> **Durum: uygulandı** (3D-1…3D-5). Uygulamada alınan kararlar ve istek belgesinden sapmalar için bkz. [PLAN.md](PLAN.md) madde 67–75 ve [YAPILANLAR.md](YAPILANLAR.md) §4.12. Bu belge özgün istek olarak korunmuştur.

Bu belge Claude Code ile paylaşılmak üzere yazıldı. Mevcut uygulamanın ne yaptığı için bkz. [YAPILANLAR.md](YAPILANLAR.md) ve [PLAN.md](PLAN.md).
Kod yazmadan önce bu belgeyi ve o iki dosyayı oku; "Açık sorular" bölümündeki maddeleri varsayımla ilerleyip PLAN.md'ye ekle (projenin mevcut çalışma kuralı bu).

---

## 1. Ne isteniyor? (tek cümle)

Mevcut **güç zinciri / ısıl yük analiz aracının** içine, **HomeByMe tarzı sürükle-bırak bir 3D yerleşim görünümü** eklemek: ekipmanlar (trafo, jeneratör, UPS, panolar, chiller, CRAH, rack sıraları…)
3D ortamda yerleştirilir, hareket ettirilir, döndürülür; **şemadaki (tek hat) model ile 3D model aynı veriyi paylaşır**; analiz sonuçları (doluluk, ısı, arıza, simülasyon) 3D'de görünür.

### "Mimari değil" ne demek (kapsam sınırı)

Bu bir **mimari tasarım aracı değil**; ekipman yerleşimi ve mühendislik görselleştirmesidir.

| Kapsamda | Kapsam DIŞI |
|---|---|
| Ekipmanın 3D'de yerleştirilmesi, döndürülmesi, hizalanması | Duvar/kapı/pencere çizimi, kat planı, çatı, merdiven |
| Basit "oda" kutusu (zemin + yarı saydam duvar) — ekipmanın bağlamı için | İç mekân dekorasyonu, mobilya, malzeme/doku kütüphanesi, fotogerçekçi render |
| Ekipman boyutları (G × D × Y), servis/erişim boşluğu | İnşaat metrajı, mimari ölçülendirme, DWG/BIM tam desteği |
| Kablo/busbar güzergâhı ve gerçek uzunluğu | Yapısal hesap, HVAC kanal tasarımı |
| Sıcak/soğuk koridor görselleştirmesi, ısı haritası | CFD (akış simülasyonu) — ileride ayrı konu |

"HomeByMe gibi" ifadesi **kullanım deneyimi** içindir: katalogdan sürükle-bırak, tıkla-seç-döndür, 2D plan ↔ 3D geçişi, kolay kamera, anlaşılır görünüm. Görsel zenginlik hedef değildir.

---

## 2. Temel ilke: tek veri modeli

3D görünüm **ayrı bir model değildir**. Mevcut `ProjectNode`/`ProjectEdge` modeli kaynak olmaya devam eder; 3D yalnızca bu düğümlere **konum, boyut ve yön** ekler.

- Şemada (React Flow) bir ekipman eklenince 3D'de de belirir (varsayılan konuma); 3D'de eklenince şemada da belirir.
- Silme, yeniden adlandırma, parametre değiştirme her iki görünümde aynıdır; **geri al/yinele** (mevcut `history`) 3D hareketlerini de kapsar.
- Analiz motoru (`src/engine`) **değişmez**; 3D yalnızca sonuçları okur. Tek istisna: 3D'den gelen **gerçek hat uzunluğu** hattın `uzunluk` alanını besler (bkz. 5.3).
- Eski proje dosyaları 3D verisi olmadan açılmalı (otomatik yerleşim, bkz. 4.4).

---

## 3. Kullanıcı senaryoları

1. **Yerleşim kurma:** "Elektrik odası" ve "Veri salonu" oluştururum; soldaki katalogdan trafo, MDB, UPS dolapları, jeneratörü sürükleyip yerleştiririm. Ekipmanlar zemine oturur, birbirine/duvara hizalanır.
2. **Rack sıraları:** Veri salonunda rack sırasını (adet × kW) sürükleyip koridorlu yerleştiririm; sıcak/soğuk koridor yönünü belirlerim; CRAH'ları sıra uçlarına koyarım.
3. **Şemadan 3D'ye:** Önce tek hat şemasını çizerim (ya da Excel'den içe aktarırım); 3D görünüme geçince ekipmanlar otomatik, mantıklı bir düzende yerleşmiş olarak gelir; ben düzeltirim.
4. **Kablo güzergâhı:** İki ekipman arasındaki hat 3D'de kablo tavası/yol boyunca çizilir; **uzunluk otomatik hesaplanır** ve kayıp/gerilim düşümü hesabına yansır.
5. **Analiz görselleştirme:** Ekipmanlar doluluğuna göre renklenir (yeşil/sarı/kırmızı); veri salonu ısı haritası gösterilir; kablo kalınlığı/rengi akıma göre değişir.
6. **Canlı simülasyon 3D'de:** Arıza uygularım; ekipman kararır/kırmızı yanıp söner, enerji akışı kablolarda animasyonla görünür, jeneratör "çalışıyor" göstergesi, salon sıcaklığı yükselirken ısı haritası değişir. Mevcut simülasyon adımları (SimStep) 3D'yi sürer.
7. **Sunum:** Gezinme (orbit), ekipmana tıklayınca özellik paneli, kamera kayıtlı görünümler, PNG/PDF'e 3D görüntü ekleme.

---

## 4. Özellikler (öncelik sırasıyla)

### Faz 3D-1 — Temel 3D yerleşim (MVP)
- Yeni üst sekme: **"3D"** (mevcut sekmelerin yanında). 2D şema sekmesi aynen kalır.
- 3D sahne: zemin ızgarası (1 m, görünür), ışık, orbit kamera (döndür/yakınlaş/kaydır), "kuşbakışı (2D plan)" ve "perspektif" kamera geçişi.
- **Ekipman 3D gösterimi:** her ekipman tipi için basit **kutu tabanlı parametrik model** (boyutlar G × D × Y metre) + ikon/etiket. Gerçekçi model şart değil; tanınabilir olması yeter
  (trafo: kutu + radyatör şeritleri; jeneratör: konteyner; rack: ince uzun dolap sırası; chiller: büyük kutu + fan diskleri; CRAH: dolap; panolar: dikdörtgen dolap; UPS: dolap + batarya dolabı).
- **Sürükle-bırak:** soldaki palet/katalogdan sahneye sürükle (mevcut palet ve `catalog.ts` yeniden kullanılır); seçili ekipmanı zeminde sürükle, **R** ile 90° döndür (veya tutamaçla serbest döndür), **Delete** ile sil.
- **Seçim:** tıkla = seç (özellik paneli mevcut `PropertiesPanel` ile aynı), çoklu seçim, Ctrl+K arama sonucuna "3D'de göster" (kamera odaklanır).
- **Yerleşim yardımcıları:** ızgaraya yapışma (varsayılan 0,1 m, ayarlanabilir), ekipman-ekipman ve ekipman-duvar hizalama çizgileri, **çakışma uyarısı** (iki ekipman aynı hacimde → kırmızı), servis boşluğu gösterimi (ön 1,0 m arka 0,6 m varsayılan; tipe göre ayarlı).
- **Oda tanımı (minimum):** dikdörtgen "oda" nesnesi: ad, genişlik × derinlik × yükseklik, tür (Elektrik odası / Veri salonu / Jeneratör alanı / Dış alan). Ekipman bir odaya aittir (`isiKonum` ile uyumlu: salon / elektrik / dış).
  Oda duvarları yarı saydam; "duvarları gizle" düğmesi. **L şekilli, çok katlı, kapı-pencere yok** (mimari değil).
- Ayrıntı düzeyi: tek ekran, 60 fps hedefi 500 ekipmanda (bkz. 7. performans).

### Faz 3D-2 — Analizle bütünleşme
- **Renk modu** seçici: Tür rengi (varsayılan) / Doluluk (yeşil-sarı-kırmızı) / Isı yükü (kW) / Enerjili-enerjisiz (arıza durumu) / Grup.
- **Veri salonu ısı haritası:** zemin üzerinde, rack ve soğutma birimlerinin ısı/soğutma kapasitesine dayalı **basit** yoğunluk haritası (CFD değil; yakınlık ağırlıklı ısı yoğunluğu ve soğutma kapsama alanı). Etiketi açıkça "yaklaşık görselleştirme" olmalı.
- **Hat görselleştirme:** her `ProjectEdge` 3D'de kablo/busbar çizgisi (tava yüksekliğinde güzergâh); kalınlık veya renk = akım/kapasite doluluğu; **enerji akışı animasyonu** (mevcut `flowAnim` tercihiyle aynı).
- **Etiket/baloncuk:** ekipman üzerine gelince: ad, kW/kVA, doluluk %, Isc, varsa jeneratör yakıt özerkliği (mevcut analiz sonuçlarından).
- **Soğutma görselleştirme:** chiller → pompa → CRAH zinciri; soğutma kaybında etkilenen CRAH'lar vurgulanır (mevcut `cooling` zinciri verisi).

### Faz 3D-3 — Canlı simülasyon 3D'de
- Mevcut `SimulationPanel` ve `SimStep` akışı 3D sahneyi de sürer: arızalı ekipman kırmızı, enerjisiz ekipman gri/koyu, yük atılan ekipman turuncu, çalışan jeneratör yeşil yanıp sönen gösterge, bataryadaki UPS sarı.
- Salon sıcaklığı (`RoomInfo.tempC`) ısı haritasının renk ölçeğini ve oda üzerinde sıcaklık göstergesini sürer; sınır aşılınca oda kenarı kırmızıya döner.
- Zaman çubuğu ve adım listesi mevcut paneldekiyle aynı (tek kaynak: `store.sim`); 3D yalnızca görselleştirir.

### Faz 3D-4 — Kablo güzergâhı ve gerçek uzunluk
- Hat için **güzergâh noktaları** (kablo tavası yolu): iki ekipman arası otomatik "ortogonal" (Manhattan, tava yüksekliği üzerinden) güzergâh önerisi; kullanıcı ara noktaları sürükleyerek değiştirebilir.
- **Gerçek uzunluk** = güzergâh segmentleri toplamı (+ ekipman girişi için pay, varsayılan %5 veya +2 m). "Hat uzunluğunu 3D'den al" düğmesi/seçeneği: işaretliyse `ProjectEdge.uzunluk` otomatik güncellenir; kullanıcı elle girdiyse elle değer korunur (kaynak göstergesi: "elle / 3D").
- Böylece mevcut kayıp (I²R), gerilim düşümü, kablo seçimi, ark flaşı hesapları **gerçek mesafeyle** çalışır.
- Kablo tavası doluluğu/kesit gösterimi **kapsam dışı** (ileride).

### Faz 3D-5 — Düzenleme konforu ve çıktı
- Kayıtlı kamera görünümleri (ad ver, kaydet, geri çağır).
- Ölçüm aracı: iki nokta arası mesafe.
- Otomatik yerleşim: "Şemadan düzenle" (katman = elektrik zincir seviyesi: kaynak → trafo → MDB → UPS → dağıtım → yük; yük ekipmanı odasına göre).
- **3D görüntüyü PNG olarak dışa aktar**; PDF raporuna "3D yerleşim" bölümü olarak ekle (mevcut `report.ts` ve `renderDiagramPng` yaklaşımı).
- Klavye kısayolları: G (taşı), R (döndür), F (seçime odaklan), 1/2/3 (kamera ön-yan-üst), H (duvarları gizle), Ctrl+Z/Y mevcut geri al.
- Dokunmatik/Trackpad desteği (iki parmak orbit/zoom).

---

## 5. Veri modeli değişiklikleri

Mevcut şema **v7**. Değişiklik **eklemeli** olmalı; mümkünse şema sürümü artırılmadan, değilse v8 + `migrate` (eski dosyalar bozulmadan açılır, PLAN.md kuralı).

### 5.1 Düğüme eklenecekler (`ProjectNode`)
```
konum3d?: { x: number; y: number; z: number }   // metre; z = zemin üstü yükseklik (çoğunlukla 0)
donus3d?: number                                  // derece (Y ekseni etrafında, 0/90/180/270 yaygın)
oda?: string                                      // oda kimliği (isteğe bağlı)
boyut3d?: { g: number; d: number; y: number }     // metre; yoksa tür varsayılanı (equipment.ts)
```
- Tür varsayılan boyutları `equipment.ts` içinde (G × D × Y m, tipik): örn. trafo 2500 kVA 2,2×1,6×2,2; jeneratör 2000 kVA 6,0×2,4×2,6; UPS dolabı 0,8×0,9×2,0; MDB 4,0×0,8×2,2; rack 0,6×1,2×2,2 (sıra için N×); chiller 6,0×2,4×2,6; CRAH 0,9×0,9×2,0.
  **Bunlar tipik yer tutucu değerlerdir; model/üretici verisi değildir** (katalog ve kullanıcı değiştirebilir).
- `boyut3d` katalog kayıtlarına ve kullanıcı kataloğuna da yazılabilmeli.

### 5.2 Proje düzeyi
```
odalar3d?: { id: string; ad: string; tur: 'elektrik'|'salon'|'jenerator'|'dis'; x:number; z:number; g:number; d:number; y:number }[]
gorunumler3d?: { ad: string; kamera: {...} }[]
```
Ayarlar (ızgara, renk modu vb.) kişisel tercihtir; projeye yazılmaz (mevcut `nodeView` gibi `localStorage`).

### 5.3 Hat (`ProjectEdge`)
```
guzergah3d?: { x:number; y:number; z:number }[]   // ara noktalar (metre)
uzunlukKaynak?: 'elle' | '3d'                      // varsayılan 'elle' (mevcut davranış)
```

### 5.4 Uyumluluk
- Alanlar yoksa: ekipman otomatik yerleşir (4.4), hatlar doğrudan çizgi, `uzunluk` aynen kalır.
- JSON dışa/içe aktarma, IndexedDB, şablonlar, HDC02 örneği, Excel/CSV içe aktarma (yeni düğümler 3D'de otomatik yerleşir) bu alanları taşımalı/yok saymalı. Mevcut **339 testin tümü** geçmeye devam etmeli.

### 5.5 Otomatik yerleşim algoritması (varsayılan)
- Düğümler derinliğine göre sıralara (kaynak → yük), oda türüne göre gruplanır; ızgara aralığı ekipman boyutu + servis boşluğu.
- Aynı grup (`grup` alanı) yan yana. İçe aktarmadaki mevcut kademelendirme mantığı (`buildImport`) yeniden kullanılabilir.

---

## 6. Teknik yaklaşım (öneri)

- **Kütüphane:** `three` + `@react-three/fiber` + `@react-three/drei` (orbit kontrolü, transform kontrolü, etiketler). Sürümler en az iki haftalık/kararlı olmalı, `package.json`'da sabitlenmeli.
- **Yeni klasör:** `src/ui3d/` (Scene, EquipmentMesh, RoomMesh, CableLine, HeatMap, Gizmo, Palette3D, `use3dStore`); motor ve mevcut store'a bağımlılık tek yönlü: 3D → store/engine.
- **Durum:** konum/boyut/yön **ana Zustand store'a** (mevcut düğümler üzerinden) yazılır; kamera/seçim görünümü gibi geçici durumlar ayrı store'da. Geri al/yinele mevcut `attachHistory` ile uyumlu (sürükleme 600 ms birleştirme kuralı aynen).
- **Mesh üretimi:** tip → parametrik geometri fonksiyonu (küçük ve test edilebilir); tüm geometri kod ile üretilir, **dış 3D model dosyası (glTF) bağımlılığı olmadan** başla. İleride kullanıcı glTF yükleyebilir (Faz sonrası).
- **Performans:** aynı tipte çok sayıda ekipmanda `InstancedMesh`, düşük poligon, etiketlerin mesafeye göre gizlenmesi, `frameloop="demand"` (sadece değişimde çiz), simülasyon animasyonu açıkken sürekli.
- **Lazy yükleme:** 3D paketi `import()` ile yalnız "3D" sekmesi açılınca yüklenir (mevcut ExcelJS lazy yaklaşımı gibi; ana paket büyümesin).
- **Erişilebilirlik/yedek:** WebGL yoksa anlaşılır hata mesajı + 2D şemaya yönlendirme. 3D'siz tüm uygulama çalışmaya devam eder.
- **Test:** saf fonksiyonlar vitest ile (boyut/yerleşim, çakışma, hizalama, güzergâh uzunluğu, otomatik yerleşim, şema ↔ 3D senkron); görsel kısım için Playwright duman testi (sahne açılır, ekipman eklenir, konum JSON'a yazılır). Mevcut testler bozulmamalı.

---

## 7. Kabul ölçütleri (bitti sayılması için)

1. "3D" sekmesi açılır; şablon veya HDC02 örneği yüklüyken **tüm ekipmanlar** ve hatlar hatasız çizilir (HDC02: 122 ekipman, kabul edilebilir kare hızı).
2. Paletten/katalogdan sürükle-bırak ile ekipman eklenir; 2D şemada da görünür. 2D'de eklenen 3D'de görünür.
3. Taşıma, döndürme, silme, çakışma uyarısı ve ızgaraya yapışma çalışır; **geri al/yinele** bunları kapsar.
4. Konumlar JSON'a kaydedilir ve yeniden açılınca korunur; **3D alanı olmayan eski dosyalar** otomatik yerleşimle açılır; mevcut tüm testler geçer.
5. Renk modları (doluluk, ısı, enerjili/arızalı) analiz sonuçlarıyla birebir tutarlıdır (aynı eşikler, aynı renkler 2D'dekiyle).
6. Simülasyonda adım değiştikçe 3D durumu (arıza, enerjisiz, jeneratör çalışıyor, batarya, yük atma, salon sıcaklığı) güncellenir.
7. "Hat uzunluğunu 3D'den al" açılınca kayıp ve gerilim düşümü değeri uzunluk değişimiyle değişir (test: uzunluk ikiye katlanınca hat kaybı ikiye katlanır).
8. 3D görüntü PNG ve PDF raporuna eklenebilir.
9. Tüm metinler Türkçe (`src/i18n/tr.ts`), yeni tipler/alanlar `equipment.ts` testleriyle (varsayılan alanlar, benzersiz anahtarlar) uyumlu.

---

## 8. Bilinçli olarak YAPILMAYACAKLAR (şimdilik)

Mimari çizim (duvar/kapı/pencere/kat/çatı), iç mekân malzeme-doku-mobilya, fotogerçekçi render/gölge kalitesi hedefi, CFD akış simülasyonu, kablo tavası dolulukları,
BIM/IFC/DWG içe aktarma, çok kullanıcılı eşzamanlı düzenleme, VR/AR, kullanıcı glTF modeli yükleme (sonraki aşama), yapısal/yangın/HVAC kanal hesapları.

---

## 9. Açık sorular (Claude Code varsayımla ilerleyip PLAN.md'ye eklesin; kullanıcı sonra onaylar)

1. **Birim ve ölçek:** metre; ızgara 0,1 m. (Onay?)
2. **Rack sırası tek ekipman mı, çok mu?** Öneri: "rack sırası" tek düğüm (N rack, toplam kW) olarak gösterilir, 3D'de N adet dolap çizilir; tek rack tek düğüm yapılması 500+ düğüme çıkarır.
3. **Oda zorunlu mu?** Öneri: değil; odasız ekipman "genel zemin"de durur, oda sonradan çizilir. Oda türü ısı konumuyla (`isiKonum`) eşleşir.
4. **Isı haritası doğruluğu:** yalnız basit yakınlık modeli (CFD yok); kullanıcıya "yaklaşık" uyarısı.
5. **Kablo güzergâhı otomatik mi, elle mi?** Öneri: otomatik ortogonal öneri + elle düzeltme.
6. **Bir ekipmanın çok sayıda 3D örneği (örn. 4 aynı CRAH):** Excel içe aktarmadaki "Adet" gibi ayrı düğümler (mevcut davranış) olarak kalsın.
7. **Katalog boyutları** gerçek üretici verisi olmadığı için "tipik" etiketiyle gelir (mevcut katalog politikası).

---

## 10. Önerilen uygulama sırası (Claude Code için)

1. Bu belgeyi, `YAPILANLAR.md`, `PLAN.md` ve `src/model/types.ts`, `src/library/equipment.ts`, `src/store/useStore.ts` dosyalarını oku; kısa bir plan yaz, açık sorulardaki varsayımları PLAN.md'ye (madde 67'den) ekle.
2. **Faz 3D-1** (MVP) → testler → commit. Sonra sırayla 3D-2, 3D-3, 3D-4, 3D-5; her faz ayrı commit, her fazdan sonra tarayıcıda (Playwright) doğrulama.
3. README ve `YAPILANLAR.md` dosyalarını güncelle; kapsam sınırlarını ("mimari değil", CFD yok) açıkça yaz.
4. Pull request açma; mevcut kural: yalnızca belirlenen dala commit/push.
