# Veri Merkezi Güç Zinciri ve Isıl Yük Analiz Uygulaması: Proje Planı

> Bu doküman Claude Code'a başlangıç belgesi olarak verilmek üzere hazırlanmıştır. Alınan kararlar, kapsam, mimari, hesap yöntemleri ve fazlara bölünmüş yol haritası burada toplanmıştır. Açık kalan konular "Açık Sorular" bölümündedir.

---

## 1. Amaç

Sürükle-bırak bir yüzeyde veri merkezi güç zincirini (trafo, jeneratör, ana dağıtım panosu, UPS, UPS dağıtım panosu ve diğer ekipmanlar) kurabilen, ekipmanlar arasına busbar veya kablo hatları çizebilen, ekipman güç değerlerinden **peak load** ve **ısıl yük** analizleri üreten, kullanımı kolay bir araç.

Hedef, ETAP / SKM / EasyPower gibi araçların yerine geçmek değil; **veri merkezi güç zinciri için hızlı ve hafif bir ön tasarım / kapasite kontrol aracı** olmaktır.

## 2. Kullanıcılar ve Çalışma Modeli

- İlk kullanıcılar: proje sahibi ve şefi. İleride başka kullanıcılar da olabilir.
- **Tarayıcıda çalışan, sunucusuz web uygulaması.** Giriş sistemi, veritabanı, hosting ilk kapsamda yok.
- Uygulama geliştirme sırasında kendi bilgisayarda çalıştırılır.
- Projeler tarayıcıda (IndexedDB) saklanır ve **JSON dosyası olarak** kaydedilir / yüklenir. Paylaşım, JSON dosyasının gönderilmesiyle yapılır.
- Geliştirme aracı: **Claude Code**.
- Windows (.exe) paketi ve çevrimdışı (PWA) kullanım şu an kapsam dışı; ihtiyaç doğarsa sonradan eklenir (bkz. Faz 6).

## 3. Kapsam

### Dahil (Faz 1-3)
- Güç zinciri şeması çizimi (graf tabanlı)
- UPS çıkışı bazında yük girişi
- IT yükü ve mekanik yükün **ayrı** ele alınması, **toplamın da** gösterilmesi
- Connected load, talep faktörü ile peak load, kVA ve akım hesabı
- Kapasite doluluğu (trafo, jeneratör, UPS, pano, hat)
- Kayıplar ve ısıl yük, soğutma ihtiyacı (kW ve TR), yaklaşık PUE
- Excel çıktısı (ekipman tablosu ve hesap özeti), şema PNG çıktısı

### Sonraki fazlara bırakılanlar
- Eşzamanlılık (diversity) faktörü ve yük yüzdesine göre değişen verim eğrileri: **Faz 3**
- Arıza senaryoları (N-1, anahtar durumları, ATS/STS, bara kuplajı): **Faz 4**
- PDF rapor, şablon topolojiler, undo/redo, gruplama: **Faz 5**
- Kablo boyutlandırma (grup düzeltme faktörleri vb.), kısa devre, çoklu kullanıcı, kat planı: **Faz 6+ / opsiyonel**

### Kapsam dışı (bilinçli)
- Kısa devre, koruma koordinasyonu, ark flaş, harmonik analizi (ETAP/SKM alanı)
- Gerçek zamanlı izleme / DCIM işlevleri

## 4. Teknoloji Yığını (öneri)

| Alan | Seçim | Not |
|---|---|---|
| Dil / çatı | TypeScript + React + Vite | |
| Canvas / diyagram | React Flow (xyflow) | Sürükle-bırak, bağlantı, zoom, minimap hazır |
| Durum yönetimi | Zustand | |
| Yerel depolama | IndexedDB (ör. `idb`) + JSON dışa/içe aktarma | |
| Excel çıktısı | SheetJS veya ExcelJS | |
| PNG çıktısı | `html-to-image` veya React Flow'un kendi export yöntemi | |
| Test | Vitest | Hesap motoru için zorunlu |
| Stil | Tailwind CSS (veya benzeri) | |

**Temel mimari ilke:** Hesap motoru arayüzden tamamen ayrı, saf TypeScript modülü olarak yazılır (`/engine`). React'a bağımlılığı olmaz, birim testlerle doğrulanır. Arayüz sonradan değişebilir, hesap motorunun doğruluğu projenin asıl değeridir.

Önerilen klasör yapısı:

