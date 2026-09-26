import { useState } from 'react'
import { holidayName } from '../lib/holidays'
import { rokuyo, toLunar } from '../lib/lunar'
import { firstLine, mdw, timesOnDay } from '../lib/dates'
import type { DisplayEvent } from './useRangeEvents'
import type { HoverHandlers } from './HoverPreview'
import { DAY_COLORS } from '../settings/prefs'

interface Props {
  day: Date
  events: DisplayEvent[]
  showTime: boolean
  onOpen: (e: DisplayEvent) => void
  onClose?: () => void // スマホの下から出る表示のとき
  hover?: HoverHandlers
  isMemo?: (e: DisplayEvent) => boolean
  onAdd?: () => void // 書き込めるときだけ
  onMemo?: (existing?: DisplayEvent) => void
  dayColor?: string
  onDayColor?: (color: string | null) => void
}

/** 選んだ日の予定の一覧。左に開始・終了時刻、色の帯、タイトルとメモの1行目 */
export default function DayList({ day, events: all, showTime, onOpen, onClose, hover, isMemo, onAdd, onMemo, dayColor, onDayColor }: Props) {
  const [colorsOpen, setColorsOpen] = useState(false)
  const memo = isMemo ? all.find(isMemo) : undefined
  const events = isMemo ? all.filter((e) => !isMemo(e)) : all
  const y = day.getFullYear()
  const m = day.getMonth() + 1
  const d = day.getDate()
  const hol = holidayName(y, m, d)
  const lunar = toLunar(y, m, d)

  return (
    <aside className="day-list">
      <div className="day-list-head">
        <div>
          <h2>{mdw(day)}</h2>
          <p className="day-sub">
            {hol && <span className="holiday-tag">{hol}</span>}
            {rokuyo(y, m, d)} ／ 旧暦 {lunar.leap ? '閏' : ''}
            {lunar.month}月{lunar.day}日
          </p>
        </div>
        {onClose && <button className="modal-close static" onClick={onClose} aria-label="閉じる">×</button>}
      </div>

      {onMemo && (
        <button className="memo-box" onClick={() => onMemo(memo)}>
          {memo ? (
            <>
              <span className="memo-label">📝 メモ</span>
              <span className="memo-body">{memo.ev.description || memo.ev.summary}</span>
            </>
          ) : (
            <span className="muted">📝 この日のメモを書く</span>
          )}
        </button>
      )}
      {!onMemo && memo && (
        <p className="memo-box readonly">
          <span className="memo-label">📝 メモ</span>
          <span className="memo-body">{memo.ev.description || memo.ev.summary}</span>
        </p>
      )}

      {events.length === 0 ? (
        <p className="empty">予定はありません</p>
      ) : (
        <ul className="day-rows">
          {events.map((item) => {
            const t = timesOnDay(item.ev, day)
            const note = firstLine(item.ev.description)
            return (
              <li key={item.key}>
                <button className={`day-row ${showTime ? '' : 'no-time'}`} onClick={() => onOpen(item)} {...hover?.(item)}>
                  {showTime && (
                    <span className="dr-time">
                      {t ? (
                        <>
                          <span>{t.start}</span>
                          <span>{t.end}</span>
                        </>
                      ) : (
                        <span>終日</span>
                      )}
                    </span>
                  )}
                  <span className="dr-bar" style={{ background: item.color }} />
                  <span className="dr-main">
                    <span className="dr-title">{item.ev.summary || '(タイトルなし)'}</span>
                    {note && <span className="dr-note">{note}</span>}
                  </span>
                  <span className="dr-chev" aria-hidden="true">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="day-list-actions">
        {onAdd && (
          <button className="small" onClick={onAdd}>
            ＋ 予定を追加
          </button>
        )}
        {onDayColor && (
          <button className={`small ghost ${colorsOpen ? 'active' : ''}`} onClick={() => setColorsOpen(!colorsOpen)} title="この日のマスの背景色">
            🎨 背景色
          </button>
        )}
      </div>
      {onDayColor && colorsOpen && (
        <div className="day-colors" aria-label="この日の背景色">
          <button className={`color-dot none ${!dayColor ? 'on' : ''}`} onClick={() => onDayColor(null)} title="色なし">✕</button>
          {DAY_COLORS.map((c) => (
            <button key={c} className={`color-dot ${dayColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onDayColor(c)} aria-label={`背景色 ${c}`} />
          ))}
        </div>
      )}
    </aside>
  )
}
