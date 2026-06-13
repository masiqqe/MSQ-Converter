const { ipcRenderer, webUtils } = require('electron')
const i18n = require('./i18n')

ipcRenderer.on('is-win11', (event, isWin11) => {
  document.body.classList.add(isWin11 ? 'win11' : 'win10')
  const backPath = basePath + '/back.png'
document.body.style.setProperty('--back-img', `url("file:///${backPath}")`)
})

document.getElementById('minBtn').addEventListener('click', () => {
  ipcRenderer.send('window-minimize')
})

document.getElementById('maxBtn').addEventListener('click', () => {
  ipcRenderer.send('window-maximize')
})

document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('window-close')
})

function addLog(message, type = '') {
  const logBody = document.getElementById('logBody')
  if (!logBody) return
  const time = new Date().toLocaleTimeString('ru-RU')
  const entry = document.createElement('div')
  entry.className = 'log-entry' + (type ? ' ' + type : '')
  entry.textContent = `[${time}] ${message}`
  logBody.appendChild(entry)
  logBody.scrollTop = logBody.scrollHeight
}

// Устанавливаем иконки кнопок
const basePath = (() => {
  const p = require('path')
  const local = p.join(__dirname, 'assets')
  const installed = p.join(process.resourcesPath, 'assets')
  return require('fs').existsSync(installed) ? installed.replace(/\\/g, '/') : local.replace(/\\/g, '/')
})()
document.getElementById('historyBtn').innerHTML = `<img src="file:///${basePath}/logs.png" style="width:100%;height:100%;object-fit:contain;opacity:0.6">`
document.getElementById('settingsBtn').innerHTML = `<img src="file:///${basePath}/settings.png" style="width:100%;height:100%;object-fit:contain;opacity:0.6">`
document.getElementById('historyBtn').addEventListener('click', () => {
  document.getElementById('logPanel').classList.toggle('open')
})

document.getElementById('logClose').addEventListener('click', () => {
  document.getElementById('logPanel').classList.remove('open')
})

// Получаем файлы от main процесса
ipcRenderer.on('convert-files', (event, data) => {
  const { files, targetFormat } = data
  files.forEach(file => addFileItem(file, targetFormat))
})

// Обновляем прогресс
ipcRenderer.on('convert-progress', (event, { filePath, progress }) => {
  const item = document.querySelector(`[data-path="${CSS.escape(filePath)}"]`)
  if (item) {
    item.querySelector('.progress-bar').style.width = progress + '%'
    item.querySelector('.status-text').textContent = 'Converting... ' + progress + '%'
  }
})

let closeTimer = null

function checkAllDoneAndScheduleClose() {
  const allItems = document.querySelectorAll('.file-item')
  if (allItems.length === 0) return

  const allFinished = Array.from(allItems).every(item => {
    const status = item.querySelector('.status-text').textContent
    return status === 'Done' || status === 'Error' || status === 'Cancelled'
  })

  if (allFinished && settings.autoClose) {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => window.close(), 5000)
  }
}

// Конвертация завершена
ipcRenderer.on('convert-done', (event, { filePath }) => {
  const item = document.querySelector(`[data-path="${CSS.escape(filePath)}"]`)
  if (item) {
    item.querySelector('.progress-bar').style.width = '100%'
    item.querySelector('.status-text').textContent = 'Done'
    item.querySelector('.check-icon').style.display = 'flex'
    const cancelBtn = item.querySelector('.cancel-btn')
    if (cancelBtn) cancelBtn.style.display = 'none'
  }
  const fileName = filePath.split('\\').pop()
  addLog(fileName + ' — готово', 'done')
  checkAllDoneAndScheduleClose()
})

// Ошибка конвертации
ipcRenderer.on('convert-error', (event, { filePath, error }) => {
  const item = document.querySelector(`[data-path="${CSS.escape(filePath)}"]`)
  if (item) {
    item.querySelector('.status-text').textContent = 'Error'
    item.querySelector('.status-text').style.color = 'red'
    item.querySelector('.progress-bar').style.background = 'red'
    item.querySelector('.progress-bar').style.width = '100%'
    const cancelBtn = item.querySelector('.cancel-btn')
    if (cancelBtn) cancelBtn.style.display = 'none'
    console.error('Ошибка:', error)
  }
  const fileName = filePath.split('\\').pop()
  addLog(fileName + ' — ошибка: ' + error, 'error')
  checkAllDoneAndScheduleClose()
})