```
/src
  /engine        → hesap motoru (saf TS, testli)
  /model         → tip tanımları, JSON şeması, sürümleme
  /library       → ekipman kütüphanesi (varsayılan değerler)
  /ui            → canvas, özellik paneli, tablo görünümü
  /export        → Excel ve PNG üretimi
  /store         → Zustand durumu
```

## 5. Veri Modeli

Şema bir **graf**tır: ekipmanlar düğüm (node), busbar ve kablo hatları kenar (edge).

**Düğüm (ekipman) ortak alanları:** `id`, `tip`, `ad`, `etiket`, `grup`, `konum (x,y)`, `notlar`

**Ekipman tipleri (başlangıç paleti):**
- Kaynaklar: Şebeke girişi, Trafo, Jeneratör
- Dağıtım: Ana dağıtım panosu (AG/MDB), Dağıtım panosu, Bara (busbar)
- UPS ve çıkış tarafı: UPS, UPS dağıtım panosu, PDU
- Yükler: **IT yükü** (UPS çıkışına bağlı), **Mekanik yük** (chiller, pompa, CRAH/CRAC, fan vb.), Aydınlatma / yardımcı yükler, Genel yük

**Kenar (hat) alanları:** `kaynak`, `hedef`, `tip` (kablo / busbar), `uzunluk`, `akım kapasitesi (A)`, `R ve X (Ω/km)`, `gerilim`

**Önemli tasarım notları:**
- İlk sürümde topoloji **radyal (ağaç)** kabul edilir. Çift beslemeli (2N) yapılar için normal çalışmada yükün iki yola yüzdeyle bölüştürülmesi (ör. %50/%50) yaklaşımı kullanılır; gerçek ring/mesh ve anahtar durumları Faz 4'tedir.
- JSON dosyasında `schemaVersion` alanı bulunur; ileride şema değişirse eski dosyalar dönüştürülebilir.
- Birimler SI esaslıdır (kW, kVA, A, V, m). Isıl yük kW ve TR olarak gösterilir (1 TR ≈ 3,517 kW).

## 6. Hesap Yöntemleri

### 6.1 Yük girişi (UPS çıkışı bazında)
Her yük kalemi için kullanıcı girer:
- **Kurulu güç** (kW)
- **Güç faktörü** (PF)
- **Talep faktörü** (DF)
- **Kategori:** IT veya Mekanik

Hesaplanır:
- `Peak kW = Kurulu kW × DF`
- `kVA = Peak kW / PF`
- `Akım (3 faz) = kVA × 1000 / (√3 × V)`

Yükler şemada yukarı doğru (yükten kaynağa) toplanır. Her düğümde **IT toplamı, mekanik toplamı ve genel toplam** ayrı ayrı gösterilir.

### 6.2 Kapasite doluluğu
Her düğüm için `Doluluk % = Hesaplanan yük / Nominal kapasite`. Renk eşikleri (kullanıcı değiştirebilir, varsayılan):
- Yeşil: < %80
- Sarı: %80-100
- Kırmızı: > %100

### 6.3 Kayıplar (Faz 2-3)
- **UPS:** Faz 2'de sabit verim (kullanıcı girer, kütüphane varsayılanı gelir). **Faz 3'te yük yüzdesine göre verim eğrisi.** `Kayıp = Giriş gücü − Çıkış gücü`
- **Trafo:** Boşta kayıp (sabit) + yük kaybı (yük oranının karesiyle ölçeklenir): `P_kayıp = P_boşta + P_yük,nominal × (S/S_n)²`
- **Kablo / busbar:** `I²R` kaybı (hat verisi girilmişse)
- Kayıplar yukarı doğru toplam çekilen güce eklenir (ör. UPS giriş gücü = çıkış gücü + UPS kaybı).

### 6.4 Isıl yük (Faz 3)
- Her ekipman ve kayıp kaleminde **"ısıyı nereye bırakır"** alanı bulunur: *Veri salonu / Elektrik odası / Dış ortam*. Böylece ısıl yük, soğutma ihtiyacının hesaplandığı mekâna göre ayrıştırılabilir.
  - Örnek: IT yükü ve CRAH fan gücü veri salonu ısısıdır; UPS ve trafo kayıpları kendi odasının ısısıdır; chiller'in elektrik gücü ise ısıyı dış ortama atar (salon ısı yükü değildir).
- Çıktı: mekân bazında ısıl yük (kW ve TR), toplam soğutma ihtiyacı özeti.
- **PUE (yaklaşık)** = Toplam tesis gücü / IT gücü

