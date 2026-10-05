const fs=require('fs'),path=require('path'),{spawn}=require('child_process')
const {inspectWindowsExecutable}=require('./executable')
const verified=new Map()
function abortError(){return Object.assign(new Error('Conversion cancelled'),{name:'AbortError'})}
function binaryPath(){
 if(process.resourcesPath){
  const file=path.join(process.resourcesPath,'ffmpeg','ffmpeg.exe')
  if(fs.existsSync(file)){
   if(process.platform==='win32'){
    const stat=fs.statSync(file),signature=stat.size+'|'+stat.mtimeMs
    if(verified.get(file)!==signature){
     const manifest=path.join(process.resourcesPath,'engine-integrity.json')
     const expected=fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest,'utf8')).ffmpeg.size : undefined
     const info=inspectWindowsExecutable(file,expected)
     if(info.machine!==0x8664)throw Object.assign(new Error('Встроенный FFmpeg предназначен для другой архитектуры: '+file),{code:'ENGINE_INVALID'})
     verified.set(file,signature)
    }
   }
   return file
  }
  // Development Electron also defines resourcesPath, but does not have an app.asar.
  if(fs.existsSync(path.join(process.resourcesPath,'app.asar')))throw Object.assign(new Error('Встроенный FFmpeg отсутствует. Закройте приложение и запустите portable EXE повторно.'),{code:'ENGINE_MISSING'})
 }
 return require('@ffmpeg-installer/ffmpeg').path.replace(/app\.asar([\\/])/,'app.asar.unpacked$1')
}
function pause(ms,signal){return new Promise((resolve,reject)=>{
 if(signal?.aborted)return reject(abortError())
 const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(abortError())}
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve()},ms)
 signal?.addEventListener('abort',cancel,{once:true})
})}
async function spawnReady(executable,args,signal,spawnFn=spawn){
 for(let attempt=0;;attempt++){
  if(signal?.aborted)throw abortError()
  try{return await new Promise((resolve,reject)=>{
   const child=spawnFn(executable,args,{windowsHide:true,stdio:['ignore','ignore','pipe']})
   const cancel=()=>child.kill('SIGTERM')
   signal?.addEventListener('abort',cancel,{once:true})
   child.once('spawn',()=>{signal?.removeEventListener('abort',cancel);child.removeListener('error',reject);resolve(child)})
   child.once('error',error=>{signal?.removeEventListener('abort',cancel);reject(error)})
  })}catch(error){
   if(!['EBUSY','EACCES','ETXTBSY'].includes(error.code) || attempt>=4)throw error
   await pause(150*(attempt+1),signal)
  }
 }
}
module.exports={binaryPath,spawnReady,abortError}
