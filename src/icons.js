(()=>{
const shapes={
scale:'<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
chevron:'<path d="m9 5 7 7-7 7"/>',
stop:'<rect x="5" y="5" width="14" height="14" rx="1"/>',
files:'<path d="M8 3h9l4 4v12H8zM17 3v5h4M3 7v14h13"/>',
info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
github:'<path fill="currentColor" stroke="none" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.64-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .26.18.57.69.48A10 10 0 0 0 12 2z"/>',
telegram:'<path d="m21 3-4 18-6-6-4 3 1-7zM8 11l13-8-10 12M8 11l-6-2 19-6"/>',

queue:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
history:'<path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/>',
settings:'<path d="m9 3-1 3-3 1v4l-2 1 2 1v4l3 1 1 3h6l1-3 3-1v-4l2-1-2-1V7l-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
add:'<path d="M12 5v14M5 12h14"/>',
close:'<path d="m6 6 12 12M18 6 6 18"/>',
retry:'<path d="M20 9a8 8 0 1 0-1 9M20 3v6h-6"/>',
open:'<path d="M14 3h7v7M21 3l-10 10M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
video:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m10 8 6 4-6 4zM3 8h3M3 16h3M18 8h3M18 16h3"/>',
audio:'<path d="M10 17V5l10-2v12M10 9l10-2"/><ellipse cx="6.5" cy="18" rx="3.5" ry="3"/><ellipse cx="16.5" cy="16" rx="3.5" ry="3"/>',
file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 14h8M8 17h5"/>',
folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 7h17a1 1 0 0 1 1 1l-3 12H4L2 9a2 2 0 0 1 1-2z"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-15-7 1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
moon:'<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14z"/>',
check:'<path d="m5 12 4 4L19 6"/>',
error:'<path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>',
convert:'<path d="M4 7h16m-5-5 5 5-5 5M20 17H4m5-5-5 5 5 5"/>',
minimize:'<path d="M5 12h14"/>',
maximize:'<rect x="5" y="5" width="14" height="14" rx="1"/>',
trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
palette:'<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3c0-4-4-7-9-7z"/><circle cx="7" cy="10" r=".7"/><circle cx="10" cy="6.5" r=".7"/><circle cx="15" cy="6.5" r=".7"/>',
local:'<path d="M3 4h18v13H3zM8 21h8M12 17v4m-4-10 3 3 5-6"/>'
}
function icon(name){return `<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.file}</svg>`}
if(typeof module!=='undefined')module.exports={icon,shapes};else{window.icons=icon;document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon))}
})()
