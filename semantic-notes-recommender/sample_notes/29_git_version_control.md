# Git Version Control

Git is a distributed version control system that tracks changes to source code. Every developer holds a full copy of the repository, including its entire history.

## Core concepts

- **Commit**: a snapshot of the repository at a point in time, identified by a SHA-1 hash
- **Branch**: a lightweight pointer to a commit; creating branches is instant and cheap
- **Merge**: combines diverged histories; fast-forward or three-way merge strategies
- **Rebase**: replays commits on top of another branch, producing a linear history

## Common workflows

**Feature branch workflow**: each new feature lives on its own branch and is merged into main via a pull request after code review.

**Trunk-based development**: developers commit small changes directly to the main branch, relying on feature flags to hide incomplete work.

## Useful commands

```
git log --oneline --graph   # visualize branch history
git bisect                  # binary search for the commit that introduced a bug
git stash                   # temporarily shelve uncommitted changes
git reflog                  # recover from accidental resets or dropped commits
```

## Merge vs rebase

Merging preserves history and shows exactly when branches diverged. Rebasing produces a cleaner linear history but rewrites commit hashes, making it unsafe on shared branches.
