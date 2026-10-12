import { describe, expect, it } from 'vitest'
import { detectGpu } from './gpu'

describe('GPU tespiti', () => {
  it('WebGL olmayan ortamda (test) null döner, hata fırlatmaz', () => {
    expect(detectGpu()).toBeNull()
  })
})
