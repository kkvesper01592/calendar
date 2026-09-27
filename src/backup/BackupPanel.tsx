import { useEffect, useState } from 'react'
import type { AccessToken } from '../google/auth'
import { canPickFolder, pickFolder } from './saveToFolder'
import { getRememberedFolder } from '../settings/cloudSettings'
import { getAutoDir, lastAutoBackup, LATEST_FOLDER, permission, requestPermission, runBackupTo, setAutoDir, type LatestBackup } from './autoBackup'

interface Props {
  token: AccessToken
  onError: (e: unknown) => void
  onDone: () => void
  // 開いている間の定期バックアップ(「最新」フォルダに上書き)
  periodic: {
    minutes: number // 0 = しない
    onMinutes: (m: number) => void
    last: LatestBackup | null
    status: string
    onRunNow: () => void
  }
}

export default function BackupPanel({ token, onError, onDone, periodic }: Props) {
  const [dir, setDir] = useState<FileSystemDirectoryHandle | undefined>()
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [last, setLast] = useState(lastAutoBackup())

  useEffect(() => {
    getAutoDir().then(setDir)
  }, [])

  const addLog = (m: string) =>
    setLog((l) => (l.at(-1)?.includes('取得中…') && m.includes('取得中…') ? [...l.slice(0, -1), m] : [...l, m]))

  async function choose() {
    try {
      const h = await pickFolder()
      await setAutoDir(h)
      setDir(h)
    } catch {
      /* キャンセル */
    }
  }

  async function runNow() {
    if (!dir) return
    if ((await permission(dir)) !== 'granted' && !(await requestPermission(dir))) {
      onError(new Error('保存先フォルダへの書き込みが許可されませんでした'))
      return
    }
    setBusy(true)
    setLog([])
    try {
      const r = await runBackupTo(dir, token, addLog)
      addLog(`保存完了: ${dir.name}\\${r.folderName}(予定 ${r.events} 件)`)
      setLast(lastAutoBackup())
      onDone()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  if (!canPickFolder()) {
    return (
      <section className="card">
        <h2>バックアップ</h2>
        <p className="warn">このブラウザはフォルダへの保存に対応していません。PC の Edge か Chrome で開いてください。</p>
      </section>
    )
  }

  return (
    <section className="card backup">
      <h2>自動バックアップ</h2>
      <p className="hint">
        PC でこのアプリを開くと、その日の最初の1回だけ、全カレンダーの予定を保存先フォルダに
        <code>backup_日時</code> として保存します(JSON・.ics・予定一覧.html)。古いバックアップは自動では削除しません。
      </p>
      <dl className="kv">
        <dt>保存先</dt>
        <dd>
          {dir ? <code>{dir.name}</code> : '未設定'}{' '}
          <button className="small" onClick={choose} disabled={busy}>
            {dir ? '変更' : 'フォルダを選ぶ'}
          </button>
        </dd>
        <dt>前回</dt>
        <dd>{last ? `${new Date(last.at).toLocaleString('ja-JP')}(予定 ${last.events} 件 / ${last.folderName})` : 'まだありません'}</dd>
      </dl>
      {!dir && getRememberedFolder() && (
        <p className="warn small-text">
          以前は「{getRememberedFolder()}」フォルダに保存していました(Google に保存した設定より)。ブラウザのデータが消えたため、同じフォルダをもう一度選んでください。
        </p>
      )}
      {!dir && (
        <p className="hint">
          おすすめ: 「ドキュメント」などに「カレンダーのバックアップ」のようなフォルダを作って選んでください。
        </p>
      )}
      <button onClick={runNow} disabled={!dir || busy}>
        {busy ? 'バックアップ中…' : '今すぐバックアップ'}
      </button>

      <h3 className="small-heading">開いている間の定期バックアップ</h3>
      <p className="hint small-text">
        アプリを開いている間、決まった間隔で全カレンダーの予定を保存先の「{LATEST_FOLDER}」フォルダに上書き保存します(裏で行うので操作は止まりません)。
        アプリを閉じる瞬間には保存できない(ブラウザの決まり)ため、閉じる時点でも直前の状態が残るように、この方法で保存しています。
        スマホや Google カレンダーで直接変えた内容も、次の回に保存されます。毎日の backup_日時 フォルダは今までどおり残ります。
      </p>
      <label className="field">
        <span>間隔</span>
        <select value={periodic.minutes} onChange={(e) => periodic.onMinutes(Number(e.target.value))}>
          <option value={10}>10分ごと</option>
          <option value={30}>30分ごと</option>
          <option value={60}>1時間ごと</option>
          <option value={0}>しない</option>
        </select>
      </label>
      <p className="small-text">
        前回: {periodic.last ? `${new Date(periodic.last.at).toLocaleString('ja-JP')}(予定 ${periodic.last.events} 件)` : 'まだありません'}
        {periodic.minutes > 0 && dir && (
          <>
            {' '}
            <button
              className="small ghost"
              onClick={async () => {
                // ボタン操作の中なので、許可が無ければここで許可を求められる
                if ((await permission(dir)) !== 'granted' && !(await requestPermission(dir))) {
                  onError(new Error('保存先フォルダへの書き込みが許可されませんでした'))
                  return
                }
                periodic.onRunNow()
              }}
            >
              今すぐ「{LATEST_FOLDER}」に保存
            </button>
          </>
        )}
      </p>
      {periodic.status && <p className="small-text muted">{periodic.status}</p>}
      {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}
    </section>
  )
}
