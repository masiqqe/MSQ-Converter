const test=require('node:test'),assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),sharp=require('sharp')
const {APP_ID,iconPaths,applyWindowIcon,createDesktopShortcut,updateShellShortcuts,rendererIconSources}=require('../src/app-icons')
const {patchRuntimeIcon,verifyEmbeddedIcon,readResources}=require('../scripts/windows-icon')
const {inspectWindowsExecutable}=require('../src/executable')
const assets=path.join(__dirname,'../src/assets')
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msq-icons-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}
test('packaged UI logos use actual resource bytes without relying on files inside ASAR',t=>{
 const root=temp(t),dir=path.join(root,'icons');fs.mkdirSync(dir)
 for(const theme of ['light','dark'])fs.copyFileSync(path.join(assets,'icon-'+theme+'.png'),path.join(dir,'icon-'+theme+'.png'))
 const sources=rendererIconSources({isPackaged:true,resourcesPath:root,assetDir:assets})
 for(const theme of ['light','dark']){assert.ok(sources[theme].startsWith('data:image/png;base64,'));assert.deepEqual(Buffer.from(sources[theme].split(',')[1],'base64'),fs.readFileSync(path.join(dir,'icon-'+theme+'.png')))}
 assert.notEqual(sources.light,sources.dark)
 fs.rmSync(path.join(dir,'icon-dark.png'));assert.deepEqual(Buffer.from(rendererIconSources({isPackaged:true,resourcesPath:root,assetDir:assets}).dark.split(',')[1],'base64'),fs.readFileSync(path.join(assets,'icon.png')))
})
test('theme icons have real alpha, transparent holes and multi-size ICO masks',async()=>{
 const api=await import('resedit')
 for(const theme of ['light','dark']){
  const png=fs.readFileSync(path.join(assets,'icon-'+theme+'.png')),{data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  assert.equal(data[3],0);assert.equal(data[(info.width-1)*4+3],0);assert.equal(data.at(-1),0);assert.equal(data[(128*256+128)*4+3],0)
  assert.ok(data.some((v,i)=>i%4===3&&v===255))
  const ico=api.Data.IconFile.from(fs.readFileSync(path.join(assets,'icon-'+theme+'.ico')))
  assert.deepEqual(ico.icons.map(i=>i.width||256),[16,20,24,32,40,48,64,128,256])
  for(const {data:frame} of ico.icons){if(frame.isRaw()){const raw=await sharp(Buffer.from(frame.bin)).ensureAlpha().raw().toBuffer();assert.equal(raw[3],0)}else{assert.equal(Buffer.from(frame.pixels)[3],0);assert.ok(Buffer.from(frame.masks)[0]&0x80)}}
 }
 assert.notDeepEqual(fs.readFileSync(path.join(assets,'icon-light.png')),fs.readFileSync(path.join(assets,'icon-dark.png')))
})
test('Windows window and taskbar use physical themed resources and the same AppUserModelID',()=>{
 const calls=[],window={setIcon:p=>calls.push(p),setAppDetails:d=>calls.push(d)},options={isPackaged:true,resourcesPath:'C:\\MSQ\\resources',platform:'win32',execPath:'C:\\My Apps\\MSQ Converter.exe'}
 applyWindowIcon(window,'light',options)
 assert.ok(calls[0].endsWith('icon-light.ico'));assert.ok(!calls[0].includes('app.asar'));assert.equal(calls[1].appId,APP_ID);assert.equal(calls[1].appIconPath,calls[0]);assert.equal(calls[1].relaunchCommand,'"'+options.execPath+'"');assert.equal(calls[1].relaunchDisplayName,'MSQ Converter')
 assert.ok(iconPaths('unexpected',{assetDir:assets}).png.endsWith('icon-dark.png'))
})
test('themed shortcuts avoid name collisions and update only identified MSQ links',t=>{
 const root=temp(t),desktop=path.join(root,'desktop'),pinned=path.join(root,'pinned');fs.mkdirSync(desktop);fs.mkdirSync(pinned)
 const existing=path.join(desktop,'MSQ Converter.lnk'),other=path.join(pinned,'Other.lnk'),own=path.join(pinned,'Pinned MSQ.lnk');for(const file of [existing,other,own])fs.writeFileSync(file,'link')
 const details=new Map([[existing,{target:'other.exe'}],[other,{target:'other.exe'}],[own,{target:'old-msq.exe',appUserModelId:APP_ID}]]),writes=[]
 const shell={readShortcutLink:f=>details.get(f),writeShortcutLink:(f,operation,d)=>{writes.push([f,operation,d]);details.set(f,d);fs.writeFileSync(f,'link');return true}}
 const options={isPackaged:true,resourcesPath:root,execPath:path.join(root,'MSQ.exe'),platform:'win32'}
 const name=createDesktopShortcut(shell,desktop,'light',options);assert.equal(name,'MSQ Converter (1).lnk');assert.equal(writes[0][1],'create')
 assert.equal(updateShellShortcuts(shell,desktop,pinned,name,'dark',options),2)
 assert.ok(!writes.some(w=>w[0]===existing||w[0]===other));assert.ok(writes.slice(1).every(w=>w[2].icon.endsWith('icon-dark.ico')))
 fs.unlinkSync(path.join(desktop,name));assert.equal(updateShellShortcuts(shell,desktop,pinned,'../MSQ Converter.lnk','light',options),1)
})
test('pinned portable launchers are recognized case-insensitively without losing their launch options',t=>{
 const root=temp(t),pinned=path.join(root,'pinned');fs.mkdirSync(pinned)
 const link=path.join(pinned,'MSQ portable.lnk'),unrelated=path.join(pinned,'Other.lnk');for(const file of [link,unrelated])fs.writeFileSync(file,'link')
 const info={target:'c:/Downloads/MSQ-Converter-3.0.5-portable-x64.EXE',args:'--format=gif "C:\\Videos\\sample.mp4"',cwd:'C:\\Videos',description:'My conversion'}
 const data=new Map([[link,info],[unrelated,{target:'C:\\Downloads\\Other.exe',args:'',cwd:'C:\\Downloads'}]]),writes=[]
 const shell={readShortcutLink:f=>data.get(f),writeShortcutLink:(f,operation,details)=>{assert.equal(operation,'update');writes.push(f);data.set(f,{...data.get(f),...details});return true}}
 const options={isPackaged:true,platform:'win32',execPath:'C:\\Cache\\MSQ Converter.exe',portableFile:'C:\\Downloads\\MSQ-Converter-3.0.5-portable-x64.exe',resourcesPath:'C:\\Cache\\resources'}
 assert.equal(updateShellShortcuts(shell,root,pinned,'','light',options),1)
 const updated=data.get(link);assert.equal(updated.target,options.execPath);assert.equal(updated.args,info.args);assert.equal(updated.cwd,info.cwd);assert.equal(updated.description,info.description);assert.equal(updated.appUserModelId,APP_ID)
 assert.ok(updated.icon.endsWith('icon-light.ico'));assert.deepEqual(writes,[link])
})
test('development icon refresh does not rewrite another app using the same Electron executable',t=>{
 const root=temp(t),link=path.join(root,'Other Electron app.lnk');fs.writeFileSync(link,'link')
 const options={isPackaged:false,platform:'win32',execPath:'C:\\Electron\\electron.exe',appRoot:'C:\\Projects\\MSQ',assetDir:assets}
 const shell={readShortcutLink:()=>({target:options.execPath,args:'"C:\\Projects\\Other"'}),writeShortcutLink:()=>assert.fail('Unrelated Electron link changed')}
 assert.equal(updateShellShortcuts(shell,root,root,'','dark',options),0)
})
test('updating an existing themed desktop shortcut preserves custom conversion arguments',t=>{
 const root=temp(t),file=path.join(root,'MSQ Converter.lnk');fs.writeFileSync(file,'link')
 let details={target:'old-msq.exe',args:'--format=png "sample.jpg"',cwd:'C:\\Pictures',description:'Images',appUserModelId:APP_ID}
 const shell={readShortcutLink:()=>details,writeShortcutLink:(link,operation,value)=>{assert.equal(link,file);assert.equal(operation,'update');details={...details,...value};return true}}
 const options={isPackaged:true,platform:'win32',execPath:'C:\\Cache\\MSQ Converter.exe',resourcesPath:'C:\\Cache\\resources'}
 assert.equal(createDesktopShortcut(shell,root,'dark',options),'MSQ Converter.lnk');assert.equal(details.args,'--format=png "sample.jpg"');assert.equal(details.cwd,'C:\\Pictures');assert.equal(details.description,'Images');assert.ok(details.icon.endsWith('icon-dark.ico'))
})
test('runtime icon patch preserves non-icon resources and validates the embedded replacement',async t=>{
 const dir=temp(t),api=await import('resedit'),exe=api.NtExecutable.createEmpty(false,false),res=api.NtExecutableResource.from(exe)
 res.entries.push({type:'INTEGRITY',id:'ELECTRONASAR',lang:1033,codepage:1200,bin:Buffer.from('{"hash":"preserve-me"}')})
 const dark=path.join(assets,'icon-dark.ico'),light=path.join(assets,'icon-light.ico')
 api.Resource.IconGroupEntry.replaceIconsForResource(res.entries,101,1033,api.Data.IconFile.from(fs.readFileSync(dark)).icons.map(i=>i.data));res.outputResource(exe)
 const file=path.join(dir,'MSQ.exe');fs.writeFileSync(file,Buffer.from(exe.generate()))
 await assert.rejects(()=>verifyEmbeddedIcon(file,light))
 await patchRuntimeIcon(file,light,'3.0.4');inspectWindowsExecutable(file)
 assert.deepEqual((await verifyEmbeddedIcon(file,light)).sizes,[16,20,24,32,40,48,64,128,256])
 const resources=(await readResources(file)).resources;assert.equal(Buffer.from(resources.entries.find(e=>e.type==='INTEGRITY').bin).toString(),'{"hash":"preserve-me"}')
})
