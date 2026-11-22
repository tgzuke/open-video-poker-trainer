# CLAUDE.md — Working rules for Open Video Poker Trainer

Read `SPEC.md` first. It is the source of truth for scope and behaviour. If something you're asked to do conflicts with SPEC.md, say so before building.

## Who you're working with
The owner is not reviewing the internals. He judges the project by whether it **plays right and the math is right**. So:
- **The tests are the review.** Every math or strategy change needs tests. Never weaken or delete a test to make it pass; fix the code, or explain why the test was wrong.
- Keep explanations short. Report what changed, what was verified, and anything that needs his decision.
- When a choice affects how the game *feels* (timing, layout, colors, sounds, controls), make a sensible choice, put it in config, and list it under "for playtesting" in your summary.

## Architecture rules
- `engine/` (Rust → WebAssembly + CLI) has **no UI dependencies**, and everything in it must work headless.
- Game definitions and pay tables are **data**, not code branches.
- The game model must allow for state that carries between hands and multiple hands per deal (future Ultimate X and multi-play), but **don't implement** those features.
- Heavy computation runs in a Web Worker. The UI thread never blocks.
- All input goes through the input abstraction layer. Default keymaps live in a single config file.
- Strategies are plain-text or JSON files in the repo, readable by humans.

## Math rules
- Grade strategies with exact enumeration, never simulation.
- Verify internally: fast path against brute force, probabilities summing to 1, suit-permutation invariance. Published figures are only an informational cross-check.
- EV is reported in credits. Return is reported as a percentage, to at least 4 decimal places in the CLI.

## Assets and legal
- Original or open-licensed assets only (fonts under OFL or drawn by us, sounds synthesized). Nothing copied from IGT or any manufacturer.
- Use generic game names by default. Don't copy published strategy lists verbatim; generate our own.
- This is not a gambling product. No real money, purchases or anything that looks like them.
- MIT license by default. Flag any dependency that is GPL or has an unclear license before adding it.

## Workflow
- Work one milestone at a time (SPEC.md §8). Finish its acceptance criteria before moving on.
- Commit in small, logical steps with clear messages. The repo is public: commit only as the owner's GitHub username with the no-reply address (set in this repo's git config), and keep personal details out of files and messages.
- At the end of each milestone, write a short summary to `docs/progress.md`: what was built, how it was verified, performance numbers, open questions, and items for playtesting.
