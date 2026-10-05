(()=>{
// One format catalog for the CLI, renderer, registry and conversion engine.
const extensions = {
  image: ['jpg','jpeg','png','webp','ico','bmp','tiff','tif','avif','svg','pdf'],
  video: ['mp4','mkv','avi','mov','webm','flv','wmv','ogv','ts','mpg','mpeg'],
  audio: ['mp3','wav','flac','aac','ogg','m4a','wma','opus'],
  gif: ['gif']
}
const formats = {
  image: ['png','jpg','webp','ico','gif','avif','pdf'],
  video: ['mp4','mkv','avi','mov','webm','ogv','gif','gif_low','mp4_low','extract_mp3','extract_aac','extract_wav','mp3','aac','ogg','wav','flac'],
  audio: ['mp3','wav','flac','aac','ogg'],
  gif: ['mp4','mkv','avi','mov','webm','ogv','mp4_low','gif','gif_low','png','webp','jpg','ico','avif','pdf']
}
function extension(file) { return file.split(/[\\/]/).pop().split('.').pop().toLowerCase() }
function getFileType(ext) {
  ext = ext.toLowerCase().replace(/^\./, '')
  return Object.keys(extensions).find(type => extensions[type].includes(ext)) || 'unknown'
}
function commonFormats(files) {
  return files.length ? formats[getFileType(extension(files[0]))]?.filter(f => files.every(file => formats[getFileType(extension(file))]?.includes(f))) || [] : []
}
function realFormat(f) { return f.replace(/^extract_/, '').replace(/_low$/, '') }
if (typeof module !== 'undefined') module.exports = { extensions, formats, extension, getFileType, commonFormats, realFormat }
else window.catalog = { extensions, formats, extension, getFileType, commonFormats, realFormat }

})()
