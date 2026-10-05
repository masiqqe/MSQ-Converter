const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict')
const hash=bytes=>crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex')
const resourceKey=e=>JSON.stringify([e.type,e.id,e.lang])
async function readResources(file){const api=await import('resedit'),exe=api.NtExecutable.from(fs.readFileSync(file),{ignoreCert:true});return {api,exe,resources:api.NtExecutableResource.from(exe)}}
function iconSignature(icon){
 const raw=icon.isRaw(),bytes=Buffer.from(raw ? icon.bin : icon.generate())
 // ICO directory dimensions use zero for 256; PE bitmap items omit them.
 const width=icon.width || (raw ? bytes.readUInt32BE(16) : Math.abs(icon.bitmapInfo.width))
 const height=icon.height || (raw ? bytes.readUInt32BE(20) : Math.abs(icon.bitmapInfo.height)/2)
 return {width,height,sha256:hash(bytes)}
}
async function verifyEmbeddedIcon(file,ico){
 const {api,resources}=await readResources(file),expected=api.Data.IconFile.from(fs.readFileSync(ico)).icons.map(i=>iconSignature(i.data)).sort((a,b)=>a.width-b.width)
 const groups=api.Resource.IconGroupEntry.fromEntries(resources.entries);assert.ok(groups.length,'EXE has no embedded icon group')
 const actual=groups[0].getIconItemsFromEntries(resources.entries).map(iconSignature).sort((a,b)=>a.width-b.width)
 assert.deepEqual(actual,expected,'Embedded EXE icon does not match the transparent MSQ icon')
 return {groups:groups.length,sizes:expected.map(i=>i.width)}
}
async function patchRuntimeIcon(file,ico,version){
 const {api,exe,resources}=await readResources(file)
 const preserved=new Map(resources.entries.filter(e=>![3,14,16].includes(e.type)).map(e=>[resourceKey(e),hash(e.bin)]))
 const icons=api.Data.IconFile.from(fs.readFileSync(ico)).icons.map(i=>i.data),groups=api.Resource.IconGroupEntry.fromEntries(resources.entries)
 for(const group of groups.length ? groups : [{id:101,lang:1033}])api.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icons)
 for(const info of api.Resource.VersionInfo.fromEntries(resources.entries)){
  info.setFileVersion(version,1033);info.setProductVersion(version,1033)
  info.setStringValues({lang:1033,codepage:1200},{FileDescription:'MSQ Converter',ProductName:'MSQ Converter',OriginalFilename:'MSQ Converter.exe',InternalName:'MSQ Converter',CompanyName:'masiqqe'})
  info.outputToResourceEntries(resources.entries)
 }
 resources.outputResource(exe);const bytes=Buffer.from(exe.generate()),temporary=file+'.msq-icon-'+process.pid
 try{fs.writeFileSync(temporary,bytes);assert.equal(hash(fs.readFileSync(temporary)),hash(bytes),'Incomplete icon resource write');fs.renameSync(temporary,file)}finally{fs.rmSync(temporary,{force:true})}
 const result=await readResources(file)
 for(const [key,sha] of preserved){const entry=result.resources.entries.find(e=>resourceKey(e)===key);assert.ok(entry,'Non-icon resource lost during icon replacement');assert.equal(hash(entry.bin),sha,'Non-icon resource changed during icon replacement')}
 return verifyEmbeddedIcon(file,ico)
}
module.exports={patchRuntimeIcon,verifyEmbeddedIcon,readResources}
