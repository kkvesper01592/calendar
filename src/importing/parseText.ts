// 仕事メモのテキストファイル(1ファイル=1日)を、取り込む予定の一覧にする。
// 形式:
//   --------------------      ← 区切り線
//   住所:…  名前:…  電話:…   ← 見出し
//   --------------------
//   メモの文章…               ← 次の区切り線まで
// 区切り線の組が無いファイル(メモだけの日)は、その日の終日予定1件にする。

export interface ImportItem {
  key: string // 二重登録を防ぐための識別子(ファイル名#何件目)
  file: string // ファイルのパス(表示用)
  date: string // YYYY-MM-DD
  index: number // その日の何件目(1始まり)
  allDay: boolean // メモだけの日
  title: string
  location: string
  description: string // ブロックの内容すべて
  startMinutes: number // 開始時刻(0時からの分)。終日なら 0
  timeSource: 'text' | 'auto' | 'allDay' // text=ファイルに書かれた時刻 auto=30分刻みで自動
  timeText?: string // 時刻として読み取った文字
  warnings: string[]
}

export interface ParseOptions {
  startMinutes: number // 自動で並べるときの最初の時刻(例 9:00 = 540)
  stepMinutes: number // 間隔(30)
}

const SEPARATOR = /^\s*[-ー―─━=＝]{5,}\s*$/

/** 取り込まない見出し(多くの日に同じ内容が重複して書かれているため) */
export const SKIPPED_HEADINGS = ['【今後の予定】']
/** 以前の取り込みでこの見出しから作られた予定のタイトル(削除の対象を探すのに使う) */
export const SKIPPED_TITLES = SKIPPED_HEADINGS.map((h) => `メモ: ${h}`)
const DATE_IN_NAME = /(\d{4})年(\d{1,2})月(\d{1,2})日/

/** ファイル名から日付(YYYY-MM-DD)。日付でないファイル(残高・フォーマット等)は null */
export function dateFromFileName(name: string): string | null {
  const m = DATE_IN_NAME.exec(name)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 「住所:…」のような行の値(全角・半角のコロン、前後の空白を許す) */
function field(lines: string[], label: string): string {
  const re = new RegExp(`^\\s*${label}\\s*[:：]\\s*(.*)$`)
  for (const l of lines) {
    const m = re.exec(l)
    if (m) return m[1].trim()
  }
  return ''
}

/**
 * 文章中の最初の時刻を読み取る。例: AM8 / AM 8:30 / PM3 / 午前8時 / 午後3時半 / 10:30 / 14時 / 9時15分
 * 「3時間」「24時間」のような長さは時刻として扱わない
 */
export function findTime(text: string): { minutes: number; text: string } | null {
  const t = text.normalize('NFKC')
  const candidates: { at: number; minutes: number; text: string }[] = []
  const push = (at: number, h: number, m: number, raw: string) => {
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) candidates.push({ at, minutes: h * 60 + m, text: raw })
  }
  // AM/PM・午前/午後
  for (const m of t.matchAll(/(AM|PM|am|pm|午前|午後)\s*(\d{1,2})(?:\s*[:時]\s*(\d{1,2}|半)?)?/g)) {
    let h = Number(m[2])
    const min = m[3] === '半' ? 30 : Number(m[3] ?? 0)
    if (/PM|pm|午後/.test(m[1]) && h < 12) h += 12
    if (/AM|am|午前/.test(m[1]) && h === 12) h = 0
    push(m.index!, h, min, m[0])
  }
  // 10:30
  for (const m of t.matchAll(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g)) push(m.index!, Number(m[1]), Number(m[2]), m[0])
  // 14時 / 9時15分 / 8時半 (「時間」は除く)
  for (const m of t.matchAll(/(?<![\d])(\d{1,2})時(?!間)(?:(\d{1,2})分|(半))?/g)) {
    push(m.index!, Number(m[1]), m[3] ? 30 : Number(m[2] ?? 0), m[0])
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => a.at - b.at)
  return { minutes: candidates[0].minutes, text: candidates[0].text }
}


/** 行の中に、ファイルの日付と違う日付(例 4/3、6月21日)が書かれているか */
function mentionsOtherDate(line: string, month: number, day: number): boolean {
  for (const m of line.normalize('NFKC').matchAll(/(?<![\d])(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})(?![\d])/g)) {
    const mm = Number(m[1])
    const dd = Number(m[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && (mm !== month || dd !== day)) return true
  }
  return false
}

// 住所らしき部分(都道府県で始まる、または 〇〇市/郡 のあとに番地の数字がある)
const ADDRESS = /((?:北海道|東京都|京都府|大阪府|[^\s\d（(【「：:、,]{2,3}県)[^\s）)」】、,]*|[^\s（(【「：:、,]{1,4}[市郡][^\s）)」】、,]*\d[^\s）)」】、,]*)/

