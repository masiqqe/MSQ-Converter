const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

function getFileType(ext) {
  const video = ['mp4','mkv','avi','mov','webm','flv','wmv','ogv','gif','ts','mpg','mpeg']
  const audio = ['mp3','wav','flac','aac','ogg','m4a','wma','opus']
  const image = ['jpg','jpeg','png','webp','ico','bmp','tiff','tif','avif','svg','pdf']
  ext = ext.toLowerCase().replace('.','')
  if (video.includes(ext)) return 'video'
  if (audio.includes(ext)) return 'audio'
  if (image.includes(ext)) return 'image'
  return 'unknown'
}

function convertImage(inputPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    onProgress(50)
    sharp(inputPath).toFile(outputPath, (err) => {
      if (err) reject(err)
      else { onProgress(100); resolve() }
    })
  })
}

function convertMedia(inputPath, outputPath, onProgress, onProcess) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(outputPath).toLowerCase().replace('.', '')

    const threadArgs = ['-threads', '0']
    let args

    if (ext === 'gif') {
      args = ['-i', inputPath, '-vf', 'fps=10,scale=iw:-1', ...threadArgs, '-y', outputPath]
    } else if (ext === 'mp4') {
      args = ['-i', inputPath, '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', ...threadArgs, '-y', outputPath]
    } else if (ext === 'webm') {
      args = ['-i', inputPath, '-c:v', 'libvpx', '-b:v', '1M', ...threadArgs, '-y', outputPath]
    } else if (['mkv', 'avi', 'mov', 'ogv'].includes(ext)) {
      args = ['-i', inputPath, '-c:v', 'copy', '-c:a', 'copy', ...threadArgs, '-y', outputPath]
    } else if (['mp3', 'aac', 'ogg', 'wav', 'flac'].includes(ext)) {
      args = ['-i', inputPath, ...threadArgs, '-y', outputPath]
    } else {
      args = ['-i', inputPath, '-c:v', 'copy', '-c:a', 'copy', ...threadArgs, '-y', outputPath]
    }

    const proc = execFile(ffmpegPath, args)
    if (onProcess) onProcess(proc)
    let errOutput = ''

    let duration = 0

  proc.stderr.on('data', (data) => {
  const str = data.toString()
  errOutput += str

  if (!duration) {
    const match = str.match(/Duration:\s(\d+):(\d+):(\d+)/)
    if (match) {
      duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
    }
  }

  const timeMatch = str.match(/time=(\d+):(\d+):(\d+)/)
  if (timeMatch && duration) {
    const current = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])
    const percent = Math.min(99, Math.round((current / duration) * 100))
    onProgress(percent)
  }
})

    proc.on('close', (code) => {
      if (code === 0) { onProgress(100); resolve() }
      else {
        const fallbackArgs = ['-i', inputPath, '-y', outputPath]
        const fallback = execFile(ffmpegPath, fallbackArgs)
        fallback.stderr.on('data', () => onProgress(75))
        fallback.on('close', (code2) => {
          if (code2 === 0) { onProgress(100); resolve() }
          else reject(new Error('FFmpeg failed: ' + errOutput.slice(-300)))
        })
        fallback.on('error', reject)
      }
    })

    proc.on('error', reject)
  })
}

async function convertFile(inputPath, targetFormat, onProgress, onProcess) {
  const ext = path.extname(inputPath).toLowerCase().replace('.', '')
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const dir = path.dirname(inputPath)

  let outputPath = path.join(dir, baseName + '.' + targetFormat)
  let counter = 2
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(dir, baseName + ' (' + counter + ').' + targetFormat)
    counter++
  }

  const fileType = getFileType(ext)

  if (fileType === 'image') {
    await convertImage(inputPath, outputPath, onProgress)
  } else if (fileType === 'video' || fileType === 'audio') {
    await convertMedia(inputPath, outputPath, onProgress, onProcess)
  } else {
    throw new Error('Неподдерживаемый формат: ' + ext)
  }

  return outputPath
}

// Масштаб в процентах (для изображений — без смены формата, для видео — со сменой формата)
async function scaleFile(inputPath, percent, onProgress, targetFormat, onProcess) {
  const ext = path.extname(inputPath).toLowerCase().replace('.', '')
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const dir = path.dirname(inputPath)
  const outExt = targetFormat || ext
  const suffix = '_' + percent + '%scale'

  let outputPath = path.join(dir, baseName + suffix + '.' + outExt)
  let counter = 2
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(dir, baseName + suffix + ' (' + counter + ').' + outExt)
    counter++
  }

  const fileType = getFileType(ext)
  const scale = parseInt(percent) / 100

  if (fileType === 'image') {
    onProgress(50)
    const metadata = await sharp(inputPath).metadata()
    const newWidth = Math.round(metadata.width * scale)
    await sharp(inputPath).resize(newWidth).toFile(outputPath)
    onProgress(100)
  } else if (fileType === 'video') {
    await new Promise((resolve, reject) => {
      const args = ['-i', inputPath, '-vf', `scale=iw*${scale}:ih*${scale}`, '-threads', '0', '-y', outputPath]
      const proc = execFile(ffmpegPath, args)
      if (onProcess) onProcess(proc)
      let duration = 0
      let errOutput = ''
      proc.stderr.on('data', (data) => {
        const str = data.toString()
        errOutput += str

  if (!duration) {
    const match = str.match(/Duration:\s(\d+):(\d+):(\d+)/)
    if (match) {
      duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
    }
  }

  const timeMatch = str.match(/time=(\d+):(\d+):(\d+)/)
  if (timeMatch && duration) {
    const current = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])
    const percent = Math.min(99, Math.round((current / duration) * 100))
    onProgress(percent)
  }
})
      proc.on('close', (code) => {
        if (code === 0) { onProgress(100); resolve() }
        else reject(new Error('Scale failed'))
      })
      proc.on('error', reject)
    })
  } else {
    throw new Error('Сжатие недоступно для этого формата')
  }

  return outputPath
}

// Масштаб по разрешению (720p / 1080p) для видео
async function resolutionFile(inputPath, resolution, onProgress, targetFormat, onProcess) {
  const ext = path.extname(inputPath).toLowerCase().replace('.', '')
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const dir = path.dirname(inputPath)
  const outExt = targetFormat || ext
  const suffix = '_' + resolution

  let outputPath = path.join(dir, baseName + suffix + '.' + outExt)
  let counter = 2
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(dir, baseName + suffix + ' (' + counter + ').' + outExt)
    counter++
  }

  const height = resolution === '720p' ? 720 : 1080

  await new Promise((resolve, reject) => {
    // scale=-2:720 — сохраняет пропорции, высота 720
    const args = ['-i', inputPath, '-vf', `scale=-2:${height}`, '-threads', '0', '-y', outputPath]
    const proc = execFile(ffmpegPath, args)
    if (onProcess) onProcess(proc)
    let duration = 0
proc.stderr.on('data', (data) => {
  const str = data.toString()
  if (!duration) {
    const match = str.match(/Duration:\s(\d+):(\d+):(\d+)/)
    if (match) {
      duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
    }
  }
  const timeMatch = str.match(/time=(\d+):(\d+):(\d+)/)
  if (timeMatch && duration) {
    const current = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])
    const percent = Math.min(99, Math.round((current / duration) * 100))
    onProgress(percent)
  }
})
    proc.on('close', (code) => {
      if (code === 0) { onProgress(100); resolve() }
      else reject(new Error('Resolution scale failed'))
    })
    proc.on('error', reject)
  })

  return outputPath
}

module.exports = { convertFile, scaleFile, resolutionFile, getFileType }