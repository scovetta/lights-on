# Lights On — 1-Command Installer (PowerShell)
#
# Usage:
#   Local checkout:
#     .\install.ps1 [-TargetDir "C:\path\to\repo"] [-DryRun] [-Force] [-CreateLabels] [-SkipLabels]
#
#   Remote 1-liner:
#     irm https://raw.githubusercontent.com/scovetta/lights-on/main/install.ps1 | iex

param(
    [string]$TargetDir = ".",
    [string]$SourceDir = "",
    [switch]$DryRun,
    [switch]$Force,
    [switch]$CreateLabels,
    [switch]$SkipLabels,
    [string]$RepoUrl = $(if ($env:LIGHTS_ON_REPO_URL) { $env:LIGHTS_ON_REPO_URL } else { "https://github.com/scovetta/lights-on.git" })
)

$ErrorActionPreference = "Stop"

# Helper to run native commands (git, gh) without Windows PowerShell 5.1 throwing
# a terminating NativeCommandError when the native process writes to stderr.
function Invoke-NativeSilent {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @()
    )
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $FilePath @Arguments 2>&1
        return [PSCustomObject]@{
            ExitCode = $LASTEXITCODE
            Output   = ($output | Out-String).Trim()
        }
    }
    catch {
        return [PSCustomObject]@{
            ExitCode = -1
            Output   = ""
        }
    }
    finally {
        $ErrorActionPreference = $prevEap
    }
}

function Get-LightsOnFileDigest {
    param([string]$File)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($File)
        try { return [System.BitConverter]::ToString($hash.ComputeHash($stream)) }
        finally { $stream.Dispose() }
    }
    finally { $hash.Dispose() }
}

function Install-LightsOnFile {
    param([string]$Source, [string]$Destination, [string]$DisplayPath)

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Source file is missing or unreadable: $Source"
    }
    if ((Test-Path -LiteralPath $Destination) -and (-not (Test-Path -LiteralPath $Destination -PathType Leaf))) {
        throw "Destination is not a file: $Destination"
    }
    if ($DryRun) {
        $exists = Test-Path -LiteralPath $Destination -PathType Leaf
        if ($exists -and ((Get-LightsOnFileDigest $Source) -eq (Get-LightsOnFileDigest $Destination))) {
            $script:PreviewUnchanged++
            Write-Host "  [unchanged] $DisplayPath"
            return
        }
        if ($exists) {
            $script:PreviewOverwrites++
            Write-Host "  [overwrite] $DisplayPath"
            $before = $Destination
        }
        else {
            $script:PreviewCreates++
            Write-Host "  [create] $DisplayPath"
            $before = "/dev/null"
        }
        $diff = Invoke-NativeSilent -FilePath "git" -Arguments @(
            "--no-pager", "diff", "--no-index", "--no-ext-diff", "--no-textconv",
            "--no-color", "--", $before, $Source
        )
        # git diff returns 1 for differences, not for a failed comparison.
        if ($diff.ExitCode -notin @(0, 1)) {
            throw "Unable to preview '$DisplayPath' (git diff exit $($diff.ExitCode)): $($diff.Output)"
        }
        if ($diff.Output) { Write-Host $diff.Output }
        return
    }
    if (-not $SameDir) {
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
    Write-Host "  [ok]   $DisplayPath" -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $TargetDir -PathType Container)) {
    throw "Target directory does not exist: $TargetDir"
}

$ResolvedTarget = (Resolve-Path -LiteralPath $TargetDir).Path
if ($DryRun) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "'git' is required to show dry-run diffs."
    }
    Write-Host "==> Dry run for: $ResolvedTarget (installed -> source)" -ForegroundColor Cyan
}
else {
    Write-Host "==> Installing Lights On into: $ResolvedTarget" -ForegroundColor Cyan
}
$script:PreviewCreates = 0
$script:PreviewOverwrites = 0
$script:PreviewUnchanged = 0

$SrcDir = $null
$TempCloneDir = $null

