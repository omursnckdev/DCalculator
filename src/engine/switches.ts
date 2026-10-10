import { EQUIPMENT } from '../library/equipment'
import type { ProjectNode, Scenario } from '../model/types'

/** Kesici/ayırıcı düğümün etkin (kullanıcı/senaryo) durumu; diğer ekipman her zaman 'kapali'. */
export function switchState(n: ProjectNode, scenario?: Scenario): 'acik' | 'kapali' {
  if (n.type !== 'kesici') return 'kapali'
  const v = scenario?.nodeStates?.[n.id] ?? n.params.durum ?? EQUIPMENT.kesici.defaults.durum
  return v === 'acik' ? 'acik' : 'kapali'
}

/**
 * Otomatik kapanma yetkisi: kesici "otomatik" işaretliyse ve durumu senaryoda elle geçersiz
 * kılınmadıysa (elle konum = kilitli), yedek yol enerjisiz kalan baraya kapanabilir.
 */
export function isAutoClosing(n: ProjectNode, scenario?: Scenario): boolean {
  if (n.type !== 'kesici') return false
  if (scenario?.nodeStates?.[n.id] !== undefined) return false
  const v = n.params.otomatik ?? EQUIPMENT.kesici.defaults.otomatik
  return v === 'otomatik'
}
