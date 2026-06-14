const { app, BrowserWindow, ipcMain } = require('electron')
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

const validFormats = ['png','jpg','webp','ico','gif','avif',
                      'mp4','mkv','avi','webm','mov',
                      'mp3','wav','flac','aac','ogg']

function parseArgs(argv) {
  const args = argv.slice(2)
  let files = []
  let format = null
  let scale = null
  let resolution = null

  for (let i = 0; i < args.length; i++) {
    const arg = args[i].trim()
    if (arg === '--format') {
      if (args[i+1]) { format = args[i+1].trim().toLowerCase(); i++ }
    } else if (arg === '--scale') {
      if (args[i+1]) { scale = args[i+1].trim(); i++ }
    } else if (arg === '--resolution') {
      if (args[i+1]) { resolution = args[i+1].trim().toLowerCase(); i++ }
    } else if (arg.length > 0 && !arg.startsWith('--')) {
      const ext = arg.split('.').pop().toLowerCase()
      if (arg.includes('\\') || arg.includes('/')) {
        if (validExts.includes(ext)) files.push(arg)
      } else if (validFormats.includes(arg.toLowerCase())) {
        if (!format) format = arg.toLowerCase()
      }
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

function createWindow(files, format, scale, resolution) {
  const os = require('os')
  const release = os.release().split('.')[2]
  const isWin11 = parseInt(release) >= 22000
  const launchedSilently = !files || files.length === 0

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

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('is-win11', isWin11)
    if (launchedSilently) {
      mainWindow.hide()
      mainWindow.webContents.send('trigger-update-check')
    } else {
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
    }
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('MSQ Converter')
  const { files, format, scale, resolution } = parseArgs(process.argv)

  try {
    execSync('reg query "HKCU\\Software\\Classes\\SystemFileAssociations\\.jpg\\shell\\ConvertFile"', { stdio: 'pipe' })
  } catch(e) {
    registerAll()
  }

  createWindow(files, format, scale, resolution)
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

ipcMain.on('start-convert', async (event, { filePath, targetFormat }) => {
  try {
    await convertFile(filePath, targetFormat, (progress) => {
      event.reply('convert-progress', { filePath, progress })
    })
    event.reply('convert-done', { filePath })
  } catch (err) {
    event.reply('convert-error', { filePath, error: err.message })
  }
})

ipcMain.on('start-scale', async (event, { filePath, percent, format }) => {
  try {
    await scaleFile(filePath, percent, (progress) => {
      event.reply('convert-progress', { filePath, progress })
    }, format)
    event.reply('convert-done', { filePath })
  } catch (err) {
    event.reply('convert-error', { filePath, error: err.message })
  }
})

ipcMain.on('start-resolution', async (event, { filePath, resolution, format }) => {
  try {
    await resolutionFile(filePath, resolution, (progress) => {
      event.reply('convert-progress', { filePath, progress })
    }, format)
    event.reply('convert-done', { filePath })
  } catch (err) {
    event.reply('convert-error', { filePath, error: err.message })
  }
})

const activeProcesses = new Map()

ipcMain.on('start-convert', async (event, { filePath, targetFormat }) => {
  try {
    await convertFile(filePath, targetFormat, (progress) => {
      event.reply('convert-progress', { filePath, progress })
    }, (proc) => {
      activeProcesses.set(filePath, proc)
    })
    activeProcesses.delete(filePath)
    event.reply('convert-done', { filePath })
  } catch (err) {
    activeProcesses.delete(filePath)
    event.reply('convert-error', { filePath, error: err.message })
  }
})

ipcMain.on('start-scale', async (event, { filePath, percent, format }) => {
  try {
    await scaleFile(filePath, percent, (progress) => {
      event.reply('convert-progress', { filePath, progress })
    }, format, (proc) => {
      activeProcesses.set(filePath, proc)
    })
    activeProcesses.delete(filePath)
    event.reply('convert-done', { filePath })
  } catch (err) {
    activeProcesses.delete(filePath)
    event.reply('convert-error', { filePath, error: err.message })
  }
})

ipcMain.on('start-resolution', async (event, { filePath, resolution, format }) => {
  try {
    await resolutionFile(filePath, resolution, (progress) => {
      event.reply('convert-progress', { filePath, progress })
    }, format, (proc) => {
      activeProcesses.set(filePath, proc)
    })
    activeProcesses.delete(filePath)
    event.reply('convert-done', { filePath })
  } catch (err) {
    activeProcesses.delete(filePath)
    event.reply('convert-error', { filePath, error: err.message })
  }
})

ipcMain.on('cancel-convert', (event, { filePath }) => {
  const proc = activeProcesses.get(filePath)
  if (proc) {
    proc.kill()
    activeProcesses.delete(filePath)
  }
})

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