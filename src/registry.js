const { execSync } = require('child_process')
const path = require('path')

const formats = {
  image: ['gif', 'png', 'webp', 'jpg', 'ico', 'pdf'],
  video: ['mkv', 'mp4', 'mp4_low', 'webm', 'ogv', 'avi', 'gif', 'gif_low', 'extract_mp3', 'extract_aac', 'extract_wav', 'ogg', 'mp3', 'aac'],
  audio: ['ogg', 'flac', 'wav', 'mp3', 'aac'],
  gif: ['mkv', 'mp4', 'mp4_low', 'webm', 'avi', 'gif_low', 'png', 'webp', 'jpg'],
}

const scaleImageFormats = ['png', 'jpg', 'webp']
const scaleVideoFormats = ['mp4', 'webm', 'ogv']
const scaleGifFormats = ['mp4', 'gif', 'ogv']

const extensions = {
  image: ['jpg','jpeg','png','webp','ico','bmp','tiff','avif','pdf'],
  video: ['mp4','mkv','avi','mov','webm','flv','wmv','ts','mpg','mpeg'],
  audio: ['mp3','wav','flac','aac','ogg','m4a','wma','opus'],
  gif: ['gif'],
}

function getElectronCmd() {
  let electronExe
  // Если запущено из установленной версии
  if (process.execPath && !process.execPath.includes('node_modules')) {
    electronExe = process.execPath
  } else {
    // Dev версия
    electronExe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe')
  }
  const mainJs = path.join(__dirname, 'main.js')
  return { electronExe, mainJs }
}

function getCommand(format) {
  const { electronExe, mainJs } = getElectronCmd()
  if (process.execPath && !process.execPath.includes('node_modules')) {
    return `\\"${electronExe}\\" --format ${format} \\"%1\\"`
  }
  return `\\"${electronExe}\\" \\"${mainJs}\\" --format ${format} \\"%1\\"`
}

function getScaleFormatCommand(percent, format) {
  const { electronExe, mainJs } = getElectronCmd()
  if (process.execPath && !process.execPath.includes('node_modules')) {
    return `\\"${electronExe}\\" --scale ${percent} --format ${format} \\"%1\\"`
  }
  return `\\"${electronExe}\\" \\"${mainJs}\\" --scale ${percent} --format ${format} \\"%1\\"`
}

function reg(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (e) {}
}

function getLabel(fmt) {
  if (fmt === 'gif_low') return 'To Gif (low quality)'
  if (fmt === 'mp4_low') return 'To Mp4 (low quality)'
  if (fmt === 'extract_mp3') return 'Extract Audio → MP3'
  if (fmt === 'extract_aac') return 'Extract Audio → AAC'
  if (fmt === 'extract_wav') return 'Extract Audio → WAV'
  return 'To ' + fmt.charAt(0).toUpperCase() + fmt.slice(1)
}

function addScaleSubmenu(menuKey, percent, scaleFormats) {
  const key = `90_scale${percent}`
  const label = `Scale ${percent}%`
  const sk = `${menuKey}\\shell\\${key}`
  reg(`reg add "${sk}" /v "MUIVerb" /d "${label}" /f`)
  reg(`reg add "${sk}" /v "SubCommands" /d "" /f`)
  scaleFormats.forEach((fmt, i) => {
    const fk = `${sk}\\shell\\${String(i).padStart(2,'0')}_${fmt}`
    reg(`reg add "${fk}" /ve /d "${getLabel(fmt)}" /f`)
    reg(`reg add "${fk}\\command" /ve /d "${getScaleFormatCommand(percent, fmt)}" /f`)
  })
}

function addImageScaleSubmenu(menuKey) {
  const scaleOptions = [
    { key: '90_scale75', label: 'Scale 75%', value: '75' },
    { key: '91_scale25', label: 'Scale 25%', value: '25' },
  ]
  scaleOptions.forEach(({ key, label, value }) => {
    const sk = `${menuKey}\\shell\\${key}`
    reg(`reg add "${sk}" /v "MUIVerb" /d "${label}" /f`)
    reg(`reg add "${sk}" /v "SubCommands" /d "" /f`)
    scaleImageFormats.forEach((fmt, i) => {
      const fk = `${sk}\\shell\\${String(i).padStart(2,'0')}_${fmt}`
      reg(`reg add "${fk}" /ve /d "${getLabel(fmt)}" /f`)
      reg(`reg add "${fk}\\command" /ve /d "${getScaleFormatCommand(value, fmt)}" /f`)
    })
  })
}

function registerExtension(ext, type) {
  const isInstalled = !process.execPath.includes('node_modules')
const iconPath = isInstalled
  ? path.join(path.dirname(process.execPath), 'resources', 'assets', 'icon.ico')
  : path.join(__dirname, 'assets', 'icon.ico')
  const menuKey = `HKCU\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\ConvertFile`

  reg(`reg delete "${menuKey}" /f`)
  reg(`reg delete "HKCU\\Software\\Classes\\.${ext}\\shell\\ConvertFile" /f`)

  reg(`reg add "${menuKey}" /v "MUIVerb" /d "MSQ Converter" /f`)
  reg(`reg add "${menuKey}" /v "SubCommands" /d "" /f`)
  reg(`reg add "${menuKey}" /v "Icon" /d "${iconPath},0" /f`)
  
  formats[type].forEach((fmt, i) => {
    const subKey = `${menuKey}\\shell\\${String(i).padStart(2,'0')}_${fmt}`
    reg(`reg add "${subKey}" /ve /d "${getLabel(fmt)}" /f`)
    reg(`reg add "${subKey}\\command" /ve /d "${getCommand(fmt)}" /f`)
  })

  if (type === 'image') {
    addImageScaleSubmenu(menuKey)
  }

  if (type === 'video') {
    addScaleSubmenu(menuKey, '50', scaleVideoFormats)
  }

  if (type === 'gif') {
    addScaleSubmenu(menuKey, '50', scaleGifFormats)
  }
}

function registerAll() {
  Object.entries(extensions).forEach(([type, exts]) => {
    exts.forEach(ext => registerExtension(ext, type))
  })
}

function unregisterAll() {
  Object.entries(extensions).forEach(([type, exts]) => {
    exts.forEach(ext => {
      reg(`reg delete "HKCU\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\ConvertFile" /f`)
    })
  })
}

module.exports = { registerAll, unregisterAll }