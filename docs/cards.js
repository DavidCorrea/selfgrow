/**
 * The cards selfgrow knows about, the hand a new player is dealt, and the
 * opponents a match can be fought against, each with the deck it brings.
 *
 * Everything here is plain data defined in the product — no card is fetched, and
 * no stat is computed from another. A card is identified by its `id`, and that is
 * the only field a saved collection stores; every display field is looked up from
 * here, so renaming a card never loses the copies a player owns of it.
 */

/**
 * The when-played abilities a card can carry, in the words printed on its face.
 * Each is written once here so the text on the card, the trigger in the match
 * and the text a tool reports can never drift apart.
 *
 * `DRAW_ON_PLAY` takes the top card of its owner's deck into that hand as the
 * card lands. `HEAL_ON_PLAY` mends its owner's hero instead — the other half of
 * what a card can do as it lands, and a slow deck's answer to an early rush.
 * `STRIKE_ON_PLAY` answers the board itself: the card hits the front card of the
 * opponent's table, or the opponent's hero once that table is empty, on the same
 * targeting the rest of the game uses when a turn ends. `CLEAR_ON_PLAY` sweeps
 * the whole opposing table instead of its front: every card there loses the same
 * small amount at once, so a card answers a table that has out-numbered it.
 */
export const DRAW_ON_PLAY = "When played: draw a card";

/** How much health a card that heals its owner's hero when played restores. */
export const HEAL_ON_PLAY_AMOUNT = 2;

/**
 * The ability a card carries when it mends its owner's hero as it lands. The
 * amount is written into the words on the face from the same constant the match
 * heals by, so the card can never promise a number the trigger does not pay.
 */
export const HEAL_ON_PLAY = `When played: heal your hero ${HEAL_ON_PLAY_AMOUNT}`;

/** How much damage a card that strikes as it lands deals to the opponent's front
 * card, or to the opponent's hero once their table is empty. */
export const STRIKE_ON_PLAY_AMOUNT = 1;

/**
 * The ability a card carries when it strikes the board as it lands. The amount is
 * written into the words on the face from the same constant the match damages by,
 * so the card can never promise a number the trigger does not deal.
 */
export const STRIKE_ON_PLAY = `When played: deal ${STRIKE_ON_PLAY_AMOUNT} damage to the opponent's front card`;

/** How much damage a card that sweeps the opponent's table as it lands deals to
 * every card on that table at once. */
export const CLEAR_ON_PLAY_AMOUNT = 1;

/**
 * The ability a card carries when it sweeps the opponent's table as it lands.
 * The amount is written into the words on the face from the same constant the
 * match damages by, so the card can never promise a number the trigger does not
 * deal to each card it touches.
 */
export const CLEAR_ON_PLAY = `When played: deal ${CLEAR_ON_PLAY_AMOUNT} damage to each card on the opponent's table`;

/**
 * The ability a card carries when it draws its owner a card the moment it leaves
 * the table. It is the first ability that answers what happens to a card after it
 * lands rather than only when it is played — so taking a card off the table can
 * cost the side that removed it something, and removing a card becomes a choice
 * rather than always a gain.
 *
 * It lives in a `fallAbility` field of its own rather than overloading `ability`,
 * so the when-played text keeps its exact meaning and a card may carry both
 * abilities at once.
 */
export const DRAW_ON_FALL = "When this falls: draw a card";

/**
 * Whether a card's face draws you a card — whether it draws as it is played or
 * as it falls. One shared predicate over the two draw abilities, so the
 * Collection screen's "draws" view and any count of a deck's drawing cards can
 * never disagree.
 */
export function drawsACard(card) {
  return card.ability === DRAW_ON_PLAY || card.fallAbility === DRAW_ON_FALL;
}

/**
 * How much health a card that mends its owner's hero as it falls restores. It is
 * the same amount the when-played heal restores, so one number names the mend
 * however a card pays it back.
 */
export const HEAL_ON_FALL_AMOUNT = HEAL_ON_PLAY_AMOUNT;

/**
 * The ability a card carries when it mends its owner's hero the moment it leaves
 * the table. Where the when-played heal rewards playing a card, this one rewards
 * losing it on purpose: a body a player expects to trade pays health back as it
 * goes, so removing it is a cost rather than only a gain. The amount is written
 * into the words on the face from the same constant the match heals by, so the
 * card can never promise a number the trigger does not pay.
 *
 * Like the draw it shares the `fallAbility` field with, it fires from the one
 * removal point every blow reaches, so a card that falls to a chosen attack, a
 * turn's blows or a sweeping card mends its owner the same way.
 */
export const HEAL_ON_FALL = `When this falls: heal your hero ${HEAL_ON_FALL_AMOUNT}`;

/**
 * The ability a card carries when it hits back as it leaves the table: the damage
 * it deals to the front card of the opponent's table, or to that side's hero once
 * its table is empty. It is the same amount the when-played strike deals, so one
 * number names the blow however a card lands it.
 *
 * Where the other fall abilities pay their owner back, this one makes removing a
 * card cost the side that removed it: a sweeping card cannot wipe a table for
 * free, and a player has a reason to leave a body standing rather than trade it
 * away. The blow runs through the same targeting and the same log lines as a
 * blow at the end of a turn, so a card killed by it leaves the table on the same
 * line as one killed any other way.
 */
