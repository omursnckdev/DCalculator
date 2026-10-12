import { fmtNum } from './status'

export interface Series {
  name: string
  color: string
  values: (number | null)[]
  /** 'bar' çubuk, varsayılan çizgi. */
  kind?: 'line' | 'bar'
  dashed?: boolean
  /** 'right': sağ eksen (ayrı ölçek). */
  axis?: 'left' | 'right'
  /** Noktaları işaretle (kesikli adım grafikleri için). */
  dots?: boolean
}

const W = 640
const PAD = { l: 52, r: 52, t: 12, b: 34 }

function niceMax(v: number): number {
  if (v <= 0) return 1
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / e
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return n * e
}

/** Bağımlılıksız SVG çizgi/çubuk grafik: çok seriler, iki eksen, kategorik x. */
export function Chart({
  labels,
  series,
  height = 220,
  unit,
  rightUnit,
  xTitle,
}: {
  labels: string[]
  series: Series[]
  height?: number
  unit?: string
  rightUnit?: string
  xTitle?: string
}) {
  const n = labels.length
  const innerW = W - PAD.l - PAD.r
  const innerH = height - PAD.t - PAD.b
  const maxOf = (axis: 'left' | 'right') =>
    niceMax(Math.max(0, ...series.filter((s) => (s.axis ?? 'left') === axis).flatMap((s) => s.values.filter((v): v is number => v !== null))))
  const maxL = maxOf('left')
  const maxR = maxOf('right')
  const hasRight = series.some((s) => s.axis === 'right')
  const bars = series.filter((s) => s.kind === 'bar')
  const slot = n > 0 ? innerW / n : innerW
  const xAt = (i: number) => PAD.l + slot * (i + 0.5)
  const yAt = (v: number, axis: 'left' | 'right') => PAD.t + innerH - (v / (axis === 'right' ? maxR : maxL)) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const labelEvery = Math.max(1, Math.ceil(n / 12))

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={series.map((s) => s.name).join(', ')}>
      {ticks.map((t) => {
        const y = PAD.t + innerH - t * innerH
        return (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#64748b">
              {fmtNum(maxL * t, maxL < 5 ? 2 : 0)}
            </text>
            {hasRight && (
              <text x={W - PAD.r + 6} y={y + 3} fontSize={10} fill="#64748b">
                {fmtNum(maxR * t, maxR < 5 ? 2 : 0)}
              </text>
            )}
          </g>
        )
      })}
      {unit && (
        <text x={4} y={10} fontSize={10} fill="#64748b">
          {unit}
        </text>
      )}
      {hasRight && rightUnit && (
        <text x={W - 4} y={10} fontSize={10} textAnchor="end" fill="#64748b">
          {rightUnit}
        </text>
      )}
      {labels.map((l, i) =>
        i % labelEvery === 0 ? (
          <text key={i} x={xAt(i)} y={height - PAD.b + 14} textAnchor="middle" fontSize={10} fill="#64748b">
            {l}
          </text>
        ) : null,
      )}
      {xTitle && (
        <text x={W / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="#94a3b8">
          {xTitle}
        </text>
      )}
      {series.map((s, si) => {
        const axis = s.axis ?? 'left'
        if (s.kind === 'bar') {
          const bi = bars.indexOf(s)
          const bw = Math.max(2, (slot * 0.7) / bars.length)
          return (
            <g key={si} fill={s.color}>
              {s.values.map((v, i) =>
                v === null ? null : (
                  <rect key={i} x={xAt(i) - (bw * bars.length) / 2 + bi * bw} y={yAt(v, axis)} width={bw} height={Math.max(0, PAD.t + innerH - yAt(v, axis))} opacity={0.85}>
                    <title>{`${labels[i]}: ${fmtNum(v, 2)}`}</title>
                  </rect>
                ),
              )}
            </g>
          )
        }
        const pts = s.values.map((v, i) => (v === null ? null : `${xAt(i)},${yAt(v, axis)}`))
        // Boşlukları ayırarak yol çiz.
        let d = ''
        let pen = false
        pts.forEach((p) => {
          if (p === null) pen = false
          else {
            d += `${pen ? 'L' : 'M'}${p} `
            pen = true
          }
        })
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 3' : undefined} />
            {(s.dots || n <= 14) &&
              s.values.map((v, i) =>
                v === null ? null : (
                  <circle key={i} cx={xAt(i)} cy={yAt(v, axis)} r={3} fill={s.color}>
                    <title>{`${s.name} — ${labels[i]}: ${fmtNum(v, 2)}`}</title>
                  </circle>
                ),
              )}
          </g>
        )
      })}
    </svg>
  )
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
      {series.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />
          {s.name}
          {s.axis === 'right' ? ' (sağ eksen)' : ''}
        </span>
      ))}
    </div>
  )
}
