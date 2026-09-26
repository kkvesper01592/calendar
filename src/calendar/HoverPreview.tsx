import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { EventBody } from './EventDetail'
import type { DisplayEvent } from './useRangeEvents'

export type HoverHandlers = (item: DisplayEvent) => {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void
  onMouseLeave: () => void
}

interface Shown {
  item: DisplayEvent
  rect: DOMRect
  mouseX: number
}

const SHOW_DELAY = 150 // 最初の表示までの待ち時間(素早く通り過ぎた時に出さない)
const HIDE_DELAY = 80 // 隣の予定へ移る間に消えてちらつかないように

/** 予定にカーソルを合わせると内容をカードで表示する(マウスが使える端末のみ) */
export function useHoverPreview(enabled: boolean) {
  const [shown, setShown] = useState<Shown | null>(null)
  const showing = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    showing.current = false
    setShown(null)
  }, [])

  const handlers: HoverHandlers = useCallback(
    (item) => ({
      onMouseEnter: (e) => {
        if (!enabled) return
        const rect = e.currentTarget.getBoundingClientRect()
        const mouseX = e.clientX
        window.clearTimeout(timer.current)
        const show = () => {
          showing.current = true
          setShown({ item, rect, mouseX })
        }
        // すでに表示中なら即座に切り替える
        if (showing.current) show()
        else timer.current = window.setTimeout(show, SHOW_DELAY)
      },
      onMouseLeave: () => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(hide, HIDE_DELAY)
      },
    }),
    [enabled, hide],
  )

  // スクロールしたら位置がずれるので消す。クリックでも消す(一覧が閉じたり切り替わって、カードが残らないように)
  useEffect(() => {
    if (!shown) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('pointerdown', hide, true)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('pointerdown', hide, true)
    }
  }, [shown, hide])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { handlers, shown, hide }
}

const MARGIN = 8

/** 予定の横に出すカード。マウス操作の邪魔をしないようクリックは素通りさせる */
export function HoverCard({ item, rect, mouseX }: Shown) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left: number
    if (rect.width > window.innerWidth / 2) {
      // 横に長い行(下から出る一覧など)は行の横に空きが無いので、行の右端(文字の無い所)に重ねる。
      // カーソルが右寄りなら左端に
      left = rect.right - w - 16
      if (left < mouseX + 24) left = rect.left + 16
    } else {
      // 右側に置き、はみ出すなら左側
      left = rect.right + MARGIN
      if (left + w > window.innerWidth - MARGIN) left = rect.left - w - MARGIN
    }
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN))
    const top = Math.max(MARGIN, Math.min(rect.top, window.innerHeight - h - MARGIN))
    setPos({ left, top })
  }, [item, rect, mouseX])

  return (
    <div
      ref={ref}
      className="hover-card"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
    >
      <div className="modal-bar" style={{ background: item.color }} />
      <EventBody item={item} />
    </div>
  )
}
