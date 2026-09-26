// 旧暦(天保暦方式)と六曜の計算。新月は Meeus『Astronomical Algorithms』49章、
// 太陽黄経は25章の簡易式で求め、日付は日本時間(UTC+9)で判定する。

const RAD = Math.PI / 180
const sin = (deg: number) => Math.sin(deg * RAD)
const norm360 = (x: number) => ((x % 360) + 360) % 360

// 力学時と世界時の差(秒)。2000〜2100年の範囲なら数十秒の誤差で十分
function deltaTSeconds(year: number): number {
  const t = year - 2000
  return 63.86 + 0.3345 * t - 0.060374 * t * t / 100 + 0.0017275 * t ** 3 / 1e4
}

/** k 番目の新月(k=0 が 2000年1月6日)の瞬間を UT のユリウス日で返す */
function newMoonJD(k: number): number {
  const T = k / 1236.85
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T ** 2 - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4
  const E = 1 - 0.002516 * T - 0.0000074 * T ** 2
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T ** 2 - 0.00000011 * T ** 3
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T ** 2 + 0.00001238 * T ** 3 - 0.000000058 * T ** 4
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T ** 2 - 0.00000227 * T ** 3 + 0.000000011 * T ** 4
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T ** 2 + 0.00000215 * T ** 3
  jde +=
    -0.4072 * sin(Mp) +
    0.17241 * E * sin(M) +
    0.01608 * sin(2 * Mp) +
    0.01039 * sin(2 * F) +
    0.00739 * E * sin(Mp - M) -
    0.00514 * E * sin(Mp + M) +
    0.00208 * E * E * sin(2 * M) -
    0.00111 * sin(Mp - 2 * F) -
    0.00057 * sin(Mp + 2 * F) +
    0.00056 * E * sin(2 * Mp + M) -
    0.00042 * sin(3 * Mp) +
    0.00042 * E * sin(M + 2 * F) +
    0.00038 * E * sin(M - 2 * F) -
    0.00024 * E * sin(2 * Mp - M) -
    0.00017 * sin(O) -
    0.00007 * sin(Mp + 2 * M) +
    0.00004 * sin(2 * Mp - 2 * F) +
    0.00004 * sin(3 * M) +
    0.00003 * sin(Mp + M - 2 * F) +
    0.00003 * sin(2 * Mp + 2 * F) -
    0.00003 * sin(Mp + M + 2 * F) +
    0.00003 * sin(Mp - M + 2 * F) -
    0.00002 * sin(Mp - M - 2 * F) -
    0.00002 * sin(3 * Mp + M) +
    0.00002 * sin(4 * Mp)
  const A: [number, number, number][] = [
    [0.000325, 299.77, 0.107408],
    [0.000165, 251.88, 0.016321],
    [0.000164, 251.83, 26.651886],
    [0.000126, 349.42, 36.412478],
    [0.00011, 84.66, 18.206239],
    [0.000062, 141.74, 53.303771],
    [0.00006, 207.14, 2.453732],
    [0.000056, 154.84, 7.30686],
    [0.000047, 34.52, 27.261239],
    [0.000042, 207.19, 0.121824],
    [0.00004, 291.34, 1.844379],
    [0.000037, 161.72, 24.198154],
    [0.000035, 239.56, 25.513099],
    [0.000023, 331.55, 3.592518],
  ]
  for (const [c, a, b] of A) jde += c * sin(a + b * k - (a === 299.77 ? 0.009173 * T * T : 0))
  const year = 2000 + k / 12.3685
  return jde - deltaTSeconds(year) / 86400
}

/** 太陽の視黄経(度)。jd は UT のユリウス日 */
function sunLongitude(jd: number): number {
  const T = (jd + 69 / 86400 - 2451545) / 36525
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M)
  const omega = 125.04 - 1934.136 * T
  return norm360(L0 + C - 0.00569 - 0.00478 * sin(omega))
}

// 日付 <-> 日本時間の「通日」(JST 0時のユリウス日を整数化したもの)
const JST = 9 / 24
function dayNumberOfDate(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000) // 1970-01-01 からの日数
}
function dayNumberOfJD(jd: number): number {
  return Math.floor(jd + JST - 2440587.5) // その瞬間の日本時間の日付
}
function jdOfDayStart(dayNum: number): number {
  return dayNum + 2440587.5 - JST
}

interface LunarMonth {
  start: number // 1日の通日
  end: number // 翌月1日の通日
  month: number // 1〜12
  leap: boolean
}

const monthCache = new Map<number, LunarMonth>()

// 新月 k から始まる月に含まれる中気から月番号を決める。中気が無ければ閏月
function chukiMonth(start: number, end: number): number | null {
  const l0 = sunLongitude(jdOfDayStart(start))
  const l1 = sunLongitude(jdOfDayStart(end))
  const i0 = Math.floor(l0 / 30)
  const i1 = Math.floor((l1 < l0 ? l1 + 360 : l1) / 30)
  if (i1 === i0) return null
  const boundary = ((i0 + 1) * 30) % 360 // 通過した中気の黄経(0=春分, 270=冬至)
  const m = (boundary / 30 + 2) % 12
  return m === 0 ? 12 : m
}

function lunarMonthFor(k: number): LunarMonth {
  const cached = monthCache.get(k)
  if (cached) return cached
  const start = dayNumberOfJD(newMoonJD(k))
  const end = dayNumberOfJD(newMoonJD(k + 1))
  let month = chukiMonth(start, end)
  let leap = false
  if (month === null) {
    // 閏月: 直前の(中気を含む)月と同じ番号
    let j = k - 1
    let prev = chukiMonth(dayNumberOfJD(newMoonJD(j)), dayNumberOfJD(newMoonJD(j + 1)))
    while (prev === null) {
      j--
      prev = chukiMonth(dayNumberOfJD(newMoonJD(j)), dayNumberOfJD(newMoonJD(j + 1)))
    }
    month = prev
    leap = true
  }
  const r = { start, end, month, leap }
  monthCache.set(k, r)
  return r
}

export interface LunarDate {
  month: number
  day: number
  leap: boolean
}

/** 新暦の日付(月は1始まり)から旧暦の月日を求める */
export function toLunar(y: number, m: number, d: number): LunarDate {
  const dn = dayNumberOfDate(y, m, d)
  let k = Math.floor((y + (m - 1) / 12 + (d - 1) / 365 - 2000) * 12.3685)
  // 推定値の前後を調べて、その日を含む月を探す
  for (let guard = 0; guard < 6; guard++) {
    const lm = lunarMonthFor(k)
    if (dn < lm.start) k--
    else if (dn >= lm.end) k++
    else return { month: lm.month, day: dn - lm.start + 1, leap: lm.leap }
  }
  throw new Error(`旧暦を計算できませんでした: ${y}-${m}-${d}`)
}

export const ROKUYO = ['大安', '赤口', '先勝', '友引', '先負', '仏滅'] as const
export type Rokuyo = (typeof ROKUYO)[number]

/** 六曜 = (旧暦の月 + 日) を6で割った余り。閏月は同じ月番号で数える */
export function rokuyo(y: number, m: number, d: number): Rokuyo {
  const l = toLunar(y, m, d)
  return ROKUYO[(l.month + l.day) % 6]
}
