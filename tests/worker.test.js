const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),sharp=require('sharp')
const runner=require('../src/job-runner')
test('worker converts images and returns actual unique output; UI thread remains free',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msq-worker-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const input=path.join(dir,'sample.png')
 await sharp({create:{width:300,height:200,channels:3,background:'#228866'}}).png().toFile(input)
 let count=0;const interval=setInterval(()=>count++,5)
 try{const output=await runner.convertFile(input,'pdf',()=>{});assert.ok(fs.statSync(output).size);assert.ok(count>0)}finally{clearInterval(interval)}
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(runner.convertFile(input,'jpg',()=>{},null,{signal:cancelled.signal}),{name:'AbortError'})
})
test('worker runs FFmpeg, reports progress, and propagates media errors',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msq-worker-media-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const input=path.join(dir,'animation.gif')
 await sharp({create:{width:21,height:19,channels:3,background:'#ee7733'}}).gif().toFile(input)
 const progress=[];const output=await runner.convertFile(input,'mp4',value=>progress.push(value));assert.ok(fs.statSync(output).size);assert.ok(progress.includes(100))
 await assert.rejects(runner.convertFile(input,'extract_mp3',()=>{}))
})
