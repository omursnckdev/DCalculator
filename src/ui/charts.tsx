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

export interface TccCurve {
  name: string
  color: string
  points: [number, number][]
}

/** Zaman-akım (TCC) grafiği: iki eksen logaritmik; isteğe bağlı dikey işaretler (ör. kısa devre akımı). */
export function TccChart({ curves, marks = [], height = 300 }: { curves: TccCurve[]; marks?: { a: number; label: string; color?: string }[]; height?: number }) {
  const X0 = 100
  const X1 = 100000
  const Y0 = 0.01
  const Y1 = 1000
  const innerW = W - PAD.l - 16
  const innerH = height - PAD.t - PAD.b
  const lx = (a: number) => PAD.l + (Math.log10(Math.min(X1, Math.max(X0, a))) - Math.log10(X0)) / (Math.log10(X1) - Math.log10(X0)) * innerW
  const ly = (t: number) => PAD.t + innerH - (Math.log10(Math.min(Y1, Math.max(Y0, t))) - Math.log10(Y0)) / (Math.log10(Y1) - Math.log10(Y0)) * innerH
  const xt = [100, 1000, 10000, 100000]
  const yt = [0.01, 0.1, 1, 10, 100, 1000]
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Zaman-akım eğrileri">
      {yt.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - 16} y1={ly(t)} y2={ly(t)} stroke="#e2e8f0" />
          <text x={PAD.l - 6} y={ly(t) + 3} textAnchor="end" fontSize={10} fill="#64748b">
            {t >= 1 ? t : String(t).replace('.', ',')}
          </text>
        </g>
      ))}
      {xt.map((a) => (
        <g key={a}>
          <line x1={lx(a)} x2={lx(a)} y1={PAD.t} y2={PAD.t + innerH} stroke="#e2e8f0" />
          <text x={lx(a)} y={height - PAD.b + 14} textAnchor="middle" fontSize={10} fill="#64748b">
            {a >= 1000 ? `${a / 1000} kA` : `${a} A`}
          </text>
        </g>
      ))}
      <text x={4} y={10} fontSize={10} fill="#64748b">
        sn
      </text>
      {marks.map((m) => (
        <g key={m.label}>
          <line x1={lx(m.a)} x2={lx(m.a)} y1={PAD.t} y2={PAD.t + innerH} stroke={m.color ?? '#475569'} strokeDasharray="4 3" />
          <text x={lx(m.a) - 4} y={PAD.t + 10} textAnchor="end" fontSize={10} fill={m.color ?? '#475569'}>
            {m.label}
          </text>
        </g>
      ))}
      {curves.map((c) => (
        <path
          key={c.name}
          d={c.points.map(([a, t], i) => `${i === 0 ? 'M' : 'L'}${lx(a)},${ly(t)}`).join(' ')}
          fill="none"
          stroke={c.color}
          strokeWidth={2}
        />
      ))}
    </svg>
  )
}
