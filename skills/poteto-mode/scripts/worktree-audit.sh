#!/usr/bin/env bash
# Read-only worktree prune audit. Classifies every git worktree by size, merge
# state, uncommitted work, remote/PR state, and the most recent T3 thread
# that operated in it. Emits a table sorted by size with a suggested bucket. Never
# deletes anything; deletion stays a human-gated step in the playbook.
#
# Usage: worktree-audit.sh [--activity <tsv>] [-b|--base <ref>] [repo-path]
#   repo-path defaults to the current repo.
#   -b sets the ref the MERGED column checks against (e.g. origin/integration).
#   Without it the base is origin/HEAD, then origin/main, then origin/master.
#   origin/HEAD is the remote's default branch, not necessarily the branch PRs
#   merge into; pass -b when they differ.
#   <tsv> has one line per worktree: <absolute worktree path>\t<UTC timestamp>\t<thread id>,
#   built from t3_thread_list and t3_thread_read. The timestamp is UTC ending in Z, as
#   t3_thread_read returns it (2026-10-10T12:34:56.789Z). Any other row aborts the audit.
#   Paths that exist compare by physical path, so /tmp matches /private/tmp.
#   Repeated paths keep the newest. Without it LAST_CHAT is "-".
set -u
# Never take git's optional index locks: the audit must not write to any worktree.
export GIT_OPTIONAL_LOCKS=0

activity=""
base=""
while [ $# -gt 0 ]; do
	case "$1" in
	--activity)
		activity="${2:-}"
		[ -r "$activity" ] || { echo "cannot read activity file: $activity" >&2; exit 1; }
		# Absolute before the cd below, so a relative path still resolves.
		activity="$(CDPATH= cd -- "$(dirname -- "$activity")" && pwd -P)/$(basename -- "$activity")"
		shift 2 ;;
	-b|--base) [ $# -ge 2 ] || { echo "error: $1 needs a ref" >&2; exit 2; }; base="$2"; shift 2 ;;
	-h|--help) sed -n '2,/^set -u/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
	-*) echo "error: unknown option: $1" >&2; exit 2 ;;
	*) break ;;
	esac
done

repo="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$repo" ] && { echo "not in a git repo; pass a repo path" >&2; exit 1; }
cd "$repo" || exit 1
git rev-parse --git-dir >/dev/null 2>&1 || { echo "error: not a git repo: $repo" >&2; exit 1; }

