const test=require('node:test'),assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os')
const {inspectWindowsExecutable}=require('../src/executable')
const {verifiedCopy,digest,cleanStaging}=require('../scripts/pack-integrity')
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msq-pe-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const data=Buffer.alloc(2048);data.write('MZ');data.writeUInt32LE(128,60);data.writeUInt32LE(0x4550,128);data.writeUInt16LE(0x8664,132);data.writeUInt16LE(1,134);data.writeUInt16LE(240,148)
 const section=128+24+240;data.write('.text',section);data.writeUInt32LE(1536,section+16);data.writeUInt32LE(512,section+20)
 const file=path.join(dir,'ffmpeg.exe');fs.writeFileSync(file,data);return {dir,file,data}
}
test('Windows PE inspection rejects a truncated EXE even when MZ and PE headers survive',t=>{
 const {file,data}=fixture(t);assert.equal(inspectWindowsExecutable(file).machine,0x8664)
 fs.writeFileSync(file,data.subarray(0,1500));assert.throws(()=>inspectWindowsExecutable(file),{code:'ENGINE_INVALID'})
})
test('Windows PE inspection rejects a size mismatch and non-executable content',t=>{
 const {file}=fixture(t);assert.throws(()=>inspectWindowsExecutable(file,2049),{code:'ENGINE_INVALID'})
 fs.writeFileSync(file,'not an executable');assert.throws(()=>inspectWindowsExecutable(file),{code:'ENGINE_INVALID'})
})
test('verified resource copy replaces a damaged destination and preserves every byte',t=>{
 const {dir,file,data}=fixture(t),out=path.join(dir,'resources/ffmpeg/ffmpeg.exe')
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,data.subarray(0,1500))
 const result=verifiedCopy(file,out);assert.equal(result.size,data.length);assert.equal(digest(out),digest(file));assert.deepEqual(fs.readFileSync(out),data);inspectWindowsExecutable(out,result.size)
})
test('portable staging removes interrupted executable copies and stale locales without deleting unrelated files',t=>{
 const {dir,data}=fixture(t),locales=path.join(dir,'locales');fs.mkdirSync(locales)
 for(const name of ['.electron.exe.Ab12cd','.MSQ Converter.exe.Zy98xW','.keep','.electron.exe.notes'])fs.writeFileSync(path.join(dir,name),'fixture')
 for(const name of ['electron.exe','MSQ Converter.exe'])fs.writeFileSync(path.join(dir,name),data)
 for(const name of ['en-US.pak','ru.pak','de.pak','README'])fs.writeFileSync(path.join(locales,name),'fixture')
 cleanStaging(dir,'MSQ Converter',['en-US','ru'])
 assert.ok(!fs.existsSync(path.join(dir,'.electron.exe.Ab12cd')));assert.ok(!fs.existsSync(path.join(dir,'.MSQ Converter.exe.Zy98xW')))
 assert.ok(!fs.existsSync(path.join(dir,'electron.exe')))
 for(const name of ['MSQ Converter.exe','.keep','.electron.exe.notes'])assert.ok(fs.existsSync(path.join(dir,name)))
 assert.deepEqual(fs.readdirSync(locales).sort(),['README','en-US.pak','ru.pak'])
})
