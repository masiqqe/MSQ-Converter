const { app, BrowserWindow, ipcMain, Notification } = require('electron')
const path = require('path')
const { execSync } = require('child_process')
const { convertFile, scaleFile, resolutionFile } = require('./converter')
const { registerAll } = require('./registry')

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

const validExts = ['jpg','jpeg','png','webp','ico','bmp','gif','avif','tiff',
                   'mp4','mkv','avi','mov','webm','flv','wmv','ts','mpg','mpeg',
                   'mp3','wav','flac','aac','ogg','m4a','wma']

const validFormats = ['png','jpg','webp','ico','gif','avif','gif_low',
                      'mp4','mkv','avi','webm','mov','mp4_low',
                      'mp3','wav','flac','aac','ogg',
                      'extract_mp3','extract_aac','extract_wav']

function parseArgs(argv) {
  const ignoredFlags = ['--allow-file-access-from-files', '--enable-logging', '--disable-gpu', '--no-sandbox']
  const raw = argv.filter(a => !ignoredFlags.includes(a) && a !== 'main.js' && !a.endsWith('main.js') && !a.endsWith('electron.exe') && a !== '.')

  let files = []
  let format = null
  let scale = null
  let resolution = null

  const scaleValues = ['25', '50', '75']
  const resolutionValues = ['720p', '1080p']

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i].trim()

    if (arg === '--format' || arg === '--scale' || arg === '--resolution') continue

    if (arg.startsWith('--')) continue

    if (arg.includes('\\') || arg.includes('/')) {
      const ext = arg.split('.').pop().toLowerCase()
      if (validExts.includes(ext)) files.push(arg)
      continue
    }

    const lower = arg.toLowerCase()

    if (!scale && scaleValues.includes(lower)) {
      scale = lower
    } else if (!resolution && resolutionValues.includes(lower)) {
      resolution = lower
    } else if (!format && validFormats.includes(lower)) {
      format = lower
    }
  }

  if (!format && !scale && !resolution && files.length > 0) {
    const ext = files[0].split('.').pop().toLowerCase()
    const imageExts = ['jpg','jpeg','png','webp','ico','bmp','gif','avif','tiff']
    const audioExts = ['mp3','wav','flac','aac','ogg','m4a','wma']
    if (imageExts.includes(ext)) format = 'png'
    else if (audioExts.includes(ext)) format = 'mp3'
    else format = 'mp4'
  }

  return { files, format: format || null, scale, resolution }
}

let mainWindow = null

function handlePaste() {
  const { clipboard } = require('electron')
  const img = clipboard.readImage()
  if (!img.isEmpty()) {
    const fs = require('fs')
    const os = require('os')
    const tmpPath = require('path').join(os.tmpdir(), 'msq_clip_' + Date.now() + '.png')
    fs.writeFileSync(tmpPath, img.toPNG())
    mainWindow.webContents.send('clipboard-image', { path: tmpPath })
    return
  }
  const { execFile } = require('child_process')
  execFile('powershell', [
    '-NoProfile', '-OutputFormat', 'Text', '-Command',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { $_ }'
  ], { timeout: 3000, encoding: 'utf8' }, (err, stdout) => {
    if (!err && stdout.trim()) {
      const validExts = ['jpg','jpeg','png','webp','ico','bmp','gif','avif','tiff','mp4','mkv','avi','mov','webm','flv','wmv','ts','mpg','mpeg','mp3','wav','flac','aac','ogg','m4a','wma']
      const files = stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(l => {
        const ext = l.split('.').pop().toLowerCase()
        return validExts.includes(ext)
      })
      if (files.length > 0) {
        mainWindow.webContents.send('paste-files', { files })
      }
    }
  })
}

