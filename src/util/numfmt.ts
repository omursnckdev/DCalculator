/**
 * tr-TR sayı biçimi (en çok `d` ondalık). `Number.prototype.toLocaleString` her çağrıda yeni bir Intl.NumberFormat kurar ve
 * yüzlerce düğümlü şemada saniyeler tutar; biçimleyici ondalık sayısına göre bir kez kurulup önbelleğe alınır.
 */
const cache = new Map<number, Intl.NumberFormat>()

export function fmtLocale(v: number, d = 1): string {
  let f = cache.get(d)
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: d })
    cache.set(d, f)
  }
  return f.format(v)
}
