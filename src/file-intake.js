const fs=require('fs'),path=require('path')
const {getFileType,extension}=require('./formats')
async function describeFiles(paths,limit=10000){
 const files=[],skipped=[],errors=[],seen=new Set(),pending=[...new Set(paths.filter(p=>typeof p==='string' && path.isAbsolute(p)))]
 while(pending.length && files.length<limit){
  const filePath=pending.shift()
  if(seen.has(filePath))continue;seen.add(filePath)
  try{
   const stat=await fs.promises.stat(filePath)
   if(stat.isDirectory()){
    const entries=await fs.promises.readdir(filePath,{withFileTypes:true})
    for(const entry of entries)if(!entry.isSymbolicLink())pending.push(path.join(filePath,entry.name))
   }else if(stat.isFile() && getFileType(extension(filePath))!=='unknown')files.push({filePath,size:stat.size})
   else skipped.push(filePath)
  }catch(error){errors.push({filePath,message:error.message})}
 }
 return {files,skipped,errors,limited:pending.length>0}
}
module.exports={describeFiles}