export const STRIKE_ON_FALL = `When this falls: deal ${STRIKE_ON_PLAY_AMOUNT} damage to the opponent's front card`;

/** How much attack a card that grows gains at the start of each of its owner's
 * turns while it remains on that table. */
export const GROWTH_ABILITY_AMOUNT = 1;

/**
 * The ability a card carries when it rewards staying on the table. It is the
 * first ability that answers how long a card lasts rather than what it does the
 * moment it lands or leaves: a card whose face says it grows gains attack at the
 * start of each of its owner's turns while it is still on that table, so a cheap
 * card left standing becomes a threat the other side must answer, and holding a
 * card back becomes a real decision. The grown attack is what the card strikes
 * with, so the reward compounds.
 *
 * It lives in a `growthAbility` field of its own rather than overloading
 * `ability` or `fallAbility`, so a card may carry it alongside either. The amount
 * is written into the words on the face from the same constant the match grows
 * by, so the card can never promise a number the trigger does not pay.
 */
export const GROWTH_ABILITY = `Grows: +${GROWTH_ABILITY_AMOUNT} attack at the start of each of your turns`;

/** Every card in the game: id, name, cost to play, attack, health, the ability
 * printed on its face for when it is played, the ability it carries for growing
 * while it stays on the table, and the ability it carries for when it falls
 * (each absent on a card with none). */
