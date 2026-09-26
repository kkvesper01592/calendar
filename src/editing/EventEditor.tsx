import { useEffect, useState } from 'react'
import type { CalendarEvent, CalendarListEntry, EventDateTime } from '../google/calendarReadApi'
import type { Colors } from '../calendar/useRangeEvents'
import { addDays, eventRange, hhmm, htmlToText, isAllDay, localIso, ymd } from '../lib/dates'
import { isMapUrl, mapSearchUrl, eventMapUrl, parsePastedPlace } from '../lib/maps'
import { describeTemplate, templateFromEvent, templateToEvent, type Template, type TemplateTimeMode } from './templates'
import PastSearch from './PastSearch'
import type { DisplayEvent } from '../calendar/useRangeEvents'
import { isAppCalendar } from '../google/calendarWriteApi'
import { buildRecurrence, defaultRepeat, describeRepeat, parseRecurrence, type RepeatForm, type RepeatKind } from './recurrence'

export type EditorTarget =
  // start: 開始日時の指定(その日の最後の予定の終了時刻など)。hour より優先
  | { mode: 'create'; date: Date; hour?: number; start?: Date; calendarId?: string; template?: Template }
  // instance: 繰り返しのうち1回だけの編集(繰り返し設定は変えない)
  | { mode: 'edit'; calendar: CalendarListEntry; event: CalendarEvent; instance: boolean }

interface Props {
  target: EditorTarget
  calendars: CalendarListEntry[] // 書き込めるカレンダー(メモ用を除く)
  colors: Colors | null
  onSave: (calendar: CalendarListEntry, body: Partial<CalendarEvent>, eventId?: string) => Promise<void>
  onCancel: () => void
  // 追加のときだけ使う: テンプレートのプルダウン
  templates?: Template[]
  timeMode?: TemplateTimeMode
  onTimeMode?: (m: TemplateTimeMode) => void
  suggestStart?: (date: Date) => Date | undefined // その日の最後の予定の終了時刻
  searchPast?: (query: string) => Promise<DisplayEvent[]> // 過去の予定の検索
}

const WD = ['日', '月', '火', '水', '木', '金', '土']
const REMINDERS: { min: number; label: string }[] = [
  { min: 0, label: '予定の時刻' },
  { min: 5, label: '5分前' },
  { min: 10, label: '10分前' },
  { min: 15, label: '15分前' },
  { min: 30, label: '30分前' },
  { min: 60, label: '1時間前' },
  { min: 1440, label: '1日前' },
]
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'

// 前回予定を追加したカレンダー(次の追加の既定にする)
const LAST_CAL = 'webcalendar.lastCalendar'
function lastCalendar(calendars: CalendarListEntry[]): string | undefined {
  try {
    const id = localStorage.getItem(LAST_CAL)
    return id && calendars.some((c) => c.id === id) ? id : undefined
  } catch {
    return undefined
  }
}

// 予定(またはテンプレートから作った予定)の内容をフォームの値にする
function fromEvent(ev: CalendarEvent, calendarId: string) {
  const { start, end } = eventRange(ev)
  const allDay = isAllDay(ev)
  const endShown = allDay ? addDays(end, -1) : end
  return {
    title: ev.summary ?? '',
    calendarId,
    allDay,
    sd: ymd(start),
    st: allDay ? '09:00' : hhmm(start),
    ed: ymd(endShown < start ? start : endShown),
    et: allDay ? '10:00' : hhmm(end),
    repeat: parseRecurrence(ev.recurrence, start),
    useDefaultReminder: ev.reminders?.useDefault ?? true,
    reminders: (ev.reminders?.overrides ?? []).map((o) => o.minutes),
    colorId: typeof ev.colorId === 'string' ? ev.colorId : '',
    location: ev.location ?? '',
    mapUrl: eventMapUrl(ev) ?? '',
    description: htmlToText(ev.description), // <br> などは改行に
  }
}

