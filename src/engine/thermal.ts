/** 1 TR (ton of refrigeration) ≈ 3,517 kW (plan §5). */
export const KW_PER_TR = 3.517

export const kwToTr = (kw: number): number => kw / KW_PER_TR