function addFileItem(filePath, targetFormat) {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  const emptyState = document.getElementById('emptyState')
  if (emptyState) emptyState.remove()

  const fileList = document.getElementById('fileList')
  const fileName = filePath.split('\\').pop()
  const fileDir = filePath.substring(0, filePath.lastIndexOf('\\'))
  const newName = fileName.replace(/\.[^.]+$/, '') + '.' + targetFormat

  const item = document.createElement('div')
  item.className = 'file-item'
  item.setAttribute('data-path', filePath)
  item.innerHTML = `
    <div class="file-info">
      <div class="file-path">${fileDir}\\${newName}</div>
      <div class="file-from">Converted from ${filePath}</div>
    </div>
    <div class="file-status">
      <div class="status-text">Converting... 0%</div>
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width: 0%"></div>
      </div>
    </div>
    <button class="cancel-btn" data-cancel="${filePath}">✕</button>
    <div class="check-icon" style="display:none">✓</div>
  `

  fileList.appendChild(item)

  // Запускаем конвертацию
  ipcRenderer.send('start-convert', { filePath, targetFormat })
  addLog(fileName + ' → ' + targetFormat)
}
// Drag & Drop поддержка
const body = document.body

body.addEventListener('dragover', (e) => {
  e.preventDefault()
  e.stopPropagation()
  document.getElementById('fileList').style.background = 'rgba(255,255,255,0.1)'
})

body.addEventListener('dragleave', (e) => {
  e.preventDefault()
  e.stopPropagation()
  document.getElementById('fileList').style.background = ''
})

body.addEventListener('drop', (e) => {
  e.preventDefault()
  e.stopPropagation()
  document.getElementById('fileList').style.background = ''

  const files = Array.from(e.dataTransfer.files)
  if (files.length === 0) return

  files.forEach(file => {
    const filePath = webUtils.getPathForFile(file)
    const ext = file.name.split('.').pop().toLowerCase()
    const targetFormat = getTargetFormat(ext)
    addFileItem(filePath, targetFormat)
  })
})

function getTargetFormat(ext) {
  const videoFormats = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ogv', 'ts', 'mpg', 'mpeg']
  const audioFormats = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus']
  const imageFormats = ['jpg', 'jpeg', 'png', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'avif', 'gif']

  if (videoFormats.includes(ext)) return 'mp4'
  if (audioFormats.includes(ext)) return 'mp3'
  if (imageFormats.includes(ext)) return 'png'
  return 'mp4'
}

ipcRenderer.on('scale-files', (event, data) => {
  const { files, percent, format } = data
  files.forEach(file => addScaleItem(file, percent, format))
})

ipcRenderer.on('resolution-files', (event, data) => {
  const { files, resolution, format } = data
  files.forEach(file => addResolutionItem(file, resolution, format))
})

function addScaleItem(filePath, percent, format) {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  const emptyState = document.getElementById('emptyState')
  if (emptyState) emptyState.remove()

  const fileList = document.getElementById('fileList')
  const fileName = filePath.split('\\').pop()
  const ext = fileName.split('.').pop().toLowerCase()
  const outExt = format || ext

  const item = document.createElement('div')
  item.className = 'file-item'
  item.setAttribute('data-path', filePath)
  item.innerHTML = `
    <div class="file-info">
      <div class="file-path">${fileName} → Scale ${percent}%.${outExt}</div>
      <div class="file-from">From ${filePath}</div>
    </div>
    <div class="file-status">
      <div class="status-text">Processing...</div>
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width: 0%"></div>
      </div>
    </div>
    <button class="cancel-btn" data-cancel="${filePath}">✕</button>
    <div class="check-icon" style="display:none">✓</div>
  `
  fileList.appendChild(item)
  ipcRenderer.send('start-scale', { filePath, percent, format })
  addLog(fileName + ' → Scale ' + percent + '% .' + outExt)
}

