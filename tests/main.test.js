const test=require('node:test'),assert=require('node:assert/strict'),vm=require('vm'),fs=require('fs'),path=require('path'),os=require('os'),{EventEmitter}=require('events')
const tick=()=>new Promise(resolve=>setImmediate(resolve))
async function eventually(condition){const end=Date.now()+1000;while(!condition() && Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(condition(),'main queue did not finish the asynchronous operation')}
async function harness(t,options={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msq-main-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const app=new EventEmitter();Object.assign(app,{isPackaged:options.isPackaged===true,getPath:()=>options.appData||dir,setPath(){},getVersion:()=>require('../package.json').version,isReady:()=>true,setAppUserModelId(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit(){}})
 const ipcMain=new EventEmitter(),handlers=new Map();ipcMain.handle=(name,handler)=>handlers.set(name,handler)
 const events=[],running=[];let window
 class BrowserWindow extends EventEmitter {
  constructor(){super();window=this;this.webContents=new EventEmitter();Object.assign(this.webContents,{setWindowOpenHandler(){},isDestroyed:()=>false,send:(channel,data)=>events.push({channel,data})})}
  isDestroyed(){return false}loadFile(){}show(){}isMinimized(){return false}focus(){}setIcon(icon){this.icon=icon}setAppDetails(details){this.details=details}
 }
 const conversion=(input,target,progress,_cb,{signal})=>new Promise((resolve,reject)=>{
  running.push({input,target,resolve,reject,signal});signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true})
 })
 const fakeElectron={app,BrowserWindow,ipcMain,Notification:{isSupported:()=>false},dialog:{showErrorBox(){}},shell:{},clipboard:{}}
 const localRequire=name=>name==='electron' ? fakeElectron : name==='./registry'&&options.registry ? options.registry : name==='./job-runner' ? {convertFile:conversion} : name.startsWith('./') ? require(path.join(__dirname,'../src',name)) : require(name)
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8'),{require:localRequire,__dirname:path.join(__dirname,'../src'),process:{...process,argv:options.isPackaged ? ['MSQ Converter.exe'] : ['electron','app'],platform:options.platform||'linux',resourcesPath:options.resourcesPath||dir,env:options.env||process.env},console,AbortController,setImmediate,Buffer})
 await tick();return {app,events,running,ipcMain,handlers,window,dir,event:{sender:window.webContents}}
}
test('main queue: two active, queued and active cancellation, actual output',async t=>{
 const h=await harness(t)
 for(let i=1;i<=4;i++)h.ipcMain.emit('start-convert',h.event,{jobId:'job_'+i,filePath:path.join(os.tmpdir(),'input'+i+'.png'),targetFormat:'jpg'})
 assert.equal(h.running.length,2)
 h.ipcMain.emit('cancel-convert',h.event,{jobId:'job_3'});assert.ok(h.events.some(e=>e.channel==='convert-cancelled' && e.data.jobId==='job_3'))
 h.running[0].resolve(path.join(os.tmpdir(),'input1 (2).jpg'));await eventually(()=>h.running.length===3)
 assert.ok(h.events.some(e=>e.channel==='convert-done' && e.data.outputPath.endsWith('input1 (2).jpg')))
 h.ipcMain.emit('cancel-convert',h.event,{jobId:'job_2'});await tick();assert.ok(h.events.some(e=>e.channel==='convert-cancelled' && e.data.jobId==='job_2'))
 h.running[2].resolve('done.jpg');await tick();assert.ok(!h.running.some(j=>j.input.endsWith('input3.png')))
})
test('theme changes during Explorer registration cannot leave stale native icons',async t=>{
 let release,registrationStarted=false;const themes=[]
 const registry={registerAll:async theme=>{themes.push(theme);if(themes.length===1){registrationStarted=true;await new Promise(resolve=>release=resolve)}},unregisterAll:async()=>{},refreshShellIcons:async()=>{}}
 const h=await harness(t,{platform:'win32',registry}),get=()=>h.handlers.get('get-settings')(),save=value=>h.handlers.get('save-settings')(h.event,value)
 save({...get(),theme:'light'});await tick()
 const integration=h.handlers.get('integration')(h.event,true);await eventually(()=>registrationStarted)
 save({...get(),theme:'dark'});assert.ok(h.window.icon.endsWith('icon-dark.ico'));assert.ok(h.window.details.appIconPath.endsWith('icon-dark.ico'))
 release();assert.equal((await integration).ok,true);await eventually(()=>themes.length===2&&get().integrationKey.endsWith('|dark'))
 assert.deepEqual(themes,['light','dark']);assert.equal(get().theme,'dark')
 h.handlers.get('save-settings')({sender:{}},{theme:'light'});assert.equal(get().theme,'dark')
 assert.equal((await h.handlers.get('create-desktop-shortcut')({sender:{}})).ok,false)
})
test('second instance held until ready and untrusted IPC sender ignored',async t=>{
 const h=await harness(t),file=path.join(os.tmpdir(),'relative.png')
 h.app.emit('second-instance',null,['electron','app','--format','png',file],os.tmpdir());assert.ok(!h.events.some(e=>e.channel==='convert-files'))
 h.ipcMain.emit('renderer-ready',h.event);assert.ok(h.events.some(e=>e.channel==='convert-files' && e.data.files[0]===file))
 h.ipcMain.emit('start-convert',{sender:{}},{jobId:'job_99',filePath:file,targetFormat:'png'});assert.equal(h.running.length,0)
})
test('portable origin survives cached launches and cannot be replaced by renderer settings',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msq-origin-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const portable=path.join(dir,'Portable MSQ.exe');fs.writeFileSync(portable,'fixture')
 const registry={registerAll:async()=>{},unregisterAll:async()=>{},refreshShellIcons:async()=>{}},options={platform:'win32',isPackaged:true,appData:dir,registry}
 const h=await harness(t,{...options,env:{MSQ_RUNTIME_CACHED:'1',PORTABLE_EXECUTABLE_FILE:portable}})
 const get=()=>h.handlers.get('get-settings')();assert.equal(get().portableExecutable,portable)
 h.handlers.get('save-settings')(h.event,{...get(),portableExecutable:'C:\\Unrelated.exe',theme:'light'});assert.equal(get().portableExecutable,portable)
 const cached=await harness(t,{...options,env:{}});assert.equal(cached.handlers.get('get-settings')().portableExecutable,portable)
 const other=await harness(t,{platform:'win32',isPackaged:true,registry,env:{PORTABLE_EXECUTABLE_FILE:portable}});assert.equal(other.handlers.get('get-settings')().portableExecutable,'')
})
test('second instance uses original arguments when Chromium reorders switches',async t=>{
 const h=await harness(t),file=path.join(os.tmpdir(),'Counter-strike 2 DVR.mp4')
 h.app.emit('second-instance',null,['electron','app','--format','--allow-file-access-from-files','gif',file],os.tmpdir(),{argv:['--format','gif',file],cwd:os.tmpdir()})
 h.ipcMain.emit('renderer-ready',h.event)
 const conversion=h.events.find(e=>e.channel==='convert-files')
 assert.ok(conversion);assert.equal(conversion.data.targetFormat,'gif');assert.deepEqual(Array.from(conversion.data.files),[file])
})
