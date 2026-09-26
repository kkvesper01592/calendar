import { holidayName } from '../lib/holidays'
import { rokuyo, toLunar } from '../lib/lunar'
import { mdw, timeOnDay, isAllDay } from '../lib/dates'
import type { DisplayEvent } from './useRangeEvents'
import type { HoverHandlers } from './HoverPreview'
import { DAY_COLORS } from '../settings/prefs'

interface Props {
  day: Date
  events: DisplayEvent[]
  showTime: boolean
  onOpen: (e: DisplayEvent) => void
  onClose?: () => void // スマホの下から出る表示のとき
  onShowDay?: () => void
  hover?: HoverHandlers
  isMemo?: (e: DisplayEvent) => boolean
  onAdd?: () => void // 書き込めるときだけ
  onMemo?: (existing?: DisplayEvent) => void
  onQuickAdd?: () => void
  dayColor?: string
  onDayColor?: (color: string | null) => void
}

/** 選んだ日の予定を1行ずつ並べる(内容はタップで個別に開く) */
export default function DayList({ day, events: all, showTime, onOpen, onClose, onShowDay, hover, isMemo, onAdd, onMemo, onQuickAdd, dayColor, onDayColor }: Props) {
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
      {onDayColor && (
        <div className="day-colors" aria-label="この日の背景色">
          <button className={`color-dot none ${!dayColor ? 'on' : ''}`} onClick={() => onDayColor(null)} title="色なし">✕</button>
          {DAY_COLORS.map((c) => (
            <button key={c} className={`color-dot ${dayColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onDayColor(c)} aria-label={`背景色 ${c}`} />
          ))}
        </div>
      )}
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
        <ul className="rows">
          {events.map((item) => (
            <li key={item.key}>
              <button className="row" onClick={() => onOpen(item)} {...hover?.(item)}>
                <span className="bar" style={{ background: item.color }} />
                {showTime && <span className={`row-time ${isAllDay(item.ev) ? 'allday' : ''}`}>{timeOnDay(item.ev, day)}</span>}
                <span className="row-title">{item.ev.summary || '(タイトルなし)'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="day-list-actions">
        {onAdd && (
          <button className="small" onClick={onAdd}>
            ＋ 予定を追加
          </button>
        )}
        {onQuickAdd && (
          <button className="small ghost" onClick={onQuickAdd}>
            テンプレートから追加
          </button>
        )}
        {onShowDay && (
          <button className="small ghost" onClick={onShowDay}>
            1日表示で見る
          </button>
        )}
      </div>
    </aside>
  )
}
