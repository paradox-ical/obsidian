export interface CommandChoice {
  name: string;
  value: string | number;
}

function text(pairs: ReadonlyArray<readonly [string, string]>): CommandChoice[] {
  return pairs.map(([value, name]) => ({ name, value }));
}

const MONTHS: CommandChoice[] = [
  ["January", 1],
  ["February", 2],
  ["March", 3],
  ["April", 4],
  ["May", 5],
  ["June", 6],
  ["July", 7],
  ["August", 8],
  ["September", 9],
  ["October", 10],
  ["November", 11],
  ["December", 12],
].map(([name, value]) => ({ name: String(name), value: Number(value) }));

const PROVIDERS = text([
  ["steam", "Steam"],
  ["riot", "Riot"],
  ["battlenet", "Battle.net"],
  ["epic", "Epic"],
  ["ea", "EA"],
  ["ubisoft", "Ubisoft"],
  ["xbox", "Xbox"],
  ["playstation", "PlayStation"],
  ["minecraft", "Minecraft"],
  ["twitch", "Twitch"],
  ["youtube", "YouTube"],
  ["bungie", "Bungie"],
  ["roblox", "Roblox"],
]);

const VISIBILITY = text([
  ["public", "Public"],
  ["private", "Private"],
]);

const CLASSES = text([
  ["hitman", "Hitman"],
  ["bruiser", "Bruiser"],
  ["saboteur", "Saboteur"],
  ["fixer", "Fixer"],
  ["duelist", "Duelist"],
  ["gunslinger", "Gunslinger"],
]);

const REGIONS = text([
  ["backstreets", "Backstreets"],
  ["black-docks", "Black Docks"],
  ["inner-sanctum", "Inner Sanctum"],
]);

const BOARDS = text([
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
]);

