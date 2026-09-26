// Google マップのリンク。予定に登録できるのは Google マップのアドレスだけ(不審なリンクを開かないため)

const MAP_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'www.google.com', 'google.com', 'www.google.co.jp', 'google.co.jp', 'maps.google.co.jp']

export function isMapUrl(s: string): boolean {
  try {
    const u = new URL(s.trim())
    if (u.protocol !== 'https:' || !MAP_HOSTS.includes(u.hostname)) return false
    // google.com などは /maps の下だけ。goo.gl は /maps の短縮リンクだけ
    if (u.hostname === 'maps.app.goo.gl' || u.hostname.startsWith('maps.google')) return true
    if (u.hostname === 'goo.gl') return u.pathname.startsWith('/maps')
    return u.pathname.startsWith('/maps')
  } catch {
    return false
  }
}

/** 住所・場所名で Google マップを検索する URL(空なら地図のトップ) */
export const mapSearchUrl = (query: string) =>
  query.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}` : 'https://www.google.com/maps'

// 地図の URL の一部を読める文字に(+ は空白、先頭の「日本、」は省く)
function readableSegment(seg: string): string {
  let t = seg
  try {
    t = decodeURIComponent(seg.replace(/\+/g, ' '))
  } catch {
    t = seg.replace(/\+/g, ' ')
  }
  return t
    .replace(/^日本[、,]\s*/, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 長い地図 URL(/maps/place/名前/@…、/maps/search/検索語/)から場所の名前・住所を取り出す */
export function placeFromMapUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    const m = /\/maps\/(?:place|search)\/([^/@]+)/.exec(u.pathname)
    if (m) return readableSegment(m[1]) || undefined
    const q = u.searchParams.get('query') ?? u.searchParams.get('q')
    return q ? readableSegment(q) : undefined
  } catch {
    return undefined
  }
}

export interface PastedPlace {
  url?: string // Google マップのリンク(あれば)
  place?: string // 場所の名前・住所(取り出せたとき)
}

/**
 * 貼り付けた内容を振り分ける。次のどれにも対応:
 *  - スマホの「共有」の文章(店名・住所・リンクが改行で並ぶ)
 *  - PC のアドレス欄の長い URL(場所の名前・住所が入っている)
 *  - 短いリンク(maps.app.goo.gl。住所は入っていない)
 *  - 住所だけの文字
 */
export function parsePastedPlace(text: string): PastedPlace {
  const t = text.trim()
  const url = t.match(/https:\/\/\S+/)?.[0]
  // リンク以外の部分(共有の文章の店名・住所)
  const rest = (url ? t.replace(url, '\n') : t)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
  const mapUrl = url && isMapUrl(url) ? url : undefined
  if (url && !mapUrl) return {} // Google マップ以外のリンクは何も取り込まない
  const place = rest || (mapUrl ? placeFromMapUrl(mapUrl) : undefined)
  return { url: mapUrl, place: place || undefined }
}

/** 予定の地図リンク(アプリ独自の項目。Google の予定の非公開プロパティに保存) */
export function eventMapUrl(ev: { extendedProperties?: { private?: Record<string, string> } }): string | undefined {
  const u = ev.extendedProperties?.private?.mapUrl
  return u && isMapUrl(u) ? u : undefined
}
