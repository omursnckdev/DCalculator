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
   - *Faz 4 geçici kararı:* Jeneratör ATS ile bağlanır: **ATS/STS ekipmanı** (iki girişli, tek çıkışlı) çizilir; normal kaynak hatlarına %100, yedek kaynağa %0 pay verilir (bkz. 21-22). ATS'siz doğrudan bağlantıda da yedek hat için pay 0 yeterlidir. Onay bekliyor.
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
20. **Anahtar/kesici modeli (Faz 4):** Anahtar ayrı bir ekipman değil, **hattın özelliğidir** (Kapalı/Açık; canvas'ta hat etiketindeki yuvarlak düğmeyle çevrilir). Açık hat şemada yok sayılır. **Bara kuplajı** için iki bara arasına karşılıklı iki hat (A→B ve B→A) çizilir ve normalde ikisi de açık bırakılır; ikisi birden kapalıysa döngü hatası verilir. Yeterli mi, yoksa tek elemanlı iki yönlü bir "kuplaj" ekipmanı mı istersiniz?
21. **ATS/STS (Faz 4):** Kararlı durumda aynı davranır: girişlerden **yalnızca biri aktiftir**, tercih edilen = en yüksek pay (eşitlikte ilk çizilen hat; belirsizse uyarı). STS'nin ATS'den farkı olan **geçiş süresi, UPS batarya otonomisi, jeneratör devreye girme süresi modellenmiyor** (yalnız kararlı durum yük dağılımı).
22. **Arızada yük aktarımı (Faz 4):** Bir ekipmanı besleyen hatlardan biri ölürse (kaynağı arızalı/enerjisiz veya hat açık) payı **canlı hatlara normal paylarıyla orantılı** aktarılır (hepsi 0 ise eşit). Yani pay %0 yedek kaynaklar **otomatik devreye girer** (otomatik transfer varsayımı). Operatör müdahalesi gerektiren geçişler (kuplaj kapatma gibi) senaryoda anahtar durumu olarak elle girilir.
23. **N-1 ölçütü (Faz 4):** Her yük-dışı ekipman ve her kapalı hat tek tek devre dışı bırakılır, anahtarlar temel durumda kalır. "Sağlanıyor" = **yük kaybı yok ve hiçbir ekipman/hat %100'ün üzerinde değil**. Arıza anında kısa süreli aşırı yük toleransı (ör. UPS %110 / 10 dk) tanımlı değil; kabul edilebilir sınır %100 mü kalsın, ekipman bazlı mı olsun?
24. **Çoklu arıza (Faz 4):** Otomatik tarama yalnız N-1'dir. N-2 veya eşzamanlı arıza, senaryo editöründen birden fazla ekipman seçilerek elle denenir; otomatik N-2 yok.
25. **Enerjisiz ekipman gösterimi (Faz 4):** Enerjisiz kalan ekipman 0 kW gösterilir ve soluklaşır; kaybedilen yük "Kaybedilen yük (kW)" olarak ayrıca raporlanır (yük kurulu gücü × talep faktörü).
26. **Jeneratör öncelik kuralı (Faz 4, düzeltme):** Jeneratör **acil kaynaktır**: bir pano/bara/ATS gibi kaynak seçilen düğümde normal kaynaktan (şebeke/trafo zinciri) beslenen canlı bir giriş varsa jeneratör girişi **yük almaz**, pay verilmemiş olsa bile (eskiden pay verilmeyince %50/%50 bölüşüyordu, bu hataydı). Normal kaynak kalmayınca (arıza, açık anahtar) otomatik devreye girer. Jeneratör hattına açık pay > 0 verilirse uyarı çıkar ve pay normal kaynak varken yok sayılır. **İstisna:** çift kablolu (2N) yüklerin iki besleme tarafı yükü paylaşmaya devam eder; yani bir trafo arızalıyken o tarafı taşıyan jeneratör, diğer taraf şebekede olsa da kendi tarafının yükünü alır. Jeneratör ile şebekenin **paralel çalışması** (peak shaving, senkron) modellenmiyor. Bu kural sizin istediğiniz gibi mi, yoksa 2N yüklerde de jeneratör tamamen boşta mı kalsın?
27. **Portlar (giriş/çıkış sayısı) (Faz 4 sonrası ekleme):** Her ekipmanın **Giriş sayısı** ve **Çıkış sayısı** alanı vardır (1-12; giriş üstte, çıkış altta). **Her porta tek hat** bağlanır; hat hangi porttan bağlandığını saklar (`kaynakPort`, `hedefPort`, şema v5). Eski dosyalar açılırken hatlar sırayla portlara atanır ve port sayısı kullanılan kadar yükseltilir. Varsayılanlar (genel tipik, değiştirilebilir): şebeke/jeneratör 0 giriş 1 çıkış; trafo 1/1; MDB 2/6; dağıtım panosu 1/6; bara 2/8; UPS 1/1; UPS panosu ve PDU 2/6; **ATS/STS 2/1**; yükler 1/0 (çift kablolu IT için giriş sayısını 2 yapın). Aynı iki ekipman arasında paralel hat için ayrı port çifti gerekir. Bu varsayılan sayılar sizin ekipmanlarınıza uygun mu?
28. **ATS/STS tercih edilen kaynak (Faz 4 sonrası ekleme):** Tercih, ekipman panelindeki **"Tercih edilen kaynak"** seçiminden yapılır (seçilen girişe %100, diğerlerine %0 pay yazar). Hiç belirtilmemişse en düşük numaralı giriş seçilir ve uyarı çıkar; jeneratör girişi her zaman acil kaynaktır (bkz. 26). Hangi kaynaktan beslendiği düğüm kartında (**Besleme: …**), port renklerinde (yeşil aktif, turuncu yedek, gri enerjisiz, kırmızı açık) ve panelde **Girişler** tablosunda görünür; arıza senaryosunda canlı olarak değişir.
29. **ATS/STS'de açık tercih jeneratör kuralını geçersiz kılar (düzeltme):** ATS/STS girişlerinden birine açık pay verilmişse (ör. A %100, B %0) kullanıcının tercihi geçerlidir; "jeneratör acil kaynak" kuralı (26) yalnızca tercih verilmemişse işler. Aksi halde jeneratörlü taraftaki UPS, STS'nin catcher'a geçmesine yol açıyordu.
30. **Kesici / ayırıcı ekipmanı ve ölçü elemanları (HDC02 şeması ile eklendi):** `Kesici / ayırıcı` düğümü (ACB, MCCB, ayırıcı; nominal akım, 3P/4P, **Açık/Kapalı** durum). Açık kesici hattı keser (arıza sayılmaz, "AÇIK" etiketi), senaryoda durumu geçersiz kılınabilir (şema v6 `nodeStates`), nominal akımı aşan yük aşırı yük olarak işaretlenir. `Ölçü / koruma elemanı` (akım trafosu, sayaç, PQM, parafudr) güç akışını etkilemez. Hatlara **ad ve açıklama** eklendi (`BB/MSB.PL1/01`, `2x(4x95)+95 mm² N2XH` gibi). Port üst sınırı 24'e çıkarıldı. **Modellenmeyenler:** anahtarlı kilit (K1-K5), solenoid, PMS, sinyal/ikaz lambaları, shunt trip; bunlar kontrol mantığıdır, güç hesabını etkilemez.
31. **HDC02 PL1 örneğindeki varsayımlar** (`examples/hdc02-pl1.dcalc.json`, üretici: `scripts/build-hdc02-pl1.py`; düğüm notlarında "Varsayım:" ile işaretli): şebeke 34,5 kV (şemada gösterilmiyor); trafo kayıpları (3,6 kW boşta / 27 kW yük); jeneratör 1800 kVA (2500 A ACB'den); UPS verimi %96 sabit; **tüm yük değerleri** (şemada kW yok): STS çıkışı 270 kW IT, RPP.POP 82 kW, chiller 289 kW, jeneratör yardımcıları 46 kW, DB.PL1.1 31 kW, DB.PL1.2 225 kW (kablo sınırlı), UDB'ler 40/30/40 kW; kablo uzunlukları (kablo 40 m, bara 8-20 m) ve kablo akım kapasitesi (IEC 60364-5-52 tipik Cu XLPE); catcher kaynağı (BB/CRP.PL1.1) ve CRP.PL1.1 beslemesi şema dışında olduğundan sınırsız kaynak kabul edildi; normalde açık: bakım bypass ACB/MCCB'leri, STS bypass ayırıcıları, load bank kesicileri, spare kompanzasyon. Gerçek yük ve cihaz değerlerini girmeniz gerekir.

## 12. Claude Code için Çalışma İlkeleri

- Önce Faz 1'i bitir, sonra sıradaki faza geç; her fazın sonunda çalışan bir sürüm olsun.
- Hesap motoru (`/engine`) UI'dan bağımsız kalsın ve her formül için birim test yazılsın. Testlerde elle doğrulanmış örnekler kullan.
- Veri modeli değişikliklerinde `schemaVersion` artırılsın ve eski dosyalar için dönüşüm yazılsın.
- Büyük bir adıma başlamadan önce kısa bir plan yaz, bitince neyin çalıştığını ve neyin eksik kaldığını belirt.
- Belirsiz bir mühendislik kararında (formül, varsayılan değer) tahmin yürütmek yerine bu dosyadaki "Açık Sorular" bölümüne ekle ve kullanıcıya sor.
32. **Otomatik bypass (kesici `otomatik` alanı):** kesici "otomatik kapanma"ya ayarlıysa, kendi aşağısındaki bara enerjisiz ve yukarısı enerjili iken kapalı sayılır (UPS arızasında hard bypass → UPS dağıtım panosu ana dağıtımdan beslenir). Senaryoda kesiciye elle durum verilirse otomasyon o kesici için devre dışıdır (elle seçim kazanır). Gerçek sistemde bypass komutu UPS kontrolörü ve kilit mantığına bağlıdır; burada yalnız sonuç durumu modellenir.
33. **Senkron panosu / jeneratör kademelendirme:** senkron panosuna bağlanan jeneratörler giriş port sırasına göre dizilir; toplam yük kVA'sı, ilk *r* jeneratör kapasitesinin eşik% (varsayılan 70) değerini aşmayan en küçük *r* kadar jeneratör çalışır, kalanlar "beklemede" olur (yükten düşer, enerjili ama yüksüz). Eşik "tek jeneratörün karşılayabileceği değerin %70'i" biçiminde yorumlanır: iki jeneratörde yük bir jeneratör kapasitesinin %70'ine inince ikinci jeneratör kapanır. Mod "eşit" ise kademelendirme yapılmaz. Yalnız jeneratörler yükteyken (normal kaynak kayıpken) geçerlidir.
34. **UPS bataryası:** UPS arızalı/girişi enerjisiz iken çıkışı `bataryaDk` (varsayılan 10 dk) boyunca çalışır; bu sürede yukarı hatta çekim yoktur (batarya şarj/deşarj enerjisi modellenmez). Süre bitince simülasyonun son adımında yük kaybı gösterilir.
35. **Adım adım simülasyon:** `simulateFailure`, arızayı sabit tipik gecikmeli aşamalara böler (STS ~4 ms, bypass ~100 ms, jeneratör ~10 s, kademelendirme ~70 s, batarya bitişi `bataryaDk`). Her aşama kararlı hal analizidir (geçici rejim yok); aşamalar arasında bir şey değişmiyorsa adım atlanır. Aşamalar kullanıcı tarafından ayarlanamaz.
36. **Akış animasyonu:** yalnız görsel; tarayıcıda saklanan tercihle açılır/kapanır (`dcalculator:flowAnim`), projeye yazılmaz.
37. **Arızanın giderilmesi (geri dönüş) simülasyonu:** `simulateRecovery`, kullanıcının seçtiği adımdan itibaren arızayı kaldırır. Adım 1 (t=0): normal kaynak enerjili ama ATS/STS ve jeneratör kolundan beslenen çok girişli panolar (ör. MSB) ile otomatik kapanmış bypass kesicileri eski konumunu korur. Adım 2 (~5 dk, geri transfer gecikmesi): girişler normale döner, bypass açılır, jeneratörler yüksüz çalışır. Adım 3 (~10 dk, 5 dk soğutma): jeneratörler durur. Süreler tipik sabitlerdir (`SIM_TIMING.retransfer/cooldown`). Jeneratör "çalışıyor" bilgisi yalnızca simülasyon adımlarında vardır (kararlı hal analizinde yoktur); jeneratör, normal kaynak kayıpken yük taşıdığı adımda çalışmış sayılır. Giderme, arıza sonrası seçili adımdan sonraki adımları siler (sonraki arıza adımları yeniden hesaplanmaz).
38. **Pano iç bara kaybı:** MDB, dağıtım panosu, bara, UPS panosu, PDU, ATS/STS ve senkron panosunda iç bara kaybı `P = 3·I²·R·L / 1000` kW (I: panonun çıkış akımı, R: faz başına mΩ/m, L: iç bara uzunluğu, m). Üç faz çarpanı (3) kullanıldı; girilen R'nin üç fazın toplamı olduğu bir kullanımda çarpan çıkarılmalıdır (kullanıcıya soruldu). Direnç girilmezse `R = 34,4 / In` mΩ/m (Cu, ρ ≈ 0,0215 Ω·mm²/m, J ≈ 1,6 A/mm², 85 °C): 5000 A için ≈ 0,0069 mΩ/m, tam yükte ≈ 0,5 kW/m. **Varsayılan iç bara uzunlukları tahmindir** (MDB 6, bara 5, dağıtım/UPS panosu 3, PDU 1,5, ATS/STS 2, senkron 4 m); gerçek pano üretici verisiyle değiştirilmelidir. Kesici/ölçü elemanı kayıpları (kontak direnci) ve pano içi kablolama/ek ısı hesaba katılmadı. `faz3-referans` örneğinde elle hesap değerinin (874,5 kW, PUE 1,749) korunması için pano iç bara uzunlukları 0 girilmiştir. Kayıp, panonun `isiKonum` alanındaki mekâna yazılır (varsayılan elektrik odası).
39. **Seçmeli arıza giderme:** `simulateRecovery(model, adım, giderilecekler)`; her simülasyon adımı hâlâ arızalı ekipman listesini (`failed`) taşır. Seçilen ekipmanın arızası kalkar, diğerleri sürer; giderme adımları kalan arızalarla çözülür. Onarılan jeneratör ilk giderme adımında devreye alınmaz (çalışmıyor), geri transfer adımında senkron panosu kuralıyla devreye girer. Jeneratör duruşu yalnızca yük taşımayan jeneratörler için gösterilir. Önceki bir adıma dönülünce o giderme geri alınır (giderme geçmişi yığın olarak tutulur).
40. **MDB yatay boyutlandırma:** Yalnız ana dağıtım panosu (MDB) şemada yatay uzatılır (React Flow `NodeResizer`); yükseklik sabit. Genişlik `params.genislik` (px, 0 = otomatik) olarak saklanır, şema sürümü değişmedi (eski dosyalar uyumlu). Genişlik, port sayısına göre gereken en az genişliğin altına inmez. Kart görünümünde de uygulanır.
41. **Arıza listesi şemadan doldurulur:** Seçili ekipmanın özellikler panelindeki düğme ekipmanı Canlı simülasyon arıza listesine ekler/çıkarır. Liste projeye kaydedilmez (oturum durumu); simülasyon açıkken değişmez; silinen ekipman listeden düşer.
42. **Kısa devre akımı:** `shortCircuit` (Thevenin, karmaşık empedans): şebeke Z = U²/Ssc (X/R = 10), jeneratör X = Xd″·U²/Sn (X/R = 20, varsayılan Xd″ %15), trafo Z = uk·U²/Sn (R = Pk/Sn), hat Z = (r + jx)·L, UPS evirici akım kaynağı (Isc = katı × In, varsayılan 1,5; bypass ayrı yoldan gelir). Paralel kaynaklar empedans olarak paralel alınır; **tüm kaynaklar eş zamanlı paralel** varsayılır (en kötü durum; gerçekte jeneratör ve trafo normalde paralel çalışmaz, bu yüzden kesici kapasitesi kontrolü muhafazakârdır). Motor katkısı, DC bileşen ve ark yok. Kesici kesme kapasitesi alanı (0 = belirtilmedi) aşımı hata verir.
43. **Toplam gerilim düşümü:** kaynaktan düğüme canlı yol boyunca hat düşümlerinin (%) ve trafo düşümünün (yük·(uR·cosφ + uX·sinφ)) toplamı; paralel yollarda en kötüsü. %5 sınırı `Thresholds.chainDropPct` (hat başına %3 sınırı ayrıdır). Yüzde toplamı farklı gerilimlerde yaklaşıktır.
44. **Soğutma yeterliliği:** `sogutmaKw` olan mekanik yükler soğutma birimi sayılır; enerjili kapasite − (salon + elektrik odası ısısı) = açık. Isıl süre: `1,2 kJ/m³K × hacim × ısıl kütle çarpanı × izinli ΔT / açık`; hacim 2000 m³, çarpan 10, ΔT 8 K varsayılan (kullanıcı ayarı). Gerçek odalarda hava dağılımı/sıcak-soğuk koridor modellenmez; süre kaba bir ön değerdir. HDC02'de chiller termal kapasitesi = elektrik gücü × COP 5 varsayıldı.
45. **Harmonik:** tipik karma spektrum (3,5,7,9,11,13. dereceler; ağırlıklar 0,6/0,8/0,55/0,25/0,3/0,2) THD'ye ölçeklenir, K = Σ(I_h/I_rms)²h². Trafo yük kaybı ×(1 + K·Pec)/(1 + Pec), kullanılabilir kapasite ×√((1 + Pec)/(1 + K·Pec)) (Pec-R varsayılan %10). Aşağı akıştaki K, yüklerin kVA² ağırlıklı ortalamasıdır; UPS yük harmoniklerini keser (yukarı akışta UPS giriş THD'si). Varsayılan THD 0 (kullanıcı girer); nötr akımı, 3. harmonik sıfır sekans etkisi ve gerilim bozulması yok.
46. **Yedeklilik özeti:** "Tek arıza" = her yük-dışı ekipman ve her kapalı hat (operatör müdahalesi yok, otomasyonlar çalışır). Soğutma birimlerinin kendi kaybı yük kaybı sayılmaz (soğutma yedekliliği ayrıca değerlendirilir; ihtiyacın %2'sinden küçük açıklar yok sayılır). Jeneratör N+1: şebeke (tüm `sebeke` düğümleri) arızalı iken jeneratör toplamı ve her jeneratörün ek kaybı. UPS/trafo/soğutma kontrolleri aynı taramadan türetilir; HDC02 örneğinde jeneratör N+1 sağlanmaz (varsayımsal yük 2377 kW > tek jeneratör 1440 kW).
47. **Bakım modu:** ekipman arıza gibi enerjisiz bırakılır (planlı); sonra her ikinci tek arıza bu durum esas alınarak taranır. Bakım sırasında operatör transferi/anahtarlama yapılmadığı, yalnız otomasyonların çalıştığı varsayılır.
48. **Yük profili ve enerji:** `profilIt` ve `profilMek` (% , 24 değer): her saat için yükler `kuruluKw × çarpan` olarak ölçeklenip analiz yeniden çözülür (kayıplar ve ısı yükle birlikte değişir); kategori IT olmayan yükler mekanik profili izler. Yıllık = günlük × 365 (mevsimsel değişim ayrı profillerle elle karşılaştırılır). Maliyet = kWh × tarife; tasarruf = (ortalama PUE − hedef PUE) × yıllık IT kWh × tarife. Tarife varsayılanı 3,5 TL/kWh **yer tutucudur**.
49. **Batarya enerjisi:** çalışma süresi = `bataryaDk × nominal kW / çıkış kW` (doğrusal enerji; Peukert, sıcaklık, yaşlanma ve minimum DC gerilim yok); şarj bataryadayken adımlar arasında önceki adımın yüküyle azalır, tükenen UPS ayrı bir "batarya tükendi" adımı üretir (aynı anda bitenler tek adımda). Girişi dönen UPS'in yeniden şarjı modellenmez (simülasyon süresi içinde şarj tutulur).
50. **Sıralı arıza:** seçili adımdan itibaren ek arıza uygulanır; transferler, bypass, çalışan jeneratörler ve batarya şarjı o adımın durumundan devam eder, zamanlar mutlaktır. Jeneratörler zaten çalışıyorsa yük devri çalıştırma gecikmesi beklemez (0,5 sn). Önceki adıma dönmek ek arızayı geri alır.
51. **Geri al / yinele:** içerik (ekipman, hat, senaryo, ayarlar, proje adı) anlık görüntüleri; 600 ms'den kısa aralıkla ardışık değişiklikler (sürükleme, yazma) tek adım; en çok 100 adım; seçim ve görünüm geçmişe girmez; proje yüklenince/yeni projede geçmiş sıfırlanır (şablon yükleme dahil).
52. **Çoklu seçim, arama, gruplama:** React Flow seçim kutusu (Partial), grup = ekipmanın mevcut `grup` alanı (şema sürümü değişmedi); grup çerçevesi ekipman sınırlarından hesaplanır (yalnız görsel). Arama ad/etiket/grup üzerinde, Türkçe büyük/küçük harf duyarsız.
53. **Şablonlar:** `src/library/templates.ts` (tek hat N, jeneratörlü N+1, 2N). Tüm değerler tipik/varsayım (IT 400 kW, trafo 1000 kVA, jeneratör 1000 kVA, UPS 500 kVA/450 kW, chiller 150 kW elektrik / 450 kW termal); kendi tesisinize göre düzenleyin. Testler her şablonun hatasız çözüldüğünü ve beklenen yedeklilik karakterini doğrular.
54. **Rapor:** `buildReportHtml` saf bir HTML üretici; yazdırma gizli iframe + `print()` ile (tarayıcıdan PDF kaydedilir, ek kütüphane yok); şema görüntüsü Şema sekmesi açıkken PNG olarak gömülür. Tüm metinler HTML kaçışlıdır.
55. **Ağır hesaplar Web Worker'da:** yedeklilik/bakım taraması ve enerji raporu `src/engine/worker.ts` içinde çalışır (HDC02'de ≈1–2 sn); arayüz donmaz. Motor saf TypeScript olduğundan aynı kod testlerde doğrudan çalışır.
56. **Ekipman kütüphanesi genişletmesi:** 20 yeni tip (chiller, CRAH, CRAC, fan wall, in-row, RDHx, kuru soğutucu, soğutma kulesi, pompa, AHU, fan, nemlendirici; rack, ağ/depolama, güvenlik, yangın paneli, asansör, yük bankası, ofis; RPP). Yük tipleri kütüphaneden türetilir (girişi var, çıkışı yok): yeni yük eklemek için `LOAD_SPECS` satırı yeterlidir. Mevcut tipler (`mekanikYuk` vb.) değişmedi; eski dosyalar aynen açılır (şema sürümü artmadı). **Varsayılan değerler tipiktir** (chiller 250 kW elektrik / 1000 kW termal, CRAH 12 kW / 80 kW, CRAC 30 kW / 90 kW, fan wall 25 kW / 250 kW, rack sırası 80 kW...); proje verisiyle değiştirilmelidir.
57. **Soğutma rolleri:** `coolingRole`: chiller `produce` (soğuk su üretimi), CRAH/fan wall/in-row/RDHx `air` (soğuk suyu havaya aktarır), CRAC ve eski genel mekanik yük (kapasite girilmişse) `direct`. Etkin kapasite `min(üretim, hava) + doğrudan` (yalnız bir taraf tanımlıysa o taraf; chiller yokken CRAH'lar soğuk suyu dışarıdan alır varsayılır). Chiller'ın heat-rejection (kuru soğutucu/kule) ve pompa bağımlılıkları modellenmez; bu ekipman yalnız elektrik yükü ve ısı olarak girer. CRAC'ın ısı konumu varsayılan "dış ortam" (kondenser), CRAH/fan wall "veri salonu" (fan ısısı salon havasına karışır).
58. **İklim ve COP(T):** aylık ortalama + genlik ile 15:00 tepeli sinüs profili (veya 8760 saatlik veri). COP, nominal sıcaklıktan itibaren %copEgim/K (varsayılan 2,5) değişir; çarpan 0,3–1,4 ile sınırlı, COP ≥ 1. Free-cooling: `fcAlt` altında tam, `fcUst` üstünde yok, arada doğrusal; free-cooling payında yalnız pompa/fan gücü (`fcOran` % kuruluKw) harcanır. Varsayılan iklim ılıman kıyı tipik değerleridir; lokasyona göre değiştirilmelidir. Mevsimsel PUE ay başına 24 saatlik temsilî gün × gün sayısıyla toplanır.
59. **WUE ve CO₂:** WUE = kule suyu (ısı atımı kWh × `suTuketimi` L/kWh, varsayılan 1,8) / IT kWh; yalnız kule ekipmanı olan projelerde anlamlıdır. CO₂ = şebeke kWh × `emisyon` (varsayılan 0,45 kg/kWh, yer tutucu; jeneratör yakıtı emisyonu dahil değil).
60. **Soğutma zinciri:** pompa (soğuk su/kondenser) ve ısı atım ekipmanı gruplarında asıl görevli birimler enerjisizse chiller kapasitesi `enerjili asıl / toplam asıl` oranıyla düşer (basit hidrolik model; basınç/debi eğrisi yok). Yedek görevli birim eksik asılın yerini alır. Salon sıcaklığı: C = 1,2 kJ/m³K × V × kütle çarpanı; adımlar arası doğrusal artış, sınır kesişimi ayrı adım. Fazla kapasitede ayar noktasına doğru düşer.
61. **Güvenilirlik:** bileşenler bağımsız, U = MTTR/(MTBF+MTTR); asgari kesit kümeleri 1.–2. derece (ve bileşen sayısı ≤ 40 ise 3.) taranır, U_sistem ≈ Σ ΠU (nadir olay yaklaşımı, üst sınır). Kesinti = herhangi bir IT yükünün enerjisiz kalması (UPS batarya ride-through sayılmaz, muhafazakâr). Jeneratör kalkış başarısızlığı %1,5. MTBF/MTTR değerleri tipik **varsayımdır**; üretici/saha verisiyle değiştirilmelidir. Tier göstergesi yalnız hesaplanan erişilebilirliğin tipik eşiklerle karşılaştırılmasıdır; Uptime sertifikasyonu değildir.
62. **Koruma seçiciliği ve ark flaşı:** ACB: uzun gecikme I²t (Ir, tr), kısa gecikme sabit süre (Isd, tsd), ani (Ii); MCCB yalnız ani. "Oto" mod tip varsayılanlarını kullanır (Isd 6×Ir, 0,3 sn, Ii 15×In / MCCB 10×In). Seçicilik: üst cihaz alt cihazdan ≥ 1,3× + 50 ms geç açmalıdır; limit = bu koşulun bozulduğu en düşük akım. Ark flaşı IEEE 1584-2002 (≤ 1 kV, basitleştirilmiş: yapılandırma, mesafe 455 mm, aralık 32 mm varsayılan), temizleme süresi koruyan cihazın eğrisinden (yoksa 2 sn). Üretici eğrileri ve IEEE 1584-2018 ile doğrulanmalıdır; yalnız ön tasarım.
63. **Kablo seçimi:** XLPE Cu çok damarlı, tava (yöntem E tipik değerler); sıcaklık düzeltmesi √((90−T)/60), gruplama faktörü kullanıcı girişi; ΔU ve k = 143 ısıl dayanımı birlikte; en az paralel kablo önce, sonra en küçük kesit. Busbar hatları kapsam dışı. Üretici tablosuyla doğrulanmalıdır.
64. **Jeneratör yakıtı:** özgül tüketim eğrisi (%10 → 350, %25 → 270, %50 → 230, %75 → 215, %100 → 210 g/kWh), dizel yoğunluğu 840 g/L, L/saat = P·sfc/840; kullanılabilir yakıt = tank × kullanılabilir %. Özerklik hedefi (varsayılan 24 sa): ≥ hedef yeşil, ≥ yarısı sarı. Tank dolu varsayılır; yakıt ikmali modellenmez. Yakıt simülasyon adımı varsayılan **kapalıdır** (ayar).
65. **Yük atma ve sıralı yük alma:** atma yalnız simülasyonda (ve `SimOptions.shed`); jeneratör > %100 yüklüyse alt akış yüklerinden en yüksek öncelik numarası (5) ve en büyük güç ilk atılır, %100'e inene kadar; öncelik 1 asla atılmaz. Gerçek tesiste yük atma röle ayarına bağlıdır. Sıralı alma: UPS girişleri ilk grup; yükler öncelik gruplarına, her grup `yukAlmaAraligi` (10 sn) arayla; gerilim çökmesi ≈ S_kalkış/(S_kalkış + Σ Sn/Xd″) (blok yükü kVA × kalkış katı; UPS arkasındaki yükler hesaba katılmaz). Kalkış katları tipik (pompa 6, chiller 3, CRAH 2); ön tahmindir, ayrıntılı motor kalkış analizi yerine geçmez.
66. **Katalog ve içe aktarma:** katalog kayıtları gerçek üretici modeli değil, **tipik boyut** kayıtlarıdır (ör. trafo 630–3150 kVA, uk %6; jeneratör 500–2500 kVA, ≈ 8 saat tank); kullanıcı kataloğu `localStorage`'da (`dcalculator:userCatalog`). İçe aktarma: başlık eşleme ASCII katlamalı (ı/ş/ğ...), tip eşleme anahtar/etiket/eş anlamlı, sayılar TR/EN ondalık; kW sütunu yük tiplerinde `kuruluKw`, UPS'te `nominalKw`, kVA sütunu `nominalKva`; Besleyen adı önce dosyada sonra mevcut şemada aranır, port sayısı gerekirse (en çok 24) artırılır; hatlar varsayılan kablo (10 m, 630 A) olarak eklenir, sonradan düzenlenmelidir. Yeni düğümler mevcut şemanın altına, besleyen derinliğine göre kademelendirilir.
