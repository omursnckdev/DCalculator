# DCalculator

Veri merkezi güç zinciri ve ısıl yük ön tasarım aracı. Tarayıcıda çalışan, sunucusuz
bir web uygulamasıdır. Kapsam, mimari ve yol haritası için bkz. [docs/PLAN.md](docs/PLAN.md).

> Sonuçlar ön tasarım tahminidir; nihai mühendislik çalışmasının yerini tutmaz.

## Durum

**Faz 1 (iskelet) tamamlandı:** sürükle-bırak şema çizimi, ekipman paleti, kablo/busbar
hatları, özellik paneli, IndexedDB'ye otomatik kayıt, JSON kaydet/yükle.
Yük ve ısıl hesaplar Faz 2-3'te `src/engine` altına eklenecek.

## Çalıştırma

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # birim testleri (vitest)
npm run typecheck
npm run build
```

## Yapı

| Klasör | İçerik |
|---|---|
| `src/model` | Tipler, JSON şeması, `schemaVersion` ve `migrate` |
| `src/library` | Ekipman kütüphanesi (varsayılan değerler, alan tanımları) |
| `src/store` | Zustand durumu, IndexedDB kalıcılığı |
| `src/ui` | Canvas, palet, özellik paneli, araç çubuğu |
| `src/i18n` | Arayüz metinleri (Türkçe) |
| `src/engine` | Hesap motoru (Faz 2'den itibaren; React'tan bağımsız, testli) |
| `src/export` | Excel / PNG çıktıları (Faz 3) |

## Kullanım

- Soldaki paletten ekipmanı sürükleyip tuvale bırakın (veya tıklayın).
- Bir ekipmanın alt noktasından diğerinin üst noktasına sürükleyerek hat çizin.
- Ekipman veya hattı seçince sağ panelden değerlerini düzenleyin; `Delete` ile silin.
- Değişiklikler 1 sn içinde tarayıcıya (IndexedDB) otomatik kaydedilir. "JSON indir / yükle" ile dosya paylaşılır.