/** 「やまこ館：（住所：長野県…）」「長野県大町市…」のような1行を、名前と住所に分ける。住所が無ければ null */
export function splitPlace(line: string): { title: string; address: string } | null {
  const m = ADDRESS.exec(line)
  if (!m) return null
  const address = m[1].trim()
  const title = line
    .slice(0, m.index)
    .replace(/[\s：:（(]*(?:住所)?[\s：:（(]*$/, '') // 「：（住所：」のような名前の後ろの記号を除く
    .replace(/^[◆※・\s]+/, '')
    .trim()
  return { title: title || address, address }
}

/** 1ファイル分を読み取る */
export function parseDay(file: string, text: string, opt: ParseOptions): ImportItem[] {
  const date = dateFromFileName(file.split(/[\\/]/).pop() ?? file)
  if (!date) return []
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const sepIdx = lines.map((l, i) => (SEPARATOR.test(l) ? i : -1)).filter((i) => i >= 0)
  const trimBlock = (ls: string[]) => ls.join('\n').replace(/^\s*\n+|\s+$/g, '')
  const items: ImportItem[] = []

  // 区切り線が2本以上なければ、メモだけの日
  if (sepIdx.length < 2) {
    const body = trimBlock(lines)
    if (!body) return []
    const first = body.split('\n').find((l) => l.trim()) ?? ''
    items.push({
      key: `${file}#memo`,
      file,
      date,
      index: 1,
      allDay: true,
      title: `メモ: ${first.trim().slice(0, 30)}`,
      location: '',
      description: body,
      startMinutes: 0,
      timeSource: 'allDay',
      warnings: [],
    })
    return items
  }

  // 最初の区切り線より前に文章があれば、それも失わないよう終日メモにする
  const preamble = trimBlock(lines.slice(0, sepIdx[0]))
  if (preamble) {
    items.push({
      key: `${file}#pre`,
      file,
      date,
      index: 0,
      allDay: true,
      title: `メモ: ${preamble.split('\n')[0].trim().slice(0, 30)}`,
      location: '',
      description: preamble,
      startMinutes: 0,
      timeSource: 'allDay',
      warnings: ['最初の区切り線より前の文章'],
    })
  }

  const [, fm, fd] = date.split('-').map(Number)
  let cursor = opt.startMinutes
  let n = 0
  for (let k = 0; k + 1 < sepIdx.length; k += 2) {
    const headStart = sepIdx[k] + 1
    const headEnd = sepIdx[k + 1]
    const memoEnd = k + 2 < sepIdx.length ? sepIdx[k + 2] : lines.length
    const head = lines.slice(headStart, headEnd)
    const memo = lines.slice(headEnd + 1, memoEnd)
    const description = trimBlock([...head, ...memo])
    if (!description) continue
    n++ // 飛ばす見出しも数える(後ろの予定の識別子を以前の取り込みと揃えるため)
    // 見出しの1行目(見出しが空ならメモの1行目)
    const firstLine = head.map((l) => l.trim()).find(Boolean) ?? description.split('\n')[0].trim()
    if (SKIPPED_HEADINGS.includes(firstLine)) continue
    const warnings: string[] = []
    const labeled = head.some((l) => /^\s*(住所|名前|電話)\s*[:：]/.test(l))
    let address = field(head, '住所')
    let title = field(head, '名前')

    if (!labeled) {
      // 「住所:」などの無い1行見出し: 住所が書かれていれば訪問先、無ければその日のメモ(終日)
      const place = splitPlace(firstLine)
      if (!place) {
        items.push({
          key: `${file}#${n}`, file, date, index: n, allDay: true,
          title: `メモ: ${firstLine.slice(0, 30)}`, location: '', description,
          startMinutes: 0, timeSource: 'allDay', warnings: ['見出しに住所が無いのでメモ(終日)に'],
        })
        continue
      }
      title = place.title
      address = place.address
      warnings.push('見出しの1行から名前と住所を読み取り')
    }

    if (!title) {
      title = address
      if (address) warnings.push('名前が空なので住所をタイトルに')
    }
    if (!title) {
      title = description.split('\n').find((l) => l.trim())?.trim().slice(0, 30) ?? '(名前なし)'
      warnings.push('名前も住所も空')
    }
    // 時刻: 見出しとメモの最初の3行だけを見る。別の日付(例 4/3)が書かれた行は、その日の話ではないので除く
    const memoHead = memo.filter((l) => l.trim()).slice(0, 3)
    let t: { minutes: number; text: string } | null = null
    for (const l of [...head, ...memoHead]) {
      if (mentionsOtherDate(l, fm, fd)) continue
      t = findTime(l)
      if (t) break
    }
    const start = t ? t.minutes : cursor
    cursor = Math.min(start + opt.stepMinutes, 23 * 60 + 30)
    items.push({
      key: `${file}#${n}`,
      file,
      date,
      index: n,
      allDay: false,
      title,
      location: address,
      description,
      startMinutes: start,
      timeSource: t ? 'text' : 'auto',
      timeText: t?.text,
      warnings,
    })
  }
  // 区切り線の本数が奇数(最後の見出しが閉じていない)なら知らせる
  if (sepIdx.length % 2 === 1) {
    const rest = trimBlock(lines.slice(sepIdx[sepIdx.length - 1] + 1))
    if (rest) {
      items.push({
        key: `${file}#tail`,
        file,
        date,
        index: n + 1,
        allDay: true,
        title: `メモ: ${rest.split('\n')[0].trim().slice(0, 30)}`,
        location: '',
        description: rest,
        startMinutes: 0,
        timeSource: 'allDay',
        warnings: ['区切り線の数が合わない部分'],
      })
    }
  }
  return items
}
