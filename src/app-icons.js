const path=require('path'),fs=require('fs')
const APP_ID='ru.masiqqe.msqconverter'
function iconPaths(theme,options={}){
 const name=theme==='light' ? 'light' : 'dark'
 const dir=options.isPackaged ? path.join(options.resourcesPath,'icons') : options.assetDir || path.join(__dirname,'assets')
 return {png:path.join(dir,'icon-'+name+'.png'),ico:path.join(dir,'icon-'+name+'.ico')}
}
function rendererIconSources(options={}){
 const fallback=path.join(options.assetDir||path.join(__dirname,'assets'),'icon.png'),sources={}
 for(const theme of ['light','dark']){
  const file=iconPaths(theme,options).png
  const bytes=fs.readFileSync(fs.existsSync(file) ? file : fallback)
  sources[theme]='data:image/png;base64,'+bytes.toString('base64')
 }
 return sources
}
function launchOptions(options){
 const args=options.isPackaged ? '' : '"'+options.appRoot+'"'
 return {target:options.execPath,args,cwd:path.dirname(options.execPath),description:'MSQ Converter',appUserModelId:APP_ID}
}
function applyWindowIcon(window,theme,options){
 const icons=iconPaths(theme,options)
 window.setIcon?.(options.platform==='win32' ? icons.ico : icons.png)
 if(options.platform==='win32'){
  const launch=launchOptions(options)
  window.setAppDetails({appId:APP_ID,appIconPath:icons.ico,appIconIndex:0,relaunchCommand:'"'+launch.target+'"'+(launch.args ? ' '+launch.args : ''),relaunchDisplayName:'MSQ Converter'})
 }
 return icons
}
function ownedShortcut(shell,file,options){
 try{
  const info=shell.readShortcutLink(file)
  if(info.appUserModelId===APP_ID)return info
  const normalize=p=>typeof p==='string'&&p ? (options.platform==='win32' ? path.win32.normalize(p).toLowerCase() : path.resolve(p)) : ''
  const target=normalize(info.target),known=[options.execPath,options.isPackaged&&options.portableFile].map(normalize).filter(Boolean)
  if(!target||!known.includes(target))return null
  // In development several apps may use the same electron.exe.
  if(!options.isPackaged && info.args!==launchOptions(options).args)return null
  return info
 }catch{return null}
}
function portableExecutablePath(value){return typeof value==='string'&&!value.includes('\0')&&path.win32.isAbsolute(value)&&/\.exe$/i.test(value) ? value : ''}
function shortcutDetails(theme,options){return {...launchOptions(options),icon:iconPaths(theme,options).ico,iconIndex:0}}
function shortcutIdentity(theme,options){
 const details={target:options.execPath,icon:iconPaths(theme,options).ico,iconIndex:0,appUserModelId:APP_ID}
 if(!options.isPackaged)details.args=launchOptions(options).args
 return details
}
function createDesktopShortcut(shell,desktop,theme,options){
 for(let i=0;i<100;i++){
  const name='MSQ Converter'+(i ? ' ('+i+')' : '')+'.lnk',file=path.join(desktop,name)
  if(fs.existsSync(file)&&!ownedShortcut(shell,file,options))continue
  const exists=fs.existsSync(file)
  if(!shell.writeShortcutLink(file,exists ? 'update' : 'create',exists ? shortcutIdentity(theme,options) : shortcutDetails(theme,options)))throw Error('Could not create desktop shortcut')
  return name
 }
 throw Error('No available desktop shortcut name')
}
function updateShellShortcuts(shell,desktop,pinnedDir,name,theme,options){
 const files=[]
 if(/^MSQ Converter(?: \(\d+\))?\.lnk$/.test(name||''))files.push(path.join(desktop,name))
 if(fs.existsSync(pinnedDir))for(const entry of fs.readdirSync(pinnedDir,{withFileTypes:true}))if(entry.isFile()&&entry.name.toLowerCase().endsWith('.lnk'))files.push(path.join(pinnedDir,entry.name))
 let updated=0
 for(const file of new Set(files))if(fs.existsSync(file)&&ownedShortcut(shell,file,options)){
  // Update only identity fields; retain custom arguments, cwd and description.
  if(!shell.writeShortcutLink(file,'update',shortcutIdentity(theme,options)))throw Error('Could not update MSQ shortcut: '+path.basename(file))
  updated++
 }
 return updated
}
module.exports={APP_ID,iconPaths,applyWindowIcon,launchOptions,createDesktopShortcut,updateShellShortcuts,portableExecutablePath,rendererIconSources}
