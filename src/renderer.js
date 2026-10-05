const api=window.msq,catalog=window.catalog,$=id=>document.getElementById(id),jobs=new Map(),history=[],selection=new Set(),batchIds=new Set()
let settings={lang:'ru',autoClose:false,autoUpdate:true,integration:false,theme:'dark',primary:'#8b5cf6'},appIcons={},counter=0,focused=null,closeTimer=null,toastTimer=null,previousFocus=null,menuFocus=null,importing=false,batchStart=0,view='queue',batchSignature=''
const t=key=>window.translations[settings.lang][key] || key
const nameOf=file=>file.split(/[\\/]/).pop()
const active=j=>['queued','active','cancelling'].includes(j.state)
const editable=j=>j.state==='ready'
const sizeText=n=>typeof n!=='number' ? '—' : n>=1048576 ? (n/1048576).toFixed(n>=104857600 ? 0 : 1)+' MB' : n>=1024 ? (n/1024).toFixed(1)+' KB' : n+' B'
const timeText=ms=>ms<1000 ? Math.round(ms)+' ms' : ms<60000 ? (ms/1000).toFixed(1)+' '+t('seconds') : Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')
const formatText=f=>catalog.realFormat(f).toUpperCase()+(f.endsWith('_low') ? ' · '+t('low') : f.startsWith('extract_') ? ' · '+t('extract') : '')
let themeTimer
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches
function animateView(el){if(!reduceMotion())el.animate([{opacity:.6,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:150,easing:'ease-out'})}
function toast(message){clearTimeout(toastTimer);$('toastText').textContent=message;$('toast').classList.add('open');toastTimer=setTimeout(()=>$('toast').classList.remove('open'),4500)}
function stopClose(){clearTimeout(closeTimer);closeTimer=null}
function scheduleClose(){stopClose();if(settings.autoClose && jobs.size && [...jobs.values()].every(j=>j.state==='done') && !document.querySelector('.overlay.open')){toast(t('closeSoon'));closeTimer=setTimeout(()=>api.send('window-close'),5000)}}
function showSettings(){stopClose();closeMenu();previousFocus=document.activeElement;$('settingsOverlay').classList.add('open');$('settingsOverlay').querySelector('button').focus()}
function hideSettings(){$('settingsOverlay').classList.remove('open');previousFocus?.focus();scheduleClose()}
function setView(next){const changed=view!==next;view=next;$('queuePanel').hidden=next!=='queue';$('historyPanel').hidden=next!=='history';for(const v of ['queue','history']){$(v+'Btn').classList.toggle('active',v===next);$(v+'Btn').setAttribute('aria-selected',String(v===next));$(v+'Btn').tabIndex=v===next ? 0 : -1}closeMenu();if(changed)animateView($(next+'Panel'))}
function applyTheme(){
 const changed=document.documentElement.dataset.theme!==settings.theme
 if(changed&&!reduceMotion()){document.documentElement.classList.add('theme-changing');clearTimeout(themeTimer);themeTimer=setTimeout(()=>document.documentElement.classList.remove('theme-changing'),220)}
 document.documentElement.dataset.theme=settings.theme
 const icon=appIcons[settings.theme]
 document.querySelectorAll('[data-app-icon]').forEach(el=>{if(el.getAttribute('src')!==icon){el.src=icon;if(changed&&!reduceMotion())el.animate([{opacity:.45,transform:'scale(.95)'},{opacity:1,transform:'scale(1)'}],{duration:180,easing:'ease-out'})}})
 document.querySelector('link[rel="icon"]').href=icon
 document.documentElement.style.setProperty('--accent',settings.primary)
 const rgb=settings.primary.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16))
 const lum=c=>c.map(v=>{v/=255;return v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
 document.documentElement.style.setProperty('--on-primary',lum(rgb)>.179 ? '#101827' : '#ffffff')
 let ink=[...rgb];for(let i=0;i<30;i++){if(settings.theme==='light' ? lum(ink)<=.16 : lum(ink)>=.3)break;ink=ink.map(v=>Math.round(settings.theme==='light' ? v*.9 : v+(255-v)*.1))}
 document.documentElement.style.setProperty('--accent-ink','rgb('+ink.join(',')+')')
 $('primaryPicker').value=settings.primary
 document.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===settings.theme)))
 document.querySelectorAll('[data-color]').forEach(b=>{b.style.background=b.dataset.color;b.setAttribute('aria-pressed',String(b.dataset.color===settings.primary))})
}
function refreshLanguage(){
 applyTheme();document.documentElement.lang=settings.lang
 document.querySelectorAll('[data-t]').forEach(el=>el.textContent=t(el.dataset.t))
 document.querySelectorAll('[data-tip]').forEach(el=>el.setAttribute('aria-label',t(el.dataset.tip)))
 $('selectAll').setAttribute('aria-label',settings.lang==='ru' ? 'Выбрать все файлы' : 'Select all files')
 $('settingLang').value=settings.lang
 $('createShortcutBtn').textContent=t(settings.desktopShortcutName ? 'updateShortcut' : 'createShortcut')
 for(const [id,key] of [['toggleAutoClose','autoClose'],['toggleAutoUpdate','autoUpdate'],['toggleIntegration','integration']])$(id).setAttribute('aria-checked',String(settings[key]))
 for(const j of jobs.values())renderJob(j)
 renderHistory();refreshBatch();summary();inspect()
}
let saveChain=Promise.resolve()
function persist(){saveChain=saveChain.then(()=>api.saveSettings({...settings})).catch(e=>toast(e.message));refreshLanguage();scheduleClose();return saveChain}
function scope(){const selected=[...selection].map(id=>jobs.get(id)).filter(Boolean);return (selected.length ? selected : [...jobs.values()]).filter(editable)}
function setOptions(select,formats,value){select.replaceChildren();for(const f of formats){const o=document.createElement('option');o.value=f;o.textContent=f ? formatText(f) : t('byFile');select.append(o)}select.value=value}
function operationAllowed(j,op,format=j.format){const type=catalog.getFileType(catalog.extension(j.filePath)),audio=['mp3','wav','flac','aac','ogg'].includes(catalog.realFormat(format));return op==='convert' || !audio && type!=='audio' && (!['720p','1080p'].includes(op) || ['gif','video'].includes(type))}
function refreshBatch(){
 const ready=scope(),signature=settings.lang+'|'+importing+'|'+ready.map(j=>[j.id,j.format,j.mode,j.percent,j.resolution].join(':')).join(',')
 if(signature!==batchSignature){
  batchSignature=signature
  const common=catalog.commonFormats(ready.map(j=>j.filePath)),uniform=ready.length && ready.every(j=>j.format===ready[0].format)
  setOptions($('outputFormat'),['',...common],uniform && common.includes(ready[0].format) ? ready[0].format : '')
  $('outputFormat').disabled=!common.length || importing;$('operation').disabled=!ready.length || importing
  const operations=ready.map(j=>j.mode==='scale' ? j.percent : j.mode==='resolution' ? j.resolution : 'convert')
  $('operation').value=operations.length && operations.every(o=>o===operations[0]) ? operations[0] : 'convert'
  for(const o of $('operation').options)o.disabled=ready.some(j=>!operationAllowed(j,o.value))
 }
 $('selectionInfo').textContent=(selection.size ? t('selected') : t('allReady'))+': '+ready.length
 $('startCount').textContent=ready.length ? '('+ready.length+')' : ''
 $('startBtn').disabled=!ready.length || importing
 const all=[...jobs.values()];$('clearBtn').disabled=!all.some(j=>!active(j) && !editable(j));$('retryAllBtn').disabled=!all.some(j=>['error','cancelled'].includes(j.state));$('cancelAllBtn').disabled=!all.some(active)
 $('selectAll').disabled=!all.length;$('selectAll').checked=!!all.length && selection.size===all.length;$('selectAll').indeterminate=selection.size>0 && selection.size<all.length
 $('emptyState').hidden=!!jobs.size || importing;$('addBtn').disabled=importing;$('folderBtn').disabled=importing
}
function summary(){
 const all=[...jobs.values()],done=all.filter(j=>j.state==='done').length,errors=all.filter(j=>j.state==='error').length,working=all.filter(active),total=[...batchIds].map(id=>jobs.get(id)).filter(Boolean)
 $('queueCount').textContent=String(all.length);$('historyCount').textContent=String(history.length)
 $('summary').textContent=importing ? t('importing') : all.length ? done+'/'+all.length+' '+t('finished')+(errors ? ' · '+errors+' '+t('errors') : '')+(working.length ? ' · '+working.length+' '+t('working') : '') : t('idle')
 $('currentFile').textContent=working.find(j=>j.state==='active') ? nameOf(working.find(j=>j.state==='active').filePath) : ''
 $('statusLight').className='status-light'+(working.length || importing ? ' working' : errors ? ' error' : '')
 $('aggregateProgress').hidden=!working.length
 $('aggregateProgress').querySelector('i').style.width=(total.length ? total.reduce((s,j)=>s+(!active(j) ? 100 : j.progress),0)/total.length : 0)+'%'
 $('elapsed').textContent=working.length && batchStart ? timeText(Date.now()-batchStart) : ''
 refreshBatch()
}
function renderJob(j){
 const el=j.element
 const motionClasses=['entering','just-finished'].filter(name=>el.classList.contains(name))
 el.className='file-item '+j.state+(selection.has(j.id) ? ' selected' : '')+(motionClasses.length ? ' '+motionClasses.join(' ') : '');el.setAttribute('aria-selected',String(selection.has(j.id)));el.querySelector('.row-check').checked=selection.has(j.id)
 const sub=el.querySelector('.file-sub');sub.textContent=j.error ? j.error.split(/[\r\n]/).find(Boolean) : j.outputPath ? nameOf(j.outputPath)+(j.outputSize!==undefined ? ' · '+sizeText(j.outputSize) : '') : catalog.extension(j.filePath).toUpperCase()+(j.mode==='scale' ? ' · '+t('scale')+' '+j.percent+'%' : j.mode==='resolution' ? ' · '+j.resolution : '')
 sub.title=j.error || j.outputPath || j.filePath
 const target=el.querySelector('.target-select'),label=el.querySelector('.target-label');target.hidden=!editable(j);label.hidden=editable(j);label.textContent=formatText(j.format);if(editable(j))setOptions(target,catalog.formats[catalog.getFileType(catalog.extension(j.filePath))],j.format)
 el.querySelector('.size-cell').textContent=sizeText(j.size)
 const state=el.querySelector('.state-cell'),stateKey=settings.lang+'|'+j.state;state.className='state-cell state-'+j.state
 if(state.dataset.stateKey!==stateKey){
  state.dataset.stateKey=stateKey;state.replaceChildren()
  const icon=['done','error'].includes(j.state) ? j.state==='done' ? 'check' : 'error' : active(j) ? 'clock' : null
  const stateLabel=document.createElement('span');stateLabel.className='state-icon';if(icon)stateLabel.innerHTML=window.icons(icon);stateLabel.append(document.createTextNode(t(j.state)));state.append(stateLabel)
 }
 el.querySelector('.meter').hidden=j.state==='ready' || ['error','cancelled'].includes(j.state);el.querySelector('.meter>i').style.width=(j.state==='done' ? 100 : j.progress)+'%'
 el.querySelector('.meter-value').textContent=j.state==='done' ? '100%' : active(j) ? j.progress+'%' : '—'
 el.querySelector('.speed').textContent=j.state==='active' && j.metrics?.speed ? j.metrics.speed.toFixed(2)+'×'+(j.metrics.fps ? ' · '+Math.round(j.metrics.fps)+' fps' : '') : j.finishedAt && j.startedAt ? timeText(j.finishedAt-j.startedAt) : ''
 const quick=el.querySelector('.quick-action');quick.hidden=j.state==='ready';quick.disabled=j.state==='cancelling' || j.retrying===true;quick.innerHTML=window.icons(active(j) ? 'stop' : ['error','cancelled'].includes(j.state) ? 'retry' : 'folder');quick.dataset.tip=active(j) ? 'cancel' : ['error','cancelled'].includes(j.state) ? 'retry' : 'showResult';quick.setAttribute('aria-label',t(quick.dataset.tip))
 el.querySelector('.more-action').setAttribute('aria-label',t('menu'))
}
function inspect(){
 const j=jobs.get(focused);$('inspector').classList.toggle('error',j?.state==='error')
 $('inspectorPath').textContent=j ? j.error ? nameOf(j.filePath)+' — '+j.error.split(/[\r\n]/).find(Boolean) : j.outputPath || j.filePath : t('outputHint')
 $('inspectorPath').title=j?.error || j?.outputPath || j?.filePath || ''
 $('detailBtn').hidden=!j?.error;$('errorDetails').textContent=j?.error || '';if(!j?.error)$('errorDetails').hidden=true
}
function selectJob(j,event={}){
 if(event.ctrlKey || event.metaKey){if(selection.has(j.id))selection.delete(j.id);else selection.add(j.id)}
 else if(event.shiftKey && focused && jobs.has(focused)){const ids=[...jobs.keys()],a=ids.indexOf(focused),b=ids.indexOf(j.id);selection.clear();ids.slice(Math.min(a,b),Math.max(a,b)+1).forEach(id=>selection.add(id))}
 else{selection.clear();selection.add(j.id)}
 focused=j.id;for(const item of jobs.values()){item.element.classList.toggle('selected',selection.has(item.id));item.element.setAttribute('aria-selected',String(selection.has(item.id)));item.element.querySelector('.row-check').checked=selection.has(item.id)}
 $('errorDetails').hidden=true;inspect();refreshBatch();stopClose()
}
function removeJob(j){if(active(j))return;j.element.remove();jobs.delete(j.id);selection.delete(j.id);if(focused===j.id)focused=null;summary();inspect();scheduleClose()}
function cancelJob(j){if(!active(j) || j.state==='cancelling')return;j.state='cancelling';renderJob(j);api.send('cancel-convert',{jobId:j.id});summary()}
function submit(j,update=true){
 stopClose();if(![...jobs.values()].some(active)){batchStart=Date.now();batchIds.clear()}batchIds.add(j.id)
 j.state='queued';j.progress=0;j.error=null;j.outputPath=null;j.outputSize=undefined;j.metrics=null;j.startedAt=Date.now();j.finishedAt=null;renderJob(j)
 if(j.mode==='scale')api.send('start-scale',{jobId:j.id,filePath:j.filePath,percent:j.percent,format:j.format})
 else if(j.mode==='resolution')api.send('start-resolution',{jobId:j.id,filePath:j.filePath,resolution:j.resolution,format:j.format})
 else api.send('start-convert',{jobId:j.id,filePath:j.filePath,targetFormat:j.format})
 if(update)summary()
}
async function retryJob(j){
 if(!['error','cancelled'].includes(j.state) || j.retrying)return
 j.retrying=true;renderJob(j)
 try{
  const metadata=await api.describeFiles([j.filePath]),info=metadata.files?.[0] || {filePath:j.filePath,size:j.size},wasSelected=selection.has(j.id)
  removeJob(j);const fresh=createJob(info,j.format,j.mode,j.mode==='scale' ? j.percent : j.resolution)
  if(wasSelected)selection.add(fresh.id);focused=fresh.id;submit(fresh);inspect()
 }catch(e){j.retrying=false;renderJob(j);toast(e.message)}
}
function createJob(info,format,mode='convert',value=null){
 const id='job_'+(++counter),filePath=info.filePath,j={id,filePath,size:info.size,format,mode,percent:mode==='scale' ? value : undefined,resolution:mode==='resolution' ? value : undefined,state:'ready',progress:0}
 const el=document.createElement('tr');j.element=el;el.dataset.job=id;el.tabIndex=0
 el.innerHTML='<td><input class="row-check" type="checkbox"></td><td><div class="filename"><span class="file-icon"></span><div class="name-block"><span class="file-name"></span><span class="file-sub"></span></div></div></td><td><select class="target-select"></select><span class="target-label" hidden></span></td><td class="size-cell number"></td><td class="state-cell"></td><td><div class="meter-line"><span class="meter"><i></i></span><span class="meter-value"></span></div><span class="speed"></span></td><td><div class="row-actions"><button class="quick-action" hidden></button><button class="more-action" data-tip="menu"></button></div></td>'
 const kind=catalog.getFileType(catalog.extension(filePath));el.querySelector('.file-icon').outerHTML=window.icons(kind==='gif' ? 'video' : kind)
 el.querySelector('.file-name').textContent=nameOf(filePath);el.querySelector('.file-name').title=filePath
 el.querySelector('.row-check').setAttribute('aria-label',(settings.lang==='ru' ? 'Выбрать ' : 'Select ')+nameOf(filePath))
 el.querySelector('.target-select').setAttribute('aria-label',t('outputFormat')+': '+nameOf(filePath))
 el.querySelector('.target-select').onchange=e=>{j.format=e.target.value;if(!operationAllowed(j,j.mode==='scale' ? j.percent : j.mode==='resolution' ? j.resolution : 'convert'))j.mode='convert';renderJob(j);refreshBatch()}
 el.querySelector('.row-check').onclick=e=>{e.stopPropagation();selectJob(j,{ctrlKey:true})}
 el.onclick=e=>{if(!e.target.closest('button,select,input'))selectJob(j,e)}
 el.onfocus=()=>{focused=j.id;inspect()}
 el.oncontextmenu=e=>{e.preventDefault();if(!selection.has(j.id))selectJob(j);openMenu(j,e.clientX,e.clientY)}
 el.querySelector('.more-action').innerHTML=window.icons('dots');el.querySelector('.more-action').onclick=e=>{selectJob(j);const r=e.currentTarget.getBoundingClientRect();openMenu(j,r.right-270,r.bottom)}
 el.querySelector('.quick-action').onclick=()=>active(j) ? cancelJob(j) : ['error','cancelled'].includes(j.state) ? retryJob(j) : api.send('open-result',j.outputPath)
 jobs.set(id,j);$('fileList').append(el);renderJob(j);el.classList.add('entering');el.addEventListener('animationend',()=>el.classList.remove('entering'),{once:true});return j
}
async function addPaths(paths,auto=null){
 stopClose();if(!paths?.length)return
 importing=true;summary();setView('queue')
 try{
  const result=await api.describeFiles(paths),infos=result.files || result
  let count=0,last=null;const existing=new Set([...jobs.values()].filter(editable).map(j=>j.filePath))
  if(auto || ![...selection].some(id=>editable(jobs.get(id) || {}))){selection.clear();for(const j of jobs.values())renderJob(j)}
  for(const info of infos){if(!auto && existing.has(info.filePath))continue;const type=catalog.getFileType(catalog.extension(info.filePath));if(type==='unknown')continue
   const format=auto?.format || (type==='image' ? 'png' : type==='audio' ? 'mp3' : 'mp4'),j=createJob(info,format,auto?.mode,auto?.value);count++;last=j;if(auto)submit(j,false)
  }
  if(auto && last){focused=last.id;last.element.scrollIntoView({block:'nearest'});for(const j of jobs.values())renderJob(j);inspect()}
  if(result.errors?.length)toast(t('readErrors')+': '+result.errors.length)
  else if(result.skipped?.length)toast(t('skipped')+': '+result.skipped.length)
  else if(!count)toast(t('noFiles'))
 }catch(e){toast(e.message)}finally{importing=false;summary()}
}
async function pickFiles(){try{await addPaths(await api.chooseFiles())}catch(e){toast(e.message)}}
async function pickFolder(){
 importing=true;summary()
 try{const result=await api.chooseFolder();importing=false;if(result.files?.length)await addPaths(result.files);if(result.limited)toast(t('folderLimited'));else if(result.errors?.length)toast(t('readErrors')+': '+result.errors.length)}
 catch(e){toast(e.message)}finally{importing=false;summary()}
}
function applyBatch(){
 const fmt=$('outputFormat').value,op=$('operation').value
 for(const j of scope()){if(fmt)j.format=fmt;const chosen=operationAllowed(j,op) ? op : 'convert';j.mode=['720p','1080p'].includes(chosen) ? 'resolution' : chosen==='convert' ? 'convert' : 'scale';j.percent=j.mode==='scale' ? chosen : undefined;j.resolution=j.mode==='resolution' ? chosen : undefined;renderJob(j)}
 refreshBatch();inspect()
}
function startScope(){for(const j of scope())submit(j,false);summary()}
function logJob(j){history.unshift({...j,element:undefined,endedAt:new Date()});if(history.length>300)history.pop();renderHistory()}
function renderHistory(){
 $('historyBody').replaceChildren()
 for(const h of history){const tr=document.createElement('tr');tr.tabIndex=0;tr.innerHTML='<td class="history-time"></td><td class="history-file"></td><td class="target-label"></td><td></td><td class="number"></td>';const cells=tr.children;cells[0].textContent=h.endedAt.toLocaleTimeString(settings.lang==='ru' ? 'ru-RU' : 'en-US');cells[1].textContent=nameOf(h.filePath);cells[1].title=h.filePath;cells[2].textContent=formatText(h.format);cells[3].textContent=t(h.state);cells[3].className='state-'+h.state;cells[4].textContent=timeText(h.finishedAt-h.startedAt)
  const show=()=>{for(const row of $('historyBody').children)row.classList.remove('selected');tr.classList.add('selected');$('historyDetail').textContent=h.error || (h.outputPath ? h.filePath+' → '+h.outputPath+(h.outputSize!==undefined ? '\n'+t('resultSize')+': '+sizeText(h.outputSize) : '') : h.filePath+' — '+t(h.state))}
  tr.onclick=show;tr.onfocus=show;tr.ondblclick=()=>{if(h.outputPath)api.send('open-result',h.outputPath)};tr.oncontextmenu=e=>{e.preventDefault();show();openMenu(h,e.clientX,e.clientY,true)};$('historyBody').append(tr)
 }
 $('historyEmpty').hidden=!!history.length;$('clearHistoryBtn').disabled=!history.length;$('historyCount').textContent=String(history.length)
}
function closeScaleMenu(restore=false){$('scaleMenu').hidden=true;const parent=$('contextMenu').querySelector('[aria-haspopup="menu"]');parent?.setAttribute('aria-expanded','false');if(restore)parent?.focus()}
function closeMenu(){closeScaleMenu();if(!$('contextMenu').hidden){$('contextMenu').hidden=true;menuFocus?.focus();menuFocus=null}}
function applyScale(j,percent){
 if(active(j)||!operationAllowed(j,'50'))return
 const target=editable(j) ? j : createJob({filePath:j.filePath,size:j.size},j.format)
 target.mode=percent==='100' ? 'convert' : 'scale';target.percent=percent==='100' ? undefined : percent;target.resolution=undefined
 setView('queue');selectJob(target);renderJob(target);summary();inspect();target.element.scrollIntoView({block:'nearest'})
}
function openScaleMenu(j,parent,focus=false){
 if(parent.disabled)return
 const menu=$('scaleMenu');menu.replaceChildren()
 for(const percent of ['25','50','75','100']){
  const b=document.createElement('button');b.setAttribute('role','menuitemradio');b.dataset.percent=percent
  const checked=j.mode==='scale' ? String(j.percent)===percent : j.mode!=='resolution' && percent==='100'
  b.setAttribute('aria-checked',String(checked));b.append(document.createTextNode(percent==='100' ? t('scaleOriginal') : percent+'%'))
  if(checked){const check=document.createElement('span');check.innerHTML=window.icons('check');check.firstChild.classList.add('menu-check');b.append(check.firstChild)}
  b.onclick=()=>{closeMenu();applyScale(j,percent)};menu.append(b)
 }
 const note=document.createElement('div');note.className='menu-note';note.textContent=t('scaleHint');menu.append(note)
 menu.hidden=false;parent.setAttribute('aria-expanded','true');const r=parent.getBoundingClientRect(),s=menu.getBoundingClientRect(),host=$('contextMenu').getBoundingClientRect()
 const left=host.right+s.width+4<=innerWidth-6 ? host.right+4 : host.left-s.width-4
 menu.style.left=Math.max(6,Math.min(left,innerWidth-s.width-6))+'px';menu.style.top=Math.max(48,Math.min(r.top-5,innerHeight-s.height-6))+'px'
 if(focus)(menu.querySelector('button[aria-checked="true"]') || menu.querySelector('button'))?.focus()
}
function openMenu(j,x,y,fromHistory=false){
 stopClose();closeScaleMenu();menuFocus=document.activeElement;const menu=$('contextMenu');menu.replaceChildren()
 function item(key,icon,fn,disabled=false,shortcut=''){const b=document.createElement('button');b.setAttribute('role','menuitem');b.dataset.action=key;b.disabled=disabled;b.innerHTML=window.icons(icon);b.append(document.createTextNode(t(key)));if(shortcut){const s=document.createElement('span');s.className='menu-shortcut';s.textContent=shortcut;b.append(s)}b.onclick=()=>{closeMenu();fn()};menu.append(b);return b}
 item('openSource','open',()=>api.send('open-source',j.filePath))
 item('showSource','folder',()=>api.send('show-source',j.filePath))
 item('openResult','open',()=>api.send('open-output',j.outputPath),!j.outputPath)
 item('showResult','folder',()=>api.send('open-result',j.outputPath),!j.outputPath)
 menu.append(document.createElement('hr'))
 const scale=item('scaleMenu','scale',()=>{},active(j)||!operationAllowed(j,'50'));scale.setAttribute('aria-haspopup','menu');scale.setAttribute('aria-controls','scaleMenu');scale.setAttribute('aria-expanded','false')
 const chevron=document.createElement('span');chevron.innerHTML=window.icons('chevron');chevron.firstChild.classList.add('menu-chevron');scale.append(chevron.firstChild)
 scale.onclick=()=>openScaleMenu(j,scale,true);scale.onpointerenter=()=>openScaleMenu(j,scale)
 for(const b of menu.querySelectorAll('button'))if(b!==scale)b.onpointerenter=()=>closeScaleMenu()
 scale.onkeydown=e=>{if(e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();openScaleMenu(j,scale,true)}}
 if(!fromHistory){if(editable(j))item('startOne','convert',()=>submit(j),false,'Ctrl+Enter');if(active(j))item('cancel','stop',()=>cancelJob(j));if(['error','cancelled'].includes(j.state))item('retry','retry',()=>retryJob(j));item('remove','trash',()=>removeJob(j),active(j),'Del')}
 if(j.error)item('copyError','file',async()=>{try{await api.copyText(j.error);toast(t('copied'))}catch(e){toast(e.message)}})
 menu.onpointerover=e=>{const button=e.target.closest('button');if(button && button!==scale)closeScaleMenu()}
 menu.hidden=false;const r=menu.getBoundingClientRect();menu.style.left=Math.max(6,Math.min(x,innerWidth-r.width-6))+'px';menu.style.top=Math.max(48,Math.min(y,innerHeight-r.height-6))+'px';menu.querySelector('button:not(:disabled)')?.focus()
}
$('addBtn').onclick=pickFiles;$('emptyAddBtn').onclick=pickFiles;$('folderBtn').onclick=pickFolder;$('startBtn').onclick=startScope
$('outputFormat').onchange=applyBatch;$('operation').onchange=applyBatch
$('clearBtn').onclick=()=>{for(const j of [...jobs.values()])if(!active(j) && !editable(j))removeJob(j)}
$('retryAllBtn').onclick=()=>{for(const j of [...jobs.values()])if(['error','cancelled'].includes(j.state))retryJob(j)}
$('cancelAllBtn').onclick=()=>{for(const j of jobs.values())cancelJob(j)}
$('clearHistoryBtn').onclick=()=>{history.length=0;renderHistory();$('historyDetail').textContent=t('historyHint')}
$('selectAll').onchange=e=>{selection.clear();if(e.target.checked)jobs.forEach(j=>selection.add(j.id));jobs.forEach(renderJob);refreshBatch()}
$('detailBtn').onclick=()=>$('errorDetails').hidden=!$('errorDetails').hidden
$('dismissToast').onclick=()=>$('toast').classList.remove('open')
document.querySelector('.tabs').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setView(e.key==='Home' ? 'queue' : e.key==='End' ? 'history' : view==='queue' ? 'history' : 'queue');$(view+'Btn').focus()}};
$('queueBtn').onclick=()=>setView('queue');$('historyBtn').onclick=()=>setView('history');$('settingsBtn').onclick=showSettings
for(const [id,channel] of [['minBtn','window-minimize'],['maxBtn','window-maximize'],['closeBtn','window-close']])$(id).onclick=()=>api.send(channel)
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=hideSettings)
$('settingsOverlay').onclick=e=>{if(e.target===$('settingsOverlay'))hideSettings()}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#contextMenu,#scaleMenu,.more-action'))closeMenu()})
document.addEventListener('keydown',e=>{
 const menu=$('contextMenu'),overlay=$('settingsOverlay'),editing=e.target.matches('input,select,textarea')
 if(!menu.hidden){
  const sub=$('scaleMenu'),inSub=!sub.hidden && sub.contains(document.activeElement)
  if(inSub && ['ArrowLeft','Escape'].includes(e.key)){e.preventDefault();closeScaleMenu(true);return}
  const container=inSub ? sub : menu,buttons=[...container.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement)
  if(['ArrowDown','ArrowUp','Home','End','Escape','Tab'].includes(e.key)){e.preventDefault();if(['Escape','Tab'].includes(e.key))closeMenu();else{if(!inSub)closeScaleMenu();buttons[e.key==='Home' ? 0 : e.key==='End' ? buttons.length-1 : (i+(e.key==='ArrowDown' ? 1 : -1)+buttons.length)%buttons.length]?.focus()}}return
 }
 if(overlay.classList.contains('open')){if(e.key==='Escape'){e.preventDefault();hideSettings()}if(e.key==='Tab'){const nodes=[...overlay.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length);if(e.shiftKey && document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus()}else if(!e.shiftKey && document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus()}}return}
 if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='o'){e.preventDefault();e.shiftKey ? pickFolder() : pickFiles()}
 else if((e.ctrlKey || e.metaKey) && e.key==='Enter'){e.preventDefault();startScope()}
 else if((e.ctrlKey || e.metaKey) && e.key===','){e.preventDefault();showSettings()}
 else if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='a' && !editing && view==='queue'){e.preventDefault();selection.clear();jobs.forEach(j=>selection.add(j.id));jobs.forEach(renderJob);refreshBatch()}
 else if(e.key==='Escape' && !editing){selection.clear();jobs.forEach(renderJob);refreshBatch()}
 else if(e.key==='Delete' && !editing && view==='queue'){for(const id of [...selection]){const j=jobs.get(id);if(j)removeJob(j)}}
 else if(['ArrowDown','ArrowUp'].includes(e.key) && e.target.closest('.file-item')){e.preventDefault();const rows=[...jobs.values()],i=rows.findIndex(j=>j.id===focused),j=rows[Math.max(0,Math.min(rows.length-1,i+(e.key==='ArrowDown' ? 1 : -1)))];if(j){selectJob(j,e);j.element.focus();j.element.scrollIntoView({block:'nearest'})}}
 else if((e.key==='ContextMenu' || e.shiftKey && e.key==='F10') && focused){e.preventDefault();const j=jobs.get(focused);if(j){const r=j.element.getBoundingClientRect();openMenu(j,r.left+32,r.bottom)}}
})
document.querySelectorAll('[data-theme-choice]').forEach(b=>b.onclick=()=>{settings.theme=b.dataset.themeChoice;persist()})
document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{settings.primary=b.dataset.color;persist()})
$('primaryPicker').oninput=e=>{settings.primary=e.target.value;applyTheme()};$('primaryPicker').onchange=persist
$('settingLang').onchange=e=>{settings.lang=e.target.value;persist()}
for(const [id,key] of [['toggleAutoClose','autoClose'],['toggleAutoUpdate','autoUpdate']])$(id).onclick=()=>{settings[key]=!settings[key];persist()}
$('toggleIntegration').onclick=async()=>{$('toggleIntegration').disabled=true;try{const result=await api.integration(!settings.integration);if(result.ok){settings.integration=result.enabled;refreshLanguage();toast(t('portableHint'))}else toast(t('integrationError')+': '+result.error)}catch(e){toast(e.message)}finally{$('toggleIntegration').disabled=settings.platform!=='win32'}}
$('createShortcutBtn').onclick=async()=>{$('createShortcutBtn').disabled=true;try{const result=await api.createDesktopShortcut();if(result.ok){settings.desktopShortcutName=result.name;refreshLanguage();toast(t('shortcutCreated'))}else toast(result.error || t('shortcutError'))}catch(e){toast(e.message)}finally{$('createShortcutBtn').disabled=settings.platform!=='win32'}}
for(const [id,key] of [['siteBtn','site'],['aboutSiteBtn','site'],['githubBtn','github'],['aboutGithubBtn','github'],['telegramBtn','telegram'],['aboutTelegramBtn','telegram']])$(id).onclick=()=>api.send('open-link',key)
let dragCount=0
document.addEventListener('dragover',e=>e.preventDefault())
document.addEventListener('dragenter',e=>{if(!e.dataTransfer?.types.includes('Files'))return;e.preventDefault();dragCount++;$('dropzone').classList.add('dragging')})
document.addEventListener('dragleave',()=>{if(--dragCount<=0){dragCount=0;$('dropzone').classList.remove('dragging')}})
document.addEventListener('drop',e=>{e.preventDefault();dragCount=0;$('dropzone').classList.remove('dragging');addPaths([...e.dataTransfer.files].map(f=>api.getPathForFile(f)).filter(Boolean))})
let tipTimer
function hideTip(){clearTimeout(tipTimer);$('tooltip').hidden=true}
document.addEventListener('pointerover',e=>{const el=e.target.closest('[data-tip]');if(!el)return;hideTip();tipTimer=setTimeout(()=>{if(!document.contains(el))return;const tip=$('tooltip');tip.textContent=t(el.dataset.tip);tip.hidden=false;const r=el.getBoundingClientRect(),tr=tip.getBoundingClientRect();tip.style.left=Math.min(innerWidth-tr.width-5,Math.max(5,r.left))+'px';tip.style.top=(r.bottom+tr.height+9>innerHeight ? r.top-tr.height-5 : r.bottom+5)+'px'},450)})
document.addEventListener('pointerout',hideTip);document.addEventListener('pointerdown',hideTip);document.addEventListener('focusin',hideTip)
api.on('paste-files',data=>addPaths(data.files))
api.on('convert-files',data=>addPaths(data.files,{format:data.targetFormat,mode:'convert'}))
api.on('scale-files',data=>addPaths(data.files,{format:data.format,mode:'scale',value:data.percent}))
api.on('resolution-files',data=>addPaths(data.files,{format:data.format || 'mp4',mode:'resolution',value:data.resolution}))
api.on('convert-progress',({jobId,progress})=>{const j=jobs.get(jobId);if(!j || !['queued','active'].includes(j.state))return;if(j.state==='queued')j.startedAt=Date.now();j.state='active';j.progress=Math.max(j.progress,Math.min(100,progress));renderJob(j);summary()})
api.on('convert-metrics',({jobId,metrics})=>{const j=jobs.get(jobId);if(j?.state==='active'){j.metrics=metrics;renderJob(j)}})
for(const [channel,state] of [['convert-done','done'],['convert-error','error'],['convert-cancelled','cancelled']])api.on(channel,data=>{const j=jobs.get(data.jobId);if(!j)return;j.state=state;j.outputPath=data.outputPath;j.outputSize=data.outputSize;j.error=state==='cancelled' ? null : data.error;j.finishedAt=Date.now();renderJob(j);j.element.classList.add('just-finished');setTimeout(()=>j.element.classList.remove('just-finished'),300);logJob(j);summary();if(focused===j.id)inspect();scheduleClose()})
api.on('update-available',({latest})=>toast(t('update')+' '+latest+' · GitHub'))
api.on('update-error',({error,source})=>{if(source==='updates'){$('updateStatus').textContent=settings.lang==='ru' ? 'Проверка обновлений недоступна' : 'Update check unavailable'}else toast(error)})
setInterval(()=>{if([...jobs.values()].some(active))summary()},1000)
async function init(){try{const {appIcons:sources,...saved}=await api.getSettings();appIcons=sources;settings={...settings,...saved};refreshLanguage();$('aboutVersion').textContent='v'+saved.version;$('appVersion').textContent=saved.version;$('toggleIntegration').disabled=saved.platform!=='win32';$('createShortcutBtn').disabled=saved.platform!=='win32';api.ready();if(settings.autoUpdate)api.send('check-update')}catch(e){toast(e.message)}}
init()
