import type { CSSProperties } from 'react'
import { holidayName } from '../lib/holidays'
import { WEEKDAYS, monthGrid, sameDay, ymd } from '../lib/dates'
import type { DisplayEvent } from './useRangeEvents'
import { dayTone, usePrefs, weekOrder } from '../settings/prefs'

interface Props {
  year: number
  byDay: Map<string, DisplayEvent[]>
  onPickDay: (d: Date) => void
  onPickMonth: (month0: number) => void
}

/** 年表示: 12か月の小さなカレンダー。予定のある日には点を付ける */
export default function YearView({ year, byDay, onPickDay, onPickMonth }: Props) {
  const today = new Date()
  const prefs = usePrefs()
  return (
    <div className="year">
      {Array.from({ length: 12 }, (_, month0) => {
        const { days } = monthGrid(year, month0, prefs.weekStart)
        // 6週目がすべて翌月なら省く
        const shown = days[35].getMonth() !== month0 ? days.slice(0, 35) : days
        return (
          <section key={month0} className="mini">
            <button className="mini-title" onClick={() => onPickMonth(month0)}>
              {month0 + 1}月
            </button>
            <div className="mini-grid">
              {weekOrder(prefs.weekStart).map((dow) => (
                <div key={dow} className={`mini-wd ${prefs.holidayWeekdays.includes(dow) ? 'sun' : dow === 6 ? 'sat' : ''}`}>{WEEKDAYS[dow]}</div>
              ))}
              {shown.map((d) => {
                if (d.getMonth() !== month0) return <div key={ymd(d)} />
                const evs = byDay.get(ymd(d)) ?? []
                const hol = holidayName(d.getFullYear(), d.getMonth() + 1, d.getDate())
                const bg = prefs.dayColors[ymd(d)]
                const cls = ['mini-day', dayTone(d, !!hol, prefs.holidayWeekdays), bg && 'tinted', sameDay(d, today) && 'today']
                  .filter(Boolean)
                  .join(' ')
                return (
                  <button key={ymd(d)} className={cls} style={bg ? ({ '--daybg': bg } as CSSProperties) : undefined} onClick={() => onPickDay(d)} title={hol ?? (evs.length ? `予定 ${evs.length} 件` : '')}>
                    {d.getDate()}
                    {evs.length > 0 && <span className="mini-dot" style={{ background: evs[0].color }} />}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
