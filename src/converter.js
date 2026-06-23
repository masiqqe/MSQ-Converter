const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const reservedPaths = new Set()

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

function convertMedia(inputPath, outputPath, onProgress, onProcess, originalFormat) {
  return new Promise((resolve, reject) => {
    const ext = originalFormat || path.extname(outputPath).toLowerCase().replace('.', '')

    const threadArgs = ['-threads', '0']
    let args

    if (ext === 'extract_mp3') {
      args = ['-i', inputPath, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', ...threadArgs, '-y', outputPath]
    } else if (ext === 'extract_aac') {
      args = ['-i', inputPath, '-vn', '-c:a', 'aac', '-b:a', '192k', ...threadArgs, '-y', outputPath]
    } else if (ext === 'extract_wav') {
      args = ['-i', inputPath, '-vn', '-c:a', 'pcm_s16le', ...threadArgs, '-y', outputPath]
    } else if (ext === 'gif_low') {
      args = ['-i', inputPath, '-vf', 'fps=5,scale=320:-1', ...threadArgs, '-y', outputPath]
    } else if (ext === 'mp4_low') {
      args = ['-i', inputPath, '-c:v', 'libx264', '-crf', '35', '-preset', 'fast', '-c:a', 'aac', '-b:a', '96k', ...threadArgs, '-y', outputPath]
    } else if (ext === 'gif') {
      args = ['-i', inputPath, '-vf', 'fps=10,scale=iw:-1', ...threadArgs, '-y', outputPath]
    } else if (ext === 'mp4') {
      args = ['-i', inputPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...threadArgs, '-y', outputPath]
    } else if (ext === 'webm') {
      args = ['-i', inputPath, '-c:v', 'libvpx', '-b:v', '1M', ...threadArgs, '-y', outputPath]
    } else if (ext === 'ogv') {
      args = ['-i', inputPath, '-c:v', 'libtheora', '-q:v', '7', '-c:a', 'libvorbis', ...threadArgs, '-y', outputPath]
    } else if (['mkv', 'avi', 'mov'].includes(ext)) {
      args = ['-i', inputPath, '-c:v', 'copy', '-c:a', 'copy', ...threadArgs, '-y', outputPath]
    } else if (['mp3', 'aac', 'ogg', 'wav', 'flac'].includes(ext)) {
      args = ['-i', inputPath, ...threadArgs, '-y', outputPath]
    } else {
      args = ['-i', inputPath, '-c:v', 'copy', '-c:a', 'copy', ...threadArgs, '-y', outputPath]
    }

    const proc = execFile(ffmpegPath, args)
    if (onProcess) onProcess(proc, outputPath)
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
      else reject(new Error('FFmpeg failed: ' + errOutput.slice(-300)))
    })

    proc.on('error', reject)
  })
}

async function convertFile(inputPath, targetFormat, onProgress, onProcess) {
  const ext = path.extname(inputPath).toLowerCase().replace('.', '')
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const dir = path.dirname(inputPath)

  const originalTargetFormat = targetFormat
  const realExt = targetFormat === 'gif_low' ? 'gif'
  : targetFormat === 'mp4_low' ? 'mp4'
  : targetFormat === 'extract_mp3' ? 'mp3'
  : targetFormat === 'extract_aac' ? 'aac'
  : targetFormat === 'extract_wav' ? 'wav'
  : targetFormat

  let outputPath = path.join(dir, baseName + '.' + realExt)
  let counter = 2
  while (fs.existsSync(outputPath) || reservedPaths.has(outputPath)) {
    outputPath = path.join(dir, baseName + ' (' + counter + ').' + realExt)
    counter++
  }
  reservedPaths.add(outputPath)

const fileType = getFileType(ext)

  try {
    if (fileType === 'image') {
      await convertImage(inputPath, outputPath, onProgress)
    } else if (fileType === 'video' || fileType === 'audio') {
      await convertMedia(inputPath, outputPath, onProgress, onProcess, originalTargetFormat)
    } else {
      throw new Error('Неподдерживаемый формат: ' + ext)
    }
  } finally {
    reservedPaths.delete(outputPath)
  }

  return outputPath
}

async function scaleFile(inputPath, percent, onProgress, targetFormat, onProcess) {
  const ext = path.extname(inputPath).toLowerCase().replace('.', '')
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const dir = path.dirname(inputPath)
  const isLowQuality = targetFormat === 'gif_low' || targetFormat === 'mp4_low'
  if (targetFormat === 'gif_low') targetFormat = 'gif'
  else if (targetFormat === 'mp4_low') targetFormat = 'mp4'
  const outExt = targetFormat || ext
  const suffix = '_' + percent + '%scale'

  let outputPath = path.join(dir, baseName + suffix + '.' + outExt)
  let counter = 2
  while (fs.existsSync(outputPath) || reservedPaths.has(outputPath)) {
    outputPath = path.join(dir, baseName + suffix + ' (' + counter + ').' + outExt)
    counter++
  }
  reservedPaths.add(outputPath)

  const fileType = getFileType(ext)
  const scale = parseInt(percent) / 100

  try {
    if (fileType === 'image') {
      onProgress(50)
      const metadata = await sharp(inputPath).metadata()
      const newWidth = Math.round(metadata.width * scale)
      await sharp(inputPath).resize(newWidth).toFile(outputPath)
      onProgress(100)
    } else if (fileType === 'video') {
      await new Promise((resolve, reject) => {
        let args
        if (isLowQuality && outExt === 'gif') {
          args = ['-i', inputPath, '-vf', `fps=5,scale=iw*${scale}:ih*${scale}`, '-threads', '0', '-y', outputPath]
        } else if (isLowQuality && outExt === 'mp4') {
          args = ['-i', inputPath, '-vf', `scale=iw*${scale}:ih*${scale}`, '-c:v', 'libx264', '-crf', '35', '-preset', 'fast', '-c:a', 'aac', '-b:a', '96k', '-threads', '0', '-y', outputPath]
        } else {
          args = ['-i', inputPath, '-vf', `scale=iw*${scale}:ih*${scale}`, '-b:v', '1500k', '-threads', '0', '-y', outputPath]
        }
        const proc = execFile(ffmpegPath, args)
        if (onProcess) onProcess(proc, outputPath)
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
  } finally {
    reservedPaths.delete(outputPath)
  }

  return outputPath
}

async function resolutionFile(inputPath, resolution, onProgress, targetFormat, onProcess) {
  const ext = path.extname(inputPath).toLowerCase().replace('.', '')
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const dir = path.dirname(inputPath)
  const outExt = targetFormat || ext
  const suffix = '_' + resolution

  let outputPath = path.join(dir, baseName + suffix + '.' + outExt)
  let counter = 2
  while (fs.existsSync(outputPath) || reservedPaths.has(outputPath)) {
    outputPath = path.join(dir, baseName + suffix + ' (' + counter + ').' + outExt)
    counter++
  }
  reservedPaths.add(outputPath)

  const height = resolution === '720p' ? 720 : 1080

  try {
    await new Promise((resolve, reject) => {
      const args = ['-i', inputPath, '-vf', `scale=-2:${height}`, '-b:v', '1500k', '-threads', '0', '-y', outputPath]
      const proc = execFile(ffmpegPath, args)
    if (onProcess) onProcess(proc, outputPath)
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
  } finally {
    reservedPaths.delete(outputPath)
  }

  return outputPath
}

module.exports = { convertFile, scaleFile, resolutionFile, getFileType }