export const CARDS = [
  // A seedling and a water spirit: the two living things that read as mending
  // what they touch, so each carries the heal ability below. Sprout is dealt at
  // the start and Dewdrop Nymph is a reward, so the ability is met early and
  // then collected for, as the draw ability is.
  { id: "sprout", name: "Sprout", cost: 1, attack: 1, health: 1, ability: HEAL_ON_PLAY },
  { id: "pebble-toad", name: "Pebble Toad", cost: 1, attack: 1, health: 2 },
  { id: "thornling", name: "Thornling", cost: 2, attack: 2, health: 1 },
  { id: "sun-moth", name: "Sun Moth", cost: 2, attack: 1, health: 3 },
  { id: "bramble-hound", name: "Bramble Hound", cost: 2, attack: 3, health: 1 },
  { id: "glowcap", name: "Glowcap", cost: 3, attack: 2, health: 4, ability: DRAW_ON_PLAY },
  { id: "mudback-turtle", name: "Mudback Turtle", cost: 3, attack: 1, health: 5 },
  { id: "vine-lasher", name: "Vine Lasher", cost: 3, attack: 3, health: 2 },
  { id: "storm-crow", name: "Storm Crow", cost: 4, attack: 4, health: 2 },
  { id: "emberling", name: "Emberling", cost: 4, attack: 3, health: 3 },
  { id: "root-colossus", name: "Root Colossus", cost: 5, attack: 5, health: 6 },
  { id: "elder-oak", name: "Elder Oak", cost: 6, attack: 4, health: 9 },
  // The reward cards, earned by winning rather than dealt at the start. They are
  // real cards — playable, and saved like any other — so a win grows what a
  // player can put in a deck. Moon Bloom, first in the reward pool, is also one
  // of the two cards that draw a card when played, so the ability is met in the
  // starter deck and then hunted for in the reward pool.
  { id: "moon-bloom", name: "Moon Bloom", cost: 2, attack: 2, health: 3, ability: DRAW_ON_PLAY },
  { id: "amber-antler", name: "Amber Antler", cost: 4, attack: 4, health: 3 },
  // Two reward cards read as the aggressive ones — a hooked-beak bird with a
  // fiery tip and a crested drake — so each carries the strike ability, the one
  // that answers what is already on the board rather than only adding to it.
  { id: "cinder-shrike", name: "Cinder Shrike", cost: 3, attack: 4, health: 1, ability: STRIKE_ON_PLAY },
  { id: "dewdrop-nymph", name: "Dewdrop Nymph", cost: 1, attack: 1, health: 3, ability: HEAL_ON_PLAY },
  { id: "twilight-fox", name: "Twilight Fox", cost: 3, attack: 2, health: 2 },
  { id: "bark-sentinel", name: "Bark Sentinel", cost: 5, attack: 3, health: 8 },
  // Six more reward cards, spread across the cost curve so a collection keeps
  // handing back something new at every size of deck.
  { id: "moss-glider", name: "Moss Glider", cost: 1, attack: 2, health: 1 },
  { id: "fern-drake", name: "Fern Drake", cost: 2, attack: 2, health: 2, ability: STRIKE_ON_PLAY },
  { id: "boulder-ram", name: "Boulder Ram", cost: 3, attack: 3, health: 2 },
  { id: "hollow-wisp", name: "Hollow Wisp", cost: 4, attack: 2, health: 5 },
  { id: "granite-warden", name: "Granite Warden", cost: 5, attack: 4, health: 6 },
  { id: "ironbark-titan", name: "Ironbark Titan", cost: 6, attack: 6, health: 7 },
  // One reward card reads as a sweeping gale rather than a single strike — a
  // thorned gust that crosses the whole opposing table — so it carries the clear
  // ability, the one that answers a table of cheap cards at once rather than one
  // card at a time.
  { id: "thorn-gale", name: "Thorn Gale", cost: 5, attack: 3, health: 4, ability: CLEAR_ON_PLAY },
  // Two more sweeping cards, spread across the cost curve so the clear ability
  // is a tool a deck can be built around rather than a single lucky reward: a
  // cheap body a player can hold for the early turns, and a heavy one for a deck
  // that has survived into the late game. Both read as gusts that cross a whole
  // table and both print the clear ability in the same words as Thorn Gale.
  { id: "gustling", name: "Gustling", cost: 3, attack: 2, health: 2, ability: CLEAR_ON_PLAY },
  { id: "storm-roc", name: "Storm Roc", cost: 6, attack: 5, health: 6, ability: CLEAR_ON_PLAY },
  // The first card that carries a fall ability: a cheap seed pod that bursts when
  // it is crushed, so the moment it leaves the table it hands its owner a card.
  // Its `fallAbility` is a field of its own, so the text it prints for being
  // played — none — is unchanged, and taking it off the board costs the side that
  // removed it a card instead of only a body. It is a reward card, so a player
  // meets the ability by collecting toward it and can then build a deck around it.
  { id: "seed-pod", name: "Seed Pod", cost: 1, attack: 1, health: 1, fallAbility: DRAW_ON_FALL },
  // The second card that carries a fall ability, and the first that mends: a
  // root crown a slow deck can hold back, expected to trade, so losing it pays
  // health back to the hero rather than only taking a body. Its `fallAbility` is
  // the same field the pod uses, so the fall abilities never overload the
  // when-played text and a card may still carry a when-played ability as well.
  { id: "comfrey-root", name: "Comfrey Root", cost: 2, attack: 1, health: 3, fallAbility: HEAL_ON_FALL },
  // The third card that carries a fall ability, and the first that hits back: a
  // thorned whip that lashes out as it is cut down, so it deals its damage to the
  // opponent's front card the moment it leaves the table. With sweeping cards in
  // the game, wiping a table would otherwise be a free move; a body that answers
  // its own removal makes clearing a board cost something, and gives a player a
  // reason to leave one standing. It is a reward card, like the other two, so the
  // ability is met by collecting toward it and can then be built around.
  { id: "whipthorn", name: "Whipthorn", cost: 2, attack: 2, health: 2, fallAbility: STRIKE_ON_FALL },
  // Two fall cards higher on the cost curve, so a deck built around trading cards
  // away has something to spend a late turn on rather than only an early trick.
  // Lantern Bough is the first fall card that is not cheap: a lit bough whose
  // lantern hands its owner a card as the branch is cut down, on a body big
  // enough to be played on turn four. It carries the draw the Seed Pod carries
  // and no when-played ability, so the card does one thing and does it as it goes.
  { id: "lantern-bough", name: "Lantern Bough", cost: 4, attack: 3, health: 4, fallAbility: DRAW_ON_FALL },
  // Thornback Behemoth is the heavy end of the same idea: a thorn-ridged beast
  // that strikes the opponent's front card as it falls. It is the biggest card
  // that answers its own removal, so clearing it is a real cost in the late
  // game instead of a free sweep, and a fall deck has a threat worth building to.
  { id: "thornback-behemoth", name: "Thornback Behemoth", cost: 6, attack: 7, health: 6, fallAbility: STRIKE_ON_FALL },
  // The first card that acts twice: it strikes the opponent's front card as it
  // lands, and hands its owner a card back as it leaves the table. Every ability
  // printed on a face has been carried by some card since it was written, but
  // never two on one card — so this is the card that shows the range a card can
  // have. A player who plays it pays for a body that answers the board at once,
  // and a player who builds around it gets a card back when it is killed, so the
  // turn it dies is not a turn wasted. Its two abilities are the shared constants
  // rather than copies of their words, so its face can never drift from the
  // trigger the match runs. It is a reward card, so both halves are collected for.
  {
    id: "sunspear-bloom",
    name: "Sunspear Bloom",
    cost: 4,
    attack: 3,
    health: 4,
    ability: STRIKE_ON_PLAY,
    fallAbility: DRAW_ON_FALL,
  },
  // The first card that rewards staying on the table rather than only arriving
  // or leaving: a cheap climbing vine that grows an attack for every turn it
  // survives, so a small body left standing becomes a threat the other side must
  // answer and holding a card back becomes a real decision. Its growth lives in
  // the `growthAbility` field of its own, so the card prints no when-played and
  // no fall text and its one line is about the reward it pays for patience. It
  // is a reward card, cheap enough to play on the opening turn, so a player meets
  // the ability by collecting toward it and can then build a deck around it.
  { id: "climbing-ivy", name: "Climbing Ivy", cost: 1, attack: 1, health: 2, growthAbility: GROWTH_ABILITY },
  // Three more cards that grow, spread across the cost curve so the ability is
  // an archetype a deck can be built around rather than one lucky card: a cheap
  // sapling to commit to on the opening turn, a mid-cost treant to hold the
  // middle, and a heavy ancient to finish a long game. Each carries the same
  // growth words and no other ability, so the grow ability is what the card is
  // for, and each is a reward card so a win at any deck size can pay one out.
  { id: "budding-sapling", name: "Budding Sapling", cost: 2, attack: 2, health: 2, growthAbility: GROWTH_ABILITY },
  { id: "sunroot-treant", name: "Sunroot Treant", cost: 4, attack: 3, health: 5, growthAbility: GROWTH_ABILITY },
  { id: "worldroot-ancient", name: "Worldroot Ancient", cost: 6, attack: 6, health: 7, growthAbility: GROWTH_ABILITY },
  // Three more cards that mend as they land, spread across the cost curve so a
  // player who wants to build a deck around staying alive has a plan at every
  // point in a match rather than only a cheap opening. Every mending card the
  // game already had costs one or two; these are the first at three, four and
  // six, so a slow deck can keep collecting a bigger body to hold the board and
  // mend its hero at once. Each carries the same HEAL_ON_PLAY words as every
  // other mender, so the amount on the face and the amount the trigger pays can
  // never drift apart, and each is a reward card so a win is how one is earned.
  { id: "dewglass-moth", name: "Dewglass Moth", cost: 3, attack: 2, health: 4, ability: HEAL_ON_PLAY },
  { id: "mossheart-chalice", name: "Mossheart Chalice", cost: 4, attack: 3, health: 5, ability: HEAL_ON_PLAY },
  { id: "elderheart-willow", name: "Elderheart Willow", cost: 6, attack: 5, health: 8, ability: HEAL_ON_PLAY },
  // Three cards that each act twice, spread across the cost curve so a deck can
  // be built around a card doing two things at once rather than only one. Every
  // other card in the game acts at exactly one moment; these print two of the
  // ability constants already in the set on one face, so the trigger the match
  // runs and the words the card reads can never drift from the shared ones.
  //
  // The cheap one draws as it lands and mends its owner's hero as it falls: a
  // body worth playing early that pays its owner back a card when it is played
  // and a little health when it is traded away, the two halves of a small card
  // answered whichever way the other side deals with it.
  { id: "mire-spore", name: "Mire Spore", cost: 1, attack: 1, health: 1, ability: DRAW_ON_PLAY, fallAbility: HEAL_ON_FALL },
  // The mid-cost one mends its owner's hero as it lands and grows each turn it
  // stays: a wall that arrives with a heal and becomes a threat the longer it is
  // left standing, so committing to the middle of the curve both holds and grows.
  { id: "heartwood-sapling", name: "Heartwood Sapling", cost: 3, attack: 2, health: 4, ability: HEAL_ON_PLAY, growthAbility: GROWTH_ABILITY },
  // The heavy one strikes the board as it lands and strikes again as it falls: a
  // late-game body that answers the front card on the turn it is played and
  // costs the other side another body the moment it is removed, so clearing it is
  // never a free move.
  { id: "spearroot-colossus", name: "Spearroot Colossus", cost: 6, attack: 6, health: 7, ability: STRIKE_ON_PLAY, fallAbility: STRIKE_ON_FALL },
  // One more card that draws as it lands, placed where the set was thinnest —
  // cost five, which held no drawer at all — so drawing is met on the middle of
  // the curve as well as the cheap end. A standing bough whose bark peels away a
  // sheet at a time reads as a card that keeps handing its owner more, the mark
  // of a character built around drawing rather than a single lucky trick. Its
  // ability is the shared DRAW_ON_PLAY constant, so the words on its face and the
  // trigger the match runs can never drift. It is a reward card, so a player
  // collects toward it and a win is how it is earned.
  { id: "scrollbark", name: "Scrollbark", cost: 5, attack: 4, health: 5, ability: DRAW_ON_PLAY },
  // The cheap end of the sweeping curve. Every clearing card before this one
  // costs three, five or six, so a player who wants an answer to a wide board
  // has nothing to play until the third turn and only meets the ability in the
  // late game. This one fills that gap at cost two, and its attack and health
  // are deliberately modest so the price is paid for the sweep rather than the
  // body. It carries the shared CLEAR_ON_PLAY constant, so its face and the
  // trigger the match runs can never drift from the other sweepers, and it is a
  // reward card like them, so a win is how a player earns it.
  { id: "breeze-wisp", name: "Breeze Wisp", cost: 2, attack: 1, health: 2, ability: CLEAR_ON_PLAY },
  // The two ends of the striking curve. Every striking card before these costs
  // two, three, four or six, so a player who wants to build a deck around hitting
  // the board as it lands has nothing to open the first turn with and nothing big
  // enough to close a late game with. These two fill both ends: a small biting
  // creature to spend an opening turn on, and a heavy antlered beast to commit a
  // late one to. Each carries the shared STRIKE_ON_PLAY constant and no other
  // ability, so the words on its face and the trigger the match runs can never
  // disagree, and each is a reward card like the strikers already in the set, so
  // a win is how one is earned.
  { id: "nibblefang-vole", name: "Nibblefang Vole", cost: 1, attack: 1, health: 1, ability: STRIKE_ON_PLAY },
  { id: "thorncrown-stag", name: "Thorncrown Stag", cost: 5, attack: 5, health: 5, ability: STRIKE_ON_PLAY },
];

