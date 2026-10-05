const fs=require('fs'),path=require('path'),assert=require('assert/strict')
const {digest,binaries}=require('./pack-integrity')
const {inspectWindowsExecutable}=require('../src/executable')
async function verifyBundle(){
const version=require('../package.json').version
const root=path.join(__dirname,'../dist/win-unpacked/resources')
const staging=path.dirname(root)
const iconFile=path.join(__dirname,'../src/assets/icon.ico'),{verifyEmbeddedIcon}=require('./windows-icon')
await verifyEmbeddedIcon(path.join(staging,'MSQ Converter.exe'),iconFile)
assert.ok(!fs.readdirSync(staging).some(name=>/^\.(electron|MSQ Converter)\.exe\.[A-Za-z0-9]{6}$/.test(name)),'Interrupted executable copy in portable staging')
assert.ok(!fs.existsSync(path.join(staging,'electron.exe')),'Unrenamed Electron copy in portable staging')
assert.deepEqual(fs.readdirSync(path.join(staging,'locales')).filter(name=>name.endsWith('.pak')).sort(),['en-US.pak','ru.pak'],'Stale locales in portable staging')
for(const relative of ['app.asar','ffmpeg/ffmpeg.exe','app.asar.unpacked/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node'])assert.ok(fs.existsSync(path.join(root,relative)),`Missing bundled dependency: ${relative}`)
assert.ok(fs.readdirSync(path.join(root,'app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib')).some(f=>f.endsWith('.node')),'Missing Sharp Windows native module')
const exes=fs.readdirSync(path.join(__dirname,'../dist')).filter(f=>f===`MSQ-Converter-${version}-portable-x64.exe`)
assert.equal(exes.length,1,'Expected exactly one portable EXE')
console.log('Portable EXE and Windows native dependencies found:',exes[0])

const script=fs.readFileSync(path.join(__dirname,'../dist/portable-launcher.nsi'),'utf8')
assert.ok(script.includes('WaitForSingleObject'),'Missing extraction mutex')
for(const theme of ['light','dark'])for(const ext of ['ico','png'])assert.ok(script.includes('IfFileExists "$INSTDIR\\resources\\icons\\icon-'+theme+'.'+ext+'" 0 repair'),'Missing native theme icon cache check')
assert.ok(script.includes('$LOCALAPPDATA\\MSQConverter\\runtime'),'Missing persistent cache')
assert.ok(!script.includes('RMDir /r $INSTDIR'),'Launcher must never delete an active runtime')
assert.ok(script.indexOf('ReleaseMutex')<script.indexOf('ExecWait'),'Unlock cache before launching Electron')

for(const file of ['conversion-worker.js','converter.js','engine.js','formats.js','executable.js'])assert.ok(fs.existsSync(path.join(root,'app.asar.unpacked/src',file)),'Worker module must be a real file: '+file)
assert.ok(fs.existsSync(path.join(root,'app-icon.ico')),'Missing Explorer icon')
const manifest=JSON.parse(fs.readFileSync(path.join(root,'engine-integrity.json'),'utf8')).ffmpeg
const binary=path.join(root,'ffmpeg/ffmpeg.exe')
const iconManifest=JSON.parse(fs.readFileSync(path.join(root,'icon-integrity.json'),'utf8'))
for(const theme of ['light','dark'])for(const ext of ['png','ico'])assert.equal(digest(path.join(root,'icons/icon-'+theme+'.'+ext)),iconManifest[theme][ext].sha256,'Damaged native theme icon')
inspectWindowsExecutable(binary,manifest.size)
assert.equal(digest(binary),manifest.sha256,'Bundled FFmpeg is damaged')
assert.equal(digest(binary),digest(path.join(__dirname,'../node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe')),'Bundled FFmpeg differs from original')
let count=0
for(const file of binaries(path.join(root,'..'))){inspectWindowsExecutable(file);count++}
console.log(`Integrity verified for ${count} Windows binaries; FFmpeg: ${manifest.size} bytes, SHA256 ${manifest.sha256}`)
// Verify the bytes shipped to users, not only the staging directory.
const os=require('os'),{execFileSync}=require('child_process')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'msq-portable-check-'))
try {
 const exe=path.join(__dirname,'../dist',exes[0])
 await verifyEmbeddedIcon(exe,iconFile)
 const listing=execFileSync(require('7zip-bin').path7za,['l','-slt',exe],{encoding:'utf8',maxBuffer:8*1024*1024})
 assert.ok(!/^Path = \.(electron|MSQ Converter)\.exe\.[A-Za-z0-9]{6}$/m.test(listing),'Interrupted executable copy shipped in final EXE')
 assert.ok(!/^Path = electron\.exe$/m.test(listing),'Unrenamed Electron copy shipped in final EXE')
 execFileSync(require('7zip-bin').path7za,['x',exe,'*.exe','*.dll','*.node','resources/app.asar','resources/engine-integrity.json','resources/icons/*','resources/icon-integrity.json','-r','-o'+temporary,'-y'],{stdio:'pipe',maxBuffer:4*1024*1024})
 assert.equal(digest(path.join(temporary,'resources/app.asar')),digest(path.join(root,'app.asar')),'Packaged UI archive differs from staging')
 await verifyEmbeddedIcon(path.join(temporary,'MSQ Converter.exe'),iconFile)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temporary,'resources/icon-integrity.json'),'utf8')),iconManifest)
 for(const theme of ['light','dark'])for(const ext of ['png','ico'])assert.equal(digest(path.join(temporary,'resources/icons/icon-'+theme+'.'+ext)),iconManifest[theme][ext].sha256,'Damaged theme icon inside final EXE')
 const shipped=path.join(temporary,'resources/ffmpeg/ffmpeg.exe')
 const metadata=JSON.parse(fs.readFileSync(path.join(temporary,'resources/engine-integrity.json'),'utf8')).ffmpeg
 assert.deepEqual(metadata,manifest,'Portable manifest differs from staging')
 inspectWindowsExecutable(shipped,manifest.size)
 assert.equal(digest(shipped),manifest.sha256,'FFmpeg inside final portable EXE is damaged')
 let shippedCount=0
 for(const file of binaries(temporary)) {
  inspectWindowsExecutable(file)
  assert.equal(digest(file),digest(path.join(staging,path.relative(temporary,file))),'Shipped Windows binary differs from staging: '+path.relative(temporary,file))
  shippedCount++
 }
 assert.equal(shippedCount,count,'Not every Windows binary was extracted from the portable EXE')
 console.log(`Final portable EXE: ${shippedCount} extracted Windows binaries match staging; FFmpeg checksum and PE sections verified`)
 console.log('Outer EXE and cached runtime both contain MSQ icon; native theme icons match their checksums')
} finally {fs.rmSync(temporary,{recursive:true,force:true})}
}
if(require.main===module)verifyBundle().catch(e=>{console.error(e);process.exitCode=1})
module.exports=verifyBundle
