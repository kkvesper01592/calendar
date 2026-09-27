import { useEffect, useState } from 'react'
import type { CalendarEvent, CalendarListEntry } from '../google/calendarReadApi'
import type { Colors } from '../calendar/useRangeEvents'
import { htmlToText } from '../lib/dates'
import { isMapUrl, mapSearchUrl, parsePastedPlace } from '../lib/maps'
import { describeTemplate, newTemplateId, type Template } from './templates'

const REMINDERS: { min: number; label: string }[] = [
  { min: 0, label: '予定の時刻' },
  { min: 5, label: '5分前' },
  { min: 10, label: '10分前' },
  { min: 15, label: '15分前' },
  { min: 30, label: '30分前' },
  { min: 60, label: '1時間前' },
  { min: 1440, label: '1日前' },
]

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
const toHhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

interface Props {
  template?: Template // 無ければ新規作成(複製のときは中身入りの新規)
  isNew?: boolean
  calendars: CalendarListEntry[] // 保存先に選べるカレンダー
  colors: Colors | null
  onSave: (t: Template) => void
  onCancel: () => void
}

/** テンプレート(よく使う予定のひな形)の新規作成・編集 */
export default function TemplateEditor({ template, isNew = !template, calendars, colors, onSave, onCancel }: Props) {
  const t = template
  const [title, setTitle] = useState(t?.title ?? '')
  const [allDay, setAllDay] = useState(t?.allDay ?? false)
  const [startTime, setStartTime] = useState(t?.startTime ?? '09:00')
  // 時間指定: 終了時刻で入力(開始より前なら翌日まで)。終日: 日数
  const [endTime, setEndTime] = useState(() => toHhmm(toMin(t?.startTime ?? '09:00') + (t && !t.allDay ? t.minutes : 60)))
  const [days, setDays] = useState(t?.allDay ? Math.max(1, Math.round(t.minutes / 1440)) : 1)
  const [calendarId, setCalendarId] = useState(t?.calendarId && calendars.some((c) => c.id === t.calendarId) ? t.calendarId : '')
  const [useDefaultReminder, setUseDefaultReminder] = useState(t?.reminders?.useDefault ?? true)
  const [reminders, setReminders] = useState<number[]>((t?.reminders?.overrides ?? []).map((o) => o.minutes))
  const [colorId, setColorId] = useState(t?.colorId ?? '')
  const [location, setLocation] = useState(t?.location ?? '')
  const [mapUrl, setMapUrl] = useState(t?.mapUrl ?? '')
  const [description, setDescription] = useState(htmlToText(t?.description))
  const [err, setErr] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // 長さ(分)。終了が開始と同じか前なら翌日まで
  const minutes = allDay ? days * 1440 : ((toMin(endTime) - toMin(startTime) + 1440) % 1440) || 1440
  const preview: Template = { id: t?.id ?? '', title, allDay, startTime, minutes }

  function applyPasted(text: string) {
    const { url, place } = parsePastedPlace(text)
    if (!url && !place) return setMapUrl(text.trim())
    if (url) setMapUrl(url)
    if (place) setLocation(place)
  }

  function save() {
    setErr('')
    if (!title.trim()) return setErr('名前(予定のタイトル)を入力してください')
    if (!allDay && (!startTime || !endTime)) return setErr('開始と終了の時刻を入力してください')
    if (allDay && (!Number.isFinite(days) || days < 1)) return setErr('日数は1以上にしてください')
    const url = mapUrl.trim()
    if (url && !isMapUrl(url)) return setErr('地図のリンクは Google マップのリンク(https://maps.app.goo.gl/… など)を貼り付けてください')
    const rem: CalendarEvent['reminders'] = useDefaultReminder
      ? { useDefault: true }
      : { useDefault: false, overrides: reminders.slice(0, 5).map((m) => ({ method: 'popup', minutes: m })) }
    onSave({
      id: t?.id ?? newTemplateId(),
      title: title.trim(),
      allDay,
      startTime: allDay ? (t?.startTime ?? '09:00') : startTime,
      minutes,
      calendarId: calendarId || undefined,
      colorId: colorId || undefined,
      location: location.trim() || undefined,
      mapUrl: url || undefined,
      description: description.trim() ? description : undefined,
      reminders: rem,
    })
  }

  const eventColors = Object.entries(colors?.event ?? {})

  return (
    <div className="modal-backdrop">
      <div className="modal editor" role="dialog" aria-modal="true" aria-label={isNew ? 'テンプレートを作成' : 'テンプレートを編集'}>
        <h2 className="editor-title">{isNew ? '新しいテンプレート' : 'テンプレートを編集'}</h2>

        <label className="field">
          <span>名前(予定のタイトルになります)</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 早番、定例会議" />
        </label>

        <label className="check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> 終日
        </label>
        {allDay ? (
          <label className="field">
            <span>日数</span>
            <span className="field-inline">
              <input type="number" min={1} className="num" value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} /> 日間
            </span>
          </label>
        ) : (
          <div className="field">
            <span>時間</span>
            <span className="field-inline">
              <input type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="開始時刻" /> 〜
              <input type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="終了時刻" />
            </span>
            <span className="hint small-text">終了が開始より前のときは翌日までの予定になります(夜勤など)。</span>
          </div>
        )}
        <p className="small-text muted">登録される時間: {describeTemplate(preview)}</p>

        <label className="field">
          <span>カレンダー</span>
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
            <option value="">指定しない(追加するときに選ぶ・最初の書き込めるカレンダー)</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summaryOverride || c.summary}
              </option>
            ))}
          </select>
          <span className="hint small-text">既存のカレンダーは、「既存カレンダーの編集」で許可しているときだけ、そのカレンダーに登録できます。</span>
        </label>

        <fieldset className="box">
          <legend>通知</legend>
          <label className="check">
            <input type="checkbox" checked={useDefaultReminder} onChange={(e) => setUseDefaultReminder(e.target.checked)} /> カレンダーの既定の通知を使う
          </label>
          {!useDefaultReminder && (
            <div className="chips-select">
              {REMINDERS.map((o) => (
                <label key={o.min} className={reminders.includes(o.min) ? 'on' : ''}>
                  <input
                    type="checkbox"
                    checked={reminders.includes(o.min)}
                    onChange={(e) => setReminders(e.target.checked ? [...reminders, o.min] : reminders.filter((m) => m !== o.min))}
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
              <button type="button" className={`color-dot none ${colorId === '' ? 'on' : ''}`} onClick={() => setColorId('')} title="カレンダーの色">
                ✕
              </button>
              {eventColors.map(([id, c]) => (
                <button key={id} type="button" className={`color-dot ${colorId === id ? 'on' : ''}`} style={{ background: c.background }} onClick={() => setColorId(id)} aria-label={`色 ${id}`} />
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span>場所</span>
          <div className="field-inline">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="住所や場所の名前" />
            <a className="button small ghost" href={mapSearchUrl(location)} target="_blank" rel="noopener noreferrer">
              地図で探す
            </a>
          </div>
        </div>
        <div className="field">
          <span>地図のリンク(任意)</span>
          <div className="field-inline">
            <input
              value={mapUrl}
              onChange={(e) => setMapUrl(e.target.value)}
              onPaste={(e) => {
                e.preventDefault()
                applyPasted(e.clipboardData.getData('text'))
              }}
              placeholder="地図のアドレス欄の URL や、共有でコピーした文章"
              inputMode="url"
              className={mapUrl.trim() && !isMapUrl(mapUrl) ? 'invalid' : ''}
            />
            {mapUrl && (
              <button type="button" className="small ghost" onClick={() => setMapUrl('')} aria-label="地図のリンクを消す">✕</button>
            )}
          </div>
        </div>
        <label className="field">
          <span>メモ</span>
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {err && <p className="error">{err}</p>}
        <div className="modal-actions">
          <button className="small ghost" onClick={onCancel}>キャンセル</button>
          <button className="small" onClick={save}>{isNew ? '作成' : '保存'}</button>
        </div>
      </div>
    </div>
  )
}
