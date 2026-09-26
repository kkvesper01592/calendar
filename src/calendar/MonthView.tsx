import type { CSSProperties } from 'react'
import { holidayName } from '../lib/holidays'
import { rokuyo } from '../lib/lunar'
import { WEEKDAYS, hhmm, isAllDay, monthGrid, sameDay, textOn, ymd, eventRange } from '../lib/dates'
import type { DisplayEvent } from './useRangeEvents'
import type { HoverHandlers } from './HoverPreview'
import { dayTone, usePrefs, weekOrder } from '../settings/prefs'

interface Props {
  year: number
  month0: number
  byDay: Map<string, DisplayEvent[]>
  selected: Date
  onSelect: (d: Date) => void
  onOpen: (e: DisplayEvent) => void
  showRokuyo: boolean
  showTime: boolean
  chipsClickable: boolean // スマホでは予定が小さすぎるので、日付ごとタップにする
  hover?: HoverHandlers
  isMemo?: (e: DisplayEvent) => boolean
  onCreate?: (d: Date) => void // 日付のダブルクリックで予定を追加
  onQuickAdd?: (d: Date) => void // 右クリック・長押しでテンプレートから追加
}

const MAX_CHIPS = 4

export default function MonthView({ year, month0, byDay, selected, onSelect, onOpen, showRokuyo, showTime, chipsClickable, hover, isMemo, onCreate, onQuickAdd }: Props) {
  const prefs = usePrefs()
  const { days } = monthGrid(year, month0, prefs.weekStart)
  const today = new Date()

  return (
    <div className="month">
      <div className="month-head">
        {weekOrder(prefs.weekStart).map((dow) => (
          <div key={dow} className={`wd ${prefs.holidayWeekdays.includes(dow) ? 'sun' : dow === 6 ? 'sat' : ''}`}>{WEEKDAYS[dow]}</div>
        ))}
      </div>
      <div className="month-grid">
        {days.map((d) => {
          const y = d.getFullYear()
          const m = d.getMonth() + 1
          const hol = holidayName(y, m, d.getDate())
          const evs = byDay.get(ymd(d)) ?? []
          const cls = [
            'cell',
            d.getMonth() !== month0 && 'other',
            sameDay(d, today) && 'today',
            sameDay(d, selected) && 'selected',
            dayTone(d, !!hol, prefs.holidayWeekdays),
            prefs.dayColors[ymd(d)] && 'tinted',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={ymd(d)}
              className={cls}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(d)}
              onDoubleClick={() => onCreate?.(d)}
              onContextMenu={(e) => {
                if (!onQuickAdd) return
                e.preventDefault()
                onQuickAdd(d)
              }}
              style={prefs.dayColors[ymd(d)] ? ({ '--daybg': prefs.dayColors[ymd(d)] } as CSSProperties) : undefined}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(d)}
              aria-label={`${m}月${d.getDate()}日 予定${evs.length}件`}
            >
              <div className="cell-top">
                <span className="daynum">{d.getDate()}</span>
                {showRokuyo && <span className="rokuyo">{rokuyo(y, m, d.getDate())}</span>}
              </div>
              {hol && <div className="holiday">{hol}</div>}
              <div className="chips">
                {evs.slice(0, MAX_CHIPS).map((item) => {
                  const allDay = isAllDay(item.ev)
                  const title = (isMemo?.(item) ? '📝 ' : '') + (item.ev.summary || '(タイトルなし)')
                  const style = allDay ? { background: item.color, color: textOn(item.color) } : { borderLeftColor: item.color }
                  const content = (
                    <>
                      {showTime && !allDay && <span className="t">{hhmm(eventRange(item.ev).start)}</span>}
                      {title}
                    </>
                  )
                  return chipsClickable ? (
                    <button
                      key={item.key}
                      className={`chip ${allDay ? 'allday' : 'timed'}`}
                      style={style}
                      {...hover?.(item)}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(item)
                      }}
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={item.key} className={`chip ${allDay ? 'allday' : 'timed'}`} style={style}>
                      {content}
                    </div>
                  )
                })}
                {evs.length > MAX_CHIPS && <div className="more">+{evs.length - MAX_CHIPS}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
