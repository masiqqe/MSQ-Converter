const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification } = require('electron')
const path=require('path'), fs=require('fs'), os=require('os'), https=require('https')
const { execFile }=require('child_process')
const { convertFile,scaleFile,resolutionFile }=require('./job-runner')
const { parseArgs }=require('./args')
const { extensions,formats,extension }=require('./formats')
const { registerAll,unregisterAll,refreshShellIcons }=require('./registry')
const {APP_ID,iconPaths,applyWindowIcon,createDesktopShortcut,updateShellShortcuts,portableExecutablePath,rendererIconSources}=require('./app-icons')
const {describeFiles}=require('./file-intake')
// Stable storage across portable extraction directories; save settings outside the EXE.
app.setPath('userData',path.join(app.getPath('appData'),'MSQConverter','ui-v3.0-release'))
let mainWindow,rendererReady=false,settings,settingsPath
const incoming=[],jobs=new Map(),queue=[],results=new Set(),sources=new Set()
const defaults={lang:'ru',autoClose:false,autoUpdate:true,integration:false,integrationKey:'',desktopShortcutName:'',portableExecutable:'',theme:'dark',primary:'#8b5cf6'}
function readSettings() {
  settingsPath=path.join(app.getPath('appData'),'MSQConverter','settings.json')
  try { settings=sanitize(JSON.parse(fs.readFileSync(settingsPath,'utf8'))) } catch { settings={...defaults} }
  const portable=app.isPackaged&&process.platform==='win32'&&process.env.MSQ_RUNTIME_CACHED==='1' ? portableExecutablePath(process.env.PORTABLE_EXECUTABLE_FILE) : ''
  if(portable&&fs.existsSync(portable)&&settings.portableExecutable!==portable){settings.portableExecutable=portable;writeSettings()}
}
function sanitize(value) {
  return {lang:value.lang === 'en' ? 'en' : 'ru',autoClose:value.autoClose === true,autoUpdate:value.autoUpdate !== false,integration:value.integration === true,theme:value.theme === 'light' ? 'light' : 'dark',primary:/^#[0-9a-f]{6}$/i.test(value.primary || '') ? value.primary : '#8b5cf6',integrationKey:typeof value.integrationKey === 'string' ? value.integrationKey : '',desktopShortcutName:/^MSQ Converter(?: \(\d+\))?\.lnk$/.test(value.desktopShortcutName || '') ? value.desktopShortcutName : '',portableExecutable:portableExecutablePath(value.portableExecutable)}
}
function writeSettings() {
  fs.mkdirSync(path.dirname(settingsPath),{recursive:true})
  fs.writeFileSync(settingsPath+'.tmp',JSON.stringify(settings,null,2)); fs.renameSync(settingsPath+'.tmp',settingsPath)
}
function identityOptions(){return {isPackaged:app.isPackaged,resourcesPath:process.resourcesPath,assetDir:path.join(__dirname,'assets'),platform:process.platform,execPath:process.execPath,portableFile:app.isPackaged ? settings.portableExecutable : '',appRoot:path.join(__dirname,'..')}}
function currentIcons(){return iconPaths(settings.theme,identityOptions())}
function updateWindowIcon(){if(mainWindow&&!mainWindow.isDestroyed())applyWindowIcon(mainWindow,settings.theme,identityOptions())}
let shellSync=Promise.resolve()
function serializeShell(action){const operation=shellSync.catch(()=>{}).then(action);shellSync=operation.catch(()=>{});return operation}
function syncShellIdentity(){
 if(process.platform!=='win32')return
 serializeShell(async()=>{
  const theme=settings.theme,key=registrationKey();let changed=false
  if(settings.integration && settings.integrationKey!==key){await registerAll(theme);if(settings.theme===theme&&settings.integration){settings.integrationKey=key;writeSettings()}changed=true}
  const pinned=path.join(app.getPath('appData'),'Microsoft','Internet Explorer','Quick Launch','User Pinned','TaskBar')
  changed=updateShellShortcuts(shell,app.getPath('desktop'),pinned,settings.desktopShortcutName,theme,identityOptions())>0 || changed
  if(changed)await refreshShellIcons()
 }).catch(e=>emit('update-error',{error:'Icons: '+e.message,source:'icons'}))
}
function saveSettings(value) {
 const oldTheme=settings.theme
 settings={...sanitize(value),integration:settings.integration,integrationKey:settings.integrationKey,desktopShortcutName:settings.desktopShortcutName,portableExecutable:settings.portableExecutable}
 writeSettings()
 if(oldTheme!==settings.theme){updateWindowIcon();syncShellIdentity()}
 return settings
}
function emit(channel,data) { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel,data) }
function receive(args,cwd) {
  try { const parsed=parseArgs(args,cwd); if (parsed.files.length) incoming.push(parsed) }
  catch (e) { if (app.isReady()) dialog.showErrorBox('MSQ Converter',e.message); else console.error(e.message) }
  flush()
}
function flush() {
  if (!rendererReady) return
  while (incoming.length) {
    const p=incoming.shift()
    if (p.resolution) emit('resolution-files',p)
    else if (p.scale) emit('scale-files',{...p,percent:p.scale})
    else if (p.format) emit('convert-files',{files:p.files,targetFormat:p.format})
    else emit('paste-files',{files:p.files})
  }
}
function validSender(event) { return mainWindow && event.sender === mainWindow.webContents }
function enqueue(event,mode,data) {
  if (!validSender(event)) return
  const {jobId,filePath}=data || {}
  if (typeof jobId !== 'string' || !/^job_\d+$/.test(jobId) || jobs.has(jobId)) return
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) { emit('convert-error',{jobId,filePath,error:'Invalid file path'}); return }
  const job={...data,mode,controller:new AbortController(),state:'queued'}
  jobs.set(jobId,job); queue.push(job); emit('job-queued',{jobId}); pump()
}
function pump() {
  while (queue.length && [...jobs.values()].filter(j=>j.state === 'active').length < 2) {
    const job=queue.shift(); job.state='active'; run(job)
  }
}
function registrationKey() { return app.getVersion()+'|'+process.execPath+'|'+settings.theme }
async function run(job) {
  const {jobId,filePath,controller}=job
  try {
    const progress=value=>emit('convert-progress',{jobId,progress:value})
    const options={signal:controller.signal,onMetrics:metrics=>emit('convert-metrics',{jobId,metrics})};progress(0)
    const outputPath=job.mode === 'scale'
      ? await scaleFile(filePath,job.percent,progress,job.format,null,options)
      : job.mode === 'resolution' ? await resolutionFile(filePath,job.resolution,progress,job.format,null,options)
      : await convertFile(filePath,job.targetFormat,progress,null,options)
    const outputSize=await fs.promises.stat(outputPath).then(stat=>stat.size).catch(()=>undefined)
    results.add(outputPath); emit('convert-done',{jobId,filePath,outputPath,outputSize})
    if (Notification.isSupported()) new Notification({title:'MSQ Converter',body:path.basename(outputPath)+' — '+(settings.lang === 'ru' ? 'готово' : 'done'),icon:currentIcons().png}).show()
  } catch (e) {
    emit(e.name === 'AbortError' ? 'convert-cancelled' : 'convert-error',{jobId,filePath,error:e.message})
  } finally { jobs.delete(jobId); pump() }
}
function createWindow() {
  mainWindow=new BrowserWindow({width:1120,height:760,minWidth:720,minHeight:480,frame:false,show:false,backgroundColor:settings.theme==='light' ? '#f2f2f7' : '#111113',icon:currentIcons().png,webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}})
  updateWindowIcon()
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  mainWindow.webContents.on('will-navigate',e=>e.preventDefault())
  mainWindow.webContents.on('before-input-event',(event,input)=>{
    if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'v') { handlePaste(); event.preventDefault() }
  })
  mainWindow.on('close',e=>{
    if (jobs.size) {
      e.preventDefault()
      dialog.showMessageBox(mainWindow,{type:'info',message:settings.lang === 'ru' ? 'Сначала отмените активные задачи или дождитесь завершения.' : 'Cancel active jobs or wait for them to finish.',buttons:['OK']})
    }
  })
  mainWindow.on('closed',()=>{mainWindow=null;rendererReady=false})
  mainWindow.once('ready-to-show',()=>mainWindow.show())
  mainWindow.loadFile(path.join(__dirname,'index.html'))
}
async function handlePaste() {
  const image=clipboard.readImage()
  if (!image.isEmpty()) {
    const dir=app.getPath('pictures'),file=path.join(dir,'MSQ Clipboard '+Date.now()+'.png')
    try { await fs.promises.mkdir(dir,{recursive:true}); await fs.promises.writeFile(file,image.toPNG(),{flag:'wx'}); emit('paste-files',{files:[file]}) }
    catch(e) { dialog.showErrorBox('Clipboard',e.message) }
    return
  }
  if (process.platform !== 'win32') return
  execFile('powershell.exe',['-NoProfile','-STA','-Command','[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { $_ }'],{windowsHide:true,timeout:5000,encoding:'utf8'},(error,stdout)=>{
    if (!error) emit('paste-files',{files:stdout.split(/\r?\n/).filter(f=>Object.values(extensions).flat().includes(extension(f)))})
  })
}
const launchArguments=process.argv.slice(app.isPackaged ? 1 : 2)
const lock=app.requestSingleInstanceLock({argv:launchArguments,cwd:process.cwd()})
if (!lock) app.quit()
else {
  app.on('second-instance',(_e,argv,cwd,data)=>{
    // Chromium may reorder argv and add switches. Preserve the original arguments.
    const original=Array.isArray(data?.argv) && data.argv.every(v=>typeof v==='string')
    receive(original ? data.argv : argv.slice(app.isPackaged ? 1 : 2),original && typeof data.cwd==='string' ? data.cwd : cwd)
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore();mainWindow.show();mainWindow.focus() }
  })
  app.whenReady().then(()=>{
    app.setAppUserModelId(APP_ID); readSettings(); createWindow(); receive(launchArguments)
    setImmediate(syncShellIdentity)
  })
}
app.on('window-all-closed',()=>app.quit())
ipcMain.on('renderer-ready',event=>{if (validSender(event)) {rendererReady=true;flush()}})
for (const [channel,mode] of [['start-convert','convert'],['start-scale','scale'],['start-resolution','resolution']]) ipcMain.on(channel,(e,data)=>enqueue(e,mode,data))
ipcMain.on('cancel-convert',(e,{jobId}={})=>{
  if (!validSender(e)) return
  const job=jobs.get(jobId); if (!job) return
  job.controller.abort()
  if (job.state === 'queued') {queue.splice(queue.indexOf(job),1);jobs.delete(jobId);emit('convert-cancelled',{jobId});pump()}
})
for (const [channel,action] of [['window-minimize',()=>mainWindow.minimize()],['window-maximize',()=>mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()],['window-close',()=>mainWindow.close()],['paste-image',handlePaste]]) ipcMain.on(channel,e=>{if (validSender(e)) action()})
let uiIconSources
ipcMain.handle('get-settings',()=>({...settings,version:app.getVersion().replace(/\.0$/,''),platform:process.platform,appIcons:uiIconSources ||= rendererIconSources(identityOptions())}))
ipcMain.handle('save-settings',(event,value)=>{if (validSender(event)) return saveSettings(value || {})})
ipcMain.handle('choose-files',async event=>{
  if (!validSender(event)) return []
  const choice=await dialog.showOpenDialog(mainWindow,{properties:['openFile','multiSelections'],filters:[{name:'Media / Images / PDF',extensions:Object.values(extensions).flat()}]})
  return choice.canceled ? [] : choice.filePaths
})
ipcMain.handle('describe-files',async(event,paths)=>{
  if(!validSender(event) || !Array.isArray(paths))return {files:[],skipped:[],errors:[]}
  const result=await describeFiles(paths)
  result.files.forEach(file=>sources.add(file.filePath))
  return result
})
ipcMain.handle('choose-folder',async event=>{
  if(!validSender(event))return {files:[]}
  const choice=await dialog.showOpenDialog(mainWindow,{properties:['openDirectory']})
  if(choice.canceled)return {files:[]}
  const result=await describeFiles(choice.filePaths)
  result.files.forEach(file=>sources.add(file.filePath))
  return {...result,files:result.files.map(file=>file.filePath)}
})
ipcMain.handle('copy-text',(event,text)=>{if(validSender(event) && typeof text==='string' && text.length<=20000){clipboard.writeText(text);return true}})
ipcMain.handle('integration',async (event,enabled)=>{
  if (!validSender(event) || typeof enabled !== 'boolean') return
  try {return await serializeShell(async()=>{const theme=settings.theme,key=registrationKey();if (enabled) await registerAll(theme); else await unregisterAll();settings.integration=enabled;settings.integrationKey=enabled ? key : '';writeSettings();await refreshShellIcons();return {ok:true,enabled}})}
  catch(e) {return {ok:false,error:e.message}}
})
ipcMain.handle('create-desktop-shortcut',async event=>{
 if(!validSender(event)||process.platform!=='win32')return {ok:false}
 try{return await serializeShell(async()=>{settings.desktopShortcutName=createDesktopShortcut(shell,app.getPath('desktop'),settings.theme,identityOptions());writeSettings();await refreshShellIcons();return {ok:true,name:settings.desktopShortcutName}})}catch(e){return {ok:false,error:e.message}}
})
ipcMain.on('open-result',(event,file)=>{if (validSender(event) && results.has(file)) shell.showItemInFolder(file)})
ipcMain.on('show-source',(event,file)=>{if(validSender(event) && sources.has(file))shell.showItemInFolder(file)})
for(const [channel,allowed] of [['open-source',sources],['open-output',results]])ipcMain.on(channel,async(event,file)=>{
  if(!validSender(event) || !allowed.has(file))return
  const error=await shell.openPath(file).catch(e=>e.message)
  if(error)emit('update-error',{error})
})
const links={site:'https://www.masiqqe.ru/',github:'https://github.com/masiqqe/MSQ-Converter',telegram:'https://t.me/masiqqee'}
ipcMain.on('open-link',(event,key)=>{if (validSender(event) && links[key]) shell.openExternal(links[key])})
function newer(a,b) {const aa=a.replace(/^v/,'').split('.').map(Number),bb=b.split('.').map(Number); if (aa.some(n=>!Number.isInteger(n)) || aa.length!==3) return false;for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]>bb[i]}return false}
let checking=false
ipcMain.on('check-update',event=>{
  if (!validSender(event) || checking) return
  checking=true
  const request=https.get('https://api.github.com/repos/masiqqe/MSQ-Converter/releases/latest',{headers:{'User-Agent':'MSQ-Converter','Accept':'application/vnd.github+json'}},response=>{
    let data='';response.setEncoding('utf8')
    response.on('data',chunk=>{data+=chunk;if(data.length>2000000)request.destroy(new Error('Response too large'))})
    response.on('error',e=>{checking=false;emit('update-error',{error:e.message,source:'updates'})})
    response.on('end',()=>{
      checking=false
      try {
        if(response.statusCode!==200) throw new Error('GitHub HTTP '+response.statusCode)
        const release=JSON.parse(data)
        if (newer(release.tag_name,app.getVersion())) {
          // Portable updates are downloaded by the user, never silently install another build.
          emit('update-available',{latest:release.tag_name})
        }
      } catch(e) {emit('update-error',{error:e.message,source:'updates'})}
    })
  })
  request.setTimeout(10000,()=>request.destroy(new Error('Update check timed out')))
  request.on('error',e=>{checking=false;emit('update-error',{error:e.message,source:'updates'})})
})
