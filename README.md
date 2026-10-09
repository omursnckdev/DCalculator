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
- Hat etiketindeki yuvarlak düğme anahtarı açar/kapar (senaryo açıksa yalnız o senaryoda).

## Örnek proje

`examples/faz3-referans.dcalc.json` dosyasını **JSON yükle** ile açın: şebeke → trafo → MDB → UPS → IT,
yanında CRAH ve chiller. Beklenen sonuç: toplam 874,5 kW, PUE ≈ 1,749, salon ısısı 550 kW (156,4 TR).

`examples/faz4-2n-senaryolar.dcalc.json`: iki trafo, ATS ile yedek jeneratör, 2N UPS, açık bara kuplajı ve üç kayıtlı
senaryo. **Arıza** sekmesini açın: Trafo B arızasında IT yükü korunur, tekil chiller kaybedilir; kuplaj
kapatılırsa hiçbir yük kaybedilmez. Trafo A arızasında jeneratör A tarafını taşır (~%26); B→A kuplajı
kapatılırsa jeneratör yükte değildir.