function initialState(t: EditorTarget, calendars: CalendarListEntry[]) {
  if (t.mode === 'create' && t.template) {
    // テンプレートの内容を入れた状態で開く(保存先はテンプレートのカレンダー、書き込めなければ最初のもの)
    const calId = calendars.some((c) => c.id === t.template!.calendarId) ? t.template.calendarId! : (calendars[0]?.id ?? '')
    return fromEvent(templateToEvent(t.template, t.date, t.start) as CalendarEvent, calId)
  }
  if (t.mode === 'create') {
    const start = t.start ?? new Date(t.date.getFullYear(), t.date.getMonth(), t.date.getDate(), t.hour ?? 9)
    const end = new Date(start.getTime() + 3600_000)
    return {
      title: '',
      calendarId: t.calendarId ?? lastCalendar(calendars) ?? calendars[0]?.id ?? '',
      allDay: false,
      sd: ymd(start),
      st: hhmm(start),
      ed: ymd(end),
      et: hhmm(end),
      repeat: defaultRepeat(start),
      useDefaultReminder: true,
      reminders: [] as number[],
      colorId: '',
      location: '',
      mapUrl: '',
      description: '',
    }
  }
  return fromEvent(t.event, t.calendar.id)
}

// 同じ瞬間かどうか(表記の違い 09:00+09:00 と 00:00Z などは同じとみなす)
function sameWhen(a: EventDateTime | undefined, b: EventDateTime | undefined): boolean {
  if (a?.date || b?.date) return a?.date === b?.date
  return !!a?.dateTime && !!b?.dateTime && new Date(a.dateTime).getTime() === new Date(b.dateTime).getTime()
}

const sameReminders = (a: CalendarEvent['reminders'], b: CalendarEvent['reminders']) =>
  (a?.useDefault ?? true) === (b?.useDefault ?? true) &&
  JSON.stringify((a?.overrides ?? []).map((o) => o.minutes).sort()) === JSON.stringify((b?.overrides ?? []).map((o) => o.minutes).sort())

/** 元の予定と比べて、変わった項目だけの差分を作る */
function changedFields(orig: CalendarEvent, next: Partial<CalendarEvent>, allDay: boolean, repeatTouched: boolean, hasColor: boolean): Partial<CalendarEvent> {
  const d: Partial<CalendarEvent> = {}
  if ((orig.summary ?? '') !== next.summary) d.summary = next.summary
  if ((orig.location ?? '') !== next.location) d.location = next.location
  // メモは表示用に HTML を文字にしているので、同じ変換をした元の内容と比べる(触っていなければ送らない)
  if (htmlToText(orig.description) !== next.description) d.description = next.description
  const nextMap = next.extendedProperties?.private?.mapUrl ?? ''
  if ((eventMapUrl(orig) ?? '') !== nextMap) d.extendedProperties = { private: { mapUrl: nextMap } }
  if (!sameWhen(orig.start, next.start) || !sameWhen(orig.end, next.end)) {
    // 終日⇔時間指定を切り替えた時は、使わなくなった方を null で消す
    const wasAllDay = !!orig.start?.date
    const clear = wasAllDay !== allDay
    d.start = { ...next.start, ...(clear ? (allDay ? { dateTime: null } : { date: null }) : {}) } as EventDateTime
    d.end = { ...next.end, ...(clear ? (allDay ? { dateTime: null } : { date: null }) : {}) } as EventDateTime
  }
  if (!sameReminders(orig.reminders, next.reminders)) d.reminders = next.reminders
  const origColor = typeof orig.colorId === 'string' ? orig.colorId : ''
  const nextColor = hasColor ? (next.colorId as string) : ''
  if (origColor !== nextColor) d.colorId = (nextColor || null) as never
  // 繰り返しは、フォームで触ったときだけ比べる(Google で作ったルールを書き換えないため)
  if (repeatTouched) {
    const a = JSON.stringify(orig.recurrence ?? [])
    const b = JSON.stringify(next.recurrence ?? [])
    if (a !== b) d.recurrence = next.recurrence ?? []
  }
  return d
}