function addResolutionItem(filePath, resolution, format) {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  const emptyState = document.getElementById('emptyState')
  if (emptyState) emptyState.remove()

  const fileList = document.getElementById('fileList')
  const fileName = filePath.split('\\').pop()
  const ext = fileName.split('.').pop().toLowerCase()
  const outExt = format || ext

  const item = document.createElement('div')
  item.className = 'file-item'
  item.setAttribute('data-path', filePath)
  item.innerHTML = `
    <div class="file-info">
      <div class="file-path">${fileName} → ${resolution}.${outExt}</div>
      <div class="file-from">From ${filePath}</div>
    </div>
    <div class="file-status">
      <div class="status-text">Processing...</div>
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width: 0%"></div>
      </div>
    </div>
    <button class="cancel-btn" data-cancel="${filePath}">✕</button>
    <div class="check-icon" style="display:none">✓</div>
  `
  fileList.appendChild(item)
  ipcRenderer.send('start-resolution', { filePath, resolution, format })
  addLog(fileName + ' → ' + resolution + ' .' + outExt)
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('cancel-btn')) {
    const filePath = e.target.getAttribute('data-cancel')
    ipcRenderer.send('cancel-convert', { filePath })
    const item = document.querySelector(`[data-path="${CSS.escape(filePath)}"]`)
    if (item) {
      item.querySelector('.status-text').textContent = 'Cancelled'
      item.querySelector('.status-text').style.color = '#999'
      item.querySelector('.progress-bar').style.background = '#ccc'
      e.target.style.display = 'none'
      const fileName = filePath.split('\\').pop()
      addLog(fileName + ' — отменено', 'cancelled')
    }
    checkAllDoneAndScheduleClose()
  }
})
// Настройки
const settings = {
  lang: localStorage.getItem('lang') || 'en',
  autoClose: localStorage.getItem('autoClose') !== 'false',
  autoUpdate: localStorage.getItem('autoUpdate') !== 'false',
}

function saveSettings() {
  localStorage.setItem('lang', settings.lang)
  localStorage.setItem('autoClose', settings.autoClose)
  localStorage.setItem('autoUpdate', settings.autoUpdate)
}

function applyLang() {
  const t = i18n[settings.lang]
  const emptyState = document.getElementById('emptyState')
  if (emptyState) emptyState.querySelector('p').textContent = t.emptyState
  document.querySelector('.log-header span').textContent = t.logs
  document.querySelector('.settings-header span').textContent = t.settingsTitle
  document.querySelectorAll('.settings-tab')[0].textContent = t.tabSettings
  document.querySelectorAll('.settings-tab')[1].textContent = t.tabAbout
  document.querySelectorAll('.setting-label')[0].textContent = t.language
  document.querySelectorAll('.setting-label')[1].textContent = t.autoClose
  document.querySelectorAll('.setting-label')[2].textContent = t.autoUpdate
  document.querySelector('.about-license').textContent = t.license
}

function applySettings() {
  document.getElementById('settingLang').value = settings.lang

  const autoCloseBtn = document.getElementById('toggleAutoClose')
  autoCloseBtn.textContent = settings.autoClose ? 'Yes' : 'No'
  autoCloseBtn.classList.toggle('off', !settings.autoClose)

  const autoUpdateBtn = document.getElementById('toggleAutoUpdate')
  autoUpdateBtn.textContent = settings.autoUpdate ? 'Yes' : 'No'
  autoUpdateBtn.classList.toggle('off', !settings.autoUpdate)
  applyLang()
}

document.getElementById('settingsBtn').addEventListener('click', () => {
  applySettings()
  applyLang()
  document.getElementById('settingsOverlay').classList.add('open')
})

document.getElementById('settingsClose').addEventListener('click', () => {
  document.getElementById('settingsOverlay').classList.remove('open')
})

document.getElementById('settingsOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsOverlay')) {
    document.getElementById('settingsOverlay').classList.remove('open')
  }
})

document.getElementById('settingLang').addEventListener('change', (e) => {
  settings.lang = e.target.value
  saveSettings()
  applyLang()
})

document.getElementById('toggleAutoClose').addEventListener('click', () => {
  settings.autoClose = !settings.autoClose
  saveSettings()
  applySettings()
})

document.getElementById('toggleAutoUpdate').addEventListener('click', () => {
  settings.autoUpdate = !settings.autoUpdate
  saveSettings()
  applySettings()
})

document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active')
  })
})

// About
const { shell } = require('electron')
const pkg = require('../package.json')

document.getElementById('aboutVersion').textContent = 'v' + pkg.version

const iconPath = require('path').join(__dirname, 'assets', 'icon.png')
document.getElementById('aboutIcon').style.backgroundImage = `url("${iconPath.replace(/\\/g, '/')}")`
document.getElementById('aboutIcon').style.backgroundSize = 'cover'
document.getElementById('aboutIcon').style.backgroundPosition = 'center'

document.getElementById('linkSite').addEventListener('click', () => {
  shell.openExternal('https://www.masiqqe.ru/')
})

document.getElementById('linkGithub').addEventListener('click', () => {
  shell.openExternal('https://github.com/masiqqe')
})

document.getElementById('linkTelegram').addEventListener('click', () => {
  shell.openExternal('https://t.me/masiqqee')
})
applyLang()