# Last T3 activity as "path<TAB>epoch<TAB>thread". A malformed row aborts the audit
# rather than reading as no activity, which could bucket a live worktree as safe.
acts=""
if [ -n "$activity" ]; then
	acts=$(jq -Rr 'select(test("^\\s*$") | not) | split("\t") as $f
		| if ($f | length) != 3 or $f[0] == "" or $f[2] == ""
			or ($f[1] | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$") | not)
		then error("bad row: \(.)") else . end
		| [($f[0] | sub("/+$"; "")), ($f[1] | sub("\\.[0-9]+"; "") | fromdateiso8601), $f[2]] | @tsv' "$activity") \
		|| { printf 'activity file rows must be <path>\\t<UTC timestamp ending in Z>\\t<thread id>: %s\n' "$activity" >&2; exit 1; }
	acts=$(printf '%s\n' "$acts" | while IFS=$'\t' read -r p ts id; do
		[ -n "$p" ] || continue
		[ -d "$p" ] && p=$(CDPATH= cd -- "$p" && pwd -P)
		printf '%s\t%s\t%s\n' "$p" "$ts" "$id"
	done)
fi

# Main worktree is the first entry; everything else is a candidate.
main_wt=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')

if [ -z "$base" ]; then
	for cand in "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)" origin/main origin/master; do
		[ -n "$cand" ] && git rev-parse --verify --quiet "$cand^{commit}" >/dev/null && { base="$cand"; break; }
	done
	[ -z "$base" ] && { echo "error: no base ref (origin/HEAD, origin/main, origin/master all missing); pass -b <ref>" >&2; exit 1; }
	echo "warn: no -b given; MERGED checks against $base" >&2
fi

# The base drives the merge check. The fetch is best-effort (stale is fine for
# a first pass) and runs before the check, since -b may name a branch not
# fetched yet. The explicit refspec creates it even in a single-branch clone.
case "$base" in
origin/*) git fetch origin "+refs/heads/${base#origin/}:refs/remotes/$base" --quiet 2>/dev/null \
	|| echo "warn: could not fetch $base; merged column may be stale" >&2 ;;
esac
git rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1 || { echo "error: base ref not found: $base" >&2; exit 1; }

# PR state by branch, fetched once as [{number, state, head}] with a lowercase
# state. Empty if gh is unavailable.
prs=$(mktemp)
if raw=$(gh pr list --author "@me" --state all --limit 1000 \
	--json number,state,headRefName 2>/dev/null); then
	printf '%s' "$raw" | jq '[.[] | {number, state: (.state | ascii_downcase), head: .headRefName}]' > "$prs" 2>/dev/null
fi
[ -s "$prs" ] || echo "[]" > "$prs"

now=$(date +%s)

echo "# base: $base"
printf "SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE\n"

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
	[ "$wt" = "$main_wt" ] && continue

	size=$(du -sh "$wt" 2>/dev/null | awk '{print $1}')
	head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
	head_ts=$(git -C "$wt" log -1 --format='%ct' HEAD 2>/dev/null || echo 0)
	age=$([ "$head_ts" -gt 0 ] 2>/dev/null && echo "$(( (now - head_ts) / 86400 ))d" || echo "?")

	# Squash-merged branches are not ancestors of the base, so PR state is the
	# real signal; merge-base only catches fast-forward/rebase merges.
	git merge-base --is-ancestor "$head" "$base" 2>/dev/null && merged=YES || merged=no

	# Distinguish real WIP (tracked edits) from disposable untracked scratch.
	porcelain=$(git -C "$wt" status --porcelain 2>/dev/null)
	if [ -z "$porcelain" ]; then dirty=clean
	elif printf '%s\n' "$porcelain" | grep -qv '^??'; then
		dirty="wip:$(printf '%s\n' "$porcelain" | grep -cv '^??')"
	else dirty="scratch:$(printf '%s\n' "$porcelain" | grep -c '^??')"; fi

	branch=$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
	if [ -z "$branch" ]; then remote=detached
	elif git -C "$wt" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
		[ "$(git -C "$wt" rev-parse "origin/$branch" 2>/dev/null)" = "$head" ] \
			&& remote=pushed \
			|| remote="ahead$(git -C "$wt" rev-list --count "origin/$branch..HEAD" 2>/dev/null)"
	else remote=no-remote; fi

	pr=$([ -n "$branch" ] && jq -r --arg b "$branch" \
		'.[] | select(.head==$b) | "#\(.number)/\(.state)"' "$prs" 2>/dev/null | head -1)
	[ -z "$pr" ] && pr="-"

	# Most recent T3 thread that ran in this worktree. Exact physical-path match
	# so glint-482 does not match glint-482-r37.
	last="-"; last_ts=0
	wt_real=$(CDPATH= cd -- "$wt" 2>/dev/null && pwd -P || printf '%s' "$wt")
	f=$(printf '%s\n' "$acts" | awk -F'\t' -v p="$wt_real" '$1 == p' | sort -t$'\t' -k2,2 -rn | head -1)
	if [ -n "$f" ]; then last_ts=$(printf '%s' "$f" | cut -f2)
		last="$(date -r "$last_ts" '+%Y-%m-%d' 2>/dev/null || date -d "@$last_ts" '+%Y-%m-%d' 2>/dev/null)/$(printf '%s' "$f" | cut -f3)"; fi
	recent=$([ "$last_ts" -gt 0 ] 2>/dev/null && [ $(( (now - last_ts) / 86400 )) -le 4 ] && echo yes || echo no)

	case "$dirty" in wip:*) bucket=hold-wip ;; *)
		case "$pr" in */open|*/draft) bucket=hold-open-pr ;; *)
			if [ "$recent" = yes ]; then bucket=verify-recent-chat
			elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe
			else bucket=review; fi ;;
		esac ;;
	esac

	printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
		"$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$last" "$bucket" "$wt"
done | sort -t$'\t' -k1,1 -rh

rm -f "$prs"
