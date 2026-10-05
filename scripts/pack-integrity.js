const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict')
const {inspectWindowsExecutable}=require('../src/executable')
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function verifiedCopy(from,to) {
  const source=fs.readFileSync(from),sha256=crypto.createHash('sha256').update(source).digest('hex')
  fs.mkdirSync(path.dirname(to),{recursive:true})
  const temporary=to+'.verified-'+process.pid
  try {
    // Read/write explicitly, then verify the real bytes before replacing the copy.
    fs.writeFileSync(temporary,source,{mode:0o755})
    assert.equal(fs.statSync(temporary).size,source.length,'Incomplete resource copy')
    assert.equal(digest(temporary),sha256,'Resource checksum mismatch')
    fs.renameSync(temporary,to)
  } finally {fs.rmSync(temporary,{force:true})}
  return {size:source.length,sha256}
}
function* binaries(dir) {
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name)
    if(entry.isDirectory())yield* binaries(file)
    else if(/\.(exe|dll|node)$/i.test(entry.name))yield file
  }
}
function cleanStaging(dir,productName,languages=[]) {
  // Interrupted executable renames can leave incomplete copies in a reused stage.
  // Match only the builder's executable-copy names, never arbitrary hidden files.
  const names=['electron.exe',productName+'.exe']
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if(entry.isFile()&&names.some(name=>entry.name.startsWith('.'+name+'.')&&/^[A-Za-z0-9]{6}$/.test(entry.name.slice(name.length+2))))fs.rmSync(path.join(dir,entry.name))
  }
  const original=path.join(dir,'electron.exe'),renamed=path.join(dir,productName+'.exe')
  if(productName.toLowerCase()!=='electron'&&fs.existsSync(original)&&fs.existsSync(renamed)) {
    inspectWindowsExecutable(renamed)
    fs.rmSync(original)
  }
  const locales=path.join(dir,'locales')
  if(languages.length&&fs.existsSync(locales))for(const entry of fs.readdirSync(locales,{withFileTypes:true})) {
    if(entry.isFile()&&entry.name.endsWith('.pak')&&!languages.includes(entry.name.slice(0,-4)))fs.rmSync(path.join(locales,entry.name))
  }
}
async function afterPack(context) {
  if(context.electronPlatformName !== 'win32')return
  const root=path.resolve(__dirname,'..'),resources=path.join(context.appOutDir,'resources')
  const pkg=require('../package.json')
  cleanStaging(context.appOutDir,pkg.build.productName,pkg.build.electronLanguages)
  const icon=path.join(root,'src/assets/icon.ico')
  const result=await require('./windows-icon').patchRuntimeIcon(path.join(context.appOutDir,pkg.build.productName+'.exe'),icon,pkg.version)
  // Clean after the patched executable has been explicitly written as well.
  cleanStaging(context.appOutDir,pkg.build.productName,pkg.build.electronLanguages)
  assert.ok(!fs.existsSync(path.join(context.appOutDir,'electron.exe')),'Unrenamed Electron executable remained in staging')
  const iconManifest={}
  for(const theme of ['light','dark']){
    iconManifest[theme]={}
    for(const ext of ['ico','png'])iconManifest[theme][ext]=verifiedCopy(path.join(root,'src/assets/icon-'+theme+'.'+ext),path.join(resources,'icons/icon-'+theme+'.'+ext))
  }
  fs.writeFileSync(path.join(resources,'icon-integrity.json'),JSON.stringify(iconManifest,null,2))
  console.log('Embedded runtime MSQ icon verified; sizes:',result.sizes.join(', '))
  const source=path.join(root,'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe')
  assert.equal(inspectWindowsExecutable(source).machine,0x8664,'FFmpeg must be Windows x64')
  const engine=verifiedCopy(source,path.join(resources,'ffmpeg/ffmpeg.exe'))
  let count=0
  for(const file of binaries(context.appOutDir)){inspectWindowsExecutable(file);count++}
  fs.writeFileSync(path.join(resources,'engine-integrity.json'),JSON.stringify({ffmpeg:engine},null,2))
  console.log(`Verified ${count} Windows binaries; FFmpeg: ${engine.size} bytes, SHA256 ${engine.sha256}`)
}
module.exports=afterPack
module.exports.verifiedCopy=verifiedCopy
module.exports.digest=digest
module.exports.binaries=binaries
module.exports.cleanStaging=cleanStaging