/** Lookup by id — the shape the saved collection speaks in. */
export const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

/**
 * The rules a deck is built to: no more than ten cards may be chosen, and a
 * match needs at least five before it is worth starting. Both are stated in the
 * UI beside the deck, and both are what the page enforces rather than merely
 * printing.
 */
export const DECK_LIMIT = 10;
export const MINIMUM_DECK_SIZE = 5;

/**
 * What a new player owns the first time they open the game: twelve different
 * cards, with a few of the cheap ones held in more than one copy.
 */
export const STARTER_COLLECTION = [
  // A reward card is deliberately absent here: winning is the only way to own
  // one, which is what makes a match worth playing again.

  { id: "sprout", copies: 3 },
  { id: "pebble-toad", copies: 2 },
  { id: "bramble-hound", copies: 2 },
  { id: "thornling", copies: 1 },
  { id: "sun-moth", copies: 1 },
  { id: "glowcap", copies: 1 },
  { id: "mudback-turtle", copies: 1 },
  { id: "vine-lasher", copies: 1 },
  { id: "storm-crow", copies: 1 },
  { id: "emberling", copies: 1 },
  { id: "root-colossus", copies: 1 },
  { id: "elder-oak", copies: 1 },
];

/**
 * The cards a win can add, and the order they are preferred in once an
 * opponent's signature card is not the one being earned. A win earns the first
 * one the player does not hold yet, so the order is the order the pool is
 * exhausted in. Every opponent's signature is also a card in this pool, so
 * whichever reward a win earns, it comes from here. None of them is in the
 * starter collection, so the first wins are always cards the player did not
 * already have. Once every one of them is held, a win falls back to walking this
 * list by how many matches have been won — a duplicate.
 */
