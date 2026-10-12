# Build protocol

Follow this protocol at the start and end of every coding session.

1. Read `docs/PROGRESS.md` and the master-spec sections named for the current task before editing. Do not reread the whole specification unless the task says to.
2. Preserve fixed decisions in `docs/MASTER_SPEC.md` section 1 and `docs/DECISIONS.md`. Do not change agreed product policy to make an implementation easier. Record new implementation choices.
3. Use the shared services in `packages/domain` and `packages/db`. Discord handlers and HTTP routes call those services. Do not create a second wallet, permission, or job implementation beside them.
4. Implement real flows. A button, route, or command that returns success without the corresponding persisted behaviour is not done. Missing credentials produce a setup-required or denied result, never a simulated login, provider success, or payout.
5. Add tests that exercise the behaviour and its important failure paths. Do not weaken an assertion to make a check pass.
6. Distinguish live verification from substitutes. A unit test, fixture, or local health check is not proof of Discord, OAuth, or provider behaviour. Say which kind of check ran.
7. Record blockers in `docs/PROGRESS.md` and `docs/REQUIREMENTS.md`. A missing secret blocks live verification of that integration only.
8. Preserve secrets and user edits. Do not commit tokens, client secrets, or `.env`. Do not revert changes you did not make.
9. Do not deploy, register commands against a production guild, or mutate production data. Test-guild registration waits for an explicit instruction that names the test guild.
10. After the session, update `docs/PROGRESS.md` and the relevant `docs/REQUIREMENTS.md` rows. Name the next unfinished task. Do not claim a later module is complete because this package built.

Current package boundary: package 26 is the acceptance audit. Read `docs/PROGRESS.md` for the remaining prerequisites. Do not restart earlier packages. Do not execute the production checklist without a separate instruction.
