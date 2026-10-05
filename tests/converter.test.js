const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os')
const {spawnSync}=require('child_process')
const sharp=require('sharp'),{PDFDocument}=require('pdf-lib')
const {convertFile,scaleFile,resolutionFile}=require('../src/converter'),{parseArgs}=require('../src/args'),{commonFormats}=require('../src/formats')
function tmp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msq-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}
function ff(args){const exe=require('@ffmpeg-installer/ffmpeg').path;const r=spawnSync(exe,['-hide_banner','-loglevel','error',...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr)}
function video(dir,audio=true){const file=path.join(dir,'odd sample.mp4');const args=['-f','lavfi','-i','testsrc=size=66x50:rate=12'];if(audio)args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=44100');ff([...args,'-t','0.4','-c:v','libx264','-pix_fmt','yuv420p',...(audio ? ['-c:a','aac'] : []),file]);return file}
test('CLI accepts relative files, flags, tif/opus/pdf and explicit literal args',()=>{
 const cwd=os.tmpdir();const p=parseArgs(['--format','png','relative name.tif','--','another.pdf'],cwd);assert.deepEqual(p.files,[path.join(cwd,'relative name.tif'),path.join(cwd,'another.pdf')]);assert.equal(p.format,'png')
 assert.throws(()=>parseArgs(['--scale','banana']));assert.throws(()=>parseArgs(['--scale','25','--resolution','720p']))
 assert.deepEqual(commonFormats(['x.png','x.mp3']),[]);assert.ok(commonFormats(['x.gif','x.png']).includes('ico'))
 const ordered=parseArgs(['--allow-file-access-from-files','--format=gif','--original-process-start-time=1234','relative name.mp4'],cwd)
 assert.equal(ordered.format,'gif');assert.deepEqual(ordered.files,[path.join(cwd,'relative name.mp4')])
 assert.equal(parseArgs(['--scale=50','--format=png','relative name.tif'],cwd).scale,'50')
 assert.throws(()=>parseArgs(['--format=unknown']))
})
test('images: ICO/PDF/GIF/AVIF, JPEG alpha, small resize, collision and originals',async t=>{
 const dir=tmp(t),input=path.join(dir,'safe & фото.png');await sharp({create:{width:3,height:5,channels:4,background:{r:255,g:0,b:0,alpha:0}}}).png().toFile(input)
 const original=fs.readFileSync(input)
 for(const format of ['png','jpg','webp','ico','gif','avif','pdf']) {
  const output=await convertFile(input,format);assert.notEqual(input,output);assert.ok(fs.statSync(output).size>0)
  if(format==='ico'){const b=fs.readFileSync(output);assert.equal(b.readUInt16LE(2),1);assert.equal(b.readUInt32LE(18),22)}
  if(format==='pdf')assert.equal((await PDFDocument.load(fs.readFileSync(output))).getPageCount(),1)
  if(format==='jpg'){const {data}=await sharp(output).raw().toBuffer({resolveWithObject:true});assert.ok(data[0]>245 && data[1]>245 && data[2]>245)}
 }
 const scaled=await scaleFile(input,25,()=>{},'png');assert.equal((await sharp(scaled).metadata()).width,1)
 const outputs=await Promise.all(Array.from({length:4},()=>convertFile(input,'png')));assert.equal(new Set(outputs).size,4);assert.deepEqual(fs.readFileSync(input),original)
})
test('PDF first page input and ICO/BMP input decode',async t=>{
 const dir=tmp(t),input=path.join(dir,'source.png');await sharp({create:{width:32,height:24,channels:3,background:'#00ff88'}}).png().toFile(input)
 const pdf=await convertFile(input,'pdf'),png=await convertFile(pdf,'png');assert.ok((await sharp(png).metadata()).width>0)
 const ico=await convertFile(input,'ico');assert.ok(fs.statSync(await convertFile(ico,'png')).size>0)
 const bmp=path.join(dir,'source.bmp');ff(['-i',input,bmp]);assert.ok(fs.statSync(await convertFile(bmp,'jpg')).size>0)
})
test('media: containers, GIF/still frame, extraction and even scaled dimensions',async t=>{
 const dir=tmp(t),input=video(dir)
 for(const format of ['mp4','mkv','mov','avi','webm','ogv','gif','gif_low','mp4_low','extract_mp3','extract_aac','extract_wav','ogg'])assert.ok(fs.statSync(await convertFile(input,format)).size>0,format)
 const gif=await convertFile(input,'gif');for(const f of ['png','jpg','webp','ico','pdf'])assert.ok(fs.statSync(await convertFile(gif,f)).size>0,f)
 const scale=await scaleFile(input,25,()=>{},'mp4');assert.ok(fs.statSync(scale).size>0)
 assert.ok(fs.statSync(await resolutionFile(input,'720p',()=>{},'mp4')).size>0)
})
test('all audio targets',async t=>{
 const dir=tmp(t),input=path.join(dir,'input.wav');ff(['-f','lavfi','-i','sine=duration=0.2',input])
 for(const f of ['mp3','wav','flac','aac','ogg'])assert.ok(fs.statSync(await convertFile(input,f)).size>0)
})
test('invalid and damaged input leaves no partial output',async t=>{
 const dir=tmp(t),input=path.join(dir,'broken.png');fs.writeFileSync(input,'broken')
 await assert.rejects(convertFile(input,'jpg'));assert.deepEqual(fs.readdirSync(dir),['broken.png'])
 await assert.rejects(convertFile(input,'../exe'));await assert.rejects(scaleFile(input,0,()=>{},'png'))
 const clip=video(dir,false);await assert.rejects(convertFile(clip,'extract_mp3'));assert.ok(!fs.readdirSync(dir).some(f=>f.endsWith('.mp3')))
})
test('cancel before work and during ffmpeg; delete partial result',async t=>{
 const dir=tmp(t),input=video(dir),controller=new AbortController();controller.abort()
 await assert.rejects(convertFile(input,'mkv',()=>{},null,{signal:controller.signal}),{name:'AbortError'})
 const abort=new AbortController()
 await assert.rejects(convertFile(input,'mkv',()=>{},()=>abort.abort(),{signal:abort.signal}),{name:'AbortError'})
 assert.ok(!fs.readdirSync(dir).some(f=>f.endsWith('.mkv')))
})