export const REWARD_POOL = [
  "moon-bloom",
  "amber-antler",
  "cinder-shrike",
  "dewdrop-nymph",
  "twilight-fox",
  "bark-sentinel",
  "moss-glider",
  "fern-drake",
  "boulder-ram",
  "hollow-wisp",
  "granite-warden",
  "ironbark-titan",
  "thorn-gale",
  "gustling",
  "storm-roc",
  // Appended rather than slotted in, so a save written before the pod existed
  // keeps the same next-reward order it already had.
  "seed-pod",
  "comfrey-root",
  // Appended for the same reason: a save written before the whip existed keeps
  // the next-reward order it already had.
  "whipthorn",
  // Appended again, so a save written before these two existed keeps its next
  // reward and its place in the queue untouched.
  "lantern-bough",
  "thornback-behemoth",
  // Appended for the same reason as every reward before it: a save written
  // before the bloom existed keeps the next-reward order it already had.
  "sunspear-bloom",
  // Appended again, so a save written before the ivy existed keeps its next
  // reward and its place in the queue untouched.
  "climbing-ivy",
  // The three growth cards are appended for the same reason: a save written
  // before they existed keeps the next-reward order and the place it already
  // had in the queue.
  "budding-sapling",
  "sunroot-treant",
  "worldroot-ancient",
  // The three mending cards are appended for the same reason as every reward
  // before them: a save written before they existed keeps the next-reward order
  // and the place it already had in the queue untouched. Mossheart Chalice is
  // the signature a future mending opponent will award, but it needs nothing
  // here beyond pool membership: a first win already resolves the signature from
  // the opponent's own field, so any pool card can be earned that way.
  "dewglass-moth",
  "mossheart-chalice",
  "elderheart-willow",
  // The three cards that each act twice are appended for the same reason as
  // every reward before them: a save written before they existed keeps the
  // next-reward order and the place it already had in the queue untouched. Each
  // is a reward card, so a win is how one is earned and a deck can be built
  // around a card that does two things at once.
  "mire-spore",
  "heartwood-sapling",
  "spearroot-colossus",
  // Appended for the same reason as every reward before it: a save written
  // before the bough existed keeps the next-reward order and the place it already
  // had in the queue untouched. It is the signature a future drawing opponent
  // will award, and a mid-curve body, so a player collecting toward it meets
  // drawing as something worth building a deck and an opponent around.
  "scrollbark",
  // Appended for the same reason as every reward before it: a save written
  // before the wisp existed keeps the next-reward order and the place it already
  // had in the queue untouched. It is the cheap sweeping card, so a player who
  // wants to build around clearing a wide board early collects toward it.
  "breeze-wisp",
  // Appended again, so a save written before these two existed keeps its next
  // reward and its place in the queue untouched. They are the cheap and the heavy
  // ends of the striking curve, so a deck built around striking the board as it
  // lands has a card to open with and one to close with, and each is earned by a
  // win like every reward before it.
  "nibblefang-vole",
  "thorncrown-stag",
];

