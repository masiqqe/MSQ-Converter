const {Worker}=require('worker_threads'),path=require('path')
const {abortError}=require('./engine')
function run(mode,data,progress,signal,onMetrics){
 if(signal?.aborted)return Promise.reject(abortError())
 return new Promise((resolve,reject)=>{
  const worker=new Worker(path.join(__dirname,'conversion-worker.js').replace(/app\.asar([\\/])/,'app.asar.unpacked$1'),{workerData:{mode,...data,resourcesPath:process.resourcesPath}})
  let done=false
  const cancel=()=>worker.postMessage({type:'cancel'})
  const finish=(error,output)=>{
   if(done)return;done=true;signal?.removeEventListener('abort',cancel)
   worker.terminate().catch(()=>{})
   if(error)reject(error);else resolve(output)
  }
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel()
  worker.on('message',message=>{
   if(message.type==='progress')progress?.(message.value)
   else if(message.type==='metrics')onMetrics?.(message.value)
   else if(message.type==='done')finish(null,message.output)
   else if(message.type==='error')finish(Object.assign(new Error(message.message),{name:message.name,code:message.code}))
  })
  worker.on('error',finish)
  worker.on('exit',code=>{if(!done)finish(new Error('Conversion worker exited unexpectedly: '+code))})
 })
}
module.exports={
 convertFile:(input,target,progress,_process,options={})=>run('convert',{input,target},progress,options.signal,options.onMetrics),
 scaleFile:(input,percent,progress,target,_process,options={})=>run('scale',{input,target,percent},progress,options.signal,options.onMetrics),
 resolutionFile:(input,resolution,progress,target,_process,options={})=>run('resolution',{input,target,resolution},progress,options.signal,options.onMetrics)
}
