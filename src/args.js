const path = require('path')
const { extensions, formats, extension } = require('./formats')
function parseArgs(argv, cwd = process.cwd()) {
  const files = [], options = {}
  const allowed = { '--format': [...new Set(Object.values(formats).flat())], '--scale': ['25','50','75'], '--resolution': ['720p','1080p'] }
  let literal = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!literal && arg === '--') { literal = true; continue }
    const equal = arg.indexOf('='), key = equal > 0 ? arg.slice(0,equal) : arg
    if (!literal && allowed[key]) {
      const value = (equal > 0 ? arg.slice(equal+1) : argv[++i])?.toLowerCase()
      if (!allowed[key].includes(value)) throw new Error(`Invalid ${key}: ${value || '(missing)'}`)
      options[key.slice(2)] = value
      continue
    }
    if (!literal && arg.startsWith('--')) continue
    if (Object.values(extensions).flat().includes(extension(arg))) files.push(path.resolve(cwd, arg))
  }
  if (options.scale && options.resolution) throw new Error('Choose scale OR resolution')
  return { files: [...new Set(files)], format: options.format || null, scale: options.scale || null, resolution: options.resolution || null }
}
module.exports = { parseArgs }
