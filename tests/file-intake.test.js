const test=require('node:test'),assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os')
const {describeFiles}=require('../src/file-intake')
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msq-intake-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'nested'));fs.writeFileSync(path.join(dir,'sample.png'),'png');fs.writeFileSync(path.join(dir,'nested/movie.mp4'),'video');fs.writeFileSync(path.join(dir,'ignore.txt'),'text');return dir}
test('folder import finds nested supported files, sizes, skips unsupported and deduplicates',async t=>{
 const dir=fixture(t),result=await describeFiles([dir,path.join(dir,'sample.png')])
 assert.equal(result.files.length,2);assert.equal(result.files.find(f=>f.filePath.endsWith('sample.png')).size,3)
 assert.equal(result.skipped.length,1);assert.equal(result.errors.length,0);assert.equal(result.limited,false)
})
test('folder import respects limit and reports inaccessible paths',async t=>{
 const dir=fixture(t);assert.equal((await describeFiles([dir],1)).limited,true)
 const result=await describeFiles([path.join(dir,'missing.png')]);assert.equal(result.files.length,0);assert.equal(result.errors.length,1)
})