/** 予定の作成・編集フォーム */
export default function EventEditor({ target, calendars, colors, onSave, onCancel, templates = [], timeMode = 'template', onTimeMode, suggestStart, searchPast }: Props) {
  const [templateId, setTemplateId] = useState('')
  const [s, setS] = useState(() => initialState(target, calendars))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [repeatTouched, setRepeatTouched] = useState(false)
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v }))
  const setRepeat = (patch: Partial<RepeatForm>) => {
    setRepeatTouched(true)
    setS((p) => {
      // 繰り返しの種類を選んだときは、曜日・日にちなどを「今の開始日」に合わせて初期化する
      if (patch.kind && patch.kind !== p.repeat.kind && patch.kind !== 'custom') {
        const d = defaultRepeat(new Date(`${p.sd}T00:00`))
        patch = { weekdays: d.weekdays, monthDays: d.monthDays, nth: d.nth, nthWeekday: d.nthWeekday, ...patch }
      }
      return { ...p, repeat: { ...p.repeat, ...patch } }
    })
  }
  const isEdit = target.mode === 'edit'
  const instance = target.mode === 'edit' && target.instance

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  /** テンプレートを選んだら、その内容をフォームに入れる(日付はそのまま。「なし」に戻しても入力は消さない) */
  function pickTemplate(id: string, mode: TemplateTimeMode) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t) applyTemplate(t, mode)
  }

  /** ひな形(テンプレート・検索でコピーした予定)の内容をフォームへ。日付は今の開始日のまま */
  function applyTemplate(t: Template, mode: TemplateTimeMode) {
    const date = new Date(`${s.sd}T00:00`)
    const start = mode === 'after' && !t.allDay ? suggestStart?.(date) : undefined
    const calId = calendars.some((c) => c.id === t.calendarId) ? t.calendarId! : s.calendarId
    setS(fromEvent(templateToEvent(t, date, start) as CalendarEvent, calId))
  }

  function changeTimeMode(m: TemplateTimeMode) {
    onTimeMode?.(m)
    if (templateId) pickTemplate(templateId, m)
  }

  // 貼り付けで「場所」を書き換えたときのお知らせ(元の文字に戻せるように)
  const [placeNote, setPlaceNote] = useState<{ kind: 'updated'; prev: string } | { kind: 'shortLink' } | null>(null)

  /** 貼り付けた内容を振り分ける: リンクは「地図のリンク」へ、店名・住所は「場所」へ */
  function applyPasted(text: string) {
    const { url, place } = parsePastedPlace(text)
    if (!url && !place) {
      set('mapUrl', text.trim()) // 振り分けられない内容はそのまま入れる(「Google マップのリンクではありません」と表示)
      setPlaceNote(null)
      return
    }
    setS((p) => ({ ...p, ...(url ? { mapUrl: url } : {}), ...(place ? { location: place } : {}) }))
    if (place && place !== s.location) setPlaceNote({ kind: 'updated', prev: s.location })
    else if (url && !place) setPlaceNote({ kind: 'shortLink' })
    else setPlaceNote(null)
  }

  async function pasteMap() {
    try {
      applyPasted(await navigator.clipboard.readText())
    } catch {
      setErr('クリップボードを読めませんでした。欄に直接貼り付けてください(Ctrl+V)')
    }
  }

  // 「何分後」欄: 開始と終了の差(分)。入力中は打った文字をそのまま表示する
  const currentDuration = () => {
    const a = new Date(`${s.sd}T${s.st}`)
    const b = new Date(`${s.ed}T${s.et}`)
    const m = Math.round((b.getTime() - a.getTime()) / 60000)
    return isNaN(m) ? 0 : m
  }
  const [durInput, setDurInput] = useState(() => String(currentDuration()))
  const [durFocused, setDurFocused] = useState(false)
  useEffect(() => {
    if (!durFocused) setDurInput(String(currentDuration()))
  }, [s.sd, s.st, s.ed, s.et]) // eslint-disable-line react-hooks/exhaustive-deps

  function changeDuration(v: string) {
    setDurInput(v)
    const m = Number(v.normalize('NFKC'))
    if (!Number.isFinite(m) || m <= 0) return
    const start = new Date(`${s.sd}T${s.st}`)
    if (isNaN(start.getTime())) return
    const end = new Date(start.getTime() + Math.round(m) * 60000)
    setS((p) => ({ ...p, ed: ymd(end), et: hhmm(end) }))
  }

  // 開始を動かしたら、終了も同じ長さを保って動かす
  function changeStart(sd: string, st: string) {
    const oldStart = new Date(`${s.sd}T${s.allDay ? '00:00' : s.st}`)
    const oldEnd = new Date(`${s.ed}T${s.allDay ? '00:00' : s.et}`)
    const dur = Math.max(0, oldEnd.getTime() - oldStart.getTime())
    const ns = new Date(`${sd}T${s.allDay ? '00:00' : st}`)
    if (isNaN(ns.getTime())) return setS((p) => ({ ...p, sd, st }))
    const ne = new Date(ns.getTime() + dur)
    setS((p) => ({ ...p, sd, st, ed: ymd(ne), et: p.allDay ? p.et : hhmm(ne) }))
  }

  async function save() {
    setErr('')
    const cal = calendars.find((c) => c.id === s.calendarId) ?? (target.mode === 'edit' ? target.calendar : undefined)
    if (!cal) return setErr('保存先のカレンダーを選んでください')
    if (!s.sd || !s.ed || (!s.allDay && (!s.st || !s.et))) return setErr('日付と時刻を入力してください')
    const start = new Date(`${s.sd}T${s.allDay ? '00:00' : s.st}`)
    const end = new Date(`${s.ed}T${s.allDay ? '00:00' : s.et}`)
    if (s.allDay ? end < start : end <= start) return setErr('終了は開始より後にしてください')
    if (s.repeat.kind === 'weekly' && s.repeat.weekdays.length === 0) return setErr('繰り返す曜日を選んでください')
    if (s.repeat.kind === 'monthlyDay' && s.repeat.monthDays.length === 0) return setErr('繰り返す日を入力してください')
    const mapUrl = s.mapUrl.trim()
    if (mapUrl && !isMapUrl(mapUrl)) return setErr('地図のリンクは Google マップのリンク(https://maps.app.goo.gl/… など)を貼り付けてください')

    // 時刻は「入力した日本時間の瞬間」を時差つきで送る(カレンダーのタイムゾーンが UTC 等でもずれない)。
    // timeZone は繰り返しの計算用に、この端末のタイムゾーン(通常 Asia/Tokyo)
    const zone = tz()
    const full: Partial<CalendarEvent> = {
      summary: s.title.trim(),
      location: s.location,
      description: s.description,
      start: s.allDay ? { date: s.sd } : { dateTime: localIso(start), timeZone: zone },
      end: s.allDay ? { date: ymd(addDays(end, 1)) } : { dateTime: localIso(end), timeZone: zone },
      reminders: s.useDefaultReminder
        ? { useDefault: true }
        : { useDefault: false, overrides: s.reminders.slice(0, 5).map((m) => ({ method: 'popup', minutes: m })) },
      ...(s.colorId ? { colorId: s.colorId } : {}),
      ...(mapUrl ? { extendedProperties: { private: { mapUrl } } } : {}),
    }
    if (!instance) {
      const rec = buildRecurrence(s.repeat, s.allDay)
      if (rec.length) full.recurrence = rec
    }

    let body = full
    if (target.mode === 'edit') {
      // 編集は「変わった項目だけ」を送る。何も変わっていなければ Google には何も送らない
      body = changedFields(target.event, full, s.allDay, repeatTouched && !instance, !!s.colorId)
      // カレンダーの変更(移動)も「変更あり」として扱う
      if (Object.keys(body).length === 0 && s.calendarId === target.calendar.id) return onCancel()
    }
    setSaving(true)
    try {
      await onSave(cal, body, target.mode === 'edit' ? target.event.id : undefined)
      if (target.mode === 'create') {
        try {
          localStorage.setItem(LAST_CAL, cal.id)
        } catch {
          /* 覚えられなくても保存は済んでいる */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const r = s.repeat
  const eventColors = Object.entries(colors?.event ?? {})

  return (
    <div className="modal-backdrop">
      <div className="modal editor" role="dialog" aria-modal="true" aria-label={isEdit ? '予定を編集' : '予定を追加'}>
        <h2 className="editor-title">{isEdit ? (instance ? '予定を編集(この回のみ)' : '予定を編集') : '予定を追加'}</h2>

        <label className="field">
          <span>タイトル</span>
          <input autoFocus value={s.title} onChange={(e) => set('title', e.target.value)} placeholder="(タイトルなし)" />
        </label>

        {target.mode === 'create' && (
          <div className="field">
            <span>テンプレート</span>
            <div className="field-inline">
              <select value={templateId} onChange={(e) => pickTemplate(e.target.value, timeMode)} disabled={!templates.length}>
                <option value="">{templates.length ? 'なし' : 'なし(予定の詳細の「テンプレートに保存」で作れます)'}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title || '(タイトルなし)'} {describeTemplate(t)}
                  </option>
                ))}
              </select>
            </div>
            {templateId && (
              <div className="tpl-mode">
                <span className="small-text muted">開始時刻</span>
                <div className="seg">
                  <button type="button" className={timeMode === 'template' ? 'on' : ''} onClick={() => changeTimeMode('template')}>テンプレートの時刻</button>
                  <button type="button" className={timeMode === 'after' ? 'on' : ''} onClick={() => changeTimeMode('after')}>最後の予定の後</button>
                </div>
              </div>
            )}
          </div>
        )}

        {target.mode === 'create' && searchPast && (
          <PastSearch
            search={searchPast}
            timeMode={timeMode}
            onTimeMode={onTimeMode}
            onApply={(item, mode) => {
              // 過去の予定の内容をコピー(繰り返しの設定はコピーしない)
              setTemplateId('')
              applyTemplate(templateFromEvent(item.ev, item.calendar.id), mode)
            }}
          />
        )}

        <label className="field">
          <span>カレンダー</span>
          <select value={s.calendarId} onChange={(e) => set('calendarId', e.target.value)} disabled={instance}>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summaryOverride || c.summary}
                {isAppCalendar(c) ? '' : '(既存のカレンダー)'}
              </option>
            ))}
          </select>
          {instance && (
            <span className="hint small-text">繰り返しの「この予定のみ」は別のカレンダーに移せません。移すときは「すべての繰り返し」で編集してください。</span>
          )}
          {target.mode === 'edit' && s.calendarId !== target.calendar.id && (
            <span className="hint small-text">保存すると、この予定を「{calendars.find((c) => c.id === s.calendarId)?.summary}」へ移します。</span>
          )}
        </label>

        <label className="check">
          <input type="checkbox" checked={s.allDay} onChange={(e) => set('allDay', e.target.checked)} /> 終日
        </label>

        <div className="field-row">
          <span className="field-label">開始</span>
          <input type="date" value={s.sd} onChange={(e) => changeStart(e.target.value, s.st)} />
          {!s.allDay && <input type="time" step={60} value={s.st} onChange={(e) => changeStart(s.sd, e.target.value)} />}
        </div>
        <div className="field-row">
          <span className="field-label">終了</span>
          <input type="date" value={s.ed} onChange={(e) => set('ed', e.target.value)} />
          {!s.allDay && (
            <>
              <input type="time" step={60} value={s.et} onChange={(e) => set('et', e.target.value)} />
              {/* 開始から何分後に終わるか。入れると終了時刻を計算、終了時刻を直接変えるとこちらも変わる */}
              <span className="dur">
                <input
                  type="number"
                  min={1}
                  step={5}
                  className="num"
                  value={durInput}
                  onFocus={() => setDurFocused(true)}
                  onBlur={() => {
                    setDurFocused(false)
                    setDurInput(String(currentDuration()))
                  }}
                  onChange={(e) => changeDuration(e.target.value)}
                  aria-label="開始から何分後"
                />
                分後
              </span>
            </>
          )}
        </div>

        {!instance && (
          <fieldset className="box">
            <legend>繰り返し</legend>
            <select value={r.kind} onChange={(e) => setRepeat({ kind: e.target.value as RepeatKind })}>
              <option value="none">繰り返さない</option>
              <option value="daily">日ごと</option>
              <option value="weekly">週ごと(曜日を選ぶ)</option>
              <option value="monthlyDay">月ごと(日にちを選ぶ)</option>
              <option value="monthlyNth">月ごと(第◯◯曜日)</option>
              <option value="monthlyLast">月ごと(末日)</option>
              <option value="yearly">年ごと</option>
              {r.kind === 'custom' && <option value="custom">独自の繰り返し(そのまま残す)</option>}
            </select>
            {r.kind !== 'none' && r.kind !== 'custom' && (
              <>
                <div className="field-row">
                  <input type="number" min={1} max={99} value={r.interval} onChange={(e) => setRepeat({ interval: Math.max(1, Number(e.target.value) || 1) })} className="num" />
                  <span>
                    {{ daily: '日', weekly: '週間', monthlyDay: 'か月', monthlyNth: 'か月', monthlyLast: 'か月', yearly: '年' }[r.kind]}ごと
                  </span>
                </div>
                {r.kind === 'weekly' && (
                  <div className="weekdays">
                    {WD.map((w, i) => (
                      <label key={w} className={r.weekdays.includes(i) ? 'on' : ''}>
                        <input
                          type="checkbox"
                          checked={r.weekdays.includes(i)}
                          onChange={(e) => setRepeat({ weekdays: e.target.checked ? [...r.weekdays, i] : r.weekdays.filter((d) => d !== i) })}
                        />
                        {w}
                      </label>
                    ))}
                  </div>
                )}
                {r.kind === 'monthlyDay' && (
                  <label className="field">
                    <span>日にち(複数はカンマ区切り 例: 5,10,15)</span>
                    <input
                      value={r.monthDays.join(',')}
                      onChange={(e) =>
                        setRepeat({
                          monthDays: [...new Set(e.target.value.normalize('NFKC').split(/[,、\s]+/).map(Number).filter((n) => n >= 1 && n <= 31))],
                        })
                      }
                    />
                  </label>
                )}
                {r.kind === 'monthlyNth' && (
                  <div className="field-row">
                    <select value={r.nth} onChange={(e) => setRepeat({ nth: Number(e.target.value) })}>
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>第{n}</option>
                      ))}
                      <option value={-1}>最終</option>
                    </select>
                    <select value={r.nthWeekday} onChange={(e) => setRepeat({ nthWeekday: Number(e.target.value) })}>
                      {WD.map((w, i) => (
                        <option key={w} value={i}>{w}曜日</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field-row">
                  <span className="field-label">終了</span>
                  <select value={r.endKind} onChange={(e) => setRepeat({ endKind: e.target.value as RepeatForm['endKind'] })}>
                    <option value="never">なし</option>
                    <option value="count">回数</option>
                    <option value="until">日付</option>
                  </select>
                  {r.endKind === 'count' && (
                    <>
                      <input type="number" min={1} max={999} className="num" value={r.count} onChange={(e) => setRepeat({ count: Math.max(1, Number(e.target.value) || 1) })} />
                      回
                    </>
                  )}
                  {r.endKind === 'until' && <input type="date" value={r.until} onChange={(e) => setRepeat({ until: e.target.value })} />}
                </div>
              </>
            )}
            {r.kind !== 'none' && <p className="hint small-text">{describeRepeat(r)}</p>}
          </fieldset>
        )}

        <fieldset className="box">
          <legend>通知</legend>
          <label className="check">
            <input type="checkbox" checked={s.useDefaultReminder} onChange={(e) => set('useDefaultReminder', e.target.checked)} /> カレンダーの既定の通知を使う
          </label>
          {!s.useDefaultReminder && (
            <div className="chips-select">
              {REMINDERS.map((o) => (
                <label key={o.min} className={s.reminders.includes(o.min) ? 'on' : ''}>
                  <input
                    type="checkbox"
                    checked={s.reminders.includes(o.min)}
                    onChange={(e) => set('reminders', e.target.checked ? [...s.reminders, o.min] : s.reminders.filter((m) => m !== o.min))}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {eventColors.length > 0 && (
          <div className="field">
            <span>色</span>
            <div className="colors">
              <button type="button" className={`color-dot none ${s.colorId === '' ? 'on' : ''}`} onClick={() => set('colorId', '')} title="カレンダーの色">
                ✕
              </button>
              {eventColors.map(([id, c]) => (
                <button key={id} type="button" className={`color-dot ${s.colorId === id ? 'on' : ''}`} style={{ background: c.background }} onClick={() => set('colorId', id)} aria-label={`色 ${id}`} />
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span>場所</span>
          <div className="field-inline">
            <input value={s.location} onChange={(e) => set('location', e.target.value)} placeholder="住所や場所の名前" />
            {/* 場所が空なら Google マップのトップを開く */}
            <a className="button small ghost" href={mapSearchUrl(s.location)} target="_blank" rel="noopener noreferrer">
              地図で探す
            </a>
          </div>
        </div>
        <div className="field">
          <span>地図のリンク(任意)</span>
          <div className="field-inline">
            <input
              value={s.mapUrl}
              onChange={(e) => set('mapUrl', e.target.value)}
              onPaste={(e) => {
                // Ctrl+V でも「貼り付け」ボタンと同じように振り分ける
                e.preventDefault()
                applyPasted(e.clipboardData.getData('text'))
              }}
              placeholder="地図のアドレス欄の URL や、共有でコピーした文章"
              inputMode="url"
              className={s.mapUrl.trim() && !isMapUrl(s.mapUrl) ? 'invalid' : ''}
            />
            <button type="button" className="small ghost" onClick={pasteMap}>貼り付け</button>
            {s.mapUrl && (
              <button type="button" className="small ghost" onClick={() => set('mapUrl', '')} aria-label="地図のリンクを消す">✕</button>
            )}
          </div>
          {placeNote?.kind === 'updated' && (
            <span className="place-note">
              ✓ 「場所」を地図の場所に書き換えました
              {placeNote.prev && (
                <>
                  (元: {placeNote.prev}){' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      set('location', placeNote.prev)
                      setPlaceNote(null)
                    }}
                  >
                    元に戻す
                  </button>
                </>
              )}
            </span>
          )}
          {placeNote?.kind === 'shortLink' && (
            <span className="place-note muted">
              短いリンク(共有 → リンクをコピー)には場所の名前・住所が入っていないため、「場所」はそのままです。
              ブラウザのアドレス欄の URL を貼り付けると、場所の名前・住所も自動で入ります。
            </span>
          )}
          <span className="hint small-text">
            「地図で探す」で開いた Google マップで場所を選び、ブラウザのアドレス欄の URL(Ctrl+L → Ctrl+C)をコピーして「貼り付け」を押すと、
            地図のリンクと場所の名前・住所が自動で入ります。スマホは「共有」→「コピー」した文章をそのまま貼り付けられます。
            {s.mapUrl.trim() && (isMapUrl(s.mapUrl) ? ' ✓ 登録できるリンクです' : ' ✕ Google マップのリンクではありません')}
          </span>
        </div>
        <label className="field">
          <span>メモ</span>
          <textarea rows={4} value={s.description} onChange={(e) => set('description', e.target.value)} />
        </label>

        {err && <p className="error">{err}</p>}
        <div className="modal-actions">
          <button className="small ghost" onClick={onCancel} disabled={saving}>キャンセル</button>
          <button className="small" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  )
}
