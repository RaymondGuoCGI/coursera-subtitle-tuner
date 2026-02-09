param(
  [switch]$PublishCws,
  [switch]$SyncGitHub,
  [string]$OutputDir = "dist",
  [string]$CommitMessage
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-MissingEnvVars {
  param([string[]]$Names)
  $missing = @()
  foreach ($name in $Names) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      $missing += $name
    }
  }
  return $missing
}

function Get-ManifestResourcePaths {
  param($Node)

  $results = New-Object System.Collections.Generic.HashSet[string]
  $extPattern = [regex]"(?i)^[^*?<>|:]+\.(js|mjs|cjs|css|html|json|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf)$"

  function Visit {
    param($Value)

    if ($null -eq $Value) {
      return
    }

    if ($Value -is [string]) {
      $candidate = $Value.Trim()
      if (
        $extPattern.IsMatch($candidate) -and
        -not $candidate.StartsWith("http://") -and
        -not $candidate.StartsWith("https://") -and
        -not $candidate.StartsWith("/")
      ) {
        $results.Add($candidate) | Out-Null
      }
      return
    }

    if ($Value -is [System.Collections.IDictionary]) {
      foreach ($key in $Value.Keys) {
        Visit -Value $Value[$key]
      }
      return
    }

    if ($Value -is [psobject]) {
      foreach ($property in $Value.PSObject.Properties) {
        Visit -Value $property.Value
      }
      return
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
      foreach ($item in $Value) {
        Visit -Value $item
      }
    }
  }

  Visit -Value $Node
  return ,$results
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$manifestPath = Join-Path $repoRoot "manifest.json"

if (-not (Test-Path -Path $manifestPath -PathType Leaf)) {
  throw "manifest.json not found at repo root: $repoRoot"
}

$manifestRaw = Get-Content -Path $manifestPath -Raw -Encoding UTF8
$manifest = $manifestRaw | ConvertFrom-Json

if ($null -eq $manifest.version -or [string]::IsNullOrWhiteSpace([string]$manifest.version)) {
  throw "manifest.json has no valid version field"
}

$version = [string]$manifest.version
$distDir = Join-Path $repoRoot $OutputDir
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

$zipName = "coursera-subtitle-tuner-$version.zip"
$zipPath = Join-Path $distDir $zipName

$tempDir = Join-Path $repoRoot ".release-tmp"
if (Test-Path $tempDir) {
  Remove-Item -Path $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

$resourcePaths = Get-ManifestResourcePaths -Node $manifest
$resourcePaths.Add("manifest.json") | Out-Null

$localesDir = Join-Path $repoRoot "_locales"
if (Test-Path -Path $localesDir -PathType Container) {
  Get-ChildItem -Path $localesDir -File -Recurse | ForEach-Object {
    $relative = $_.FullName.Substring($repoRoot.Length + 1)
    $resourcePaths.Add($relative) | Out-Null
  }
}

$missingFiles = @()
foreach ($relativePath in $resourcePaths) {
  $source = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -Path $source -PathType Leaf)) {
    $missingFiles += $relativePath
    continue
  }

  $target = Join-Path $tempDir $relativePath
  $targetParent = Split-Path -Parent $target
  if (-not (Test-Path $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  }
  Copy-Item -Path $source -Destination $target -Force
}

if ($missingFiles.Count -gt 0) {
  $missingText = $missingFiles -join ", "
  throw "Manifest references missing files: $missingText"
}

if (Test-Path -Path $zipPath -PathType Leaf) {
  Remove-Item -Path $zipPath -Force
}

Compress-Archive -Path (Join-Path $tempDir "*") -DestinationPath $zipPath
Remove-Item -Path $tempDir -Recurse -Force

Write-Host "Created package: $zipPath"

if ($PublishCws) {
  $required = @("CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN", "CWS_EXTENSION_ID")
  $missing = Get-MissingEnvVars -Names $required
  if (@($missing).Count -gt 0) {
    throw "Missing required environment variables for CWS publish: $($missing -join ', ')"
  }

  $clientId = [Environment]::GetEnvironmentVariable("CWS_CLIENT_ID")
  $clientSecret = [Environment]::GetEnvironmentVariable("CWS_CLIENT_SECRET")
  $refreshToken = [Environment]::GetEnvironmentVariable("CWS_REFRESH_TOKEN")
  $extensionId = [Environment]::GetEnvironmentVariable("CWS_EXTENSION_ID")

  $tokenResp = Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -Body @{
    client_id = $clientId
    client_secret = $clientSecret
    refresh_token = $refreshToken
    grant_type = "refresh_token"
  }
  $accessToken = $tokenResp.access_token

  $uploadUri = "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$extensionId"
  $uploadResp = Invoke-RestMethod -Method Put -Uri $uploadUri -Headers @{ Authorization = "Bearer $accessToken" } -ContentType "application/zip" -InFile $zipPath

  $publishUri = "https://www.googleapis.com/chromewebstore/v1.1/items/$extensionId/publish?publishTarget=default"
  $publishResp = Invoke-RestMethod -Method Post -Uri $publishUri -Headers @{ Authorization = "Bearer $accessToken" }

  Write-Host "CWS upload response: $($uploadResp | ConvertTo-Json -Depth 5 -Compress)"
  Write-Host "CWS publish response: $($publishResp | ConvertTo-Json -Depth 5 -Compress)"
}

if ($SyncGitHub) {
  $insideRepo = (git rev-parse --is-inside-work-tree).Trim()
  if ($insideRepo -ne "true") {
    throw "Current directory is not a git repository"
  }

  git add -A | Out-Null

  $staged = git diff --cached --name-only
  if ([string]::IsNullOrWhiteSpace(($staged -join ""))) {
    Write-Host "No staged changes to commit. Skipped git commit/push."
  } else {
    if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
      $CommitMessage = "release: v$version"
    }

    git commit -m $CommitMessage
    git push
    Write-Host "GitHub sync completed on current branch."
  }
}
