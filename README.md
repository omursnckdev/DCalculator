# DCalculator

Veri merkezi güç zinciri ve ısıl yük ön tasarım aracı. Tarayıcıda çalışan, sunucusuz
bir web uygulamasıdır. Kapsam, mimari ve yol haritası için bkz. [docs/PLAN.md](docs/PLAN.md).

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
- Faz 5: PDF rapor, şablon topolojiler, gruplama, undo/redo.

## Çalıştırma

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # birim testleri (vitest)
npm run typecheck
npm run build
```

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
