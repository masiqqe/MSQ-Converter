const { binaryPath, spawnReady } = require('./engine')
const os = require('os')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')
const { getFileType, formats, realFormat } = require('./formats')
const reservedPaths = new Set()
function abortError() { return Object.assign(new Error('Conversion cancelled'), { name: 'AbortError' }) }
function checkAbort(signal) { if (signal?.aborted) throw abortError() }
function reserveOutput(input, suffix, ext) {
  const dir = path.dirname(input), base = path.basename(input, path.extname(input)) + suffix
  for (let n = 1; ; n++) {
    const output = path.join(dir, base + (n === 1 ? '' : ` (${n})`) + '.' + ext)
    if (reservedPaths.has(output.toLowerCase())) continue
    try { fs.closeSync(fs.openSync(output, 'wx')); reservedPaths.add(output.toLowerCase()); return output }
    catch (e) { if (e.code !== 'EEXIST') throw e }
  }
}
function seconds(value) { const p = value.split(':').map(Number); return p[0]*3600 + p[1]*60 + p[2] }
async function runFFmpeg(args, onProgress, onProcess, outputPath, signal, onMetrics) {
  checkAbort(signal)
  const proc = await spawnReady(binaryPath(), ['-hide_banner','-nostdin',...args], signal)
  return new Promise((resolve, reject) => {
    let tail = '', buffer = '', duration = 0
    const cancel = () => proc.kill('SIGTERM')
    signal?.addEventListener('abort', cancel, { once: true })
    if (onProcess) onProcess(proc, outputPath)
    if (signal?.aborted) cancel()
    proc.stderr.on('data', chunk => {
      tail = (tail + chunk.toString()).slice(-8192)
      buffer += chunk.toString()
      const parts = buffer.split(/[\r\n]/); buffer = parts.pop().slice(-4096)
      for (const line of parts) {
        const d = line.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/)
        if (d) duration = seconds(d[1])
        const t = line.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/)
        if (t && duration) onProgress(Math.max(0, Math.min(99, Math.round(seconds(t[1])/duration*100))))
        const speed=line.match(/speed=\s*([\d.]+)x/),fps=line.match(/fps=\s*([\d.]+)/)
        if(speed || fps)onMetrics?.({speed:speed ? Number(speed[1]) : null,fps:fps ? Number(fps[1]) : null})
      }
    })
    let settled = false
    const finish = err => {
      if (settled) return; settled = true
      signal?.removeEventListener('abort', cancel)
      if (signal?.aborted) reject(abortError())
      else if (err) reject(err)
      else resolve()
    }
    proc.once('error', finish)
    proc.once('close', code => finish(code === 0 ? null : new Error('FFmpeg: ' + tail.slice(-1800))))
  })
}
function mediaArgs(input, output, requested, filter) {
  const ext = realFormat(requested)
  const args = ['-i',input]
  const audio = ['mp3','wav','flac','aac','ogg']
  const still = ['png','jpg','ico','avif','pdf']
  if (audio.includes(ext)) {
    const codec = {mp3:'libmp3lame',wav:'pcm_s16le',flac:'flac',aac:'aac',ogg:'libvorbis'}[ext]
    args.push('-map','0:a:0','-vn','-c:a',codec)
  } else if (still.includes(ext)) {
    args.push('-frames:v','1','-an')
  } else {
    if (ext === 'gif') {
      const vf = [filter,requested === 'gif_low' ? "fps=5,scale=w='min(320,iw)':h=-1:flags=fast_bilinear" : 'fps=12', requested === 'gif_low' ? null : 'split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1:dither=bayer'].filter(Boolean).join(',')
      args.push('-filter_complex', vf, '-an')
    } else {
      if (filter) args.push('-vf',filter)
      if (['mp4','mkv','mov','avi'].includes(ext)) {
        if (!filter) args.push('-vf','scale=ceil(iw/2)*2:ceil(ih/2)*2')
        args.push('-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-crf',requested === 'mp4_low' ? '35' : '23','-c:a',ext === 'avi' ? 'libmp3lame' : 'aac')
        if (['mp4','mov'].includes(ext)) args.push('-movflags','+faststart')
      } else if (ext === 'webm') args.push('-c:v','libvpx-vp9','-deadline','good','-cpu-used','5','-row-mt','1','-crf','32','-b:v','0','-c:a','libopus')
      else if (ext === 'ogv') args.push('-c:v','libtheora','-q:v','7','-c:a','libvorbis')
      else if (ext === 'webp') args.push('-c:v','libwebp_anim','-loop','0','-an')
    }
  }
  return [...args,'-threads',String(Math.max(1,Math.min(4,Math.floor((os.availableParallelism?.() || os.cpus().length)/2)))),'-y',output]
}
async function pdfRaster(input) {
  const canvas = require('@napi-rs/canvas')
  for (const key of ['DOMMatrix','ImageData','Path2D']) if (!globalThis[key]) globalThis[key] = canvas[key]
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({data:new Uint8Array(await fs.promises.readFile(input)),useSystemFonts:true,isEvalSupported:false})
  let pdf
  try {
    pdf = await task.promise
    const page = await pdf.getPage(1)
    let viewport = page.getViewport({scale:1.5})
    if (viewport.width*viewport.height > 16000000) viewport = page.getViewport({scale:1.5*Math.sqrt(16000000/(viewport.width*viewport.height))})
    const surface = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const factory = {
      create(w,h) { const c=canvas.createCanvas(w,h); return {canvas:c,context:c.getContext('2d')} },
      reset(target,w,h) { target.canvas.width=w; target.canvas.height=h },
      destroy(target) { target.canvas.width=0; target.canvas.height=0; target.canvas=null; target.context=null }
    }
    await page.render({canvasContext:surface.getContext('2d'),viewport,canvasFactory:factory}).promise
    return surface.toBuffer('image/png')
  } finally { if (pdf) await pdf.destroy(); else await task.destroy() }
}
async function imageConvert(input, output, requested, scale, onProgress, onProcess, signal) {
  checkAbort(signal)
  const inputExt = path.extname(input).slice(1).toLowerCase(), ext = realFormat(requested)
  let data = input
  if (inputExt === 'pdf') data = await pdfRaster(input)
  else if (['bmp','ico'].includes(inputExt)) {
    // libvips does not decode ICO/BMP; FFmpeg extracts a PNG frame.
    const temp = output + '.decode.png'
    try {
      await runFFmpeg(['-i',input,'-frames:v','1','-y',temp],()=>{},onProcess,output,signal)
      data = await fs.promises.readFile(temp)
    } finally { await fs.promises.rm(temp,{force:true}) }
  }
  checkAbort(signal); onProgress(20)
  let image = sharp(data, { animated: ['gif','webp'].includes(ext) }).rotate()
  if (scale) {
    const meta = await sharp(data).metadata()
    const width = meta.autoOrient?.width || meta.width
    image = image.resize({width:Math.max(1,Math.round(width*scale))})
  }
  if (ext === 'jpg') image = image.flatten({background:'#ffffff'})
  if (ext === 'ico') {
    const png = await image.resize(256,256,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer()
    checkAbort(signal)
    const header=Buffer.alloc(22); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4)
    header.writeUInt16LE(1,10); header.writeUInt16LE(32,12); header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18)
    await fs.promises.writeFile(output,Buffer.concat([header,png]))
  } else if (ext === 'pdf') {
    const { PDFDocument } = require('pdf-lib')
    const png = await image.png().toBuffer(); checkAbort(signal)
    const pdf = await PDFDocument.create(), embedded = await pdf.embedPng(png)
    const page=pdf.addPage([embedded.width,embedded.height]); page.drawImage(embedded,{x:0,y:0,width:embedded.width,height:embedded.height})
    await fs.promises.writeFile(output,await pdf.save())
  } else await image.toFormat(ext === 'jpg' ? 'jpeg' : ext).toFile(output)
  checkAbort(signal)
}
async function execute(input, target, progress=()=>{}, processCb, options={}) {
  const { scale, resolution, signal } = options
  checkAbort(signal)
  const type=getFileType(path.extname(input))
  if (!formats[type]?.includes(target)) throw new Error(`Unsupported conversion: ${path.extname(input)} → ${target}`)
  const stat=await fs.promises.stat(input)
  if (!stat.isFile()) throw new Error('Input must be a file')
  if (scale && ![25,50,75].includes(Number(scale))) throw new Error('Scale must be 25, 50 or 75')
  if (resolution && !['720p','1080p'].includes(resolution)) throw new Error('Resolution must be 720p or 1080p')
  const ext=realFormat(target)
  if ((scale || resolution) && ['mp3','wav','flac','aac','ogg'].includes(ext)) throw new Error('Audio cannot be resized')
  if (resolution && !['video','gif'].includes(type)) throw new Error('Resolution is only available for video/GIF')
  const suffix=resolution ? '_'+resolution : scale ? '_'+scale+'%scale' : ''
  const output=reserveOutput(input,suffix,ext)
  try {
    if (type === 'image' || (type === 'gif' && ['png','jpg','ico','avif','pdf'].includes(ext))) {
      await imageConvert(input,output,target,scale ? Number(scale)/100 : null,progress,processCb,signal)
    } else {
      const filter = resolution ? `scale=w='max(2,trunc(iw*min(1,${resolution === '720p' ? 720 : 1080}/ih)/2)*2)':h='max(2,trunc(ih*min(1,${resolution === '720p' ? 720 : 1080}/ih)/2)*2)'`
        : scale ? `scale=w='max(2,trunc(iw*${Number(scale)/100}/2)*2)':h='max(2,trunc(ih*${Number(scale)/100}/2)*2)'` : null
      await runFFmpeg(mediaArgs(input,output,target,filter),progress,processCb,output,signal,options.onMetrics)
    }
    checkAbort(signal); progress(100); return output
  } catch (error) {
    await fs.promises.rm(output,{force:true}); throw error
  } finally { reservedPaths.delete(output.toLowerCase()) }
}
function convertFile(input,target,progress,processCb,options) { return execute(input,target,progress,processCb,options) }
function scaleFile(input,percent,progress,target,processCb,options={}) { return execute(input,target || path.extname(input).slice(1),progress,processCb,{...options,scale:percent}) }
function resolutionFile(input,resolution,progress,target,processCb,options={}) { return execute(input,target || 'mp4',progress,processCb,{...options,resolution}) }
module.exports = { convertFile, scaleFile, resolutionFile, getFileType, mediaArgs, reserveOutput }