/**
 * The opponents a player can face: characters, each with a look and a deck of
 * their own.
 *
 * Every deck is fixed — the same ten cards in every match against that
 * character — and drawn from the same catalog a player's deck is, so every card
 * an opponent draws and plays is a real card the player can own. None of them is
 * the player's own deck: what you choose for your deck is what you are up
 * against, instead of a race against a copy of yourself. Facing a different
 * character is what changes the game from one puzzle into a choice.
 *
 * `accent` names a colour token from styles.css rather than a colour, so the one
 * place a colour is written stays the stylesheet, and the opponent's portrait in
 * docs/cardart.js is painted in it. `cardPreference` is how the opponent
 * spends its turn, drawn from the kind of match its `description` promises:
 *
 * - `"dearest"` plays the biggest body it can afford;
 * - `"cheapest"` plays its smallest cards first so its table fills with several
 *   at once;
 * - `"hold-sweep"` holds a sweeping card back while the player's table holds a
 *   single card, and plays one the moment it holds two or more;
 * - `"mend-when-hurt"` mends its hero once it is below the health it started the
 *   match with, and plays its dearest body while it is unharmed;
 * - `"prefer-twice"` plays dearest, preferring a card that carries more than one
 *   ability when two cards cost the same;
 * - `"prefer-strike"` plays cheapest, preferring a card that strikes the board as
 *   it lands when two cards cost the same.
 *
 * The choice stays deterministic — the same hand and energy always pick the same
 * card — so what an opponent does can be read off the character it is.
 *
 * Each deck also brings a card that does something as it lands, chosen to suit
 * that same promise — the slow, wearing character mends, scythes the player's
 * whole table at once and strikes back as one of its bodies falls, the fast ones
 * strike — so a player meets the ability inside a match and learns to watch for
 * it on the opponent's turn. One deck trades bodies on purpose and is
 * built around what a card does as it falls, the half of a card's behaviour no
 * other opponent centres on, so the fourth character is a lesson of its own. The
 * fifth is built around the one ability none of the others teach: a deck of
 * cards that grow stronger each turn they stand, so a player meets the reward
 * for patience as something to beat rather than only as a card to collect. The
 * sixth is built around mending itself: slow, high-health bodies that mend their
 * hero as they land and as they fall, so a player meets healing not as a line on
 * one card but as a match that has to be closed out before it outlasts them. The
 * seventh is built around cards that act twice: a deck whose bodies answer the
 * board as they land and pay their owner back as they fall, or mend and grow at
 * once, so a player meets "a card can be two things" as something to beat rather
 * than only as a card to collect. The eighth is built around drawing itself: a
 * deck where most cards hand their owner another card, so its hand keeps
 * refilling and the answer is to close the match before its cards outlast the
 * player — the one ability a card's face can carry that was a card to collect
 * before it was ever a board to beat. The ninth is built around sweeping the
 * opponent's table: a deck of cards that deal damage to every card the other
 * side has out at once, so a player who fills the table with small bodies is
 * punished for it and learns to keep the board thin — the one ability that had a
 * card to collect and no opponent built around meeting it. The first entry is the
 * opponent a match is against unless the player picks another.
 *
 * `signature` is the one card that stands for how that opponent plays: a card
 * from their own deck and, like every reward card, in `REWARD_POOL`. A first win
 * against an opponent adds it while the player does not already hold it, so
 * beating a new character grows the collection in a way beating the same one
 * again does not and each character is a collection goal of its own.
 */
