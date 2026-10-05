const fs=require('fs'),path=require('path'),sharp=require('sharp')
const root=path.join(__dirname,'../src/assets'),sizes=[16,20,24,32,40,48,64,128,256]
async function ico(input) {
 const frames=await Promise.all(sizes.map(async size=>{
  const image=sharp(input).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).ensureAlpha()
  if(size===256)return image.png().toBuffer()
  const {data}=await image.raw().toBuffer({resolveWithObject:true}),stride=Math.ceil(size/32)*4,pixels=Buffer.alloc(size*size*4),mask=Buffer.alloc(stride*size),dib=Buffer.alloc(40)
  dib.writeUInt32LE(40,0);dib.writeInt32LE(size,4);dib.writeInt32LE(size*2,8);dib.writeUInt16LE(1,12);dib.writeUInt16LE(32,14);dib.writeUInt32LE(pixels.length,20)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const src=(y*size+x)*4,dst=((size-1-y)*size+x)*4
   pixels[dst]=data[src+2];pixels[dst+1]=data[src+1];pixels[dst+2]=data[src];pixels[dst+3]=data[src+3]
   if(data[src+3]===0)mask[(size-1-y)*stride+(x>>3)]|=0x80>>(x&7)
  }
  return Buffer.concat([dib,pixels,mask])
 }))
 const header=Buffer.alloc(6+frames.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);let offset=header.length
 frames.forEach((frame,i)=>{const o=6+i*16;header[o]=sizes[i]===256 ? 0 : sizes[i];header[o+1]=header[o];header.writeUInt16LE(1,o+4);header.writeUInt16LE(32,o+6);header.writeUInt32LE(frame.length,o+8);header.writeUInt32LE(offset,o+12);offset+=frame.length})
 return Buffer.concat([header,...frames])
}
async function main(){
 for(const theme of ['dark','light']){
  const master=path.join(root,'icon-'+theme+'-master.png');await sharp(master).resize(256,256,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile(path.join(root,'icon-'+theme+'.png'));fs.writeFileSync(path.join(root,'icon-'+theme+'.ico'),await ico(master))
 }
 fs.writeFileSync(path.join(root,'icon.png'),fs.readFileSync(path.join(root,'icon-light.png')))
 fs.writeFileSync(path.join(root,'icon.ico'),fs.readFileSync(path.join(root,'icon-light.ico')))
 console.log('Created transparent light/dark PNG and multi-size Windows ICO:',sizes.join(', '))
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
module.exports={ico,sizes}