/** Closed lists only. Free ids, names, and amounts stay typed. */
export const COMMAND_CHOICES: Record<string, readonly CommandChoice[]> = {
  "accounts.link.provider": PROVIDERS,
  "accounts.privacy.provider": PROVIDERS,
  "accounts.unlink.provider": PROVIDERS,
  "accounts.privacy.visibility": VISIBILITY,
  "invites.attribution.confidence": text([
    ["known", "Known recruit"],
    ["unknown", "Unknown"],
    ["vanity", "Vanity link"],
    ["ambiguous", "Ambiguous"],
  ]),
  "birthday.set.month": MONTHS,
  "mod.sanctions.action": text([
    ["warn", "Warn"],
    ["timeout", "Timeout"],
    ["kick", "Kick"],
    ["ban", "Ban"],
    ["note", "Note only"],
  ]),
  "economy.adjust.action": text([
    ["add", "Add Marks"],
    ["remove", "Take Marks"],
    ["set", "Set the balance"],
    ["bulk", "Staff batch grant"],
  ]),
  "market.quote.side": text([
    ["buy", "Buy Ingots"],
    ["sell", "Sell Ingots"],
  ]),
  "leaderboard.rankings.category": text([
    ["community_xp", "Community XP"],
    ["marks", "Marks"],
    ["ingots", "Ingots"],
    ["seasonal_seals", "Seasonal seals"],
    ["lifetime_seals", "Lifetime seals"],
    ["pvp", "PvP"],
    ["contracts", "Contracts"],
    ["recruitment", "Recruitment"],
    ["estimated_wealth", "Estimated wealth"],
  ]),
  "leaderboard.archive.category": text([
    ["community_xp", "Community XP"],
    ["marks", "Marks"],
    ["ingots", "Ingots"],
    ["seasonal_seals", "Seasonal seals"],
    ["lifetime_seals", "Lifetime seals"],
    ["pvp", "PvP"],
    ["contracts", "Contracts"],
    ["recruitment", "Recruitment"],
    ["estimated_wealth", "Estimated wealth"],
  ]),
  "events.manage.action": text([
    ["create", "Create"],
    ["edit", "Edit"],
    ["cancel", "Cancel"],
    ["transfer", "Transfer host"],
    ["checkin", "Check in"],
    ["attendance", "Attendance"],
    ["recap", "Write the recap"],
  ]),
  "events.manage.scope": text([
    ["occurrence", "This occurrence"],
    ["series", "The whole series"],
  ]),
  "events.rsvp.response": text([
    ["yes", "Yes"],
    ["maybe", "Maybe"],
    ["no", "No"],
  ]),
  "schedule.control.action": text([
    ["link-room", "Link a room"],
    ["link-announcement", "Link an announcement"],
  ]),
  "crew.persistent.action": text([
    ["create", "Found a crew"],
    ["officer", "Appoint an officer"],
    ["transfer", "Transfer the crew"],
    ["disband", "Disband"],
    ["mission", "Open a mission"],
  ]),
  "crew.session.action": text([
    ["create", "Open a session"],
    ["join", "Join"],
    ["approve", "Approve a member"],
    ["ready", "Mark ready"],
    ["attend", "Record attendance"],
    ["room", "Request a room"],
  ]),
  "crew.session.mode": text([
    ["open", "Open join"],
    ["approval", "Approval required"],
  ]),
  "crew.lfg.action": text([
    ["list", "List open sessions"],
    ["join", "Join one"],
  ]),
  "prediction.free.action": text([
    ["create", "Open"],
    ["view", "View"],
    ["enter", "Enter"],
    ["confirm", "Confirm"],
    ["lock", "Lock"],
    ["resolve", "Resolve"],
    ["cancel", "Cancel"],
  ]),
  "prediction.staked.action": text([
    ["create", "Open"],
    ["view", "View"],
    ["enter", "Stake"],
    ["confirm", "Confirm"],
    ["resolve", "Resolve"],
    ["cancel", "Cancel and refund"],
    ["reverse", "Reverse"],
  ]),
  "contest.submit.media": text([
    ["text", "Text"],
    ["image", "Image"],
    ["video", "Video"],
    ["audio", "Audio"],
    ["link", "Link"],
  ]),
  "contest.judge.action": text([
    ["create", "Create"],
    ["publish", "Publish"],
    ["close", "Close"],
    ["correct", "Correct"],
    ["award", "Award"],
  ]),
  "contest.judge.mode": text([
    ["vote", "Member vote"],
    ["judge", "Staff judging"],
  ]),
  "giveaway.draw.action": text([
    ["create", "Create"],
    ["close", "Close entries"],
    ["draw", "Draw"],
    ["claim", "Claim"],
    ["disqualify", "Disqualify"],
    ["reroll", "Reroll"],
    ["cancel", "Cancel"],
  ]),
  "lottery.tickets.action": text([
    ["quote", "Price the tickets"],
    ["buy", "Buy the quote"],
  ]),
  "contracts.board.cycle": BOARDS,
  "contracts.settings.delivery": text([
    ["dm", "Direct message"],
    ["channel", "Channel"],
  ]),
  "contracts.custom.action": text([
    ["create", "Create"],
    ["edit", "Edit"],
    ["assign", "Assign"],
    ["submit", "Submit"],
    ["approve", "Approve"],
    ["reject", "Reject"],
  ]),
  "contracts.custom.kind": text([
    ["chat_messages", "Chat messages"],
    ["voice_minutes", "Voice minutes"],
    ["event_attendance", "Event attendance"],
    ["crew_session", "Crew session"],
    ["riddle", "Riddle"],
    ["manual", "Manual review"],
    ["rpg_exploration", "Exploration"],
    ["rpg_pve", "Defeat an enemy"],
    ["rpg_crafting", "Crafting"],
    ["rpg_pvp", "Ranked fight"],
  ]),
  "contracts.custom.policy": text([
    ["preserve", "Keep current progress"],
    ["migrate", "Move progress over"],
  ]),
  "contracts.custom.board": BOARDS,
  "combat.queue.action": text([
    ["join", "Join the queue"],
    ["leave", "Leave the queue"],
    ["accept", "Accept the match"],
  ]),
  "combat.queue.mode": text([
    ["casual", "Casual"],
    ["ranked", "Ranked"],
  ]),
  "combat.challenge.action": text([
    ["offer", "Offer a duel"],
    ["accept", "Accept"],
    ["cancel", "Cancel"],
  ]),
  "combat.challenge.mode": text([
    ["casual", "Casual"],
    ["ranked", "Ranked"],
  ]),
  "combat.challenge.style": text([
    ["quick", "Quick"],
    ["tactical", "Tactical"],
  ]),
  "combat.action.mode": text([
    ["quick", "Quick"],
    ["tactical", "Tactical"],
  ]),
  "combat.action.opponent": text([
    ["training-dummy", "Training Dummy"],
    ["range-marker", "Range Marker"],
  ]),
  "combat.action.move": text([
    ["strike", "Strike"],
    ["defend", "Defend"],
    ["ability", "Ability"],
    ["item", "Item"],
  ]),
  "character.class.class": CLASSES,
  "character.respec.class": CLASSES,
  "character.stats.stat": text([
    ["strength", "Strength"],
    ["agility", "Agility"],
    ["endurance", "Endurance"],
    ["focus", "Focus"],
  ]),
  "character.respec.action": text([
    ["respec", "Reset stats"],
    ["class", "Change class"],
    ["intro", "Introductory reset"],
  ]),
  "character.loadout.slot": [
    { name: "Slot 1", value: 1 },
    { name: "Slot 2", value: 2 },
    { name: "Slot 3", value: 3 },
    { name: "Slot 4", value: 4 },
  ],
  "explore.expedition.action": text([
    ["preview", "Preview"],
    ["start", "Start"],
    ["report", "Read the report"],
  ]),
  "explore.expedition.region": REGIONS,
  "explore.expedition.difficulty": text([
    ["routine", "Routine"],
    ["standard", "Standard"],
    ["severe", "Severe"],
  ]),
  "explore.mission.action": text([
    ["preview", "Preview"],
    ["start", "Start"],
    ["choose", "Choose a branch"],
    ["check", "Check progress"],
    ["fight", "Fight"],
  ]),
  "explore.mission.region": text([
    ["backstreets", "Backstreets"],
    ["black-docks", "Black Docks"],
  ]),
  "inventory.gear.action": text([
    ["list", "List gear"],
    ["equip", "Equip"],
    ["unequip", "Unequip"],
  ]),
  "inventory.crates.action": text([
    ["list", "List crates"],
    ["preview", "Preview"],
    ["open", "Open"],
  ]),
  "inventory.trade.action": text([
    ["offer", "Offer a trade"],
    ["inspect", "Inspect"],
    ["confirm", "Confirm"],
    ["edit", "Edit"],
    ["cancel", "Cancel"],
  ]),
  "inventory.craft.action": text([
    ["list", "List recipes"],
    ["preview", "Preview"],
    ["make", "Craft"],
  ]),
  "inventory.salvage.action": text([
    ["preview", "Preview salvage"],
    ["confirm", "Confirm salvage"],
  ]),
  "inventory.upgrade.action": text([
    ["preview", "Preview the upgrade"],
    ["apply", "Apply the upgrade"],
  ]),
  "inventory.reroll.action": text([
    ["preview", "Preview the reroll"],
    ["apply", "Replace the affix"],
  ]),
  "profile.privacy.visibility": VISIBILITY,
  "shop.supply.action": text([
    ["browse", "Browse the shop"],
    ["buy", "Buy"],
  ]),
  "shop.ingot.action": text([
    ["browse", "Browse"],
    ["buy", "Buy"],
    ["reveal", "Reveal"],
    ["refund", "Refund"],
  ]),
  "shop.marketplace.action": text([
    ["browse", "Browse listings"],
    ["list", "List gear"],
    ["buy", "Buy a listing"],
    ["cancel", "Cancel a listing"],
  ]),
  "blackjack.solo.action": text([
    ["quote", "Price the hand"],
    ["open", "Open the hand"],
    ["hit", "Hit"],
    ["stand", "Stand"],
    ["double", "Double"],
    ["split", "Split"],
  ]),
  "blackjack.social.action": text([
    ["quote", "Price the seat"],
    ["open", "Open the table"],
    ["join", "Join"],
    ["hit", "Hit"],
    ["stand", "Stand"],
    ["double", "Double"],
    ["split", "Split"],
  ]),
  "deaddrop.pick.action": text([
    ["quote", "Price the cell"],
    ["buy", "Buy the cell"],
  ]),
  "deaddrop.special.action": text([
    ["set", "Set a special board"],
    ["activate", "Activate a charge"],
  ]),
  "deaddrop.special.kind": text([
    ["collapse", "Market Collapse"],
    ["gear", "Gear"],
    ["crate", "Crate"],
    ["clue", "Clue"],
    ["clear", "Clear"],
  ]),
  "support.tickets.action": text([
    ["open", "Open"],
    ["list", "List"],
    ["close", "Close"],
    ["reopen", "Reopen"],
    ["claim", "Claim"],
    ["transfer", "Transfer"],
    ["note", "Add a note"],
    ["transcript", "Transcript"],
    ["link", "Link a record"],
  ]),
  "support.tickets.kind": text([
    ["moderation_case", "Moderation case"],
    ["purchase", "Purchase"],
    ["reward", "Reward"],
  ]),
  "support.rooms.action": text([
    ["create", "Create"],
    ["join", "Join"],
    ["leave", "Leave"],
    ["close", "Close"],
    ["claim", "Claim"],
    ["transfer", "Transfer"],
    ["hold", "Hold"],
  ]),
  "support.rooms.kind": text([
    ["voice", "Voice"],
    ["text", "Text"],
  ]),
  "community.polls.action": text([
    ["create", "Create"],
    ["vote", "Vote"],
    ["results", "Results"],
    ["close", "Close"],
  ]),
  "community.polls.kind": text([
    ["single", "One choice"],
    ["multiple", "Several choices"],
    ["suggestion", "Suggestion"],
  ]),
};

export function commandChoices(parent: string, subcommand: string, option: string): readonly CommandChoice[] | undefined {
  return COMMAND_CHOICES[`${parent}.${subcommand}.${option}`];
}
