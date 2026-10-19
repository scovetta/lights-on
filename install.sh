#!/usr/bin/env sh
# Lights On — 1-Command Installer (POSIX sh)
#
# Usage:
#   Local checkout:
#     ./install.sh [/path/to/target-repo] [--dry-run] [--force] [--skip-labels]
#
#   Remote 1-liner:
#     curl -fsSL https://raw.githubusercontent.com/scovetta/lights-on/main/install.sh | sh
#     curl -fsSL https://raw.githubusercontent.com/scovetta/lights-on/main/install.sh | sh -s -- /path/to/repo --force

set -eu

LIGHTS_ON_REPO_URL="${LIGHTS_ON_REPO_URL:-https://github.com/scovetta/lights-on.git}"
LIGHTS_ON_BRANCH="${LIGHTS_ON_BRANCH:-main}"
TARGET_DIR="."
FORCE=0
DRY_RUN=0
CREATE_LABELS=0
SKIP_LABELS=0

usage() {
  cat <<'EOF'
Lights On Installer

Usage:
  install.sh [TARGET_DIR] [OPTIONS]

Arguments:
  TARGET_DIR              Target git repository path (default: current directory ".")

Options:
  -n, --dry-run           Show file diffs without changing target files or GitHub labels
  -f, --force             Overwrite existing .github/lights-on.yml configuration
      --create-labels     Pre-create lights-on:* labels on origin via GitHub CLI (gh)
      --skip-labels       Skip creating/updating lights-on:* labels via GitHub CLI (gh)
      --repo-url <url>    Override source repository URL (default: $LIGHTS_ON_REPO_URL)
  -h, --help              Show this help message
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -n|--dry-run)
      DRY_RUN=1
      shift
      ;;
    -f|--force)
      FORCE=1
      shift
      ;;
    --create-labels)
      CREATE_LABELS=1
      shift
      ;;
    --skip-labels)
      SKIP_LABELS=1
      shift
      ;;
    --repo-url)
      if [ "$#" -lt 2 ]; then
        echo "Error: --repo-url requires a URL argument." >&2
        exit 1
      fi
      LIGHTS_ON_REPO_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Error: Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      TARGET_DIR="$1"
      shift
      ;;
  esac
done

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Target directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

if [ "$DRY_RUN" -eq 1 ]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "Error: 'git' is required to show dry-run diffs." >&2
    exit 1
  fi
  echo "==> Dry run for: $TARGET_DIR (installed -> source)"
else
  echo "==> Installing Lights On into: $TARGET_DIR"
fi
PREVIEW_CREATES=0
PREVIEW_OVERWRITES=0
PREVIEW_UNCHANGED=0

install_file() {
  file_source="$1"
  file_destination="$2"
  file_display="$3"
  if [ ! -f "$file_source" ]; then
    echo "Error: Source file is missing or unreadable: $file_source" >&2
    return 1
  fi
  if [ -e "$file_destination" ] && [ ! -f "$file_destination" ]; then
    echo "Error: Destination is not a file: $file_destination" >&2
    return 1
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ -f "$file_destination" ]; then
      if cmp -s "$file_destination" "$file_source"; then
        PREVIEW_UNCHANGED=$((PREVIEW_UNCHANGED + 1))
        echo "  [unchanged] $file_display"
        return
      else
        compare_status=$?
        if [ "$compare_status" -ne 1 ]; then
          echo "Error: Unable to compare $file_display (cmp exit $compare_status)." >&2
          return 1
        fi
      fi
      PREVIEW_OVERWRITES=$((PREVIEW_OVERWRITES + 1))
      echo "  [overwrite] $file_display"
      file_before="$file_destination"
    else
      PREVIEW_CREATES=$((PREVIEW_CREATES + 1))
      echo "  [create] $file_display"
      file_before="/dev/null"
    fi
    # A difference is exit 1; comparison errors must still fail the installer.
    diff_status=0
    git --no-pager diff --no-index --no-ext-diff --no-textconv --no-color -- "$file_before" "$file_source" || diff_status=$?
    case "$diff_status" in
      0|1) ;;
      *) echo "Error: Unable to preview $file_display (git diff exit $diff_status)." >&2; return 1 ;;
    esac
    return
  fi
  if [ "$SRC_DIR" != "$TARGET_DIR" ]; then
    cp "$file_source" "$file_destination"
  fi
  echo "  [ok]   $file_display"
}

# Determine whether source files are adjacent to this script or need to be downloaded
SRC_DIR=""
TMP_CLONE_DIR=""

cleanup() {
  if [ -n "$TMP_CLONE_DIR" ] && [ -d "$TMP_CLONE_DIR" ]; then
    rm -rf "$TMP_CLONE_DIR"
  fi
}
trap cleanup EXIT INT TERM

