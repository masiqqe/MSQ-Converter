const {parentPort,workerData}=require('worker_threads')
if(workerData.resourcesPath)process.resourcesPath=workerData.resourcesPath
const controller=new AbortController()
parentPort.on('message',message=>{if(message.type==='cancel')controller.abort()})
const converters=require('./converter')
async function execute(){
 const {mode,input,target,percent,resolution}=workerData
 const progress=value=>parentPort.postMessage({type:'progress',value}),options={signal:controller.signal,onMetrics:value=>parentPort.postMessage({type:'metrics',value})}
 try{
  const output=mode==='scale' ? await converters.scaleFile(input,percent,progress,target,null,options)
   : mode==='resolution' ? await converters.resolutionFile(input,resolution,progress,target,null,options)
   : await converters.convertFile(input,target,progress,null,options)
  parentPort.postMessage({type:'done',output})
 }catch(error){parentPort.postMessage({type:'error',name:error.name,code:error.code,message:error.message})}
}
execute()
