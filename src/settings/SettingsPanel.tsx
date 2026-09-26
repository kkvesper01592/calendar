import { ACCENTS, FONT_LABELS, type Prefs } from './prefs'
import { describeTemplate, type Template } from '../editing/templates'
import type { CalendarListEntry } from '../google/calendarReadApi'
import { isAppCalendar, isEditableRole } from '../google/calendarWriteApi'

const WD = ['日', '月', '火', '水', '木', '金', '土']

interface Props {
  prefs: Prefs
  onChange: (p: Prefs) => void
  templates: Template[]
  onTemplatesChange: (t: Template[]) => void
  calendars: CalendarListEntry[]
  canEditExisting: boolean // ログイン時に「予定の編集」が許可されているか
  onOpenImport?: () => void // PC のときだけ(フォルダの読み取りが必要)
}

/** 見た目・週・テンプレートの設定 */
export default function SettingsPanel({ prefs, onChange, templates, onTemplatesChange, calendars, canEditExisting, onOpenImport }: Props) {
  const existing = calendars.filter((c) => !isAppCalendar(c))
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v })
  const coloredDays = Object.keys(prefs.dayColors).sort()
  const updateTpl = (id: string, patch: Partial<Template>) => onTemplatesChange(templates.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  return (
    <>
      <section className="card settings">
        <h2>表示</h2>
        <div className="set-row">
          <span className="set-label">画面の明るさ</span>
          <div className="seg">
            {(
              [
                ['auto', '端末に合わせる'],
                ['light', 'ライト'],
                ['dark', 'ダーク'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} className={prefs.theme === v ? 'on' : ''} onClick={() => set('theme', v)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <span className="set-label">テーマ色</span>
          <div className="colors">
            {ACCENTS.map((c) => (
              <button key={c} className={`color-dot ${prefs.accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('accent', c)} aria-label={`テーマ色 ${c}`} />
            ))}
            <label className="color-custom" title="好きな色を選ぶ">
              <input type="color" value={prefs.accent} onChange={(e) => set('accent', e.target.value)} />
              その他
            </label>
          </div>
        </div>
        <div className="set-row">
          <span className="set-label">文字の大きさ</span>
          <div className="seg">
            {FONT_LABELS.map((l, i) => (
              <button key={l} className={prefs.fontScale === i ? 'on' : ''} onClick={() => set('fontScale', i)}>{l}</button>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={prefs.bold} onChange={(e) => set('bold', e.target.checked)} /> 予定の文字を太字にする
        </label>
      </section>

      <section className="card settings">
        <h2>週と休日</h2>
        <div className="set-row">
          <span className="set-label">週の始まり</span>
          <div className="seg">
            <button className={prefs.weekStart === 0 ? 'on' : ''} onClick={() => set('weekStart', 0)}>日曜日</button>
            <button className={prefs.weekStart === 1 ? 'on' : ''} onClick={() => set('weekStart', 1)}>月曜日</button>
          </div>
        </div>
        <div className="set-row">
          <span className="set-label">週表示の日数</span>
          <div className="seg">
            <button className={prefs.weekDays === 7 ? 'on' : ''} onClick={() => set('weekDays', 7)}>7日</button>
            <button className={prefs.weekDays === 5 ? 'on' : ''} onClick={() => set('weekDays', 5)}>5日(月〜金)</button>
            <button className={prefs.weekDays === 3 ? 'on' : ''} onClick={() => set('weekDays', 3)}>3日</button>
          </div>
        </div>
        <div className="set-row">
          <span className="set-label">休日(赤)にする曜日</span>
          <div className="weekdays">
            {WD.map((w, i) => (
              <label key={w} className={prefs.holidayWeekdays.includes(i) ? 'on' : ''}>
                <input
                  type="checkbox"
                  checked={prefs.holidayWeekdays.includes(i)}
                  onChange={(e) => set('holidayWeekdays', e.target.checked ? [...prefs.holidayWeekdays, i] : prefs.holidayWeekdays.filter((d) => d !== i))}
                />
                {w}
              </label>
            ))}
          </div>
        </div>
        <p className="hint small-text">祝日は曜日にかかわらず赤で表示します。</p>
      </section>

      <section className="card settings">
        <h2>既存カレンダーの編集</h2>
        <p className="hint small-text">
          チェックを入れたカレンダーだけ、このアプリで予定の追加・変更・削除ができます。変更・削除の前の内容は必ず変更履歴に残り、「バックアップ」画面から元に戻せます。
          PC では、その日のバックアップが保存されるまで書き込みません。招待客などへの通知メールは送りません。
        </p>
        {!canEditExisting ? (
          <p className="warn small-text">
            ログイン時に「予定の表示と編集」が許可されていません。ログアウトして再ログインし、許可にチェックを入れてください。
          </p>
        ) : (
          <ul className="cal-list">
            {existing.map((c) => {
              const ok = isEditableRole(c)
              return (
                <li key={c.id}>
                  <label className={ok ? '' : 'muted'}>
                    <input
                      type="checkbox"
                      disabled={!ok}
                      checked={ok && prefs.editableCalendars.includes(c.id)}
                      onChange={(e) =>
                        set('editableCalendars', e.target.checked ? [...prefs.editableCalendars, c.id] : prefs.editableCalendars.filter((id) => id !== c.id))
                      }
                    />
                    <span className="swatch" style={{ background: c.backgroundColor as string }} />
                    {c.summaryOverride || c.summary}
                    {!ok && <span className="small-text">(閲覧のみの共有カレンダーのため編集できません)</span>}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card settings">
        <h2>テンプレート</h2>
        <p className="hint small-text">
          予定の詳細の「テンプレートに保存」で作れます。カレンダーの日付を右クリック(スマホは長押し)すると、テンプレートからすぐ登録できます。
        </p>
        {templates.length === 0 ? (
          <p className="muted">まだありません</p>
        ) : (
          <ul className="tpl-list">
            {templates.map((t) => (
              <li key={t.id}>
                <input className="tpl-title" value={t.title} onChange={(e) => updateTpl(t.id, { title: e.target.value })} aria-label="テンプレートの名前" />
                <label className="check tpl-allday">
                  <input type="checkbox" checked={t.allDay} onChange={(e) => updateTpl(t.id, { allDay: e.target.checked, minutes: e.target.checked ? 1440 : 60 })} /> 終日
                </label>
                {!t.allDay && (
                  <>
                    <input type="time" step={300} value={t.startTime} onChange={(e) => updateTpl(t.id, { startTime: e.target.value })} aria-label="開始時刻" />
                    <input
                      type="number"
                      min={5}
                      step={5}
                      className="num"
                      value={t.minutes}
                      onChange={(e) => updateTpl(t.id, { minutes: Math.max(5, Number(e.target.value) || 60) })}
                      aria-label="長さ(分)"
                    />
                    分
                  </>
                )}
                <span className="muted small-text">{describeTemplate(t)}</span>
                <button className="small danger" onClick={() => onTemplatesChange(templates.filter((x) => x.id !== t.id))}>削除</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {onOpenImport && (
        <section className="card settings">
          <h2>テキストから取り込み</h2>
          <p className="hint small-text">過去の仕事メモ(1ファイル=1日のテキスト)を読み取り、取り込み専用のカレンダーに予定として登録します(PC のみ)。</p>
          <button className="small" onClick={onOpenImport}>取り込み画面を開く</button>
        </section>
      )}

      <section className="card settings">
        <h2>日付の背景色</h2>
        <p className="hint small-text">日付を選んだときの一覧から色を付けられます。色はこの端末に保存されます。</p>
        {coloredDays.length === 0 ? (
          <p className="muted">色を付けた日はありません</p>
        ) : (
          <>
            <div className="colored-days">
              {coloredDays.map((d) => (
                <span key={d} className="colored-day" style={{ background: prefs.dayColors[d] }}>{d.replace(/-/g, '/')}</span>
              ))}
            </div>
            <button className="small ghost" onClick={() => set('dayColors', {})}>すべての色を消す</button>
          </>
        )}
      </section>
    </>
  )
}
