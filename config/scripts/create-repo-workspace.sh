#!/usr/bin/env bash
# Create or remove a disposable multi-repository Git-worktree snapshot.
# DEST is an Orca folder workspace, not a Google-repo client.
set -euo pipefail

usage() {
  printf '%s\n' \
    'Usage: create-repo-workspace.sh [--topic TOPIC] [--only PATH,...] GOLDEN [DEST]' \
    '       create-repo-workspace.sh --remove [--delete-branches] DEST'
}
fail() { echo "error: $*" >&2; exit 1; }

MODE=create
TOPIC=''
ONLY=''
DELETE_BRANCHES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --topic) [[ $# -gt 1 ]] || fail '--topic needs a value'; TOPIC=$2; shift 2 ;;
    --only) [[ $# -gt 1 ]] || fail '--only needs a value'; ONLY=$2; shift 2 ;;
    --remove) MODE=remove; shift ;;
    --delete-branches) DELETE_BRANCHES=1; shift ;;
    --) shift; break ;;
    -*) fail "unknown option: $1" ;;
    *) break ;;
  esac
done

command -v realpath >/dev/null 2>&1 || fail 'realpath command not found'
command -v git >/dev/null 2>&1 || fail 'git command not found'

if [[ "$MODE" == remove ]]; then
  [[ $# -eq 1 ]] || { usage >&2; exit 2; }
  DEST=$(realpath "$1") || fail "destination does not exist: $1"
  STATE="$DEST/.repo-worktrees"
  [[ -f "$STATE/source" && -f "$STATE/created" ]] || fail "not a snapshot workspace: $DEST"
  GOLDEN=$(cat "$STATE/source")
  while IFS=$'\t' read -r path branch gitdir || [[ -n "${path:-}" ]]; do
    [[ -n "$path" ]] || continue
    git --git-dir="$gitdir" worktree remove --force "$DEST/$path" >/dev/null 2>&1 || \
      git --git-dir="$gitdir" worktree prune >/dev/null 2>&1 || true
    if [[ "$DELETE_BRANCHES" -eq 1 ]]; then
      git --git-dir="$gitdir" branch -D "$branch" >/dev/null 2>&1 || true
    fi
  done < "$STATE/created"
  rm -rf -- "$DEST"
  printf 'Removed snapshot workspace: %s\n' "$DEST"
  exit 0
fi

[[ "$DELETE_BRANCHES" -eq 0 ]] || fail '--delete-branches requires --remove'
[[ $# -ge 1 && $# -le 2 ]] || { usage >&2; exit 2; }
command -v rsync >/dev/null 2>&1 || fail 'rsync command not found'
GOLDEN=$(realpath "$1") || fail "golden does not exist: $1"
DEST=$(realpath -m "${2:-${GOLDEN}-workspace}") || fail 'cannot resolve destination'
[[ -f "$GOLDEN/.repo/project.list" ]] || fail "missing $GOLDEN/.repo/project.list"
[[ ! -e "$DEST" ]] || fail "destination already exists: $DEST"
[[ "$GOLDEN" != "$DEST" && "$DEST" != "$GOLDEN"/* ]] || fail 'destination must not be inside golden'
[[ -d "$(dirname "$DEST")" ]] || fail "destination parent does not exist: $(dirname "$DEST")"
[[ "$(stat -c %d "$GOLDEN")" == "$(stat -c %d "$(dirname "$DEST")")" ]] || \
  fail 'golden and destination must share a filesystem'
TOPIC=${TOPIC:-$(basename "$DEST")}
[[ "$TOPIC" =~ ^[A-Za-z0-9._][A-Za-z0-9._/-]*$ && "$TOPIC" != *..* ]] || \
  fail "invalid topic: $TOPIC"

mapfile -t ALL_PROJECTS < <(sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$GOLDEN/.repo/project.list")
PROJECTS=()
if [[ -n "$ONLY" ]]; then
  IFS=',' read -r -a WANTED <<< "$ONLY"
  for wanted in "${WANTED[@]}"; do
    found=0
    for project in "${ALL_PROJECTS[@]}"; do
      if [[ "$project" == "$wanted" ]]; then PROJECTS+=("$project"); found=1; break; fi
    done
    [[ "$found" -eq 1 ]] || fail "unknown --only path: $wanted"
  done
else
  PROJECTS=("${ALL_PROJECTS[@]}")
fi
[[ ${#PROJECTS[@]} -gt 0 ]] || fail 'no projects selected'
for path in "${PROJECTS[@]}"; do
  [[ "$path" != /* && "$path" != *..* && "$path" != *\\* ]] || fail "unsafe project path: $path"
  [[ -d "$GOLDEN/$path" && -e "$GOLDEN/$path/.git" ]] || fail "not a Git project: $GOLDEN/$path"
  git -C "$GOLDEN/$path" show-ref --verify --quiet "refs/heads/$TOPIC" && \
    fail "topic already exists in $path: $TOPIC" || true
done

STATE="$DEST/.repo-worktrees"
mkdir -p -- "$STATE"
printf '%s\n' "$GOLDEN" > "$STATE/source"
printf '%s\n' "$TOPIC" > "$STATE/topic"
printf '%s\n' "${PROJECTS[@]}" > "$STATE/projects"
: > "$STATE/created"
cleanup() {
  while IFS=$'\t' read -r path branch gitdir || [[ -n "${path:-}" ]]; do
    [[ -n "$path" ]] || continue
    git --git-dir="$gitdir" worktree remove --force "$DEST/$path" >/dev/null 2>&1 || true
    git --git-dir="$gitdir" branch -D "$branch" >/dev/null 2>&1 || true
  done < "$STATE/created"
  rm -rf -- "$DEST"
}
trap cleanup EXIT

for path in "${PROJECTS[@]}"; do
  src="$GOLDEN/$path"
  dst="$DEST/$path"
  mkdir -p -- "$(dirname "$dst")"
  git -C "$src" worktree add --no-checkout -b "$TOPIC" "$dst" HEAD
  gitdir=$(git -C "$src" rev-parse --path-format=absolute --git-common-dir)
  printf '%s\t%s\t%s\n' "$path" "$TOPIC" "$gitdir" >> "$STATE/created"
done

rsync -a --link-dest="$GOLDEN/" \
  --exclude='.git' --exclude='/.repo/' --exclude='/.repo-worktrees/' \
  --exclude='/out/' --exclude='/dist/' --exclude='/build/' --exclude='/node_modules/' \
  "$GOLDEN/" "$DEST/"
cat > "$DEST/WORKTREE_WORKSPACE.txt" <<EOF
Disposable multi-repository Git-worktree snapshot.
golden: $GOLDEN
topic: $TOPIC
This is an Orca folder workspace. Do not run repo sync or repo start here.
Working-tree files are hardlinked with golden; avoid in-place writes and destructive checkout/reset.
Remove with: $(basename "$0") --remove --delete-branches $DEST
EOF
trap - EXIT
printf 'Created snapshot workspace: %s (%s projects)\n' "$DEST" "${#PROJECTS[@]}"
