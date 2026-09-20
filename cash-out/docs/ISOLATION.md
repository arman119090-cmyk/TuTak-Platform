# Isolation from TuTak

Cash Out is a separate product. It lives inside `TuTak-Platform/cash-out/` only
because the GitHub App in this environment cannot create a repository
(`403 Resource not accessible by integration`). Until it moves, these are the
walls between the two, and what each one is for.

## Walls that exist today

| Wall                                     | Where                                                                       | What it prevents                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Own pnpm workspace and lockfile          | `cash-out/pnpm-workspace.yaml`, `cash-out/pnpm-lock.yaml`                   | TuTak's `pnpm install`, `pnpm -r`, turbo and `pnpm audit` never see Cash Out packages; nothing is hoisted across      |
| Not in TuTak's workspace                 | root `pnpm-workspace.yaml` lists only `apps/*` and `packages/*`             | No TuTak package can `workspace:` depend on a Cash Out package, or the reverse                                        |
| Own ESLint, Prettier, TypeScript configs | `cash-out/eslint.config.mjs`, `cash-out/.prettierrc*`, `cash-out/tsconfig*` | TuTak's rules never run on Cash Out and vice versa                                                                    |
| Root ESLint ignores the folder           | root `eslint.config.mjs` (`cash-out/**`)                                    | `pnpm lint` at the root skips it                                                                                      |
| Root Prettier ignores the folder         | root `.prettierignore`, root `format` script                                | `pnpm format` at the root does not rewrite Cash Out files                                                             |
| Docker ignores the folder                | root `.dockerignore` (`cash-out`)                                           | No TuTak image (API, admin, partner) ever contains Cash Out                                                           |
| Own CI, path-filtered                    | `.github/workflows/cash-out-ci.yml` (`paths: cash-out/**`)                  | Cash Out's checks run only when Cash Out changes; TuTak's `CI` workflow runs TuTak's own packages                     |
| **Merge tripwire**                       | `.github/workflows/cash-out-isolation.yml`                                  | A pull request into `main` that adds or changes `cash-out/**` fails; a push to `main` that contains `cash-out/` fails |
| Rule for future sessions                 | root `CLAUDE.md`, section «Cash Out — отдельный проект»                     | Nobody working in this repository treats Cash Out as part of TuTak                                                    |
| Reports kept apart                       | `cash-out/docs/`, not root `docs/`                                          | TuTak's documentation does not accumulate Cash Out material                                                           |

The tripwire is a GitHub Actions check. To make it a hard stop rather than a
red mark, add it to `main`'s branch protection as a required status check
(`Cash Out isolation / cash-out/ must not enter main`).

## Verified: the history splits cleanly

`git subtree split --prefix=cash-out` produces a branch whose tree is
byte-for-byte `HEAD:cash-out` (checked on `2404c6c`: 18 commits, tree
`06d4915…`). Nothing in Cash Out's history depends on a TuTak file.

## The end state, in two possible orders

**A. Separate repository (preferred).** Create an EMPTY private repository
`cash-out`, give the Claude GitHub App access to it, then from this checkout:

```bash
cash-out/scripts/split-to-own-repo.sh git@github.com:arman119090-cmyk/cash-out.git
```

The script pushes the split history as `main`, clones it back, compares trees,
and only then tells you how to delete the copy here.

**B. A standalone branch in this repository, meanwhile.** If the repository
cannot be created yet, the same split can live as an orphan branch that shares
no commit with TuTak's `main`:

```bash
git subtree split --prefix=cash-out -b cash-out-standalone
git push origin cash-out-standalone:refs/heads/cash-out
```

That branch is a complete Cash Out repository root (its CI is
`cash-out/.github/workflows/ci.yml`, which becomes `.github/workflows/ci.yml`
there). It was not pushed automatically: pushing to a branch other than the
working branch needs your say-so.

## Never

- Never open a pull request from a Cash Out branch into `main`.
- Never add `cash-out` to the root `pnpm-workspace.yaml`, `turbo.json` or any
  TuTak Dockerfile.
- Never import across the boundary in either direction.
