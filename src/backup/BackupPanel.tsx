import { useEffect, useState } from 'react'
import type { AccessToken } from '../google/auth'
import { canPickFolder, pickFolder } from './saveToFolder'
import { getRememberedFolder } from '../settings/cloudSettings'
import { getAutoDir, lastAutoBackup, permission, requestPermission, runBackupTo, setAutoDir } from './autoBackup'

interface Props {
  token: AccessToken
  onError: (e: unknown) => void
  onDone: () => void
}

export default function BackupPanel({ token, onError, onDone }: Props) {
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
      {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}
    </section>
  )
}
