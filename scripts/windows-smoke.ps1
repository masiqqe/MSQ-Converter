$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = node -p "require('./package.json').version"
if ($LASTEXITCODE -ne 0) { throw 'Cannot read application version' }
$exe = Join-Path (Get-Location) "dist\MSQ-Converter-$version-portable-x64.exe"
$work = Join-Path $env:TEMP ('msq-v3-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
$env:MSQ_SMOKE_DIR = $work
node -e "require('sharp')({create:{width:51,height:37,channels:3,background:'#ff8844'}}).gif().toFile(require('path').join(process.env.MSQ_SMOKE_DIR,'sample.gif')).then(()=>console.log('fixture ready'))"
if ($LASTEXITCODE -ne 0) { throw 'Fixture generation failed' }
$fixturePath = Join-Path $work 'sample.gif'
$outer = @()
try {
  # Two cold/warm launches of the SAME portable EXE: the v2 failure scenario.
  $outer += Start-Process -FilePath $exe -ArgumentList @('--format=mp4',('"' + $fixturePath + '"')) -PassThru
  $outer += Start-Process -FilePath $exe -ArgumentList @('--format=mp4',('"' + $fixturePath + '"')) -PassThru
  $deadline = (Get-Date).AddSeconds(180)
  do {
    Start-Sleep -Milliseconds 250
    $outputs = @(Get-ChildItem $work -Filter '*.mp4' | Where-Object Length -gt 0)
  } until ($outputs.Count -eq 2 -or (Get-Date) -gt $deadline)
  if ($outputs.Count -ne 2) { throw 'Portable multi-launch did not produce two MP4 outputs' }
  # An additional launch must leave both earlier results and FFmpeg intact.
  $outer += Start-Process -FilePath $exe -ArgumentList @('--format=mp4',('"' + $fixturePath + '"')) -PassThru
  $deadline = (Get-Date).AddSeconds(60)
  do { Start-Sleep -Milliseconds 250; $outputs = @(Get-ChildItem $work -Filter '*.mp4' | Where-Object Length -gt 0) } until ($outputs.Count -eq 3 -or (Get-Date) -gt $deadline)
  if ($outputs.Count -ne 3) { throw 'Third portable launch failed' }
  Write-Output 'PASS: three real portable launches; GIF to MP4; unique outputs; no runtime deletion'
} finally {
  # Stop only cached Electron processes launched by this test's wrapper PIDs.
  $pids = @($outer | ForEach-Object Id)
  Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -in $pids -and $_.Name -eq 'MSQ Converter.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
  Remove-Item Env:\MSQ_SMOKE_DIR -ErrorAction SilentlyContinue
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
