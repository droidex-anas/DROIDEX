## What changed

<!-- Explain the problem and the smallest complete solution. Link the issue this closes. -->

## Why

<!-- Why this approach? Note any tradeoff a reviewer would otherwise have to reconstruct. -->

## Verification

<!--
List the checks you actually ran and their outcome. Do not list a check you did not run.
For UI changes, attach a screenshot or short recording of the change in the running app.
-->

## Checklist

- [ ] Every commit is signed off (`git commit -s`), per [CONTRIBUTING.md](https://github.com/droidex-anas/droid-maxxing/blob/main/CONTRIBUTING.md#sign-your-commits-dco)
- [ ] The change follows the engineering guide in [AGENTS.md](https://github.com/droidex-anas/droid-maxxing/blob/main/AGENTS.md)
- [ ] Checks relevant to the files I touched pass locally
- [ ] Docs regenerated (`npm run docs:generate`) if scripts, environment variables, or onboarding commands changed
- [ ] No unrelated reformatting, renames, or dead code left behind
