// Pinned electron-builder 26.0.12 has no public portable.script setting.
// Override the script in memory for this build, preserving builder headers/macros.
// No node_modules files are changed. Upgrades must pass packaging tests.
const fs=require('fs'),path=require('path'),crypto=require('crypto')
const {build,Platform,Arch}=require('electron-builder')
const {NsisTarget}=require('app-builder-lib/out/targets/nsis/NsisTarget')
// electron-builder otherwise forces 7z level 9 even with normal compression.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '5'
const root=path.resolve(__dirname,'..'),pkg=require('../package.json')
const hash=crypto.createHash('sha256')
function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isDirectory())scan(file);else {hash.update(path.relative(root,file));hash.update(fs.readFileSync(file))}}}
scan(path.join(root,'src'));hash.update(fs.readFileSync(path.join(root,'package.json')));hash.update(fs.readFileSync(path.join(root,'package-lock.json')))
const cacheId=pkg.version+'-'+hash.digest('hex').slice(0,16)
const originalScript=NsisTarget.prototype.computeFinalScript,originalCompile=NsisTarget.prototype.executeMakensis
const originalPackage=NsisTarget.prototype.buildAppPackage
NsisTarget.prototype.buildAppPackage=async function(appOutDir,arch){
 // A reused staging directory can receive stale native-copy files after afterPack.
 // Run the same narrow cleanup immediately before the archive is created.
 if(this.isPortable)require('./pack-integrity').cleanStaging(appOutDir,pkg.build.productName,pkg.build.electronLanguages)
 return originalPackage.call(this,appOutDir,arch)
}
NsisTarget.prototype.computeFinalScript=function(script,isInstaller,archs){
 if(this.isPortable)script=fs.readFileSync(path.join(root,'build/portable-cache.nsi'),'utf8')
 return originalScript.call(this,script,isInstaller,archs)
}
NsisTarget.prototype.executeMakensis=function(defines,commands,script){
 if(this.isPortable){delete defines.UNPACK_DIR_NAME;defines.MSQ_CACHE_ID=cacheId;defines.MSQ_FFMPEG_SIZE=fs.statSync(path.join(root,'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe')).size;fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.writeFileSync(path.join(root,'dist/portable-launcher.nsi'),script);fs.writeFileSync(path.join(root,'dist/runtime-cache-id.txt'),cacheId)}
 return originalCompile.call(this,defines,commands,script)
}
console.log('Portable runtime cache:',cacheId)
build({projectDir:root,targets:Platform.WINDOWS.createTarget('portable',Arch.x64),config:process.platform==='win32' ? undefined : {win:{signAndEditExecutable:false}}}).catch(error=>{console.error(error);process.exitCode=1})
