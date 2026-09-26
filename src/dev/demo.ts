// 開発サーバー専用のデモモード(?demo)。Google の代わりに架空のデータを返す。本番ビルドには含まれない。
import { ymd, addDays } from '../lib/dates'

const now = new Date()
const y = now.getFullYear()
const m = now.getMonth()
const d = (day: number) => new Date(y, m, day)
const dt = (day: number, h: number, min = 0) => new Date(y, m, day, h, min).toISOString()

const calendars = [
  { id: 'work@demo', summary: '仕事', backgroundColor: '#f09300', accessRole: 'owner', timeZone: 'Asia/Tokyo' },
  { id: 'me@demo', summary: 'プライベート', backgroundColor: '#4285f4', accessRole: 'owner', primary: true, timeZone: 'Asia/Tokyo' },
  { id: 'ja.japanese#holiday@group.v.calendar.google.com', summary: '日本の祝日', backgroundColor: '#16a765', accessRole: 'reader' },
]

const events: Record<string, unknown[]> = {
  'work@demo': [
    { id: 'w1', summary: '定例会議', start: { dateTime: dt(3, 10) }, end: { dateTime: dt(3, 11) }, location: '本社 3F 会議室' },
    { id: 'w2', summary: '出張(大阪)', start: { date: ymd(d(8)) }, end: { date: ymd(d(11)) } },
    { id: 'w3', summary: '見積提出', start: { dateTime: dt(15, 9, 30) }, end: { dateTime: dt(15, 10) }, description: '資料: https://example.com/doc<br>担当に確認 見積額１５，０００円' },
    ...[1, 2, 3, 4, 5].map((i) => ({ id: `w4-${i}`, summary: `打ち合わせ ${i}`, start: { dateTime: dt(20, 9 + i) }, end: { dateTime: dt(20, 10 + i) } })),
    { id: 'w5', summary: '夜勤', start: { dateTime: dt(22, 22) }, end: { dateTime: dt(23, 6) } },
  ],
  'me@demo': [
    { id: 'p1', summary: '歯医者', start: { dateTime: dt(now.getDate(), 18) }, end: { dateTime: dt(now.getDate(), 19) }, location: '駅前歯科' },
    { id: 'p4', summary: '打ち合わせ(重なり確認)', start: { dateTime: dt(now.getDate(), 18, 30) }, end: { dateTime: dt(now.getDate(), 20) } },
    { id: 'p5', summary: '朝会', start: { dateTime: dt(now.getDate(), 9) }, end: { dateTime: dt(now.getDate(), 9, 30) } },
    { id: 'p6', summary: '歯医者(前回)', start: { dateTime: new Date(y, m - 2, 10, 18).toISOString() }, end: { dateTime: new Date(y, m - 2, 10, 19).toISOString() } },
    { id: 'p2', summary: '誕生日', start: { date: ymd(d(12)) }, end: { date: ymd(addDays(d(12), 1)) }, colorId: '11' },
    { id: 'p3', summary: 'とても長いタイトルの予定が入った場合の表示確認用', start: { date: ymd(d(15)) }, end: { date: ymd(d(16)) } },
  ],
  'ja.japanese#holiday@group.v.calendar.google.com': [],
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const appCreated = new Set<string>()
let grantedScope = ''

// Google と同じように保存後の日時を UTC(…Z)の表記にそろえる。時差の無い日時は timeZone(ここでは UTC 扱い)で解釈
function googleLike(ev: Record<string, unknown>) {
  for (const k of ['start', 'end']) {
    const t = ev[k] as { dateTime?: string | null; date?: string | null; timeZone?: string } | undefined
    if (!t) continue
    if (t.date === null) delete t.date
    if (t.dateTime === null) delete t.dateTime
    if (t.dateTime) {
      const hasOffset = /(Z|[+-]\d\d:\d\d)$/.test(t.dateTime)
      t.dateTime = new Date(hasOffset ? t.dateTime : t.dateTime + 'Z').toISOString().replace('.000Z', 'Z')
    }
  }
  return ev
}
// デモ中の通信の記録(確認用に window.__demoLog で見られる)
const writeLog: string[] = []
let evSeq = 0 // 同じミリ秒に作った予定でも ID が重ならないように
;(window as unknown as { __demoLog: string[] }).__demoLog = writeLog

export function installDemo() {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)
    const method = init?.method ?? 'GET'
    const p = url.pathname
    writeLog.push(`${method} ${decodeURIComponent(p)}`)
    if (p.endsWith('/users/me/calendarList')) return json({ items: calendars })
    if (p.endsWith('/users/me/settings')) return json({ items: [{ id: 'timezone', value: 'Asia/Tokyo' }] })
    if (p.endsWith('/colors')) return json({ event: { '11': { background: '#dc2127' }, '5': { background: '#fbd75b' }, '2': { background: '#7ae7bf' } } })

    // カレンダーの作成(calendar.app.created 相当: 作ったものは appCreated に記録)
    if (p.endsWith('/calendar/v3/calendars') && method === 'POST') {
      const body = JSON.parse(String(init!.body))
      // 実際の Google で起きたのと同じく、アプリが作ったカレンダーは UTC になる
      const cal = { id: `app${Date.now()}@demo`, accessRole: 'owner', backgroundColor: '#9a9cff', ...body, timeZone: 'UTC' }
      calendars.push(cal)
      appCreated.add(cal.id)
      events[cal.id] = []
      return json(cal)
    }

    // 予定を別のカレンダーへ移す(Google の events.move 相当)
    const mv = /\/calendars\/([^/]+)\/events\/([^/]+)\/move$/.exec(p)
    if (mv && method === 'POST') {
      const from = decodeURIComponent(mv[1])
      const to = url.searchParams.get('destination') ?? ''
      const canWriteCal = (id: string) => appCreated.has(id) || grantedScope.includes('calendar.events')
      if (!canWriteCal(from) || !canWriteCal(to)) return json({ error: { message: 'Insufficient Permission (demo)' } }, 403)
      const src = (events[from] ??= []) as Record<string, unknown>[]
      const i = src.findIndex((e) => e.id === decodeURIComponent(mv[2]))
      if (i < 0) return new Response('{}', { status: 404 })
      const [ev] = src.splice(i, 1)
      ;((events[to] ??= []) as Record<string, unknown>[]).push(ev)
      return json(ev)
    }

    const m = /\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(p)
    if (!m) return new Response('{}', { status: 404 })
    const calId = decodeURIComponent(m[1])
    const evId = m[2] && decodeURIComponent(m[2])
    const list = (events[calId] ??= []) as Record<string, unknown>[]

    if (method === 'GET') {
      if (evId) {
        const ev = list.find((e) => e.id === evId)
        return ev ? json(ev) : new Response('{}', { status: 404 })
      }
      return json({ items: url.searchParams.get('showDeleted') === 'true' ? list : list.filter((e) => e.status !== 'cancelled') })
    }
    // Google と同じく、アプリが作っていないカレンダーへの書き込みは拒否
    // calendar.events が許可されていれば既存カレンダーにも書ける(Google と同じ)
    if (!appCreated.has(calId) && !grantedScope.includes('calendar.events')) return json({ error: { message: 'Insufficient Permission (demo)' } }, 403)
    if (!url.searchParams.has('sendUpdates')) return json({ error: { message: 'sendUpdates missing (demo check)' } }, 400)
    if (method === 'POST') {
      const ev = googleLike({ id: `ev${Date.now()}-${++evSeq}`, status: 'confirmed', ...JSON.parse(String(init!.body)) })
      list.push(ev)
      return json(ev)
    }
    const i = list.findIndex((e) => e.id === evId)
    if (i < 0) return new Response('{}', { status: 404 })
    if (method === 'PATCH') {
      const patch = JSON.parse(String(init!.body))
      const merged: Record<string, unknown> = { ...list[i], ...patch }
      for (const k of ['start', 'end']) if (patch[k]) merged[k] = { ...(list[i][k] as object), ...patch[k] }
      list[i] = googleLike(merged)
      return json(list[i])
    }
    if (method === 'DELETE') {
      // Google と同じく、削除した予定は「cancelled」としてしばらく残る(元に戻せる)
      list[i] = { ...list[i], status: 'cancelled' }
      return new Response(null, { status: 204 })
    }
    return new Response('{}', { status: 405 })
  }
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg) => ({
          requestAccessToken: () => {
            grantedScope = cfg.scope
            cfg.callback({ access_token: 'demo', expires_in: 3600, scope: cfg.scope })
          },
        }),
        hasGrantedAllScopes: () => true,
        revoke: (_t, done) => done?.(),
      },
    },
  }
}
