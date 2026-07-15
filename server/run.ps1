# elizax backend proxy — Windows PowerShell
# 사용법:
#   Anthropic:  $env:ANTHROPIC_API_KEY="sk-ant-..." ; .\server\run.ps1
#   Bedrock  :  $env:AWS_KEYS_CSV="$env:USERPROFILE\cgpark_accessKeys.csv" ; .\server\run.ps1
#               (또는 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 직접 설정)
#               리전: $env:AWS_REGION (기본 ap-northeast-2) · 모델: $env:ELIZAX_BEDROCK_MODEL

# 편의: 키가 하나도 없으면 홈 디렉토리의 *_accessKeys.csv 자동 탐지
if (-not $env:ANTHROPIC_API_KEY -and -not $env:AWS_ACCESS_KEY_ID -and -not $env:AWS_KEYS_CSV) {
  $csv = Get-ChildItem "$env:USERPROFILE\*_accessKeys.csv" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($csv) {
    $env:AWS_KEYS_CSV = $csv.FullName
    Write-Host "[elizax] AWS 키 CSV 자동 감지: $($csv.Name) → Bedrock 모드" -ForegroundColor Cyan
  } else {
    Write-Host "[elizax] 자격증명 없음 — 폴백 응답 모드로 실행됩니다." -ForegroundColor Yellow
  }
}
node "$PSScriptRoot\server.js"