### 6.5 Eşzamanlılık faktörü (Faz 3)
Grup veya pano seviyesinde diversity faktörü eklenir; peak load hesabına katılır. Faz 1-2'de yoktur.

### 6.6 Arıza senaryoları (Faz 4)
Anahtar/kesici durumları (açık/kapalı), ATS/STS, bara kuplajı modele eklenir. "Bir trafo / UPS devre dışı kalırsa kalan hat yüzde kaç yüklenir?" sorusu cevaplanır; senaryolar kaydedilir ve karşılaştırılır.

### 6.7 Şeffaflık ilkesi
Her hesap sonucunun yanında "nasıl hesaplandı" bilgisi (formül ve kullanılan girdiler) görülebilmelidir.

## 7. Kullanım Kolaylığı İlkeleri

1. **Canlı sonuç:** Bir değer değiştiği anda toplamlar ve doluluk renkleri güncellenir. "Hesapla" butonu yoktur.
2. **Tablo görünümü:** Canvas'ın yanında tüm ekipmanları satır satır gösteren, toplu düzenlenebilen tablo (fill-down desteğiyle). Çok sayıda yükü tek tek canvas'ta girmek zorunda kalınmaz.
3. **Gerçekçi varsayılanlar:** Ekipman kütüphanesinde tipik değerler hazır gelir; kullanıcı yalnızca farklı olanı değiştirir.
4. **Canlı doğrulama:** Bağlantısız ekipman, kaynağı olmayan düğüm, döngü, aşırı yüklenmiş ekipman/hat, gerilim uyumsuzluğu anında işaretlenir.
5. **Standart semboller:** IEC tek hat sembolleri; ortogonal hat yönlendirme; grid'e yapışma.
6. **Gruplama:** Salon / hat bazında katlanabilir gruplar (Faz 5).
7. **Hazır şablonlar:** "2N UPS bloğu" gibi bloklar tek hamlede yerleştirilebilir ve kopyalanabilir (Faz 5).
8. **Klavye kısayolları, kopyala-yapıştır, undo/redo** (undo/redo Faz 5; mimari baştan buna uygun kurulur).
9. **Net sorumluluk uyarısı:** Sonuçlar ön tasarım tahminidir, nihai mühendislik çalışmasının yerini tutmaz. Bu uyarı uygulamada ve Excel çıktısında yer alır.

## 8. Çıktılar