function createWindow(files, format, scale, resolution) {
  const os = require('os')
  const release = os.release().split('.')[2]
  const isWin11 = parseInt(release) >= 22000

  mainWindow = new BrowserWindow({
    width: 700,
    height: 400,
    minWidth: 700,
    minHeight: 400,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'MSQ Converter',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    ...(isWin11 ? { backgroundMaterial: 'acrylic' } : {})
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.key === 'v') {
      handlePaste()
      event.preventDefault()
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('is-win11', isWin11)
    mainWindow.show()
    mainWindow.webContents.send('trigger-update-check')
    if (files && files.length > 0) {
        if (resolution) {
          mainWindow.webContents.send('resolution-files', { files, resolution, format })
        } else if (scale) {
          mainWindow.webContents.send('scale-files', { files, percent: scale, format })
        } else {
          mainWindow.webContents.send('convert-files', { files, targetFormat: format })
        }
    }
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('MSQ Converter')

  const { files, format, scale, resolution } = parseArgs(process.argv)

  const currentVersion = app.getVersion()
  let registeredVersion = null
  try {
    const output = execSync('reg query "HKCU\\Software\\MSQConverter" /v RegisteredVersion', { stdio: 'pipe' }).toString()
    const match = output.match(/RegisteredVersion\s+REG_SZ\s+(\S+)/)
    if (match) registeredVersion = match[1]
  } catch (e) {}

  if (registeredVersion !== currentVersion) {
    registerAll()
    try {
      execSync(`reg add "HKCU\\Software\\MSQConverter" /v RegisteredVersion /d "${currentVersion}" /f`, { stdio: 'pipe' })
    } catch (e) {}
  }

  createWindow(files, format, scale, resolution)

  const { globalShortcut } = require('electron')
  globalShortcut.register('CommandOrControl+V', () => {
    if (mainWindow && mainWindow.isFocused()) {
      handlePaste()
    }
  })
})

app.on('will-quit', () => {
  const { globalShortcut } = require('electron')
  globalShortcut.unregisterAll()
})

app.on('second-instance', (event, argv) => {
  const { files, format, scale, resolution } = parseArgs(argv)

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    if (files.length > 0) {
      if (resolution) {
        mainWindow.webContents.send('resolution-files', { files, resolution, format })
      } else if (scale) {
        mainWindow.webContents.send('scale-files', { files, percent: scale, format })
      } else {
        mainWindow.webContents.send('convert-files', { files, targetFormat: format })
      }
    }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const activeProcesses = new Map()

ipcMain.on('start-convert', async (event, { filePath, targetFormat, jobId }) => {
  try {
    await convertFile(filePath, targetFormat, (progress) => {
      event.reply('convert-progress', { jobId, filePath, progress })
    }, (proc, outputPath) => {
      activeProcesses.set(jobId, { proc, outputPath })
    })
    activeProcesses.delete(jobId)
    event.reply('convert-done', { jobId, filePath })
    new Notification({
      title: 'MSQ Converter',
      body: require('path').basename(filePath) + ' — готово',
      icon: path.join(__dirname, 'assets', 'icon.png')
    }).show()
  } catch (err) {
    activeProcesses.delete(jobId)
    event.reply('convert-error', { jobId, filePath, error: err.message })
  }
})

ipcMain.on('start-scale', async (event, { filePath, percent, format, jobId }) => {
  try {
    await scaleFile(filePath, percent, (progress) => {
      event.reply('convert-progress', { jobId, filePath, progress })
    }, format, (proc, outputPath) => {
      activeProcesses.set(jobId, { proc, outputPath })
    })
    activeProcesses.delete(jobId)
    event.reply('convert-done', { jobId, filePath })
    new Notification({
      title: 'MSQ Converter',
      body: require('path').basename(filePath) + ' — готово',
      icon: path.join(__dirname, 'assets', 'icon.png')
    }).show()
  } catch (err) {
    activeProcesses.delete(jobId)
    event.reply('convert-error', { jobId, filePath, error: err.message })
  }
})

ipcMain.on('start-resolution', async (event, { filePath, resolution, format, jobId }) => {
  try {
    await resolutionFile(filePath, resolution, (progress) => {
      event.reply('convert-progress', { jobId, filePath, progress })
    }, format, (proc, outputPath) => {
      activeProcesses.set(jobId, { proc, outputPath })
    })
    activeProcesses.delete(jobId)
    event.reply('convert-done', { jobId, filePath })
    new Notification({
      title: 'MSQ Converter',
      body: require('path').basename(filePath) + ' — готово',
      icon: path.join(__dirname, 'assets', 'icon.png')
    }).show()
  } catch (err) {
    activeProcesses.delete(jobId)
    event.reply('convert-error', { jobId, filePath, error: err.message })
  }
})

ipcMain.on('cancel-convert', (event, { jobId }) => {
  const entry = activeProcesses.get(jobId)
  if (entry) {
    const { proc, outputPath } = entry
    try {
      require('child_process').execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'pipe' })
    } catch(e) {
      proc.kill()
    }
    activeProcesses.delete(jobId)
    setTimeout(() => {
      try {
        const fs = require('fs')
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      } catch(e) {}
    }, 800)
  }
})

ipcMain.on('paste-image', () => handlePaste())

ipcMain.on('window-minimize', () => mainWindow.minimize())
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window-close', () => mainWindow.close())

const https = require('https')

function checkForUpdates() {
  const options = {
    hostname: 'api.github.com',
    path: '/repos/masiqqe/MSQ-Converter/releases/latest',
    headers: { 'User-Agent': 'MSQ-Converter' }
  }

  https.get(options, (res) => {
    let data = ''
    res.on('data', chunk => data += chunk)
    res.on('end', () => {
  try {
    const release = JSON.parse(data)
    const latest = release.tag_name.replace('v', '')
    const current = app.getVersion()
    if (latest !== current) {
      const asset = release.assets.find(a => a.name.endsWith('.exe'))
      const downloadUrl = asset ? asset.browser_download_url : release.html_url
      if (mainWindow) {
        mainWindow.webContents.send('update-available', { latest, downloadUrl })
      }
    } else {
      if (mainWindow && !mainWindow.isVisible()) app.quit()
    }
  } catch (e) {
    if (mainWindow && !mainWindow.isVisible()) app.quit()
  }
})
    }).on('error', () => {
      if (mainWindow && !mainWindow.isVisible()) app.quit()
    })
}

ipcMain.on('check-update', () => {
  checkForUpdates()
})

ipcMain.on('show-update-dialog', (event, { latest, downloadUrl }) => {
  const { dialog, shell } = require('electron')
  mainWindow.show()
  const result = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    title: 'Update available',
    message: `MSQ Converter v${latest} is available`,
    detail: 'Do you want to download and install the update?',
    buttons: ['Install', 'Later'],
    defaultId: 0
  })

  if (result === 0) {
    const fs = require('fs')
    const os = require('os')
    const tmpPath = path.join(os.tmpdir(), 'MSQ-Converter-Setup.exe')
    const file = fs.createWriteStream(tmpPath)

    const download = (url) => {
      require('https').get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          download(res.headers.location)
          return
        }
        res.pipe(file)
        file.on('finish', () => {
          file.close(() => {
            const { execFile } = require('child_process')
            execFile(tmpPath, ['/SILENT'], (err) => {})
            setTimeout(() => app.quit(), 2000)
          })
        })
      }).on('error', () => {
        fs.unlink(tmpPath, () => {})
        shell.openExternal(downloadUrl)
      })
    }

    download(downloadUrl)
  } else {
    if (!mainWindow.isVisible()) app.quit()
  }
})