const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path')
const pkg=require('../package.json')
test('portable launcher retains runtime and unlocks extraction before launching',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../build/portable-cache.nsi'),'utf8')
 assert.ok(s.includes('$LOCALAPPDATA\\MSQConverter\\runtime\\${MSQ_CACHE_ID}'))
 assert.ok(s.includes('WaitForSingleObject'));assert.ok(s.includes('IfFileExists "$INSTDIR\\.ready"'))
 assert.ok(!s.includes('RMDir'));assert.ok(s.indexOf('ReleaseMutex')<s.indexOf('ExecWait'))
 assert.ok(s.includes('IntCmp $6 ${MSQ_FFMPEG_SIZE} launch repair repair'))
 for(const theme of ['light','dark'])for(const ext of ['ico','png']){
  const file='$INSTDIR\\resources\\icons\\icon-'+theme+'.'+ext
  assert.ok(s.includes('IfFileExists "'+file+'" 0 repair'))
  assert.ok(s.includes('IfFileExists "'+file+'" 0 failed'))
 }
 assert.equal(pkg.version,'3.0.0');assert.ok(pkg.build.extraResources.some(r=>r.to==='ffmpeg/ffmpeg.exe'))
})
test('theme values are saved and screenshot decoration is absent',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8'),main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8')
 assert.ok(!html.includes('MSQ / 02'));assert.ok(html.includes('data-theme-choice="light"'));assert.ok(html.includes('primaryPicker'));assert.ok(main.includes("theme:value.theme === 'light'"))
})
