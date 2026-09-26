import { useEffect, useRef, useState } from 'react'
import type { AccessToken } from '../google/auth'
import { listEventsInRange, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
import { eventDayKeys, eventRange, isAllDay, ymd } from '../lib/dates'

export interface DisplayEvent {
  key: string
  ev: CalendarEvent
  calendar: CalendarListEntry
  color: string
}

export type Colors = { event?: Record<string, { background: string }> }

export function toDisplay(ev: CalendarEvent, cal: CalendarListEntry, colors: Colors | null): DisplayEvent {
  const color =
    (typeof ev.colorId === 'string' && colors?.event?.[ev.colorId]?.background) || (cal.backgroundColor as string) || '#4285f4'
  return { key: `${cal.id}|${ev.id}`, ev, calendar: cal, color }
}

/** 終日を先に、その後は開始時刻順 */
export function compareEvents(a: DisplayEvent, b: DisplayEvent): number {
  const ad = isAllDay(a.ev) ? 0 : 1
  const bd = isAllDay(b.ev) ? 0 : 1
  return ad - bd || eventRange(a.ev).start.getTime() - eventRange(b.ev).start.getTime()
}

/** 期間内の予定を、見えているカレンダーから取得して日付(YYYY-MM-DD)ごとにまとめる */
export function useRangeEvents(
  token: AccessToken | null,
  calendars: CalendarListEntry[],
  hidden: Set<string>,
  colors: Colors | null,
  start: Date,
  end: Date,
  reloadKey: number,
  onError: (e: unknown) => void,
) {
  const cache = useRef(new Map<string, CalendarEvent[]>())
  const [byDay, setByDay] = useState(new Map<string, DisplayEvent[]>())
  const [loading, setLoading] = useState(false)
  const startKey = ymd(start)
  const endKey = ymd(end)

  useEffect(() => {
    cache.current.clear()
  }, [reloadKey])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const visible = calendars.filter((c) => !hidden.has(c.id))
    setLoading(true)
    Promise.all(
      visible.map(async (cal) => {
        const k = `${cal.id}|${startKey}|${endKey}`
        let items = cache.current.get(k)
        if (!items) {
          items = await listEventsInRange(token, cal.id, start, end)
          cache.current.set(k, items)
        }
        return { cal, items }
      }),
    )
      .then((results) => {
        if (cancelled) return
        const map = new Map<string, DisplayEvent[]>()
        for (const { cal, items } of results) {
          for (const ev of items) {
            if (ev.status === 'cancelled' || !ev.start) continue
            const de = toDisplay(ev, cal, colors)
            for (const key of eventDayKeys(ev)) {
              const arr = map.get(key) ?? []
              arr.push(de)
              map.set(key, arr)
            }
          }
        }
        for (const arr of map.values()) arr.sort(compareEvents)
        setByDay(map)
      })
      .catch((e) => !cancelled && onError(e))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // start/end は日付キーで比較する。onError が変わっても再取得しない
  }, [token, calendars, hidden, colors, startKey, endKey, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { byDay, loading }
}
