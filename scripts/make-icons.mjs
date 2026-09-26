// アプリアイコン(PNG)を生成する。外部ライブラリなし
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

function crc32(buf) {
  let c, crc = 0xffffffff
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) raw.set(pixel(x / size, y / size), y * (size * 4 + 1) + 1 + x * 4)
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const BLUE = [47, 111, 219, 255], WHITE = [255, 255, 255, 255], RED = [217, 48, 37, 255], GRID = [205, 218, 240, 255]
// 全面青(マスク可能アイコン対応)の上に白いカレンダー
const icon = (x, y) => {
  const inPage = x > 0.24 && x < 0.76 && y > 0.28 && y < 0.76
  if (!inPage) return (x > 0.33 && x < 0.37 || x > 0.63 && x < 0.67) && y > 0.22 && y < 0.34 ? WHITE : BLUE
  if (y < 0.38) return RED
  const cx = (x - 0.24) / 0.52, cy = (y - 0.38) / 0.38
  const gx = Math.abs(cx * 4 - Math.round(cx * 4)) < 0.04, gy = Math.abs(cy * 3 - Math.round(cy * 3)) < 0.05
  return gx || gy ? GRID : WHITE
}
for (const s of [192, 512]) writeFileSync(`public/icon-${s}.png`, png(s, icon))
writeFileSync('public/apple-touch-icon.png', png(180, icon))
console.log('ok')
