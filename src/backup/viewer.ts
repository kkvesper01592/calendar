import type { CalendarEvent, EventDateTime } from '../google/calendarReadApi'
import type { FullBackup } from './collect'

const h = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const WD = ['日', '月', '火', '水', '木', '金', '土']

function fmt(dt: EventDateTime | undefined): string {
  if (!dt) return ''
  if (dt.date) {
    const [y, m, d] = dt.date.split('-').map(Number)
    return `${y}/${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]}) 終日`
  }
  if (!dt.dateTime) return ''
  const d = new Date(dt.dateTime)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`
}

function sortKey(ev: CalendarEvent): string {
  return ev.start?.dateTime ? new Date(ev.start.dateTime).toISOString() : (ev.start?.date ?? '')
}

function row(ev: CalendarEvent): string {
  const kind = ev.recurrence ? '繰り返し' : ev.recurringEventId ? '繰り返しの変更回' : ''
  return `<tr>
<td class="nowrap">${h(fmt(ev.start))}</td>
<td class="nowrap">${h(fmt(ev.end))}</td>
<td><b>${h(ev.summary || '(タイトルなし)')}</b>${kind ? `<div class="tag">${kind}</div>` : ''}${
    ev.recurrence ? `<div class="sub">${h(ev.recurrence.join(' / '))}</div>` : ''
  }</td>
<td>${h(ev.location)}</td>
<td class="desc">${h(ev.description)}</td>
</tr>`
}

/** バックアップ内容をブラウザで読める1枚の HTML にする(外部参照なし) */
export function toViewerHtml(b: FullBackup): string {
  const created = new Date(b.createdAt).toLocaleString('ja-JP')
  const sections = b.calendars
    .map((c, i) => {
      const live = c.events.filter((e) => e.status !== 'cancelled').sort((a, z) => sortKey(a).localeCompare(sortKey(z)))
      const cancelled = c.events.length - live.length
      const name = c.calendar.summaryOverride || c.calendar.summary
      return `<section id="cal${i}">
<h2><span class="dot" style="background:${h(c.calendar.backgroundColor)}"></span>${h(name)}</h2>
<p class="meta">予定 ${live.length} 件${cancelled ? `(このほか削除済みの記録 ${cancelled} 件は JSON にのみ保存)` : ''} ／ 権限: ${h(
        c.calendar.accessRole,
      )}${c.calendar.primary ? ' ／ メインカレンダー' : ''}</p>
${c.error ? `<p class="err">取得できませんでした: ${h(c.error)}</p>` : ''}
${
  live.length
    ? `<table><thead><tr><th>開始</th><th>終了</th><th>タイトル</th><th>場所</th><th>メモ</th></tr></thead><tbody>${live
        .map(row)
        .join('')}</tbody></table>`
    : ''
}
</section>`
    })
    .join('\n')

  const toc = b.calendars
    .map((c, i) => `<li><a href="#cal${i}">${h(c.calendar.summaryOverride || c.calendar.summary)}</a>(${c.events.filter((e) => e.status !== 'cancelled').length})</li>`)
    .join('')
  const total = b.calendars.reduce((n, c) => n + c.events.filter((e) => e.status !== 'cancelled').length, 0)

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>予定一覧(バックアップ ${h(created)})</title>
<style>
body{font-family:"Yu Gothic UI","Meiryo",sans-serif;margin:0;padding:16px 24px;color:#222;background:#fafafa;line-height:1.5}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 4px;display:flex;align-items:center;gap:8px}
.dot{width:14px;height:14px;border-radius:50%;display:inline-block;border:1px solid #0002}
.meta{color:#666;font-size:13px;margin:0 0 8px}.err{color:#b00020}
table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}
th,td{border:1px solid #ddd;padding:4px 8px;vertical-align:top;text-align:left}th{background:#f0f0f0;position:sticky;top:0}
.nowrap{white-space:nowrap}.desc{white-space:pre-wrap;max-width:420px;word-break:break-all}
.tag{display:inline-block;font-size:11px;background:#e8f0fe;color:#1a56c4;border-radius:4px;padding:0 6px;margin-top:2px}
.sub{font-size:11px;color:#888;word-break:break-all}
input{font-size:14px;padding:6px 10px;width:320px;max-width:100%;margin:8px 0}
.hidden{display:none}
</style></head><body>
<h1>Google カレンダー バックアップ 予定一覧</h1>
<p class="meta">取得日時: ${h(created)} ／ カレンダー ${b.calendars.length} 件 ／ 予定 合計 ${total} 件</p>
<p class="meta">このファイルは閲覧用です。復元には同じフォルダの .ics(Google カレンダーにインポート)または full_backup.json を使います。</p>
<ul>${toc}</ul>
<input id="q" type="search" placeholder="絞り込み(タイトル・場所・メモ)">
${sections}
<script>
document.getElementById('q').addEventListener('input',function(){var q=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(function(tr){tr.classList.toggle('hidden',q&&tr.textContent.toLowerCase().indexOf(q)<0)})});
</script>
</body></html>`
}