export const OPPONENTS = [
  {
    id: "thornmere",
    name: "Thornmere",
    look: "a thorned warden of the deep wood, mud-backed and slow to fall",
    description: "Slow, thorned growth — big bodies that wear you down",
    cardPreference: "dearest",
    accent: "--opponent-thornmere",
    // Thorn Gale: the sweeping gust that answers a whole table at once, the card
    // that stands for the slow warden's control.
    signature: "thorn-gale",
    deck: [
      "whipthorn",
      "mudback-turtle",
      "thornling",
      "glowcap",
      "dewdrop-nymph",
      "moon-bloom",
      "cinder-shrike",
      "thorn-gale",
      "root-colossus",
      "elder-oak",
    ],
  },
  {
    id: "emberwake",
    name: "Emberwake",
    look: "a burning herald, all sparks and lit grass",
    description: "Fast, cheap strikers that hit before you can answer",
    cardPreference: "prefer-strike",
    accent: "--opponent-emberwake",
    // Cinder Shrike: the fiery-tipped striker that hits as it lands, the card
    // that stands for the herald's rush.
    signature: "cinder-shrike",
    deck: [
      "dewdrop-nymph",
      "sprout",
      "pebble-toad",
      "bramble-hound",
      "cinder-shrike",
      "thornling",
      "twilight-fox",
      "moon-bloom",
      "vine-lasher",
      "emberling",
    ],
  },
  {
    id: "mistfen",
    name: "Mistfen",
    look: "a fog-bound fen where wet things creep and gather",
    description: "Cheap, creeping things that rise from the fen in numbers",
    cardPreference: "cheapest",
    accent: "--opponent-mistfen",
    // Fern Drake: the cheap body that strikes as it lands, the card that stands
    // for the fen's swarm.
    signature: "fern-drake",
    deck: [
      "dewdrop-nymph",
      "sprout",
      "pebble-toad",
      "moss-glider",
      "thornling",
      "sun-moth",
      "bramble-hound",
      "twilight-fox",
      "moon-bloom",
      "fern-drake",
    ],
  },
  {
    id: "barrowmere",
    name: "Barrowmere",
    look: "a grave-tender in a wide hat, wreathed in drifting leaves",
    description: "Cheap bodies traded away — they pay you back when they fall",
    cardPreference: "cheapest",
    accent: "--opponent-barrowmere",
    // Seed Pod: the cheap body that hands its owner a card as it falls, the card
    // that stands for the grave-tender's trade.
    signature: "seed-pod",
    // The one deck built around what a card does as it falls rather than as it
    // lands: every body here is cheap enough to trade without regret, and three
    // of them pay their owner back the moment they are removed — a card drawn, a
    // hero mended, a blow struck. It plays cheapest for that same reason: the
    // more small bodies on the table at once, the more of them the player has to
    // choose to kill, and the more of them answer being killed. Fern Drake keeps
    // a when-played card in the deck, so the opponent still meets the player with
    // one card that acts as it lands as every other opponent does.
    deck: [
      "seed-pod",
      "comfrey-root",
      "whipthorn",
      "pebble-toad",
      "moss-glider",
      "thornling",
      "bramble-hound",
      "fern-drake",
      "twilight-fox",
      "vine-lasher",
    ],
  },
  {
    id: "rootwarden",
    name: "Rootwarden",
    look: "a slow rooting warden, half tree and half stone, planted where it stands",
    description: "Slow, rooting bodies that strengthen the longer they stand",
    cardPreference: "dearest",
    accent: "--opponent-rootwarden",
    // Sunroot Treant: the growing body that holds the middle of the curve, the
    // card that stands for the warden's patience.
    signature: "sunroot-treant",
    // The one deck built around a card that rewards staying on the table: four
    // of its ten cards grow an attack at the start of every one of its turns, so
    // each body the player leaves standing is a threat that compounds, and the
    // answer is to trade early rather than let the table take root. It plays
    // dearest for the same reason: it wants one big body to commit to and grow,
    // not a swarm. Dewdrop Nymph keeps a when-played card in the deck, so the
    // opponent still meets the player with a card that acts as it lands as every
    // other opponent does.
    deck: [
      "climbing-ivy",
      "budding-sapling",
      "sunroot-treant",
      "worldroot-ancient",
      "dewdrop-nymph",
      "mudback-turtle",
      "glowcap",
      "moon-bloom",
      "root-colossus",
      "elder-oak",
    ],
  },
  {
    id: "mossheart",
    name: "Mossheart",
    look: "a bowed mender of the deep wood, green to the shoulders where the moss has taken hold",
    description: "Slow, high-health bodies that mend — they outlast you",
    cardPreference: "mend-when-hurt",
    accent: "--opponent-mossheart",
    // Mossheart Chalice: the mended bowl that heals its holder's hero as it is
    // lifted, the card that stands for the mender's long patience.
    signature: "mossheart-chalice",
    // The one deck built around mending rather than around a single trigger:
    // four of its ten cards mend the hero the moment they land, a fifth pays a
    // mend back as it falls, and every other body is cheap for the health it
    // carries. It mends once its own hero is wounded rather than the moment the
    // match starts, so a player who never lands a blow never sees it spend its
    // turn on health, and the mends it keeps taking are what a player has to
    // outpace before the match runs long and the slow deck wins by not dying.
    // Its bodies are slow enough to leave the player free to race it, which is
    // the lesson: against a mender, a stalled board is a losing one.
    deck: [
      "dewdrop-nymph",
      "sprout",
      "comfrey-root",
      "dewglass-moth",
      "mossheart-chalice",
      "mudback-turtle",
      "bark-sentinel",
      "elderheart-willow",
      "root-colossus",
      "elder-oak",
    ],
  },
  {
    id: "twinbough",
    name: "Twinbough",
    look: "a forked spirit of two boughs, one trunk splitting into twin crowns",
    description: "Two things at once — bodies that answer the board and pay you back",
    cardPreference: "prefer-twice",
    accent: "--opponent-twinbough",
    // Spearroot Colossus: the heavy body that strikes the board as it lands and
    // strikes again as it falls, the card that stands for the forked spirit's
    // doubled play.
    signature: "spearroot-colossus",
    // The one deck built around a card that acts twice: four of its ten cards
    // carry two abilities each — a body that draws as it lands and mends as it
    // falls, one that mends and grows, one that strikes as it lands and draws as
    // it falls, and one that strikes both ways — so a player meets a card doing
    // two things at once as a board to answer rather than only as a card to
    // collect. It still plays dearest — one doubled body a turn, each dealt with
    // before the next — but among cards of the same cost it reaches for the one
    // that acts twice, because every body it commits both answers the board and
    // is owed something when it is removed. Seed Pod and Comfrey Root feed the
    // same idea — bodies cheap enough to trade that pay
    // their owner back as they fall — while Climbing Ivy, Glowcap, Mudback
    // Turtle and Elder Oak keep the curve playable.
    deck: [
      "mire-spore",
      "seed-pod",
      "comfrey-root",
      "climbing-ivy",
      "heartwood-sapling",
      "glowcap",
      "sunspear-bloom",
      "mudback-turtle",
      "spearroot-colossus",
      "elder-oak",
    ],
  },
  {
    id: "quillmere",
    name: "Quillmere",
    look: "a stooped archivist bent low over a scroll it holds out, a pointed hood down over its eyes",
    description: "Cheap cards that draw — its hand keeps refilling",
    cardPreference: "cheapest",
    accent: "--opponent-quillmere",
    // Scrollbark: the standing bough that peels off a card as it lands, the card
    // that stands for the archivist's endless supply.
    signature: "scrollbark",
    // The one deck built around drawing rather than around a single trigger:
    // seven of its ten cards hand their owner another card, as they land or as
    // they fall, so the archivist's hand keeps refilling and a player has to
    // close the match before its cards outlast them. It plays cheapest for that
    // same reason: the more small drawing bodies it puts on the table at once,
    // the faster it cycles, and every one the player answers pays its owner back
    // a card. Dewdrop Nymph, Mudback Turtle and Root Colossus keep a curve under
    // the drawing, and Dewdrop Nymph also keeps a when-played mender in the deck
    // as every other opponent brings one.
    deck: [
      "scrollbark",
      "lantern-bough",
      "sunspear-bloom",
      "seed-pod",
      "mire-spore",
      "glowcap",
      "moon-bloom",
      "dewdrop-nymph",
      "mudback-turtle",
      "root-colossus",
    ],
  },
  {
    id: "galehollow",
    name: "Galehollow",
    look: "a lean wind-caller, arms flung wide, hair and hem torn sideways in the gale it holds open",
    description: "Wide, rolling gusts — it sweeps your whole table at once",
    cardPreference: "hold-sweep",
    accent: "--opponent-galehollow",
    // Storm Roc: the wide-winged body that sweeps every card on the opposing
    // table as it lands, the card that stands for the wind-caller's gale.
    signature: "storm-roc",
    // The one deck built around sweeping the opponent's table rather than around
    // a single trigger: four of its ten cards deal damage to every card the
    // player has out at once, so a player who fills the table with small bodies
    // is punished for it and the answer is to keep the board thin and answer
    // each sweeper before the next lands. Only three cards in the game carry the
    // sweep ability, so the cheapest of them is carried twice to reach the
    // four-of-ten pattern the other archetype decks use. It plays dearest for
    // the same reason: it wants one heavy sweeper committed, not a swarm of its
    // own. Dewdrop Nymph keeps a when-played mender in the deck as every other
    // opponent brings one, and Glowcap, Mudback Turtle, Moon Bloom, Root Colossus
    // and Elder Oak keep the curve playable.
    deck: [
      "gustling",
      "gustling",
      "thorn-gale",
      "storm-roc",
      "dewdrop-nymph",
      "glowcap",
      "mudback-turtle",
      "moon-bloom",
      "root-colossus",
      "elder-oak",
    ],
  },
];

