const fs = require('fs')
// Checking only MZ/PE signatures misses truncated EXEs: their headers survive.
// Every section's raw data must fit inside the actual file.
function inspectWindowsExecutable(file, expectedSize) {
  const size = fs.statSync(file).size
  const invalid = reason => Object.assign(new Error(`Повреждён встроенный FFmpeg (${reason}). Закройте приложение и запустите новый portable EXE. Путь: ${file}`), {code:'ENGINE_INVALID'})
  if (expectedSize !== undefined && size !== expectedSize) throw invalid(`размер ${size}, ожидается ${expectedSize}`)
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(64)
    if (fs.readSync(fd, head, 0, 64, 0) !== 64 || head.toString('ascii',0,2) !== 'MZ') throw invalid('нет заголовка MZ')
    const pe = head.readUInt32LE(60), header = Buffer.alloc(24)
    if (pe < 64 || pe > size - 24 || fs.readSync(fd,header,0,24,pe) !== 24 || header.readUInt32LE(0) !== 0x4550) throw invalid('нет заголовка PE')
    const machine = header.readUInt16LE(4), count = header.readUInt16LE(6), optionalSize = header.readUInt16LE(20)
    const start = pe + 24 + optionalSize, length = count * 40
    if (!count || count > 96 || optionalSize < 2 || start + length > size) throw invalid('таблица секций')
    const sections = Buffer.alloc(length)
    if (fs.readSync(fd,sections,0,length,start) !== length) throw invalid('обрезана таблица секций')
    let requiredSize = start + length
    for (let i=0;i<count;i++) {
      const rawSize=sections.readUInt32LE(i*40+16), offset=sections.readUInt32LE(i*40+20)
      if (rawSize) requiredSize=Math.max(requiredSize,offset+rawSize)
    }
    if (size < requiredSize) throw invalid(`файл обрезан: ${size} из минимум ${requiredSize} байт`)
    return {size,machine,requiredSize}
  } finally {fs.closeSync(fd)}
}
module.exports={inspectWindowsExecutable}
