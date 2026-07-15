# elizax backend proxy — Windows PowerShell
# 사용법:  $env:ANTHROPIC_API_KEY="sk-ant-..." ; .\server\run.ps1
if (-not $env:ANTHROPIC_API_KEY) {
  Write-Host "[elizax] ANTHROPIC_API_KEY 미설정 — 폴백 응답 모드로 실행됩니다." -ForegroundColor Yellow
}
node "$PSScriptRoot\server.js"
