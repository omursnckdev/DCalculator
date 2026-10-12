# AOS_DCalculator

> Uygulamanın görünen adı **AOS_DCalculator**'dır. Depo adı (`DCalculator`), proje dosyası uzantısı (`.dcalc.json`) ve tarayıcıdaki kayıt anahtarları (`dcalculator:*`, IndexedDB adı) değişmedi; böylece mevcut kayıtlı projeler ve tercihler kaybolmaz.

Veri merkezi güç zinciri ve ısıl yük ön tasarım aracı. Tarayıcıda çalışan, sunucusuz
bir web uygulamasıdır. Kapsam, mimari ve yol haritası için bkz. [docs/PLAN.md](docs/PLAN.md); yapılanların tam özeti için [docs/YAPILANLAR.md](docs/YAPILANLAR.md).

> Sonuçlar ön tasarım tahminidir; nihai mühendislik çalışmasının yerini tutmaz.

## Durum

- **Faz 1 (iskelet) tamamlandı:** sürükle-bırak şema çizimi, ekipman paleti, kablo/busbar
  hatları, özellik paneli, IndexedDB'ye otomatik kayıt, JSON kaydet/yükle.
- **Faz 2 (yük analizi) tamamlandı:** yükten kaynağa IT / mekanik / kayıp toplama, kVA ve akım,
  kapasite doluluğu (yeşil/sarı/kırmızı), hat akımı ve gerilim düşümü, sabit verimli UPS,
  canlı doğrulama, tablo görünümü, "nasıl hesaplandı" adımları.
- **Faz 3 (ısıl analiz) tamamlandı:** trafo ve kablo/busbar kayıpları, UPS verim eğrisi, "ısıyı nereye
  bırakır" (salon / elektrik odası / dış ortam) ile mekân bazında ısıl yük (kW ve TR), yaklaşık PUE,
  pano seviyesinde eşzamanlılık (diversity), Excel ve PNG çıktısı. Toplam ısı = çekilen güç (testle doğrulanır).
- **Faz 4 (arıza senaryoları) tamamlandı:** hat anahtar durumu (açık/kapalı), ATS/STS, bara kuplajı,
  arızada yükün sağlam hatlara aktarılması (2N, yedek jeneratör), otomatik N-1 taraması, kaydedilebilir
  senaryolar ve senaryo karşılaştırma.
- **Canlı simülasyon ve otomasyon (Faz 4 eki):** akan enerjiyi gösteren hat animasyonu, otomatik bypass kesicisi,
  senkron panosu (jeneratör kademelendirme), UPS batarya geçişi ve arızanın adım adım izlenmesi.
- **Faz 5 (kapsam genişletme) tamamlandı:** kısa devre ve toplam gerilim düşümü, soğutma yeterliliği, harmonik/K-faktörü, kapasite ve yedeklilik özeti,
  bakım modu, 24 saatlik yük profili ve enerji/maliyet, batarya enerjisi, sıralı arıza, simülasyon grafiği, geri al/yinele, çoklu seçim, arama,
  gruplama, hazır şablonlar ve yazdırılabilir (PDF) rapor. Ayrıntı için aşağıdaki "Yeni özellikler" bölümüne bakın.