**İlk sürüm (Faz 2-3'te tamamlanır):**
- **Excel:** Ekipman tablosu (girdiler) ve hesap özeti (IT / mekanik / toplam yük, doluluklar, kayıplar, ısıl yük).
- **PNG:** Şemanın görüntüsü.
- **JSON:** Proje dosyası (kaydet / yükle).

**Sonra:** PDF rapor (Faz 5).

## 9. Yol Haritası

### Faz 1: İskelet
- Vite + React + TS proje kurulumu, klasör yapısı, test altyapısı
- Canvas, ekipman paleti, düğüm ekleme/taşıma/silme
- Hat (kablo/busbar) çizimi ve bağlama
- Özellik paneli (seçili ekipmanın değerlerini düzenleme)
- Kaydet / yükle (IndexedDB ve JSON)
- **Çıkış kriteri:** Tipik bir güç zinciri çizilip kaydedilebiliyor ve geri yüklenebiliyor.

### Faz 2: Yük analizi
- UPS çıkışı bazında yük girişi (kW, PF, DF, kategori)
- Yükten kaynağa toplama (IT / mekanik / toplam)
- kVA, akım, kapasite doluluğu ve renk göstergeleri
- Hat akım kapasitesi ve gerilim düşümü (basit)
- Sabit verimli UPS modeli
- Canlı doğrulama, tablo görünümü
- Hesap motoru birim testleri
- **Çıkış kriteri:** Elle hesaplanmış bir örnek topolojinin sonuçları uygulamayla eşleşiyor.

### Faz 3: Isıl analiz ve gelişmiş yük modeli
- Trafo ve kablo kayıpları, UPS verim eğrisi (yük yüzdesine göre)
- "Isıyı nereye bırakır" alanı, mekân bazında ısıl yük, kW / TR
- Yaklaşık PUE
- Eşzamanlılık (diversity) faktörü
- Excel ve PNG çıktısı
- **Çıkış kriteri:** Toplam ısıl yük ve PUE, örnek bir tesis için elle hesapla uyumlu.

### Faz 4: Arıza senaryoları
- Anahtar/kesici durumları, ATS/STS, bara kuplajı
- N-1 analizi, kalan hat doluluğu
- Senaryo kaydetme ve karşılaştırma

### Faz 5: Çıktı ve konfor
- PDF rapor, şablon topolojiler, gruplama
- Undo/redo, kopyala-yapıştır
- Gelişmiş toplu düzenleme

### Faz 6+ (opsiyonel)
- Kablo boyutlandırma (grup düzeltme faktörleri vb.)
- Windows paketi (Tauri) ve/veya çevrimdışı PWA
- Çoklu kullanıcı / paylaşım (sunucu gerektirir)
- Kat planı yerleşimi

## 10. Benzer Araçlardan Alınacak Dersler

- **Sunbird dcTrack:** Diyagram üzerinde kapasite ve bütçelenen/gerçekleşen değer gösterimi.
- **OpenDSS Designer (açık kaynak):** Canlı doğrulama ve altta düzenlenebilir tablo görünümü; kullanım kolaylığı için referans alınabilir.
- **ETAP / SKM / EasyPower:** Hazır ekipman kütüphanesi.
- **Kaçınılacak:** Kısa devre, koordinasyon ve ark flaş alanına girmemek; kapsamı steady-state yük ve ısıl analizle sınırlı tutmak.

## 11. Açık Sorular

1. **Arayüz dili:** Türkçe mi, ileride çoklu dil (i18n) mi? (Öneri: Türkçe ile başla, metinleri baştan ayrı dosyada tut.)
2. **Çift beslemeli (2N) yapıların Faz 1-3'teki normal çalışma modeli:** Yükün iki yola %50/%50 bölünmesi yeterli mi?
3. **Ekipman kütüphanesi:** Varsayılan değerler (trafo kVA/uk/kayıplar, UPS verimleri vb.) proje bazlı gerçek ekipman verileriyle mi doldurulacak, genel tipik değerlerle mi?
4. **Şirket IT politikası:** Uygulama ileride şirket içinde bir yerde yayınlanacaksa buna uygun karar verilecek (şu an gerekmiyor, sadece yerelde çalışıyor).
5. **Varsayılan gerilim seviyeleri ve frekans:** (ör. 34,5 kV / 380-400 V, 50 Hz) kütüphanede nasıl tanımlanacak?
   - *Faz 1 geçici kararı:* 34,5 kV / 400 V, 50 Hz tipik değerleri `src/library/equipment.ts` içinde varsayılan; kullanıcı her ekipmanda değiştirebilir. Onay/düzeltme bekliyor.
6. **Yük kategorisi (Faz 1'de eklendi):** Plan yalnızca IT / Mekanik kategorilerini tanımlıyor. Aydınlatma / yardımcı yükler ve genel yük şu an varsayılan olarak **Mekanik** sayılıyor (kullanıcı IT'ye çevirebilir). Üçüncü bir "Diğer" kategorisi gerekir mi?
7. **Hat yönü (Faz 1'de eklendi):** Hatlar kaynaktan yüke doğru yönlüdür (ekipmanın altı = çıkış, üstü = giriş); yükler yalnızca beslenebilir, şebeke/jeneratör yalnızca besleyebilir. Çift yönlü beslemeli yapılar (ör. jeneratörün ATS üzerinden MDB'ye girmesi) Faz 4 öncesinde nasıl çizilecek?
8. **Gerilim düşümü sınırı (Faz 2):** Hat başına uyarı eşiği varsayılan **%3** (`src/engine/thresholds.ts`). Doluluk eşikleri plandaki gibi %80 / %100. Sınır değerler doğru mu, kullanıcı arayüzünden ayarlanabilir olsun mu?
9. **UPS giriş güç faktörü (Faz 2):** UPS giriş tarafı reaktif gücü için varsayılan PF **0,99** (UPS alanı `girisPf`). Çıkış tarafı yüklerin PF'sinden bağımsızdır. Gerçek UPS verisi (giriş PF, THDi) var mı?
10. **Çift besleme modeli (Soru 2'nin Faz 2 uygulaması):** Bir ekipmanı besleyen hatlar yükü varsayılan olarak **eşit paylaşır** (2N için %50/%50). Hatta açık "yük payı" (%) girilebilir; jeneratör gibi yedek beslemeler için **0** girilir. Açık payların toplamı %100 değilse uyarı çıkar. Şema `schemaVersion: 2` oldu (`pay` alanı; v1 dosyalar otomatik dönüştürülür).
11. **Toplama yöntemi (Faz 2):** Yükler yukarı doğru **P ve Q ayrı ayrı toplanarak** birleştirilir (kVA = √(P²+Q²)); kVA'ların aritmetik toplamı kullanılmaz (o, farklı PF'lerde fazla muhafazakârdır). Muhafazakâr toplam tercih edilir mi?
12. **Faz 2 kayıp kapsamı:** ~~Yalnızca UPS kaybı~~ — Faz 3'te trafo (boşta + yük²), kablo/busbar (I²R) kayıpları ve UPS verim eğrisi eklendi (bkz. 14-15, 19).
13. **Çıkış kriteri için örnek:** Faz 2 çıkış kriteri "elle hesaplanmış örnek topoloji"dir. Şimdilik kendi hazırladığım örnek (`src/engine/analyze.test.ts`, üst yorumda adım adım) testte doğrulanıyor. Gerçek bir projenizden elle hesaplanmış bir örnek verirseniz teste eklenecek.
14. **UPS verim eğrisi (Faz 3):** Eğri %25 / %50 / %75 / %100 yük noktalarından doğrusal enterpolasyonla okunur; %25'in altında ilk, %100'ün üstünde son nokta sabit tutulur (gerçekte düşük yükte verim daha da düşer). Varsayılan noktalar genel tipik değerlerdir (94,5 / 96 / 96,5 / 96,3); yeni UPS **sabit verim** modunda başlar, eğri modu kullanıcı seçer. Üreticinin %10 noktası da gerekir mi?
15. **Trafo kaybı (Faz 3):** P kaybı = boşta + yük kaybı × (S/Sn)², S trafo **çıkış** kVA'sıdır. Reaktif kayıp = uk × Sn × (S/Sn)² (mıknatıslanma akımı ihmal). Yükle değişen verimi bu basit model yeterince yansıtıyor mu?
16. **Isı konumu varsayılanları (Faz 3):** IT yükü, aydınlatma ve genel yük → *Veri salonu*; mekanik yük → *Dış ortam*; UPS, trafo ve hat kayıpları → *Elektrik odası*. Mekanik yük tek tip olduğundan CRAH/CRAC fan gücünü **elle "Veri salonu" yapmak** gerekir. Mekanik yük için "ısının yüzde kaçı salona" gibi oransal bir alan ister misiniz?
17. **Diversity (Faz 3):** Yalnızca **pano/bara/PDU seviyesinde** (düğüm alanı "Eşzamanlılık faktörü", 0-1) uygulanır; planın "grup seviyesi" kısmı (aynı `grup` etiketli ekipmanlara ortak faktör) henüz yok. Hat akımı ve doluluğu hedefin kendi pikiyle hesaplanır, diversity yalnızca pano çıkış toplamına uygulanır. Grup bazlı faktör gerekli mi?
18. **PUE tanımı (Faz 3):** Peak yük üzerinden = (kaynaklardan çekilen toplam güç) / (IT kategorisindeki yükler). Yıllık ortalama PUE değildir. IT dışı tüm yükler (aydınlatma, genel yük dahil) paydaya girmez, paya girer.
19. **Hat kaybı (Faz 3):** 3·I²·R·L; I hedef (yük) tarafının akımıdır, tek iterasyonla hesaplanır (kaybın kendi akıma etkisi ihmal). Kayıp, hattın yukarı yönündeki düğümün talebine eklenir.

## 12. Claude Code için Çalışma İlkeleri

- Önce Faz 1'i bitir, sonra sıradaki faza geç; her fazın sonunda çalışan bir sürüm olsun.
- Hesap motoru (`/engine`) UI'dan bağımsız kalsın ve her formül için birim test yazılsın. Testlerde elle doğrulanmış örnekler kullan.
- Veri modeli değişikliklerinde `schemaVersion` artırılsın ve eski dosyalar için dönüşüm yazılsın.
- Büyük bir adıma başlamadan önce kısa bir plan yaz, bitince neyin çalıştığını ve neyin eksik kaldığını belirt.
- Belirsiz bir mühendislik kararında (formül, varsayılan değer) tahmin yürütmek yerine bu dosyadaki "Açık Sorular" bölümüne ekle ve kullanıcıya sor.
