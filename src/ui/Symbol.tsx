import type { EquipmentType } from '../model/types'

/** Sadeleştirilmiş IEC tek hat sembolleri (24×24 görünüm kutusu). */
export function Symbol({ type, color, size = 28 }: { type: EquipmentType; color: string; size?: number }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const }
  let body: React.ReactNode
  switch (type) {
    case 'sebeke':
      body = (
        <>
          <path {...common} d="M12 3v7M8 10l4 4 4-4M12 14v7M7 21h10" />
        </>
      )
      break
    case 'trafo':
      body = (
        <>
          <circle {...common} cx="9" cy="12" r="5" />
          <circle {...common} cx="15" cy="12" r="5" />
        </>
      )
      break
    case 'jenerator':
      body = (
        <>
          <circle {...common} cx="12" cy="12" r="8" />
          <path {...common} d="M8.5 12q1.75-4 3.5 0t3.5 0" />
        </>
      )
      break
    case 'mdb':
    case 'dagitimPanosu':
    case 'upsPanosu':
      body = (
        <>
          <rect {...common} x="3" y="5" width="18" height="14" rx="1" />
          <path {...common} d="M6 12h12M9 5v14M15 5v14" />
        </>
      )
      break
    case 'ats':
    case 'sts':
      body = (
        <>
          <rect {...common} x="3" y="5" width="18" height="14" rx="1" />
          <path {...common} d="M7 17V12M17 17V12M7 12L12 8M17 12L12 8M12 8V6" />
        </>
      )
      break
    case 'senkron':
      body = (
        <>
          <path {...common} d="M3 12h18M7 12V7M17 12V7" />
          <circle {...common} cx="7" cy="5" r="2.2" />
          <circle {...common} cx="17" cy="5" r="2.2" />
          <path {...common} d="M12 12v6M9 21l3-3 3 3" />
        </>
      )
      break
    case 'kesici':
      body = (
        <>
          <path {...common} d="M12 3v5M12 16v5" />
          <path {...common} d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
          <path {...common} d="M9.5 6l2.5-2.5L14.5 6M9.5 18l2.5 2.5 2.5-2.5" />
        </>
      )
      break
    case 'yardimci':
      body = (
        <>
          <circle {...common} cx="12" cy="12" r="7" />
          <path {...common} d="M12 5V3M9 12a3 3 0 0 1 6 0M9 12a3 3 0 0 0 6 0" />
        </>
      )
      break
    case 'bara':
      body = <path {...common} strokeWidth={3.2} d="M3 12h18" />
      break
    case 'ups':
      body = (
        <>
          <rect {...common} x="3" y="5" width="18" height="14" rx="1" />
          <path {...common} d="M3 19L21 5M6 8h4M14 16h4" />
        </>
      )
      break
    case 'pdu':
      body = (
        <>
          <rect {...common} x="3" y="5" width="18" height="14" rx="1" />
          <path {...common} d="M8 9v6M12 9v6M16 9v6" />
        </>
      )
      break
    case 'itYuku':
      body = (
        <>
          <rect {...common} x="5" y="3" width="14" height="18" rx="1" />
          <path {...common} d="M8 8h8M8 12h8M8 16h8" />
        </>
      )
      break
    case 'mekanikYuk':
      body = (
        <>
          <circle {...common} cx="12" cy="12" r="8" />
          <path {...common} d="M8.5 15.5v-7l3.5 4 3.5-4v7" />
        </>
      )
      break
    case 'aydinlatma':
      body = (
        <>
          <circle {...common} cx="12" cy="12" r="8" />
          <path {...common} d="M7 7l10 10M17 7L7 17" />
        </>
      )
      break
    default:
      body = (
        <>
          <rect {...common} x="4" y="6" width="16" height="12" rx="1" />
          <path {...common} d="M4 18L20 6" />
        </>
      )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {body}
    </svg>
  )
}