/** The opponents a match can be fought against, looked up by the id a caller names. */
export const OPPONENT_BY_ID = new Map(OPPONENTS.map((opponent) => [opponent.id, opponent]));

/**
 * The opponent a match is against until another is chosen: Thornmere, first in
 * the list, whose deck is the fixture the match's own checks were written
 * against.
 */
export const DEFAULT_OPPONENT = OPPONENTS[0];

export const OPPONENT_NAME = DEFAULT_OPPONENT.name;

/**
 * Thornmere's fixed deck: slow, thorned, mud-backed growth, the opposite of a
 * deck built for speed. It mends its hero, carries one sweeping gale and brings a
 * card that strikes as it falls, so the slow warden is also the opponent that
 * teaches a player not to commit every small card at once — its Thorn Gale deals
 * 1 to the whole player's table — and that killing one of its bodies costs the
 * player's own front card — its Whipthorn deals 1 to the player's front card (or
 * to the player's hero once the player's table is empty) the moment it leaves the
 * table.
 *
 * The order is part of the fixture, not an accident: a deal with a fixed random
 * source leaves the second, third and fourth cards in the opponent's opening
 * hand, so the turtle and the thornling there are what the match's own checks
 * fight with. The fall-striking Whipthorn sits first so that, under the fixed
 * shuffle the checks deal with, it is the last card drawn rather than one of the
 * dealt hand — which is why it can be swapped in without moving the opening hand
 * those checks fight. Reordering this list means rethinking those checks.
 */
export const OPPONENT_DECK = DEFAULT_OPPONENT.deck;
