import { describe, expect, it } from 'vitest'
import type { Oda3D } from '../model/types'
import { MIN_ROOM, newRoomAt, resizeRoom, roomStep } from './roomEdit'

const room: Oda3D = { id: 'a', ad: 'Oda', tur: 'salon', x: 10, z: 20, g: 20, d: 10, y: 3.5 }

describe('oda düzenleme', () => {
  it('yeni oda bırakılan noktayı merkez alır, 0,5 m ızgaraya oturur, adı benzersizdir', () => {
    const r = newRoomAt([], 'elektrik', 30.3, 40.1, 0.1)
    expect(r).toMatchObject({ tur: 'elektrik', g: 12, d: 8, ad: 'Elektrik odası 1' })
    expect(r.x).toBeCloseTo(24.5, 5)
    expect(r.z).toBeCloseTo(36, 5)
    const r2 = newRoomAt([{ ...room, tur: 'elektrik', ad: 'Elektrik odası 1', id: 'x' }], 'elektrik', 0, 0, 1)
    expect(r2.ad).toBe('Elektrik odası 2')
    expect(newRoomAt([], 'salon', 0, 0, 0.5, true).elev).toBe(4.5)
    expect(newRoomAt([], 'salon', 0, 0, 0.5).elev).toBeUndefined()
  })
  it('izgara adımı: ince adım 0,5 m\'ye yükselir, kaba adım korunur', () => {
    expect(roomStep(0)).toBe(0.5)
    expect(roomStep(0.1)).toBe(0.5)
    expect(roomStep(1)).toBe(1)
  })
  it('kenar tutamacı yalnız o kenarı oynatır, karşı kenar sabit', () => {
    expect(resizeRoom(room, 'e', 5.2, 9, 0.5)).toEqual({ x: 10, z: 20, g: 25, d: 10 })
    expect(resizeRoom(room, 'w', -4, 0, 0.5)).toEqual({ x: 6, z: 20, g: 24, d: 10 })
    expect(resizeRoom(room, 'n', 0, -3, 0.5)).toEqual({ x: 10, z: 17, g: 20, d: 13 })
    expect(resizeRoom(room, 's', 0, 2, 0.5)).toEqual({ x: 10, z: 20, g: 20, d: 12 })
  })
  it('köşe iki kenarı birlikte oynatır; ters yönde sürüklemede en küçük boyut korunur', () => {
    expect(resizeRoom(room, 'se', 3, 4, 0.5)).toEqual({ x: 10, z: 20, g: 23, d: 14 })
    expect(resizeRoom(room, 'nw', -2, -2, 0.5)).toEqual({ x: 8, z: 18, g: 22, d: 12 })
    const small = resizeRoom(room, 'e', -100, 0, 0.5)
    expect(small.g).toBe(MIN_ROOM)
    expect(small.x).toBe(10)
    const flip = resizeRoom(room, 'w', 100, 0, 0.5)
    expect(flip.g).toBe(MIN_ROOM)
    expect(flip.x + flip.g).toBe(30)
  })
  it('taşıma boyutu korur ve ızgaraya oturur', () => {
    expect(resizeRoom(room, 'move', 2.3, -1.1, 0.5)).toEqual({ x: 12.5, z: 19, g: 20, d: 10 })
  })
})