SCRIPT_DIR=""
case "$0" in
  */*)
    if [ -f "$0" ]; then
      SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
    fi
    ;;
esac

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/.github/lights-on.yml" ] && [ -d "$SCRIPT_DIR/.github/lights-on/runner" ]; then
  SRC_DIR="$SCRIPT_DIR"
  echo "==> Using local Lights On source from: $SRC_DIR"
elif [ -f "./.github/lights-on.yml" ] && [ -d "./.github/lights-on/runner" ] && [ -f "./.github/actions/lights-on-agent/action.yml" ]; then
  SRC_DIR="$(pwd)"
  echo "==> Using local Lights On source from: $SRC_DIR"
else
  if ! command -v git >/dev/null 2>&1; then
    echo "Error: 'git' is required to download Lights On from $LIGHTS_ON_REPO_URL" >&2
    exit 1
  fi
  TMP_CLONE_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'lights-on-install')"
  echo "==> Downloading Lights On from $LIGHTS_ON_REPO_URL (branch: $LIGHTS_ON_BRANCH)..."
  git clone --depth 1 --branch "$LIGHTS_ON_BRANCH" "$LIGHTS_ON_REPO_URL" "$TMP_CLONE_DIR" >/dev/null 2>&1 || \
    git clone --depth 1 "$LIGHTS_ON_REPO_URL" "$TMP_CLONE_DIR" >/dev/null 2>&1
  SRC_DIR="$TMP_CLONE_DIR"
fi

# Validate source files
if [ ! -f "$SRC_DIR/.github/lights-on.yml" ]; then
  echo "Error: Source directory is missing .github/lights-on.yml ($SRC_DIR)" >&2
  exit 1
fi

# Create target directory structure
if [ "$DRY_RUN" -ne 1 ]; then
  mkdir -p \
    "$TARGET_DIR/.github/actions/lights-on-agent" \
    "$TARGET_DIR/.github/lights-on/runner" \
    "$TARGET_DIR/.github/lights-on/prompts" \
    "$TARGET_DIR/.github/lights-on/ecosystems" \
    "$TARGET_DIR/.github/workflows"
fi

# 1. Copy .github/lights-on.yml (preserve existing unless --force)
if [ -f "$TARGET_DIR/.github/lights-on.yml" ] && [ "$FORCE" -ne 1 ]; then
  echo "  [skip] .github/lights-on.yml already exists (use --force to overwrite)"
else
  install_file "$SRC_DIR/.github/lights-on.yml" "$TARGET_DIR/.github/lights-on.yml" ".github/lights-on.yml"
fi

# 2. Copy composite action .github/actions/lights-on-agent/action.yml
install_file "$SRC_DIR/.github/actions/lights-on-agent/action.yml" "$TARGET_DIR/.github/actions/lights-on-agent/action.yml" ".github/actions/lights-on-agent/action.yml"

# Copy controllers and the non-executing package metadata inspector.
for f in "$SRC_DIR/.github/lights-on/runner/"*.mjs "$SRC_DIR/.github/lights-on/runner/"*.py \
  "$SRC_DIR/.github/lights-on/runner/copilot-sdk.package.json" "$SRC_DIR/.github/lights-on/runner/copilot-sdk.package-lock.json" \
  "$SRC_DIR/.github/lights-on/runner/copilot-cli.package.json" "$SRC_DIR/.github/lights-on/runner/copilot-cli.package-lock.json"; do
  if [ -f "$f" ]; then
    install_file "$f" "$TARGET_DIR/.github/lights-on/runner/$(basename "$f")" ".github/lights-on/runner/$(basename "$f")"
  fi
done

# 4. Copy prompts .github/lights-on/prompts/*.md
for f in "$SRC_DIR/.github/lights-on/prompts/"*.md; do
  if [ -f "$f" ]; then
    install_file "$f" "$TARGET_DIR/.github/lights-on/prompts/$(basename "$f")" ".github/lights-on/prompts/$(basename "$f")"
  fi
done

# 5. Copy ecosystem detection manifest .github/lights-on/ecosystems/detection.json
if [ -f "$SRC_DIR/.github/lights-on/ecosystems/detection.json" ]; then
  install_file "$SRC_DIR/.github/lights-on/ecosystems/detection.json" "$TARGET_DIR/.github/lights-on/ecosystems/detection.json" ".github/lights-on/ecosystems/detection.json"
fi

# 6. Copy installed Lights On workflows.
for wf in lights-on-events.yml lights-on-schedule.yml lights-on-pr.yml lights-on-release.yml lights-on-setup.yml; do
  if [ -f "$SRC_DIR/.github/workflows/$wf" ]; then
    install_file "$SRC_DIR/.github/workflows/$wf" "$TARGET_DIR/.github/workflows/$wf" ".github/workflows/$wf"
  fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "==> Dry run complete: $PREVIEW_CREATES create, $PREVIEW_OVERWRITES overwrite, $PREVIEW_UNCHANGED unchanged."
  echo "No target files or GitHub labels were changed. Remove --dry-run to install."
  exit 0
fi

# 7. Create/update lights-on:* labels if gh CLI is installed, authenticated, and target has a GitHub remote
ORIGIN_REPO=""
create_label() {
  label_name="$1"
  label_color="$2"
  label_desc="$3"
  if [ -n "$ORIGIN_REPO" ]; then
    (cd "$TARGET_DIR" && gh label create "$label_name" --repo "github.com/$ORIGIN_REPO" --color "$label_color" --description "$label_desc" --force) || {
      echo "Error: Failed to configure label '$label_name' on '$ORIGIN_REPO'." >&2
      return 1
    }
  fi
}

if [ "$SKIP_LABELS" -eq 1 ] || [ "$CREATE_LABELS" -eq 0 ]; then
  echo "==> Skipping remote GitHub label creation (local file install; pass --create-labels to pre-create labels on origin)."
elif command -v gh >/dev/null 2>&1; then
  HAS_GH_REMOTE=0
  if (cd "$TARGET_DIR" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
    REMOTE_URL="$(cd "$TARGET_DIR" && git remote get-url origin 2>/dev/null || true)"
    case "$REMOTE_URL" in
      https://github.com/*|git@github.com:*|ssh://git@github.com/*)
        ORIGIN_REPO="$(printf '%s' "$REMOTE_URL" | sed -E 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#/$##; s#\.git$##')"
        case "$ORIGIN_REPO" in
          *[!A-Za-z0-9_./-]*|*/*/*|./*|../*|*/.|*/..) ORIGIN_REPO="" ;;
          ?*/?*) HAS_GH_REMOTE=1 ;;
        esac
        ;;
    esac
  fi

  HAS_PUSH_PERM=0
  if [ "$HAS_GH_REMOTE" -eq 1 ] && (cd "$TARGET_DIR" && gh auth status --hostname github.com >/dev/null 2>&1); then
    PUSH_PERM="$(cd "$TARGET_DIR" && gh api "repos/$ORIGIN_REPO" --hostname github.com --jq '.permissions.push' 2>/dev/null || echo "false")"
    if [ "$PUSH_PERM" = "true" ]; then
      HAS_PUSH_PERM=1
    fi
  fi

  if [ "$HAS_PUSH_PERM" -eq 1 ]; then
    echo "==> Creating/updating lights-on:* labels via GitHub CLI on $ORIGIN_REPO (never upstream)..."
    create_label "lights-on:ignore"                      "cfd3d7" "Lights On will never touch or comment on this issue/PR"
    create_label "lights-on:actionable"                  "0e8a16" "Queue this issue for an autonomous fix PR by Lights On"
    create_label "lights-on:migrate-dep"                 "5319e7" "Request read-only dependency migration planning"
    create_label "lights-on:hold"                        "d93f0b" "Keep reviewed PR open; block auto-merge until removed"
    create_label "lights-on:automerge"                   "0e8a16" "Explicitly opt this PR into auto-merge once all 4 gates pass"
    create_label "lights-on:re-review"                   "1d76db" "Trigger a fresh 4-Gate review on this PR"
    create_label "lights-on:needs-human"                 "b60205" "Escalated by Lights On for maintainer decision"
    create_label "lights-on:approved-override"           "fbca04" "Maintainer override for protected-path or high-risk PRs"
    create_label "lights-on:approved"                    "0e8a16" "Lights On 4-Gate review passed"
    create_label "lights-on:changes-requested"           "e99695" "Lights On 4-Gate review requested changes"
    create_label "lights-on:automerge-disabled-external" "fef2c0" "External PR passed review; auto-merge disabled by policy"
    create_label "lights-on:triaged"                     "c5def5" "Issue triaged by Lights On"
    create_label "lights-on:in-progress"                 "bfdadc" "Lights On is actively working on this item"
    create_label "lights-on:reviewed"                    "d4c5f9" "PR reviewed by Lights On"
    create_label "lights-on:automation"                  "0052cc" "Automated PR or issue created by Lights On"
    create_label "lights-on:release"                     "0e8a16" "Automated Release PR prepared by Lights On"
    create_label "lights-on:agent-pr"                    "1d76db" "Automated PR created by Lights On"
    create_label "lights-on:pause"                       "b60205" "Pause Lights On automated merges"
    create_label "lights-on:upstream"                    "5319e7" "Mirrored from read-only upstream repository"
    create_label "lights-on:dependencies"                "0366d6" "Dependency update or migration"
    create_label "lights-on:security"                    "b60205" "Security vulnerability remediation"
    create_label "lights-on:docs"                        "0075ca" "Documentation clarification"
    create_label "lights-on:needs-info"                  "fbca04" "Awaiting reproduction details or clarification"
    create_label "lights-on:wontfix-by-design"            "5319e7" "Behavior is intentional per project scope"
    echo "  [ok]   24 lights-on:* labels configured on $ORIGIN_REPO"
  else
    echo "==> Skipping GitHub labels (no authenticated 'gh' session or GitHub origin remote detected)."
  fi
else
  echo "==> Skipping GitHub labels ('gh' CLI not found; labels will be created as needed or run 'gh label create')."
fi

cat <<'EOF'

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
EOF
