# Discord experience redesign

The redesign covers the entire implemented Discord surface. `DISCORD_EXPERIENCE_COVERAGE.md` is the generated inventory, including all command families, action variants, handlers, component families, modals, autocomplete and notification paths.

## Member journey

Start at `/help open`, choose a section, choose a feature, then choose an action. Every existing parent also has `/name open`. Existing direct slash commands, option keys and saved component routes remain supported.

Read-only views open immediately with their defaults. Change options opens a form when a member wants a different view. The menu explains the feature in ordinary language. A user, role or channel field uses Discord's native picker. Closed lists use selects. Owned gear, abilities, offers, recipes, crates, affixes, tickets, accessible cases, listings and authorised gathering records offer contextual choices. Other free IDs and text can still be entered; suggestions are not an access grant or a replacement for the services' checks.

Choose an action before filling its details. For example, joining a crew session requests a session, not all the fields used to create one. Optional fields can be skipped, and Review now skips remaining optional fields together. Text and amounts use a modal. The review shows selected inputs, costs or consequences, and Confirm, Edit details and Cancel controls.

Quotes link directly to purchase review. Workshop previews preserve the item and operation in their continuation. Expedition and mission previews lead to preparation of that same objective. Member settings and results have a route back to their feature and the full navigation.

Tactical combat turns and blackjack Hit/Stand execute immediately through their existing handlers. Blackjack Double/Split review the additional stake first. Active blackjack responses show own cards, total, stake, turn and receipt rather than an empty receipt string. Dealer secrecy and other players' hands are preserved.

## Visual and writing system

Cards share a dark, restrained metallic identity and a small diamond signature. Headings identify the feature; body text states the actual result; the next action is either the card's own controls or contextual navigation. Functional labels say Wallet, Stats, Character class, Combat and Transaction history rather than requiring the member to decode metaphors. Errors remain plain and explain recovery.

The common renderer covers every `event.reply` path. CAPTCHA attachments display as images. Long text and large control sets are paginated, stored in full and bound to the reader. Private controls update their existing panel; public controls stay in place and return a private response. Exceptions do not falsely claim that an action rolled back.

All five existing worker message POST paths use the same renderer: moderation alerts, birthday announcements, ticket inactivity reminders, voice-room closure warnings and verification assistance. Existing destinations, scheduling, privacy and mention policy are unchanged. User-authored publications, embeds, links, pins, stickies and reply variants retain their content and formatting. Existing adapters that return setup-required still do so; the redesign does not invent delivery, add integrations or change delivery rules.

## State and permission boundaries

Forms, confirmations, continuations and page data reuse the existing InteractionSession table. They survive process restart, expire after 15 minutes, and validate actor, guild and published configuration revision. Transitions use atomic one-use consumption. Invalid text input can be corrected before consumption. Changing prices or terms detected at confirmation produces a refreshed review rather than silently accepting different terms.

The UI dispatches to the original handlers and domain services. Those services still own permissions, native verification, hierarchy, privacy, eligibility, ledger transactions, idempotency, escrow, funding, costs, cooldowns, rewards and schedules. Selected target roles/hierarchy are re-read before dispatch. No schema or economy-rule migration is introduced.

Reaction-style role panels use the equivalent select in private slash responses, since ephemeral messages cannot receive reactions. Existing public reaction panels retain their original stored mode and bindings.

Existing slash subcommands and parameters are preserved. The 36-parent budget remains unchanged. Previously implemented ticket panel/message and room invite/lock/rename operations are now listed among their action choices. Unsupported suggestion polls are no longer advertised, matching the existing exclusion rule.

## Local verification and live review

Run the repository build before tests, then:

```sh
npm run typecheck
npm run lint
npm test
npm run commands:plan
npm run experience:audit
```

Unit tests include a mocked Discord client and controlled repository doubles. They validate dispatch/transport boundaries and failure behaviour, not a live Discord server or PostgreSQL concurrency. Existing domain/economy tests remain in the suite. The session compare-and-set test executes the real session function with a controlled repository double.

A named test guild and credentials are still required for a live review. Check every family from the coverage inventory, including private panel updates, public role/ticket/review controls, CAPTCHA image rendering, all four modal flows, native selects, help autocomplete, quoted purchases, staff role removal, expired sessions, page navigation, attachments and worker notices. Check that the existing direct slash shortcuts still execute their original services. No commands have been registered or production data changed by this work.

`commands:plan` remains a dry run by default. The existing explicit registration tool is still the only path for updating a named test guild. Production registration and deployment remain outside this change.
