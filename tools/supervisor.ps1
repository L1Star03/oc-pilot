param(
    [string]$RootSid = "",
    [string]$ApiBase = "http://127.0.0.1:4097/api",
    [int]$IdleMinutes = 12
)
# 用法: .\supervisor.ps1 -RootSid ses_xxx
# 监视 RootSid 及其所有子会话：卡住自动中断+续跑、自动回答提问、跑完自动退出
$ErrorActionPreference = "Continue"
$log = "C:\Users\ROG\AppData\Local\Temp\opencode\rl-supervisor.log"
$watch = @("ses_e02af24f0ffeXlZd050ll9w6fM", "ses_e02b1d042ffeLGIVF8vI55WuSD")
$apiBase = $ApiBase
$h = @{ "x-pilot-backend" = "4096"; "Content-Type" = "application/json" }
$lastUpdated = @{}
$wakeCount = 0
function L($m) { $line = "$(Get-Date -Format 'MM-dd HH:mm:ss') $m"; Add-Content -Path $log -Value $line -Encoding UTF8 }

L "supervisor start: watching $($watch -join ',')"

# keep awake
powercfg /change monitor-timeout-ac 0 2>$null
powercfg /change standby-timeout-ac 0 2>$null
L "powercfg: monitor/standby timeout -> 0 (ac)"

$done = @{}
while ($true) {
  $allDone = $true
  try {
    $status = (Invoke-WebRequest -UseBasicParsing -Uri "$apiBase/session/status" -Headers $h -TimeoutSec 10).Content | ConvertFrom-Json
    $sessions = (Invoke-WebRequest -UseBasicParsing -Uri "$apiBase/session" -Headers $h -TimeoutSec 10).Content | ConvertFrom-Json
    $byId = @{}
    foreach ($s in $sessions) { $byId[$s.id] = $s }

    foreach ($sid in $watch) {
      if ($done[$sid]) { continue }
      $busy = $status.$sid -and $status.$sid.type -eq "busy"
      $s = $byId[$sid]
      $upd = 0
      if ($s -and $s.time -and $s.time.updated) { $upd = $s.time.updated }
      $ageMin = [Math]::Round(((Get-Date) - [DateTime]::new(1970,1,1).AddMilliseconds($upd).ToLocalTime()).TotalMinutes)

      if (-not $busy) {
        L "$($sid.Substring(4,10)): IDLE (age ${ageMin}min)"
        $done[$sid] = $true
        continue
      }
      $allDone = $false

      if ($ageMin -ge 10 -and $upd -eq $lastUpdated[$sid]) {
        $wakeCount++
        L "$($sid.Substring(4,10)): STUCK ${ageMin}min -> abort + resume (#$wakeCount)"
        try { Invoke-WebRequest -UseBasicParsing -Uri "$apiBase/session/$sid/abort" -Method POST -Headers $h -TimeoutSec 10 | Out-Null } catch {}
        Start-Sleep -Seconds 3
        $msg = '{"parts":[{"type":"text","text":"（监督者）上次执行疑似中断，请检查已完成部分并从断点继续，不要重做已完成步骤。"}]}'
        try { Invoke-WebRequest -UseBasicParsing -Uri "$apiBase/session/$sid/prompt_async" -Method POST -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($msg)) -ContentType "application/json; charset=utf-8" -TimeoutSec 10 | Out-Null; L "  resume sent" } catch { L "  resume FAILED: $($_.Exception.Message)" }
      }
      $lastUpdated[$sid] = $upd
      if ($ageMin -lt 10) { L "$($sid.Substring(4,10)): busy ok (age ${ageMin}min)" }
    }

    # auto-answer pending questions for watched sessions
    try {
      $qs = (Invoke-WebRequest -UseBasicParsing -Uri "$apiBase/question" -Headers $h -TimeoutSec 10).Content | ConvertFrom-Json
      foreach ($q in $qs) {
        if ($watch -contains $q.sessionID) {
          $answers = @()
          foreach ($qq in $q.questions) {
            if ($qq.options -and $qq.options.Count -gt 0) { $answers += @($qq.options[0].label) }
            else { $answers += @("继续") }
          }
          $body = @{ answers = $answers } | ConvertTo-Json -Depth 5 -Compress
          Invoke-WebRequest -UseBasicParsing -Uri "$apiBase/question/$($q.id)/reply" -Method POST -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType "application/json; charset=utf-8" -TimeoutSec 10 | Out-Null
          L "auto-answered question $($q.id.Substring(4,10)) for $($q.sessionID.Substring(4,10))"
        }
      }
    } catch {}
  } catch { L "loop error: $($_.Exception.Message)" }

  if ($allDone) {
    L "ALL WATCHED SESSIONS IDLE -> COMPLETE. exiting."
    break
  }
  Start-Sleep -Seconds 60
}
L "supervisor end"
