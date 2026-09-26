import type { CSSProperties } from 'react'
import { useEffect, useRef } from 'react'
import { holidayName } from '../lib/holidays'
import { rokuyo } from '../lib/lunar'
import { WEEKDAYS, addDays, eventRange, hhmm, isAllDay, sameDay, textOn, ymd } from '../lib/dates'
import type { DisplayEvent } from './useRangeEvents'
import type { HoverHandlers } from './HoverPreview'
import { dayTone, usePrefs } from '../settings/prefs'

interface Props {
  days: Date[]
  byDay: Map<string, DisplayEvent[]>
  onOpen: (e: DisplayEvent) => void
  onPickDay?: (d: Date) => void
  showRokuyo: boolean
  showTime: boolean
  hover?: HoverHandlers
  onCreateAt?: (d: Date, hour: number) => void // 空いている時間をクリックして予定を追加
}

const HOUR_PX = 48
const HOURS = Array.from({ length: 24 }, (_, i) => i)

interface Placed {
  item: DisplayEvent
  top: number
  height: number
  col: number
  cols: number
  label: string
}

// その日の中での位置を計算し、重なる予定は横に並べる
function layoutDay(day: Date, items: DisplayEvent[]): Placed[] {
  const dayStart = day.getTime()
  const dayEnd = addDays(day, 1).getTime()
  const segs = items
    .filter((i) => !isAllDay(i.ev))
    .map((item) => {
      const { start, end } = eventRange(item.ev)
      const s = Math.max(start.getTime(), dayStart)
      const e = Math.min(Math.max(end.getTime(), start.getTime() + 15 * 60000), dayEnd)
      return { item, s, e, label: `${sameDay(start, day) ? hhmm(start) : '前日から'} – ${sameDay(end, day) ? hhmm(end) : '翌日'}` }
    })
    .sort((a, b) => a.s - b.s || b.e - a.e)

  const placed: Placed[] = []
  let group: (typeof segs[number] & { col: number })[] = []
  let groupEnd = 0
  const flush = () => {
    const cols = Math.max(...group.map((g) => g.col)) + 1
    for (const g of group) {
      placed.push({
        item: g.item,
        top: ((g.s - dayStart) / 3600000) * HOUR_PX,
        height: Math.max(((g.e - g.s) / 3600000) * HOUR_PX, 18),
        col: g.col,
        cols,
        label: g.label,
      })
    }
    group = []
  }
  for (const seg of segs) {
    if (group.length && seg.s >= groupEnd) flush()
    const colEnds: number[] = []
    for (const g of group) colEnds[g.col] = Math.max(colEnds[g.col] ?? 0, g.e)
    let col = colEnds.findIndex((end) => end <= seg.s)
    if (col < 0) col = colEnds.length
    group.push({ ...seg, col })
    groupEnd = Math.max(groupEnd, seg.e)
  }
  if (group.length) flush()
  return placed
}

/** 週表示・1日表示(時間軸つき) */
export default function TimeGridView({ days, byDay, onOpen, onPickDay, showRokuyo, showTime, hover, onCreateAt }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const today = new Date()
  const prefs = usePrefs()
  const cols = { gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }

  // 最初は朝8時あたりを表示
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = HOUR_PX * 8
  }, [days.length])

  const nowTop = ((today.getHours() * 60 + today.getMinutes()) / 60) * HOUR_PX

  return (
    <div className={`timegrid ${days.length === 1 ? 'single-day' : ''}`}>
      <div className="tg-body" ref={scroller}>
      <div className="tg-sticky">
      <div className="tg-head" style={cols}>
        <div />
        {days.map((d) => {
          const hol = holidayName(d.getFullYear(), d.getMonth() + 1, d.getDate())
          const bg = prefs.dayColors[ymd(d)]
          const cls = ['tg-day', dayTone(d, !!hol, prefs.holidayWeekdays), bg && 'tinted', sameDay(d, today) && 'today']
            .filter(Boolean)
            .join(' ')
          return (
            <button key={ymd(d)} className={cls} style={bg ? ({ '--daybg': bg } as CSSProperties) : undefined} onClick={() => onPickDay?.(d)} disabled={!onPickDay}>
              <span className="tg-wd">{WEEKDAYS[d.getDay()]}</span>
              <span className="daynum">{d.getDate()}</span>
              {showRokuyo && <span className="rokuyo">{rokuyo(d.getFullYear(), d.getMonth() + 1, d.getDate())}</span>}
              {hol && <span className="holiday">{hol}</span>}
            </button>
          )
        })}
      </div>

      <div className="tg-allday" style={cols}>
        <div className="tg-label">終日</div>
        {days.map((d) => (
          <div key={ymd(d)} className="tg-allday-cell">
            {(byDay.get(ymd(d)) ?? [])
              .filter((i) => isAllDay(i.ev))
              .map((item) => (
                <button
                  key={item.key}
                  className="chip allday"
                  style={{ background: item.color, color: textOn(item.color) }}
                  onClick={() => onOpen(item)}
                  {...hover?.(item)}
                >
                  {item.ev.summary || '(タイトルなし)'}
                </button>
              ))}
          </div>
        ))}
      </div>
      </div>

        <div className="tg-inner" style={{ ...cols, height: HOUR_PX * 24 }}>
          <div className="tg-hours">
            {HOURS.map((h) => (
              <div key={h} className="tg-hour" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : `${h}:00`}
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={ymd(d)}
              className={`tg-col ${onCreateAt ? 'creatable' : ''}`}
              onClick={(e) => {
                if (!onCreateAt || e.target !== e.currentTarget) return
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top
                onCreateAt(d, Math.min(23, Math.max(0, Math.floor(y / HOUR_PX))))
              }}
              title={onCreateAt ? 'クリックでこの時間に予定を追加' : undefined}
            >
              {HOURS.map((h) => (
                <div key={h} className="tg-line" style={{ top: h * HOUR_PX }} />
              ))}
              {sameDay(d, today) && <div className="tg-now" style={{ top: nowTop }} />}
              {layoutDay(d, byDay.get(ymd(d)) ?? []).map((p) => (
                <button
                  key={p.item.key}
                  className="tg-event"
                  style={{
                    top: p.top,
                    height: p.height,
                    left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                    width: `calc(${100 / p.cols}% - 3px)`,
                    background: p.item.color,
                    color: textOn(p.item.color),
                  }}
                  onClick={() => onOpen(p.item)}
                  {...hover?.(p.item)}
                >
                  <span className="tg-ev-title">{p.item.ev.summary || '(タイトルなし)'}</span>
                  {showTime && p.height >= 30 && <span className="tg-ev-time">{p.label}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
