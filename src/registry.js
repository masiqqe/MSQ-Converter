const { execFile } = require('child_process')
const fs = require('fs'), os = require('os')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)
const path = require('path')
const { extensions, formats, realFormat } = require('./formats')
const {iconPaths}=require('./app-icons')
function launchInfo(theme='dark') {
  const { app } = require('electron')
  // The cached runtime is persistent. Explorer skips the outer archive/decompression.
  const exe = process.execPath
  return {exe,icon:iconPaths(theme,{isPackaged:app.isPackaged,resourcesPath:process.resourcesPath}).ico,prefix: app.isPackaged ? [] : [path.join(__dirname,'..')]}
}
function command(flags, info=launchInfo()) {
  return [info.exe,...info.prefix,...flags,'%1'].map(v => `"${v}"`).join(' ')
}
function key(ext) { return `HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\MSQConverter` }
function put(lines,k,name,value) {
  const escape = v => v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')
  lines.push(`[${k}]`, (name ? '"'+escape(name)+'"' : '@')+'="'+escape(value)+'"', '')
}
async function importRegistry(lines) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(),'msq-reg-'))
  const file = path.join(dir,'menu.reg')
  try {
    await fs.promises.writeFile(file,'\ufeff'+lines.join('\r\n'),'utf16le')
    await execFileAsync('reg.exe',['import',file],{windowsHide:true,timeout:30000})
  } finally { await fs.promises.rm(dir,{recursive:true,force:true}) }
}
function registrationText(info, enabled=true) {
  const lines=['Windows Registry Editor Version 5.00','']
  for (const [type,exts] of Object.entries(extensions)) for (const ext of exts) {
    const k=key(ext)
    lines.push(`[-${k}]`, `[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\ConvertFile]`, '')
    if (!enabled) continue
    put(lines,k,'MUIVerb','MSQ Converter'); put(lines,k,'SubCommands',''); put(lines,k,'Icon',`"${info.icon || info.exe}",0`)
    formats[type].forEach((fmt,i) => {
      const sub=k+'\\shell\\'+String(i).padStart(2,'0')+'_'+fmt
      const label=fmt.startsWith('extract_') ? 'Extract audio → '+realFormat(fmt).toUpperCase() : '→ '+realFormat(fmt).toUpperCase()+(fmt.endsWith('_low') ? ' (low quality)' : '')
      put(lines,sub,'',label); put(lines,sub+'\\command','',command(['--format='+fmt],info))
    })
    if (type !== 'audio') for (const percent of ['25','50','75','100']) {
      const scale=k+'\\shell\\scale'
      if(percent==='25'){put(lines,scale,'MUIVerb','Scale');put(lines,scale,'SubCommands','');put(lines,scale,'Icon',`"${info.icon || info.exe}",0`)}
      const sub=scale+'\\shell\\scale'+percent; put(lines,sub,'MUIVerb',percent==='100' ? '100% (original size)' : percent+'%'); put(lines,sub,'SubCommands','')
      for (const fmt of type === 'image' ? ['png','jpg','webp'] : ['mp4','webm','gif']) {
        const sk=sub+'\\shell\\'+fmt; put(lines,sk,'',fmt.toUpperCase()); put(lines,sk+'\\command','',command(percent==='100' ? ['--format='+fmt] : ['--scale='+percent,'--format='+fmt],info))
      }
    }
    if (['video','gif'].includes(type)) for (const resolution of ['720p','1080p']) {
      const sub=k+'\\shell\\resolution'+resolution; put(lines,sub,'',resolution+' → MP4')
      put(lines,sub+'\\command','',command(['--resolution='+resolution,'--format=mp4'],info))
    }
  }
  return lines
}
async function registerAll(theme='dark') {
  if (process.platform !== 'win32') throw new Error('Explorer integration is Windows-only')
  await importRegistry(registrationText(launchInfo(theme))); return true
}
async function unregisterAll() {
  if (process.platform !== 'win32') throw new Error('Explorer integration is Windows-only')
  await importRegistry(registrationText(null,false)); return false
}
async function refreshShellIcons(){
 if(process.platform!=='win32')return
 const code='Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class MSQShell { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b); }\'; [MSQShell]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)'
 await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,timeout:10000})
}
module.exports={registerAll,unregisterAll,command,registrationText,refreshShellIcons}
