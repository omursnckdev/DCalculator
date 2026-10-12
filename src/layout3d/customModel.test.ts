import { describe, expect, it } from 'vitest'
import { fitScale, modelSearchUrl, modelSpecOf, nativeBox } from './customModel'

describe('özel model', () => {
  it('parametrelerden okunur; geçersiz değerler varsayılana düşer', () => {
    expect(modelSpecOf({})).toBeUndefined()
    expect(modelSpecOf({ model3d: 'm_abc' })).toEqual({ id: 'm_abc', fit: 'gerdir', rot: 0 })
    expect(modelSpecOf({ model3d: 'm_abc', model3dSigdir: 'oran', model3dDonus: 90 })).toEqual({ id: 'm_abc', fit: 'oran', rot: 90 })
    expect(modelSpecOf({ model3d: 'm_abc', model3dDonus: 45 })!.rot).toBe(0)
  })
  it('gerdir: eksen başına ölçek; döndürülünce x/z yer değiştirir', () => {
    expect(fitScale({ x: 1, y: 2, z: 0.5 }, { g: 2, d: 1, h: 2 }, 'gerdir', 0)).toEqual([2, 1, 2])
    expect(fitScale({ x: 1, y: 2, z: 0.5 }, { g: 2, d: 1, h: 2 }, 'gerdir', 90)).toEqual([1, 1, 4])
  })
  it('oran: tek tip ölçek, kutuya sığar', () => {
    const s = fitScale({ x: 2, y: 1, z: 1 }, { g: 1, d: 1, h: 5 }, 'oran', 0)
    expect(s).toEqual([0.5, 0.5, 0.5])
  })
  it('sıfır boyutlu model sonsuz ölçek üretmez', () => {
    for (const v of fitScale({ x: 0, y: 0, z: 0 }, { g: 1, d: 1, h: 1 }, 'gerdir', 0)) expect(Number.isFinite(v)).toBe(true)
  })
  it('gerçek boyut: döndürmede en/derinlik yer değiştirir', () => {
    expect(nativeBox({ x: 2.4, y: 2.2, z: 0.9 }, 0)).toEqual({ g: 2.4, d: 0.9, y: 2.2 })
    expect(nativeBox({ x: 2.4, y: 2.2, z: 0.9 }, 90)).toEqual({ g: 0.9, d: 2.4, y: 2.2 })
  })
  it('arama bağlantısı türe göre', () => {
    expect(modelSearchUrl('trafo')).toContain('dry%20type%20transformer')
    expect(modelSearchUrl('bilinmeyen')).toContain('bilinmeyen')
  })
})