## Çalıştırma

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # birim testleri (vitest)
npm run typecheck
npm run build
```

**Isı kaybı:** kablo ve busbar hatlarında `3·I²·R·L/1000` (R: Ω/km, L: m→km). Panolarda (MDB, dağıtım panosu, bara, UPS panosu, PDU, ATS/STS, senkron)
iç bara kaybı da aynı formülle hesaplanır: **İç bara uzunluğu** (m) ve **Bara direnci** (mΩ/m, faz başı) panel alanlarından girilir; direnç 0 ise
nominal akımdan tahmin edilir (`R = 34,4 / In` mΩ/m). Varsayılan iç bara uzunlukları tahminidir (MDB 6 m, bara 5 m, dağıtım/UPS panosu 3 m, ATS/STS 2 m,
senkron 4 m); kendi panonuza göre girin. Kayıp, panonun **Isıyı bıraktığı yer** alanındaki mekâna yazılır. Kesici ve ölçü elemanlarında kayıp hesaplanmaz.

**Kayıpları nerede göreceksiniz:** (1) **Isıl özet** sekmesi → "Kayıp dökümü (kalem kalem)": her kablo, busbar hattı, pano iç barası, trafo ve UPS
satır satır (kayıp kW, pay %, ısının bırakıldığı mekân; Kablo / Busbar / Pano / Trafo / UPS filtreleri). (2) Hat veya pano seçince sağ panelde "Kayıp (kendi)".
(3) **Tablo** sekmesinde ekipman satırlarında "Kayıp (kendi)" ve hat satırlarında "Hat kaybı" sütunu. (4) Excel'de **Kayıplar** sayfası.

**Windows:** Node.js (LTS, 22.12 veya üzeri) kurulu olmalıdır; proje klasöründeki `baslat.bat` dosyasına çift tıklamak ilk seferde paketleri kurar, sonra uygulamayı başlatıp tarayıcıda açar.

Excel ve PNG çıktıları üst çubuktaki **Excel indir / PNG indir** düğmeleriyle alınır (PNG için Şema sekmesi açık olmalı).

## Yapı

| Klasör | İçerik |
|---|---|
| `src/model` | Tipler, JSON şeması, `schemaVersion` ve `migrate` |
| `src/library` | Ekipman kütüphanesi (varsayılan değerler, alan tanımları) |
| `src/store` | Zustand durumu, IndexedDB kalıcılığı |
| `src/ui` | Canvas, palet, özellik paneli, araç çubuğu |
| `src/i18n` | Arayüz metinleri (Türkçe) |
| `src/engine` | Hesap motoru (saf TS, React'tan bağımsız, testli): yük toplama, doluluk, hat, doğrulama |
| `src/export` | Excel / PNG çıktıları (Faz 3) |

## Kullanım

- Soldaki paletten ekipmanı sürükleyip tuvale bırakın (veya tıklayın).
- Bir ekipmanın alt noktasından diğerinin üst noktasına sürükleyerek hat çizin.
- Ekipman veya hattı seçince sağ panelden değerlerini düzenleyin; `Delete` ile silin.
- Değişiklikler 1 sn içinde tarayıcıya (IndexedDB) otomatik kaydedilir. "JSON indir / yükle" ile dosya paylaşılır.
- **Tablo** sekmesi: tüm ekipman ve hatlar satır satır; bir tip seçince tipe özgü alanlar düzenlenir.
  Sütun başlığındaki `↓` ilk satırın değerini aşağıya doldurur.
- Çift beslemeli (2N) yapılarda bir ekipmanı besleyen hatlar yükü eşit paylaşır; hat özelliklerinden
  "Yük payı" girilebilir (yedek besleme için 0).
- Her sonucun altında "Nasıl hesaplandı?" ile formül ve kullanılan girdiler görülür.
- **Arıza** sekmesi: senaryo oluşturun (arızalı ekipman + anahtar durumları), "Göster" ile şemada/sonuçlarda
  açın (üstte sarı bant çıkar, "Temel duruma dön" ile kapanır). **N-1 taraması** her ekipman/hat arızasında
  kaybedilen yükü ve en yüksek doluluğu listeler; "Senaryo yap" satırı senaryoya çevirir. Alt tabloda senaryolar yan yana karşılaştırılır.
- **Jeneratör acil kaynaktır:** normal kaynak (şebeke/trafo) varken yük almaz, pay vermeye gerek yoktur; normal kaynak kalmayınca otomatik devreye girer.
- **Giriş/çıkış sayısı:** ekipman panelinden belirlenir (1-12). Her porta tek hat bağlanır; hattın hangi porttan bağlandığı
  hat panelinden değiştirilebilir. Port sayısı bağlı portların altına indirilemez.
- **ATS/STS besleme:** düğüm kartında "Besleme: <kaynak> (G1)" yazar; sağ panelde **Girişler** tablosu her girişin
  durumunu (aktif/yedek/enerjisiz/açık) gösterir, **Tercih edilen kaynak** seçimi pay yazar. Arıza senaryosunda canlı değişir.
- **Düğüm görünümü:** tuvalin sol üstündeki **İkon / Kart** düğmesiyle değişir. Varsayılan **İkon**: yalnızca ekipman ikonu ve adı
  (durum rengiyle çerçeve, doluluk rozeti, AÇIK/ARIZALI etiketi); ayrıntılar fare üstüne gelince ve sağ panelde. **Kart** eski ayrıntılı görünümdür.
  Tercih tarayıcıda saklanır, projeye yazılmaz. İkon görünümünde hat etiketleri sadeleşir (yalnız ad; ayrıntı hat seçilince).
- **Kesici / ayırıcı** düğümü: ACB/MCCB/ayırıcı, nominal akım ve Açık/Kapalı durum. Kartındaki yuvarlak düğmeyle açılıp kapanır
  (senaryo açıksa yalnız o senaryoda). Açık kesici hattı keser; ölçü/koruma elemanları (CT, sayaç, parafudr) güç akışını etkilemez.
- Hatlara **ad ve açıklama** verilebilir (ör. `BB/MSB.PL1/01`).
- Hat etiketindeki yuvarlak düğme anahtarı açar/kapar (senaryo açıksa yalnız o senaryoda).

## Canlı simülasyon

- **Akış animasyonu:** tuvaldeki **Akış** düğmesi (varsayılan açık) enerjili hatlarda güç yönünü gösteren hareketli çizgi çizer;
  hat kalınlığı/rengi doluluğa göre, enerjisiz hatlar sönüktür.
- **Adım adım arıza:** **Şema** sekmesinin altındaki *Canlı simülasyon* şeridinden arızalı ekipmanı seçip **Arızayı uygula** deyin.
  Sıra: **Arıza anı** (transferler tutulur, UPS bataryaya geçer) → **STS/ATS** (~4 ms) → **Otomatik bypass** (~100 ms) →
  **Jeneratör devrede** (~10 s) → **Senkron panosu kademelendirme** (~70 s) → **Batarya bitişi** (UPS özerkliği, varsayılan 10 dk).
  Değişmeyen adımlar atlanır. Her adımda tuval o anın durumunu gösterir (değişen ekipman titreşir) ve "ne değişti" listesi yazılır;
  ileri/geri, oynat ve hız düğmeleri vardır. Tüm bunlar projeyi değiştirmez.
- **Ana dağıtım panosunu (MDB) uzatma:** MDB'yi seçince iki yanında tutamaçlar çıkar; sürükleyerek yatay uzatın (çok girişli/çıkışlı baralar için).
  Genişlik projeye kaydedilir; özellikler panelindeki "Şemada genişlik" alanıyla da girilebilir (0 = otomatik).
- **Arıza listesine ekle:** şemada bir ekipmanı seçince sağ panelin üstündeki **⚡ Arıza listesine ekle** düğmesi, ekipmanı alttaki Canlı simülasyon
  arıza listesine ekler (aynı düğme listeden çıkarır). Birden fazla ekipmanı tek tek tıklayarak listeye alıp **Arızayı uygula** diyebilirsiniz.
- **Seçmeli giderme:** birden çok ekipmana arıza verdiyseniz, **Arızayı gider** düğmesinin yanındaki listeden hangisinin giderileceğini seçin
  (ör. yalnız GEN.PL1.1; TX.PL1 arızalı kalır). Kalan arıza sonraki adımlardan yine giderilebilir. Onarılan jeneratör hemen devreye girmez;
  geri transfer adımında devreye alınır.
- **Arızayı giderme:** simülasyon sürerken (oynatırken de) seçili adımdan **Arızayı gider** düğmesine basın; arıza o adımdan itibaren giderilir ve
  şu adımlar oynatılır: **Arıza giderildi** (normal kaynak geri geldi, yük hâlâ jeneratör/bypass üzerinde) → **Geri transfer** (~5 dk; MSB/ATS/STS normal girişe döner,
  bypass kesicileri açılır, jeneratörler yüksüz çalışır, rozet "ÇALIŞIYOR") → **Jeneratörler durdu** (~10 dk, soğutma sonrası). Sonunda sistem arıza öncesi duruma döner.
- **Otomatik bypass:** kesicide *Otomatik kapanma* = otomatik ise, aşağısındaki bara enerjisiz kalıp yukarısı enerjili olunca kesici kapanır
  (UPS arızasında hard bypass → UPS dağıtım panosu doğrudan ana dağıtımdan beslenir). Senaryoda kesiciyi elle açık/kapalı yaparsanız o seçim geçerlidir.
- **Senkron panosu:** jeneratörlerin bağlandığı bara. *Mod* = sıralı iken yük, tek jeneratörün (senkron girişi sırasıyla ilk *r* jeneratörün) kapasitesinin
  **eşik %'sine** (varsayılan 70) inince fazladan jeneratör durdurulur; durdurulan jeneratör "Beklemede" rozeti alır. Mod *eşit* ise hepsi paylaşır.
- **Sınırlar:** simülasyon, tipik gecikmelerle sıralanmış kararlı hal görüntüleridir; elektromanyetik geçici rejim hesaplanmaz.
  Süreler sabit tipik değerlerdir. Batarya devredeyken UPS çıkışı çalışır, yukarı akıma çekim yoktur.

## Yeni özellikler

- **Kısa devre ve toplam gerilim düşümü:** her düğümde üç faz simetrik kısa devre akımı (Isc, kA) ve kaynaktan o düğüme toplam gerilim düşümü (trafo dahil, %).
  Isc, şebeke (kısa devre MVA), jeneratör (Xd″), trafo (uk) ve hat empedanslarından hesaplanır; tüm kaynaklar paralel varsayılır (en kötü durum).
  Kesiciye "Kesme kapasitesi (kA)" girilirse Isc aşımı hata olur (0 = belirtilmedi). Yük uçlarında toplam düşüm %5'i aşarsa uyarı. Sonuçlar özellik panelinde, Tabloda ve Excel'de.
- **Soğutma yeterliliği:** mekanik yüke "Soğutma kapasitesi (termal kW)" girin (chiller/CRAH). **Isıl özet** sekmesi enerjili kapasite, ihtiyaç (salon + elektrik odası),
  yedek ve açığı gösterir; açıkta salon sıcaklığının izinli artışa ulaşma süresi (hava hacmi ve ısıl kütle çarpanına göre) hesaplanır. Simülasyon adımlarında "Soğutma açığı" satırı çıkar.
- **Harmonik:** yüke ve UPS girişine akım THD (%) girilir; tipik spektrumdan K-faktörü hesaplanır. Trafo, harmonikli yükte ek yük kaybı (Pec-R) alır ve kullanılabilir kapasitesi düşer
  (özellik panelinde K-faktörü ve kullanılabilir kapasite). UPS yük harmoniklerini yukarı iletmez; trafo UPS giriş THD'sini görür.
- **Yedeklilik sekmesi:** her arıza adayı için tek arıza taraması: N-1, jeneratör N+1, UPS N+1, trafo doluluğu, soğutma yedekliliği ve tekil arıza noktaları.
  **Bakım modu:** bir ekipmanı bakıma alın; bakım sürerken hangi ikinci arızanın yük kaybettireceğini görün. Ağır tarama arka planda (Web Worker) çalışır.
- **Enerji ve maliyet sekmesi:** 24 saatlik IT/mekanik yük profili (hazır: düz, tipik, yaz, kış); günlük/yıllık kWh, ortalama PUE, saatlik grafik, elektrik maliyeti,
  kayıpların maliyeti ve hedef PUE'ye inilirse yıllık tasarruf. Tarife, para birimi ve profil projeyle kaydedilir.
- **Simülasyon eklemeleri:** UPS batarya şarjı ve kalan süre (yükle ters orantılı; farklı UPS'ler farklı zamanlarda tükenir), simülasyon sırasında **Bu adımda ek arıza** (sıralı arıza),
  **Grafik** görünümü (kaybedilen yük, jeneratör yükü, çekilen güç, en düşük batarya) ve **Arıza raporu (PDF)**.
- **Kullanım:** **↶/↷** geri al/yinele (Ctrl+Z / Ctrl+Y); **Seçim kutusu** (veya Shift+sürükle, Ctrl+tık) ile çoklu seçim, toplu arıza listesine ekleme ve gruplama;
  **Ctrl+K** ekipman arama; grup çerçeveleri (şemada) ve grup bazında güç özeti (Isıl özet); **Şablon** menüsünden tek hat (N), jeneratörlü N+1 ve 2N tam yedekli hazır şemalar.
- **Rapor (PDF):** üst çubuktaki düğme özet, şema görüntüsü, kayıplar, doluluk/Isc, doğrulama, yedeklilik, enerji/maliyet ve (varsa) simülasyon bölümlerini içeren yazdırılabilir rapor açar;
  tarayıcının yazdır penceresinde "PDF olarak kaydet" seçin. Excel'e ayrıca **Kayıplar** ve (simülasyon varsa) **Simülasyon** sayfaları eklenir.
- **İklim, COP ve mevsimsel PUE (Enerji ve maliyet):** 12 aylık ortalama dış sıcaklık ve günlük genlik (veya 8760 saatlik veri yükleme) girilir. Chiller/CRAC için COP dış sıcaklıkla değişir
  (nominal sıcaklığın üstünde %/K düşer), **free-cooling** (alt/üst sıcaklık arasında doğrusal pay) etkin olunca elektrik gücü düşer. Aylık/mevsimsel PUE, yıllık kWh ve maliyet,
  **WUE** (kule su tüketimi, L/kWh BT) ve **CO₂** ayak izi (emisyon faktörü, varsayılan 0,45 kg/kWh) hesaplanır.
- **Soğutma zinciri ve salon sıcaklığı:** soğuk su/kondenser **pompası** ve **ısı atım** (kuru soğutucu, kule) ekipmanı arızalanınca chiller kapasitesi hidrolik zincir çarpanıyla düşer
  (pompa yedeği "Görev: yedek" ile tanımlanır). Simülasyonda salon sıcaklığı dakika dakika modellenir (ısıl kütle çarpanıyla); sınır aşılınca "Salon sıcaklığı sınıra ulaştı" adımı çıkar.
- **Güvenilirlik sekmesi:** ekipmana MTBF/MTTR girilir (varsayılanlar tipiktir); sistem **erişilebilirlik, yılda kesinti dakikası, "kaç dokuz"**, asgari kesit kümeleri (tek arıza noktaları dahil) ve
  N / N+1 / 2N şablonlarının karşılaştırması. Tier ifadesi yalnızca hesaplanan erişilebilirlik yüzdesinin Uptime tablosundaki eşiklerle karşılaştırılmasıdır; sertifikasyon değildir.
- **Elektrik çalışmaları sekmesi:** (1) **Koruma seçiciliği:** kesici açma eğrileri (TCC grafiği) ve üst/alt kesici seçicilik limiti; (2) **Ark flaşı:** IEEE 1584-2002 basitleştirilmiş olay enerjisi ve PPE kategorisi;
  (3) **Kablo seçimi:** IEC 60364-5-52 tipik değerleriyle akım, gerilim düşümü ve kısa devre dayanımına göre kesit/paralel kablo önerisi (tek tıkla hatta uygula);
  (4) **Jeneratör:** şebeke kaybında **yakıt özerkliği** (saat), **sıralı yük alma** ve motor kalkışında **jeneratör gerilim çökmesi**, yük **öncelik/kalkış katı** tablosu.
- **Yük atma ve yakıt (simülasyon):** jeneratör nominal gücünün üzerinde yüklenirse öncelik 5 → 2 sırasıyla yük atılır (1 = kritik, atılmaz; Elektrik çalışmaları → Jeneratör'den kapatılabilir).
  "Simülasyonda yakıt tükenmesini de göster" açıksa tank bitince jeneratör durur ve yük kalan kaynaklara kalır (saat cinsinden adım).
- **Katalog ve toplu içe aktarma:** paletteki **Katalog** bölümü üretici-bağımsız tipik boyutları (trafo, jeneratör, UPS, ACB/MCCB, chiller, CRAH...) tek tıkla veya sürükleyerek ekler; seçili ekipman
  **kendi kataloğunuza** kaydedilebilir (tarayıcıda saklanır). **Liste içe aktar** düğmesi Excel (.xlsx) veya CSV'den ekipman listesini okur: sütunlar Türkçe/İngilizce başlıklarla tanınır
  (Ad, Tip, kVA, kW, Soğutma kW, Gerilim, Grup, Adet, Besleyen, Öncelik ve tipin tüm alan adları); önizlemede uyarılar görülür, "Besleyen" sütunu hatları da oluşturur. Şablon CSV indirilebilir.
- **3D yerleşim (HomeByMe tarzı, mimari değil):** üst sekmelerdeki **3D** ekipmanı metre ölçeğinde 3D'de gösterir; palet/katalogdan sahneye sürükleyin, zeminde taşıyın (ızgaraya ve komşu ekipmana hizalanır),
  **R** ile döndürün, **G** ile tutup taşıyın, **F** ile odaklanın, **1/2/3** ile ön/yan/üst (2D plan) görünüme geçin, **H** ile duvarları gizleyin. Şemadaki ve 3D'deki ekipman **aynı veridir**
  (2D'de eklenen 3D'de, 3D'de eklenen 2D'de görünür; geri al/yinele ikisini de kapsar). Eski projeler 3D açılınca otomatik yerleşir. Odalar (elektrik odası, veri salonu...), çakışma uyarısı, servis boşluğu,
  **renk modları** (tür / doluluk / ısı yükü / enerjili-arızalı / grup), salon **ısı haritası** (yaklaşık, CFD değil), kablo/busbar hatları (kalınlık = doluluk, akan enerji noktaları), kayıtlı kamera görünümleri,
  ölçüm aracı ve **3D PNG** vardır. **Canlı simülasyon 3D'de de izlenir** (arıza, enerjisiz, atılan yük, çalışan jeneratör, batarya, salon sıcaklığı). Hat seçilince **kablo güzergâhı** (ara noktalar sürüklenir) ve
  **"Uzunluk kaynağı: 3D güzergâhtan"** seçeneği vardır: uzunluk güzergâhtan hesaplanıp kayıp, gerilim düşümü, kablo seçimi ve ark flaşı hesaplarına yansır. **Kablo tavası ve boru hatları:** sol panelde "Kablo tavası ve borular" — **Tava çiz** (zemine tıkla, Enter), **Kabloları tavalara yönlendir** (kablolar tava ağı üzerinden gerçek yoldan gider, uzunluk/kayıp/gerilim düşümü buna göre güncellenir; "Uzunluk kaynağı: 3D" olan hatlarda), tava **doluluk %** (yeşil/sarı/kırmızı), **Boruları otomatik çiz** (chiller → pompa → CRAH soğuk su besleme/dönüş ve kondenser devreleri; debi, DN, hız, basınç kaybı). Pompa/chiller arızasında borular grileşir. PDF raporuna eklenir. **Yürüme modu:** **Y** (veya "🚶 Yürü") ile birinci şahıs yürüyün: ↑↓/WS ileri-geri, ←→/QE dönüş, A D yana, Shift koş, fareyle bak, Esc çık; ekipman engeldir. Sol palet ve sağ özellikler paneli **[** ve **]** tuşlarıyla (veya sekme çubuğundaki düğmelerle) gizlenip ekran genişletilebilir. Zeminde **Shift+sürükle** seçim kutusu, **Hizala** menüsü ve **Ctrl+D** kopyalama vardır; panoyu taşıyınca kesicileri onunla gelir. 3D sekmesinde ayrıca **Senaryo ve bakım** paneli (senaryo seç, seçili ekipmanı arızalı işaretle, **bakım analizi** ve "bakımı senaryoya uygula") ve alttaki **Canlı simülasyon** şeridi vardır: bakım senaryosu açıkken üstüne dinamik arıza uygulanabilir. **Şalterler (chiller, UPS bypass, giriş/çıkış kesicileri) bağlı oldukları panonun/MSB'nin ön yüzünde** modül olarak görünür ve panoyla birlikte taşınır/döner; ekipman modelleri ayrıntılıdır (trafo radyatör ve konservatörü, jeneratör kabini ve susturucusu, pano kapıları, chiller fanları, rack kabinleri...). Alttaki simülasyon şeridinin yüksekliği üst kenarından **sürüklenerek** ayarlanır veya **⤢ Ayrı sayfa** ile tam sayfa açılır. Ekipman boyutları tipik yer tutucudur; özellik panelindeki "Konum (3D)" bölümünden değiştirilir. **Performans:** 3D, tarayıcının WebGL'i üzerinden ekran kartını kullanır (Chrome/Edge'de donanım hızlandırma açık olmalı; araç çubuğundaki ? kartı kullanılan işlemciyi gösterir, "Yazılım render" uyarısı çıkarsa Ayarlar → Sistem → donanım hızlandırmayı açın ve Windows → Grafik ayarlarında tarayıcıya güçlü ekran kartını atayın). Yavaşsa **Göster → Kalite → Düşük** deneyin. **Katlı bina:** "Otomatik yerleşim" binayı iki katlı kurar — **zemin kat (gri): elektrik odası**, **1. kat (beyaz): veri salonu** (kot 4,5 m); **jeneratörler ve dış ekipman (chiller, kule) bina dışında**, doğudaki avluda. Batı cephedeki **merdivenden** yürüme modunda (Y) 1. kata çıkılır (korkuluk/döşeme kenarından düşülmez); araç çubuğundaki **Kat** seçicisi (Tümü / Zemin kat / 1. kat) diğer katı gizler. Katlar arası kablolar kat şaftından geçer ve uzunluğu yükseklik farkını içerir. Eski, elle yerleşmiş projeler olduğu gibi kalır; katlı düzen için "Otomatik yerleşim"i kullanın. **Kat planı (PDF):** 3D sekmesinde sol panelde **Kat planı → HDC02 zemin kat planını yükle** (veya kendi plan JSON'unuzu açın) duvarları, odaları ve etiketi eşleşen ekipmanı (MSB, UPS, UDP, STS, TX...) plandaki gerçek yerine ve boyutuna koyar; planda olmayan ekipman bölgesine yerleşir; yürürken duvarlar engeldir; ekipmanın üstünde adı, her odanın girişinde (duvarda) oda adı yazar. Kendi PDF'iniz için: `python3 scripts/pdf-plan.py plan.pdf cikti.plan.json --olcek 100 --odalar odalar.json` (pdfplumber gerekir); odaları duvarlara karşı denetlemek için `python3 scripts/plan-kontrol.py cikti.plan.json`. Şalterler (ACB/MCCB/ayırıcı) ve ölçü elemanları ayrıntılı modellenir (açma birimi ekranı, ON/OFF göstergesi, butonlar, kollar, kadranlar); açık kesici modelde de açık görünür.

## Ekipman kütüphanesi

Palet, işlevlerine göre gruplanır. Tüm yük tipleri ortak alanlara sahiptir (kurulu kW, PF, DF, kategori, gerilim, ısıyı bıraktığı yer, THD); varsayılanlar tipik değerlerdir, kendi ekipmanınızla değiştirin.

- **Soğutma ve mekanik:** Chiller, CRAH, CRAC (DX), Fan wall (EC fan duvarı), Sıra içi soğutucu (in-row), Arka kapı eşanjörü (RDHx), Kuru soğutucu, Soğutma kulesi, Pompa (soğuk su / kondenser / yangın / sirkülasyon), Klima santrali / taze hava (AHU), Havalandırma / egzoz fanı, Nemlendirici.
  Soğutma birimlerinde **Soğutma kapasitesi (termal kW)** alanı vardır. Etkin kapasite = min(chiller, hava tarafı [CRAH + fan wall + in-row + RDHx]) + doğrudan (CRAC). Chiller ile hava tarafı zincirlenir, toplanmaz.
- **Yükler ve yardımcılar:** IT yükü, Rack sırası, Ağ ve depolama, Güvenlik ve izleme, Yangın paneli, Asansör, Yük bankası, Ofis / NOC, Aydınlatma, Mekanik yük (genel), Genel yük.
- **Dağıtım:** Ana dağıtım panosu, Dağıtım panosu, Bara, ATS, STS, Senkron panosu, **RPP**, PDU, UPS dağıtım panosu; kesici ve ölçü elemanları.
- Yeni eklenen ekipman varsayılan olarak kısa adla gelir (ör. `Chiller 1`, `CRAH 2`).

## HDC02 PL1 şeması

`examples/hdc02-pl1.dcalc.json`: HDC02-ARP-SC-E-DD-ZZ-ZZ-POWR-6002 "LV Distribution Schematic Power Line-up 1" DXF'inden üretildi
(TX.PL1 3,15 MVA, GEN.PL1.1/.2, MSB.PL1 5000 A, UPS.PL1.1/.2/.3, UDP.PL1.1/.2/.3, 4 STS panosu, catcher, CRP.PL1.1, 33 ACB,
8 ayırıcı, MCCB'ler, CT/sayaç/parafudr; bara ve kablo adları hat üzerinde). Ekipman ve değerler şemadan, **yükler ve bazı
cihaz değerleri varsayımdır** (düğüm notlarında "Varsayım:"). Beş kayıtlı senaryo içerir (TX arızası, UPS arızası, bakım bypass...).
Yeniden üretmek için: `python3 scripts/build-hdc02-pl1.py`.

## Örnek proje

`examples/faz3-referans.dcalc.json` dosyasını **JSON yükle** ile açın: şebeke → trafo → MDB → UPS → IT,
yanında CRAH ve chiller. Beklenen sonuç: toplam 874,5 kW, PUE ≈ 1,749, salon ısısı 550 kW (156,4 TR).

`examples/faz4-2n-senaryolar.dcalc.json`: iki trafo, ATS ile yedek jeneratör, 2N UPS, açık bara kuplajı ve üç kayıtlı
senaryo. **Arıza** sekmesini açın: Trafo B arızasında IT yükü korunur, tekil chiller kaybedilir; kuplaj
kapatılırsa hiçbir yük kaybedilmez. Trafo A arızasında jeneratör A tarafını taşır (~%26); B→A kuplajı
kapatılırsa jeneratör yükte değildir.
