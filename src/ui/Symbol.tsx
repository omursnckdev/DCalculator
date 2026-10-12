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
    case 'rpp':
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
    case 'chiller':
      body = (
        <>
          <rect {...common} x="3" y="6" width="18" height="12" rx="1.5" />
          <path {...common} d="M12 8.5v7M9 10l6 4M9 14l6-4" />
        </>
      )
      break
    case 'crah':
      body = (
        <>
          <rect {...common} x="3" y="5" width="18" height="14" rx="1" />
          <circle {...common} cx="9" cy="12" r="3" />
          <path {...common} d="M15 8v8M18 8v8" />
        </>
      )
      break
    case 'crac':
      body = (
        <>
          <rect {...common} x="3" y="5" width="18" height="14" rx="1" />
          <path {...common} d="M8 8.5v7M5.5 10l5 4M5.5 14l5-4" />
          <circle {...common} cx="16.5" cy="12" r="2.5" />
        </>
      )
      break
    case 'fanwall':
      body = (
        <>
          <rect {...common} x="3" y="4" width="18" height="16" rx="1" />
          <circle {...common} cx="8.5" cy="9" r="2.6" />
          <circle {...common} cx="15.5" cy="9" r="2.6" />
          <circle {...common} cx="8.5" cy="15.5" r="2.6" />
          <circle {...common} cx="15.5" cy="15.5" r="2.6" />
        </>
      )
      break
    case 'inrow':
      body = (
        <>
          <rect {...common} x="7" y="3" width="10" height="18" rx="1" />
          <circle {...common} cx="12" cy="8.5" r="2.4" />
          <path {...common} d="M9.5 14h5M9.5 17h5" />
        </>
      )
      break
    case 'rdhx':
      body = (
        <>
          <rect {...common} x="6" y="3" width="12" height="18" rx="1" />
          <path {...common} d="M10 7c-1 3-1 7 0 10M14 7c-1 3-1 7 0 10" />
        </>
      )
      break
    case 'kuruSogutucu':
      body = (
        <>
          <circle {...common} cx="12" cy="9" r="5" />
          <path {...common} d="M12 9V5M12 9l3.5 2M12 9l-3.5 2M4 20h16M6 17v3M10 17v3M14 17v3M18 17v3" />
        </>
      )
      break
    case 'sogutmaKulesi':
      body = (
        <>
          <path {...common} d="M7 4h10l2 16H5z" />
          <path {...common} d="M8 10c1.5-1.5 2.5 1.5 4 0s2.5 1.5 4 0M7.5 15c1.5-1.5 2.5 1.5 4 0s2.5 1.5 4 0" />
        </>
      )
      break
    case 'pompa':
      body = (
        <>
          <circle {...common} cx="12" cy="12" r="7" />
          <path {...common} d="M9.5 8.5l6.5 3.5-6.5 3.5z" />
        </>
      )
      break
    case 'ahu':
      body = (
        <>
          <rect {...common} x="2.5" y="7" width="19" height="10" rx="1" />
          <path {...common} d="M5 12h5M8 10l2 2-2 2" />
          <circle {...common} cx="16" cy="12" r="2.5" />
        </>
      )
      break
    case 'fan':
      body = (
        <>
          <circle {...common} cx="12" cy="12" r="8" />
          <path {...common} d="M12 12V5.5M12 12l5.6 3.2M12 12l-5.6 3.2" />
        </>
      )
      break
    case 'nemlendirici':
      body = <path {...common} d="M12 4c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z" />
      break
    case 'rack':
      body = (
        <>
          <rect {...common} x="6" y="3" width="12" height="18" rx="1" />
          <path {...common} d="M8.5 7h7M8.5 11h7M8.5 15h7" />
          <circle {...common} cx="15" cy="18.2" r="0.4" />
        </>
      )
      break
    case 'depolama':
      body = (
        <>
          <path {...common} d="M5 7c0-1.7 3-3 7-3s7 1.3 7 3-3 3-7 3-7-1.3-7-3zM5 7v10c0 1.7 3 3 7 3s7-1.3 7-3V7M5 12c0 1.7 3 3 7 3s7-1.3 7-3" />
        </>
      )
      break
    case 'guvenlik':
      body = (
        <>
          <path {...common} d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
          <path {...common} d="M9 12l2.2 2.2L15.5 10" />
        </>
      )
      break
    case 'yangin':
      body = <path {...common} d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />
      break
    case 'asansor':
      body = (
        <>
          <rect {...common} x="6" y="3" width="12" height="18" rx="1" />
          <path {...common} d="M12 7l-3 3h6zM12 17l-3-3h6z" />
        </>
      )
      break
    case 'yukBankasi':
      body = <path {...common} d="M3 12h4l2-5 3 10 3-10 2 5h4" />
      break
    case 'ofis':
      body = (
        <>
          <rect {...common} x="4" y="5" width="16" height="10" rx="1" />
          <path {...common} d="M9 19h6M12 15v4" />
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
