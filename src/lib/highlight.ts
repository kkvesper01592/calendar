// 検索のキーワードに色を付けるための共通処理。
// 検索は「全角/半角・大文字/小文字・数字のカンマ区切り」の違いを無視して比べるので、
// 色を付ける位置も同じ比べ方で探し、元の文字列の位置に戻す。

/** 1文字ずつの正規化(全角→半角、大文字→小文字) */
const normChar = (c: string) => c.normalize('NFKC').toLowerCase()

/** 比べるための正規化(検索と同じ) */
export function normalizeText(s: string | undefined): string {
  return (s ?? '').normalize('NFKC').toLowerCase().replace(/(\d),(?=\d{3})/g, '$1')
}

/** 検索語をスペースで区切って正規化した一覧 */
export function searchWords(query: string): string[] {
  return normalizeText(query).split(/\s+/).filter(Boolean)
}

/**
 * text の中で words のどれかに一致する部分の範囲 [開始, 終了)(元の文字列の位置)。
 * 重なる範囲はまとめる
 */
export function matchRanges(text: string, words: string[]): [number, number][] {
  if (!text || !words.length) return []
  // 正規化した文字列と、その各文字が元の文字列のどこから来たか(開始・終了)
  let norm = ''
  const from: number[] = []
  const to: number[] = []
  const chars = Array.from(text)
  let pos = 0
  for (let i = 0; i < chars.length; i++) {
    let c = chars[i]
    // 半角カナの濁点・半濁点(ｶﾞ ﾊﾟ)は前の文字と一緒に正規化する(ｶﾞ → ガ)
    if (chars[i + 1] === 'ﾞ' || chars[i + 1] === 'ﾟ') c += chars[++i]
    // 数字にはさまれた3桁区切りのカンマは無視(検索と同じ)
    const isDigitComma =
      normChar(c) === ',' && /\d$/.test(normChar(chars[i - 1] ?? '')) && /^\d{3}/.test(normChar(chars.slice(i + 1, i + 4).join('')))
    if (!isDigitComma) {
      const n = normChar(c)
      for (let k = 0; k < n.length; k++) {
        from.push(pos)
        to.push(pos + c.length)
      }
      norm += n
    }
    pos += c.length
  }

  const ranges: [number, number][] = []
  for (const w of words) {
    let at = norm.indexOf(w)
    while (at >= 0) {
      // 終わりの位置: 一致した最後の文字が、元の文字列で占める範囲の終わり
      ranges.push([from[at], to[at + w.length - 1]])
      at = norm.indexOf(w, at + Math.max(1, w.length))
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

/** 文字列を「一致した部分」と「それ以外」に分ける */
export function splitByMatches(text: string, words: string[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  let last = 0
  for (const [s, e] of matchRanges(text, words)) {
    if (s > last) out.push({ text: text.slice(last, s), hit: false })
    out.push({ text: text.slice(s, e), hit: true })
    last = e
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out
}

/** 説明欄の HTML から文字だけを取り出す(<br> は改行に。スクリプトは実行されない) */
export function plainText(html: string): string {
  if (!/[<&]/.test(html)) return html
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html')
  return doc.body.textContent ?? ''
}

/** 1行でもキーワードのどれかを含むか */
export const lineHits = (line: string, words: string[]) => {
  const n = normalizeText(line)
  return words.some((w) => n.includes(w))
}
