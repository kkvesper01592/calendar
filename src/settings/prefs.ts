import { createContext, useContext } from 'react'

// 見た目・表示の設定(この端末のブラウザに保存)
export interface Prefs {
  theme: 'auto' | 'light' | 'dark'
  accent: string // テーマ色
  fontScale: number // 文字サイズ 0〜4(2 が標準)
  bold: boolean // 予定の文字を太字に
  weekStart: 0 | 1 // 週の始まり 0=日曜 1=月曜
  weekDays: 7 | 5 | 3 // 週表示の日数
  holidayWeekdays: number[] // 休日として赤く表示する曜日
  dayColors: Record<string, string> // 日付マスの背景色 YYYY-MM-DD -> 色
  editableCalendars: string[] // 編集を許可した既存カレンダー(最初は無し)
  offlineCache: boolean // この端末にオフライン表示用の予定を保存する(最初はオフ)
  periodicBackupMin: number // 開いている間の定期バックアップの間隔(分)。0 = しない
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'auto',
  accent: '#2f6fdb',
  fontScale: 2,
  bold: false,
  weekStart: 0,
  weekDays: 7,
  holidayWeekdays: [0],
  dayColors: {},
  editableCalendars: [],
  offlineCache: false,
  periodicBackupMin: 30,
}

export const FONT_SCALES = [0.85, 0.93, 1, 1.12, 1.25]
export const FONT_LABELS = ['極小', '小', '中', '大', '特大']

export const ACCENTS = [
  '#2f6fdb', '#1a73e8', '#0b8043', '#33b679', '#009688', '#039be5',
  '#7986cb', '#8e24aa', '#d81b60', '#e67c73', '#f4511e', '#ef6c00',
  '#f6bf26', '#795548', '#616161', '#3f51b5',
]

// 日付マスの背景色の候補(薄く表示する)
export const DAY_COLORS = ['#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb', '#aecbfa', '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed']

const KEY = 'webcalendar.prefs'

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* 保存できなくても今の表示には反映される */
  }
}

/** 設定を画面全体に反映(テーマ・色・文字サイズ・太字) */
export function applyPrefs(p: Prefs) {
  const root = document.documentElement
  if (p.theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', p.theme)
  root.style.setProperty('--accent', p.accent)
  root.style.setProperty('--today', p.accent)
  root.style.setProperty('--fs', String(FONT_SCALES[p.fontScale] ?? 1))
  root.toggleAttribute('data-bold', p.bold)
}

export const PrefsContext = createContext<Prefs>(DEFAULT_PREFS)
export const usePrefs = () => useContext(PrefsContext)

/** 曜日を週の始まりから並べた順(例: 月曜始まりなら [1,2,3,4,5,6,0]) */
export const weekOrder = (weekStart: number) => Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7)

/** 赤(休日)・青(土曜)の判定 */
export function dayTone(date: Date, isHoliday: boolean, holidayWeekdays: number[]): 'sun' | 'sat' | '' {
  if (isHoliday || holidayWeekdays.includes(date.getDay())) return 'sun'
  if (date.getDay() === 6) return 'sat'
  return ''
}