try {
    # Check if an explicit -SourceDir was provided or if running from a local Lights On checkout
    if ($SourceDir) {
        if (-not (Test-Path -LiteralPath (Join-Path $SourceDir ".github\lights-on.yml") -PathType Leaf)) {
            throw "Explicit source directory is missing .github\lights-on.yml: $SourceDir"
        }
        $SrcDir = (Resolve-Path -LiteralPath $SourceDir).Path
        Write-Host "==> Using local Lights On source from: $SrcDir"
    }
    elseif ($PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot ".github\lights-on.yml")) -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot ".github\lights-on\runner"))) {
        $SrcDir = $PSScriptRoot
        Write-Host "==> Using local Lights On source from: $SrcDir"
    }
    elseif ((Test-Path -LiteralPath ".\.github\lights-on.yml") -and (Test-Path -LiteralPath ".\.github\lights-on\runner") -and (Test-Path -LiteralPath ".\.github\actions\lights-on-agent\action.yml")) {
        $SrcDir = (Get-Location).Path
        Write-Host "==> Using local Lights On source from: $SrcDir"
    }
    else {
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            throw "'git' is required to download Lights On from $RepoUrl"
        }
        $TempCloneDir = Join-Path ([System.IO.Path]::GetTempPath()) ("lights-on-install-" + [System.Guid]::NewGuid().ToString("N"))
        Write-Host "==> Downloading Lights On from $RepoUrl..."
        $cloneRes = Invoke-NativeSilent -FilePath "git" -Arguments @("clone", "--depth", "1", $RepoUrl, $TempCloneDir)
        if ($cloneRes.ExitCode -ne 0) {
            throw "Failed to clone Lights On repository from $RepoUrl"
        }
        $SrcDir = $TempCloneDir
    }

    $ConfigSrc = Join-Path $SrcDir ".github\lights-on.yml"
    if (-not (Test-Path -LiteralPath $ConfigSrc)) {
        throw "Source directory is missing .github\lights-on.yml ($SrcDir)"
    }

    # Ensure destination directories exist
    $DirsToCreate = @(
        (Join-Path $ResolvedTarget ".github\actions\lights-on-agent"),
        (Join-Path $ResolvedTarget ".github\lights-on\runner"),
        (Join-Path $ResolvedTarget ".github\lights-on\prompts"),
        (Join-Path $ResolvedTarget ".github\lights-on\ecosystems"),
        (Join-Path $ResolvedTarget ".github\workflows")
    )
    foreach ($dir in $DirsToCreate) {
        if (-not $DryRun -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
    }

    $SameDir = ($SrcDir.TrimEnd('\', '/') -ieq $ResolvedTarget.TrimEnd('\', '/'))

    # 1. Copy .github\lights-on.yml (preserve existing unless -Force)
    $ConfigDst = Join-Path $ResolvedTarget ".github\lights-on.yml"
    if ((Test-Path -LiteralPath $ConfigDst) -and (-not $Force)) {
        Write-Host "  [skip] .github\lights-on.yml already exists (use -Force to overwrite)" -ForegroundColor Yellow
    }
    else {
        Install-LightsOnFile $ConfigSrc $ConfigDst ".github\lights-on.yml"
    }

    # 2. Copy composite action .github\actions\lights-on-agent\action.yml
    $ActionSrc = Join-Path $SrcDir ".github\actions\lights-on-agent\action.yml"
    $ActionDst = Join-Path $ResolvedTarget ".github\actions\lights-on-agent\action.yml"
    Install-LightsOnFile $ActionSrc $ActionDst ".github\actions\lights-on-agent\action.yml"

    # 3. Copy Node controllers and the non-executing Python metadata inspector
    $RunnerSrcDir = Join-Path $SrcDir ".github\lights-on\runner"
    $RunnerDstDir = Join-Path $ResolvedTarget ".github\lights-on\runner"
    Get-ChildItem -LiteralPath $RunnerSrcDir -File | Where-Object {
        $_.Extension -in @(".mjs", ".py") -or $_.Name -in @(
            "copilot-sdk.package.json", "copilot-sdk.package-lock.json",
            "copilot-cli.package.json", "copilot-cli.package-lock.json")
    } | ForEach-Object {
        Install-LightsOnFile $_.FullName (Join-Path $RunnerDstDir $_.Name) ".github\lights-on\runner\$($_.Name)"
    }

    # 4. Copy prompts .github\lights-on\prompts\*.md
    $PromptsSrcDir = Join-Path $SrcDir ".github\lights-on\prompts"
    $PromptsDstDir = Join-Path $ResolvedTarget ".github\lights-on\prompts"
    Get-ChildItem -LiteralPath $PromptsSrcDir -Filter "*.md" -File | ForEach-Object {
        Install-LightsOnFile $_.FullName (Join-Path $PromptsDstDir $_.Name) ".github\lights-on\prompts\$($_.Name)"
    }

    # 5. Copy ecosystem detection manifest .github\lights-on\ecosystems\detection.json
    $DetectSrc = Join-Path $SrcDir ".github\lights-on\ecosystems\detection.json"
    $DetectDst = Join-Path $ResolvedTarget ".github\lights-on\ecosystems\detection.json"
    if (Test-Path -LiteralPath $DetectSrc) {
        Install-LightsOnFile $DetectSrc $DetectDst ".github\lights-on\ecosystems\detection.json"
    }

    # 6. Copy installed Lights On workflows.
    $WorkflowNames = @("lights-on-events.yml", "lights-on-schedule.yml", "lights-on-pr.yml", "lights-on-release.yml", "lights-on-setup.yml")
    foreach ($wf in $WorkflowNames) {
        $WfSrc = Join-Path $SrcDir (".github\workflows\" + $wf)
        $WfDst = Join-Path $ResolvedTarget (".github\workflows\" + $wf)
        if (Test-Path -LiteralPath $WfSrc) {
            Install-LightsOnFile $WfSrc $WfDst ".github\workflows\$wf"
        }
    }

    if ($DryRun) {
        Write-Host "==> Dry run complete: $PreviewCreates create, $PreviewOverwrites overwrite, $PreviewUnchanged unchanged."
        Write-Host "No target files or GitHub labels were changed. Remove -DryRun to install."
        # Callers such as Actions inspect LASTEXITCODE; a diff's 1 is not a preview failure.
        $global:LASTEXITCODE = 0
        return
    }

    # 7. Create/update lights-on:* labels via gh CLI if available and authenticated
    $Labels = @(
        @{ Name = "lights-on:ignore";                      Color = "cfd3d7"; Description = "Lights On will never touch or comment on this issue/PR" },
        @{ Name = "lights-on:actionable";                  Color = "0e8a16"; Description = "Queue this issue for an autonomous fix PR by Lights On" },
        @{ Name = "lights-on:migrate-dep";                 Color = "5319e7"; Description = "Request read-only dependency migration planning" },
        @{ Name = "lights-on:hold";                        Color = "d93f0b"; Description = "Keep reviewed PR open; block auto-merge until removed" },
        @{ Name = "lights-on:automerge";                   Color = "0e8a16"; Description = "Explicitly opt this PR into auto-merge once all 4 gates pass" },
        @{ Name = "lights-on:re-review";                   Color = "1d76db"; Description = "Trigger a fresh 4-Gate review on this PR" },
        @{ Name = "lights-on:needs-human";                 Color = "b60205"; Description = "Escalated by Lights On for maintainer decision" },
        @{ Name = "lights-on:approved-override";           Color = "fbca04"; Description = "Maintainer override for protected-path or high-risk PRs" },
        @{ Name = "lights-on:approved";                    Color = "0e8a16"; Description = "Lights On 4-Gate review passed" },
        @{ Name = "lights-on:changes-requested";           Color = "e99695"; Description = "Lights On 4-Gate review requested changes" },
        @{ Name = "lights-on:automerge-disabled-external"; Color = "fef2c0"; Description = "External PR passed review; auto-merge disabled by policy" },
        @{ Name = "lights-on:triaged";                     Color = "c5def5"; Description = "Issue triaged by Lights On" },
        @{ Name = "lights-on:in-progress";                 Color = "bfdadc"; Description = "Lights On is actively working on this item" },
        @{ Name = "lights-on:reviewed";                    Color = "d4c5f9"; Description = "PR reviewed by Lights On" },
        @{ Name = "lights-on:automation";                  Color = "0052cc"; Description = "Automated PR or issue created by Lights On" },
        @{ Name = "lights-on:release";                     Color = "0e8a16"; Description = "Automated Release PR prepared by Lights On" },
        @{ Name = "lights-on:agent-pr";                    Color = "1d76db"; Description = "Automated PR created by Lights On" },
        @{ Name = "lights-on:pause";                       Color = "b60205"; Description = "Pause Lights On automated merges" },
        @{ Name = "lights-on:upstream";                    Color = "5319e7"; Description = "Mirrored from read-only upstream repository" },
        @{ Name = "lights-on:dependencies";                Color = "0366d6"; Description = "Dependency update or migration" },
        @{ Name = "lights-on:security";                    Color = "b60205"; Description = "Security vulnerability remediation" },
        @{ Name = "lights-on:docs";                        Color = "0075ca"; Description = "Documentation clarification" },
        @{ Name = "lights-on:needs-info";                  Color = "fbca04"; Description = "Awaiting reproduction details or clarification" },
        @{ Name = "lights-on:wontfix-by-design";            Color = "5319e7"; Description = "Behavior is intentional per project scope" }
    )

    if ($SkipLabels -or (-not $CreateLabels)) {
        Write-Host "==> Skipping remote GitHub label creation (local file install; pass -CreateLabels to pre-create labels on origin)."
    }
    elseif (Get-Command gh -ErrorAction SilentlyContinue) {
        Push-Location $ResolvedTarget
        try {
            $remoteRes = Invoke-NativeSilent -FilePath "git" -Arguments @("remote", "get-url", "origin")
            $RemoteUrl = if ($remoteRes.ExitCode -eq 0) { $remoteRes.Output } else { "" }

            $OriginRepo = ""
            if ($RemoteUrl -match "^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)(?<owner>[A-Za-z0-9_.-]+)/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?/?$") {
                if ($Matches['owner'] -notin @(".", "..") -and $Matches['repo'] -notin @(".", "..")) {
                    $OriginRepo = "$($Matches['owner'])/$($Matches['repo'])"
                }
            }

            $IsGitHubRemote = [bool]$OriginRepo
            $GhAuthenticated = $false
            if ($IsGitHubRemote) {
                $authRes = Invoke-NativeSilent -FilePath "gh" -Arguments @("auth", "status", "--hostname", "github.com")
                if ($authRes.ExitCode -eq 0) {
                    $GhAuthenticated = $true
                }
            }

            if ($IsGitHubRemote -and $GhAuthenticated) {
                # Verify write permission on OriginRepo before attempting label creation
                $permRes = Invoke-NativeSilent -FilePath "gh" -Arguments @("api", "repos/$OriginRepo", "--hostname", "github.com", "--jq", ".permissions.push")
                if ($permRes.ExitCode -eq 0 -and $permRes.Output -eq "true") {
                    Write-Host "==> Creating/updating lights-on:* labels via GitHub CLI on $OriginRepo (never upstream)..."
                    foreach ($lbl in $Labels) {
                        $labelRes = Invoke-NativeSilent -FilePath "gh" -Arguments @("label", "create", $lbl.Name, "--repo", "github.com/$OriginRepo", "--color", $lbl.Color, "--description", $lbl.Description, "--force")
                        if ($labelRes.ExitCode -ne 0) {
                            throw "Failed to configure label '$($lbl.Name)' on '$OriginRepo' (exit $($labelRes.ExitCode))."
                        }
                    }
                    Write-Host "  [ok]   $($Labels.Count) lights-on:* labels configured on $OriginRepo" -ForegroundColor Green
                }
                else {
                    Write-Host "==> Skipping GitHub labels (no write permission on origin '$OriginRepo' or repo is an upstream clone)." -ForegroundColor Yellow
                }
            }
            else {
                Write-Host "==> Skipping GitHub labels (no authenticated 'gh' session or GitHub origin remote detected)."
            }
        }
        finally {
            Pop-Location
        }
    }
    else {
        Write-Host "==> Skipping GitHub labels ('gh' CLI not found; labels will be created as needed or run 'gh label create')."
    }

    Write-Host @"

========================================================================
Lights On installed successfully!
========================================================================

Next Steps:

  1. Add ANY ONE AI provider secret in your repository settings
     (Settings -> Secrets and variables -> Actions -> New repository secret):
       - COPILOT_GITHUB_TOKEN   (GitHub Copilot CLI)
       - ANTHROPIC_API_KEY      (Anthropic Messages API)
       - OPENAI_API_KEY         (OpenAI Responses API)
       - OPENROUTER_API_KEY     (OpenRouter tool-calling API)

  2. Enable Pull Request permissions for GitHub Actions:
     Settings -> Actions -> General -> Workflow permissions:
       - Select "Read and write permissions"
       - Check "Allow GitHub Actions to create and approve pull requests"

  3. Commit and push the installed files:
       git add .github
       git commit -m "chore: adopt Lights On autonomous maintenance"
       git push

  What happens next?
    - On first run, Lights On automatically generates THREAT_MODEL.md
      (§1.1-§1.19) using alpha-omega-security/threat-model if not present.
    - Dependencies and downstream dependent packages are discovered
      dynamically on demand via ecosyste.ms and osv.dev.
========================================================================
"@
}
finally {
    if ($TempCloneDir -and (Test-Path -LiteralPath $TempCloneDir)) {
        Remove-Item -LiteralPath $TempCloneDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
