// Holiday-themed bank pools.
//
// On a recognized American holiday the daily game deals its bank from a curated,
// on-theme word list instead of the usual common-word pool, so e.g. Halloween
// hands you PUMPKIN, WITCH, and CAULDRON. Everything else about the day still
// works the same — the board is still the deterministic daily seed, bonus words
// are still derived from the board, scoring is unchanged.
//
// `holidayFor("YYYY-M-D")` (the same date string Game uses as its seed) returns
// the matching holiday `{ id, name, emoji, words }` or null. game.js filters the
// words to the loaded dictionary (every placed run must be a real word) and falls
// back to the normal pool if too few survive, so an off word here is harmless.
//
// Dates are computed per-year: fixed holidays return a constant month/day; floating
// ones (Thanksgiving, Memorial Day, Easter, …) compute it. This file has no other
// dependencies and is loaded before game.js.

// --- date helpers (all months are 1-based; weekday 0 = Sunday) ---

// The day-of-month of the Nth given weekday in a month, e.g. the 4th Thursday of
// November (Thanksgiving) is nthWeekday(y, 11, 4, 4).
function nthWeekday(year, month, weekday, n) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const offset = (weekday - firstDow + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

// The day-of-month of the LAST given weekday in a month, e.g. the last Monday of
// May (Memorial Day) is lastWeekday(y, 5, 1).
function lastWeekday(year, month, weekday) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const lastDow = new Date(year, month - 1, daysInMonth).getDay();
  return daysInMonth - ((lastDow - weekday + 7) % 7);
}

// Gregorian Easter Sunday (Anonymous/Meeus computus). Returns { month, day }.
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

// A date `days` before/after another { month, day } in a given year, as { month, day }.
function shiftDate(year, md, days) {
  const t = new Date(year, md.month - 1, md.day + days);
  return { month: t.getMonth() + 1, day: t.getDate() };
}

// --- holiday table ---
//
// `date(year)` returns { month, day }. Words are lowercase and chosen to be
// common dictionary words (game.js drops any that aren't), spread across lengths
// 3–9 so the length-varied bank has plenty to draw from.

const HOLIDAYS = [
  {
    id: 'new-years-day', name: "New Year's Day", emoji: '🎉',
    date: () => ({ month: 1, day: 1 }),
    words: [
      'fresh', 'start', 'year', 'hope', 'goal', 'plan', 'renew', 'begin', 'dream', 'wish', 'resolve',
      'change', 'future', 'bright', 'clean', 'slate', 'first', 'dawn', 'early', 'morning', 'calendar',
      'winter', 'frost', 'party', 'cheer', 'toast', 'brunch', 'reset', 'focus', 'growth', 'habit', 'journal',
      'gather', 'family', 'rest', 'optimism', 'healthy', 'organize', 'intention', 'mindful', 'gratitude',
      'ambition', 'progress', 'sunrise', 'horizon', 'resolution', 'promise', 'inspire', 'energy', 'vision',
      'clarity', 'balance', 'purpose', 'momentum', 'celebrate'],
  },
  {
    id: 'mlk-day', name: 'Martin Luther King Jr. Day', emoji: '🕊️',
    date: (y) => ({ month: 1, day: nthWeekday(y, 1, 1, 3) }),
    words: [
      'dream', 'peace', 'equality', 'justice', 'freedom', 'march', 'unity', 'hope', 'courage', 'leader',
      'civil', 'rights', 'change', 'voice', 'harmony', 'respect', 'dignity', 'brave', 'vision', 'legacy',
      'honor', 'gather', 'speech', 'progress', 'equal', 'struggle', 'faith', 'liberty', 'reform',
      'nonviolent', 'tolerance', 'brotherhood', 'beloved', 'sermon', 'boycott', 'activist', 'protest',
      'banner', 'podium', 'crowd', 'sacrifice', 'conscience', 'humanity', 'compassion', 'inspire',
      'monument', 'anthem', 'marcher'],
  },
  {
    id: 'groundhog-day', name: 'Groundhog Day', emoji: '🐹',
    date: () => ({ month: 2, day: 2 }),
    words: [
      'groundhog', 'shadow', 'burrow', 'winter', 'spring', 'forecast', 'weather', 'rodent', 'furry', 'hole',
      'sleep', 'wake', 'season', 'frost', 'cloud', 'sunny', 'early', 'late', 'weeks', 'snow', 'cold',
      'mammal', 'critter', 'ground', 'emerge', 'peek', 'watch', 'crowd', 'annual', 'predict', 'meadow',
      'field', 'tunnel', 'whistle', 'marmot', 'chubby', 'sniff', 'dawn', 'frosty', 'chilly', 'brisk',
      'pebble', 'woodland', 'slumber', 'yawn', 'stretch', 'timid', 'omen', 'ritual'],
  },
  {
    id: 'valentines-day', name: "Valentine's Day", emoji: '❤️',
    date: () => ({ month: 2, day: 14 }),
    words: [
      'heart', 'love', 'cupid', 'arrow', 'rose', 'flower', 'candy', 'chocolate', 'card', 'gift', 'kiss',
      'romance', 'sweet', 'dear', 'crush', 'date', 'dinner', 'candle', 'ribbon', 'lace', 'pink', 'cherish',
      'adore', 'devotion', 'couple', 'partner', 'beloved', 'charm', 'bouquet', 'admirer', 'passion',
      'tender', 'fondness', 'smitten', 'flirt', 'swoon', 'darling', 'sweetheart', 'cherub', 'lover',
      'embrace', 'cuddle', 'warmth', 'devoted', 'blossom', 'honey', 'treasure', 'poem', 'sonnet'],
  },
  {
    id: 'presidents-day', name: "Presidents' Day", emoji: '🎩',
    date: (y) => ({ month: 2, day: nthWeekday(y, 2, 1, 3) }),
    words: [
      'president', 'leader', 'nation', 'history', 'liberty', 'freedom', 'capitol', 'vote', 'office', 'term',
      'honor', 'founder', 'country', 'union', 'government', 'democracy', 'election', 'monument', 'eagle',
      'flag', 'patriot', 'statesman', 'legacy', 'respect', 'service', 'senate', 'oath', 'cabinet',
      'leadership', 'governor', 'congress', 'debate', 'ballot', 'campaign', 'policy', 'federal', 'republic',
      'citizen', 'candidate', 'inaugural', 'mandate', 'reform', 'veto', 'council', 'governance', 'address',
      'portrait', 'marble', 'civic', 'mayor', 'polls', 'elect', 'court', 'judge', 'swear', 'ruler', 'crest'],
  },
  {
    id: 'pi-day', name: 'Pi Day', emoji: '🥧',
    date: () => ({ month: 3, day: 14 }),
    words: [
      'pie', 'circle', 'number', 'math', 'ratio', 'digit', 'radius', 'round', 'slice', 'bake', 'crust',
      'apple', 'cherry', 'filling', 'dessert', 'sweet', 'three', 'constant', 'formula', 'geometry',
      'equation', 'decimal', 'endless', 'pattern', 'sequence', 'pastry', 'oven', 'treat', 'infinite',
      'spiral', 'diameter', 'sphere', 'curve', 'theorem', 'integer', 'fraction', 'measure', 'compute',
      'tangent', 'angle', 'segment', 'area', 'volume', 'symbol', 'rational', 'square', 'cosine', 'graph',
      'vertex', 'crumb', 'savory', 'custard'],
  },
  {
    id: 'st-patricks-day', name: "St. Patrick's Day", emoji: '🍀',
    date: () => ({ month: 3, day: 17 }),
    words: [
      'clover', 'shamrock', 'green', 'gold', 'lucky', 'charm', 'rainbow', 'leprechaun', 'blarney', 'parade',
      'festive', 'harp', 'fortune', 'blessing', 'emerald', 'fairy', 'magic', 'mischief', 'beard', 'coin',
      'treasure', 'dance', 'music', 'fiddle', 'celebrate', 'spring', 'lush', 'jig', 'pinch', 'hat', 'jade',
      'verdant', 'meadow', 'festival', 'ballad', 'feast', 'frolic', 'merry', 'jolly', 'kettle', 'golden',
      'sparkle', 'shimmer', 'prosper', 'whistle', 'banner', 'trinket', 'token'],
  },
  {
    id: 'april-fools-day', name: "April Fools' Day", emoji: '🃏',
    date: () => ({ month: 4, day: 1 }),
    words: [
      'prank', 'joke', 'trick', 'fool', 'silly', 'laugh', 'hoax', 'jest', 'jester', 'surprise', 'funny',
      'comedy', 'mischief', 'humor', 'antic', 'clown', 'riddle', 'banter', 'tease', 'playful', 'sneaky',
      'foolish', 'giggle', 'chuckle', 'gag', 'witty', 'nonsense', 'gullible', 'mockery', 'caper', 'ruse',
      'ploy', 'scheme', 'dupe', 'parody', 'satire', 'deception', 'kidding', 'absurd', 'ludicrous', 'zany',
      'goofy', 'quirky', 'slapstick', 'charade', 'baffle', 'fluster', 'prankster'],
  },
  {
    id: 'earth-day', name: 'Earth Day', emoji: '🌎',
    date: () => ({ month: 4, day: 22 }),
    words: [
      'earth', 'planet', 'green', 'nature', 'tree', 'forest', 'ocean', 'river', 'mountain', 'clean',
      'recycle', 'reuse', 'reduce', 'compost', 'garden', 'plant', 'seed', 'grow', 'soil', 'water', 'energy',
      'solar', 'wind', 'climate', 'protect', 'wildlife', 'habitat', 'bloom', 'leaf', 'sustain', 'ecology',
      'meadow', 'prairie', 'wetland', 'glacier', 'coral', 'reef', 'species', 'organic', 'renew', 'conserve',
      'restore', 'carbon', 'native', 'wilderness', 'canopy', 'greenery', 'sprout', 'flourish', 'shelter'],
  },
  {
    id: 'easter', name: 'Easter', emoji: '🐰',
    date: (y) => easter(y),
    words: [
      'bunny', 'rabbit', 'egg', 'basket', 'chick', 'hunt', 'hide', 'spring', 'bloom', 'flower', 'tulip',
      'lily', 'pastel', 'chocolate', 'candy', 'jelly', 'bean', 'lamb', 'sunrise', 'renew', 'family',
      'brunch', 'color', 'grass', 'sweet', 'treat', 'garden', 'bonnet', 'parade', 'hop', 'blossom',
      'daffodil', 'crocus', 'hatch', 'nest', 'fluffy', 'meadow', 'duckling', 'marshmallow', 'gingham',
      'vigil', 'hymn', 'chapel', 'gather', 'joyful', 'rejoice', 'warmth', 'springtime', 'sweets'],
  },
  {
    id: 'mardi-gras', name: 'Mardi Gras', emoji: '🎭',
    date: (y) => shiftDate(y, easter(y), -47),
    words: [
      'mask', 'parade', 'float', 'bead', 'costume', 'festive', 'music', 'jazz', 'dance', 'color', 'purple',
      'gold', 'green', 'feast', 'celebrate', 'carnival', 'king', 'jester', 'crowd', 'street', 'party',
      'vibrant', 'festival', 'gather', 'masquerade', 'revelry', 'trumpet', 'beads', 'cake', 'revel',
      'frolic', 'pageant', 'spectacle', 'plume', 'feather', 'sequin', 'glitter', 'sparkle', 'jubilee',
      'brass', 'melody', 'rhythm', 'dazzle', 'merriment', 'festoon', 'banner', 'trinket', 'flamboyant'],
  },
  {
    id: 'cinco-de-mayo', name: 'Cinco de Mayo', emoji: '🌮',
    date: () => ({ month: 5, day: 5 }),
    words: [
      'fiesta', 'taco', 'salsa', 'guacamole', 'pepper', 'chili', 'lime', 'corn', 'bean', 'rice', 'festive',
      'music', 'dance', 'guitar', 'sombrero', 'color', 'parade', 'victory', 'battle', 'spicy', 'flavor',
      'feast', 'party', 'vibrant', 'celebrate', 'heritage', 'amigo', 'maraca', 'pinata', 'avocado',
      'tortilla', 'nacho', 'cilantro', 'cactus', 'desert', 'tradition', 'ballad', 'trumpet', 'drum',
      'banner', 'ribbon', 'colorful', 'savory', 'spice', 'zest', 'sizzle', 'mango'],
  },
  {
    id: 'mothers-day', name: "Mother's Day", emoji: '💐',
    date: (y) => ({ month: 5, day: nthWeekday(y, 5, 0, 2) }),
    words: [
      'mother', 'love', 'flower', 'bouquet', 'rose', 'tulip', 'card', 'gift', 'brunch', 'kind', 'gentle',
      'caring', 'nurture', 'devotion', 'family', 'daughter', 'cherish', 'gratitude', 'breakfast', 'garden',
      'sweet', 'tender', 'warmth', 'comfort', 'treasure', 'beloved', 'hug', 'mom', 'apron', 'bloom',
      'maternal', 'embrace', 'patience', 'wisdom', 'lullaby', 'devoted', 'affection', 'peony', 'daisy',
      'lavender', 'pamper', 'grace', 'generous', 'selfless', 'heartfelt', 'dear', 'blossom', 'kiss'],
  },
  {
    id: 'memorial-day', name: 'Memorial Day', emoji: '🎖️',
    date: (y) => ({ month: 5, day: lastWeekday(y, 5, 1) }),
    words: [
      'memorial', 'honor', 'remember', 'soldier', 'service', 'sacrifice', 'flag', 'freedom', 'brave', 'hero',
      'valor', 'duty', 'tribute', 'salute', 'grave', 'wreath', 'ceremony', 'veteran', 'country', 'nation',
      'fallen', 'courage', 'respect', 'parade', 'banner', 'eagle', 'liberty', 'patriot', 'summer', 'poppy',
      'remembrance', 'cemetery', 'monument', 'anthem', 'bugle', 'reverence', 'bravery', 'devotion',
      'regiment', 'garland', 'solemn', 'mourn', 'cherish', 'defend', 'marble', 'gratitude'],
  },
  {
    id: 'flag-day', name: 'Flag Day', emoji: '🇺🇸',
    date: () => ({ month: 6, day: 14 }),
    words: [
      'flag', 'banner', 'stars', 'stripes', 'white', 'blue', 'country', 'nation', 'pride', 'pledge', 'honor',
      'freedom', 'liberty', 'eagle', 'symbol', 'patriot', 'fabric', 'pole', 'wave', 'salute', 'anthem',
      'history', 'union', 'emblem', 'colors', 'march', 'parade', 'glory', 'crimson', 'star', 'allegiance',
      'bunting', 'hoist', 'ensign', 'standard', 'pennant', 'azure', 'woven', 'ceremony', 'republic',
      'citizen', 'devotion', 'reverence', 'bravery', 'unity', 'heritage'],
  },
  {
    id: 'juneteenth', name: 'Juneteenth', emoji: '✊',
    date: () => ({ month: 6, day: 19 }),
    words: [
      'freedom', 'liberty', 'justice', 'equality', 'history', 'heritage', 'celebrate', 'unity', 'hope',
      'progress', 'dignity', 'courage', 'legacy', 'ancestor', 'community', 'music', 'dance', 'feast',
      'parade', 'banner', 'pride', 'honor', 'remember', 'gather', 'festival', 'jubilee', 'liberation',
      'emancipate', 'proclaim', 'gathering', 'cookout', 'barbecue', 'ribbon', 'soulful', 'anthem',
      'spiritual', 'struggle', 'triumph', 'perseverance', 'resilience', 'hopeful', 'festive', 'gratitude',
      'elder', 'drumming'],
  },
  {
    id: 'fathers-day', name: "Father's Day", emoji: '👔',
    date: (y) => ({ month: 6, day: nthWeekday(y, 6, 0, 3) }),
    words: [
      'father', 'gift', 'card', 'grill', 'barbecue', 'sport', 'fishing', 'tool', 'hero', 'mentor', 'guide',
      'strong', 'wise', 'kind', 'brave', 'family', 'daughter', 'respect', 'proud', 'garage', 'workshop',
      'advice', 'support', 'treasure', 'dad', 'tie', 'lawn', 'wrench', 'hammer', 'cookout', 'patient',
      'steady', 'provider', 'protector', 'handyman', 'camping', 'baseball', 'recliner', 'necktie', 'whittle',
      'grilling', 'sturdy', 'dependable', 'gruff', 'chuckle', 'wisdom', 'legacy', 'beard'],
  },
  {
    id: 'independence-day', name: 'Independence Day', emoji: '🎆',
    date: () => ({ month: 7, day: 4 }),
    words: [
      'fireworks', 'freedom', 'liberty', 'flag', 'eagle', 'parade', 'picnic', 'grill', 'barbecue',
      'sparkler', 'rocket', 'banner', 'stars', 'stripes', 'patriot', 'nation', 'country', 'summer',
      'celebrate', 'anthem', 'glory', 'festival', 'cookout', 'lemonade', 'watermelon', 'firework', 'star',
      'union', 'rockets', 'salute', 'bunting', 'marching', 'bonfire', 'sizzle', 'festive', 'sparkle',
      'gathering', 'sunshine', 'blanket', 'cooler', 'patriotic', 'hotdog', 'grilling', 'flags', 'burger',
      'relish', 'hurrah', 'brave', 'proud', 'feast', 'kabob'],
  },
  {
    id: 'labor-day', name: 'Labor Day', emoji: '🛠️',
    date: (y) => ({ month: 9, day: nthWeekday(y, 9, 1, 1) }),
    words: [
      'labor', 'worker', 'union', 'rest', 'picnic', 'barbecue', 'parade', 'weekend', 'holiday', 'summer',
      'vacation', 'beach', 'family', 'grill', 'relax', 'leisure', 'festival', 'effort', 'trade', 'craft',
      'skill', 'industry', 'honor', 'march', 'banner', 'gather', 'cookout', 'lemonade', 'sunshine', 'wage',
      'workforce', 'employee', 'laborer', 'craftsman', 'artisan', 'profession', 'retire', 'paycheck',
      'overtime', 'factory', 'foreman', 'toil', 'respite', 'getaway', 'hammock', 'solidarity', 'dignity'],
  },
  {
    id: 'columbus-day', name: 'Indigenous Peoples’ Day', emoji: '🧭',
    date: (y) => ({ month: 10, day: nthWeekday(y, 10, 1, 2) }),
    words: [
      'explore', 'voyage', 'ocean', 'ship', 'sail', 'compass', 'discover', 'journey', 'native', 'heritage',
      'culture', 'history', 'land', 'people', 'tribe', 'ancestor', 'tradition', 'honor', 'respect', 'story',
      'legacy', 'drum', 'dance', 'harvest', 'autumn', 'map', 'distant', 'horizon', 'canoe', 'nation',
      'mariner', 'galleon', 'anchor', 'harbor', 'seafarer', 'settlement', 'frontier', 'prairie', 'totem',
      'council', 'elder', 'folklore', 'legend', 'basket', 'pottery', 'feast', 'ritual', 'homeland',
      'migration'],
  },
  {
    id: 'halloween', name: 'Halloween', emoji: '🎃',
    date: () => ({ month: 10, day: 31 }),
    words: [
      'pumpkin', 'ghost', 'witch', 'candy', 'costume', 'spooky', 'haunted', 'skeleton', 'spider', 'web',
      'cauldron', 'broom', 'vampire', 'zombie', 'monster', 'goblin', 'lantern', 'carve', 'scare', 'fright',
      'creepy', 'eerie', 'midnight', 'moon', 'shadow', 'graveyard', 'mask', 'trick', 'treat', 'orange',
      'cobweb', 'gravestone', 'tombstone', 'mummy', 'werewolf', 'phantom', 'specter', 'wicked', 'lurking',
      'shriek', 'howl', 'hollow', 'dusk', 'gourd', 'candle', 'flicker', 'potion', 'raven', 'ghoul', 'owl'],
  },
  {
    id: 'veterans-day', name: 'Veterans Day', emoji: '🎖️',
    date: () => ({ month: 11, day: 11 }),
    words: [
      'veteran', 'honor', 'service', 'soldier', 'brave', 'hero', 'valor', 'duty', 'salute', 'flag',
      'freedom', 'sacrifice', 'courage', 'tribute', 'country', 'nation', 'respect', 'banner', 'medal',
      'uniform', 'parade', 'eagle', 'liberty', 'patriot', 'gratitude', 'ceremony', 'remember', 'march',
      'defend', 'proud', 'regiment', 'garrison', 'infantry', 'sailor', 'marine', 'battalion', 'ribbon',
      'reverence', 'bravery', 'defender', 'homecoming', 'honorable', 'sentinel', 'allegiance', 'valiant'],
  },
  {
    id: 'thanksgiving', name: 'Thanksgiving', emoji: '🦃',
    date: (y) => ({ month: 11, day: nthWeekday(y, 11, 4, 4) }),
    words: [
      'turkey', 'gravy', 'stuffing', 'cranberry', 'harvest', 'feast', 'family', 'gather', 'grateful',
      'thankful', 'pumpkin', 'pie', 'corn', 'autumn', 'pilgrim', 'plenty', 'bounty', 'dinner', 'blessing',
      'gratitude', 'table', 'potato', 'butter', 'roast', 'tradition', 'fall', 'yam', 'pecan', 'apron',
      'leftover', 'cornucopia', 'drumstick', 'casserole', 'squash', 'maize', 'gourd', 'platter', 'gathering',
      'abundance', 'autumnal', 'relatives', 'hearth', 'savory', 'simmer', 'baste', 'nap', 'parade'],
  },
  {
    id: 'christmas-eve', name: 'Christmas Eve', emoji: '🎄',
    date: () => ({ month: 12, day: 24 }),
    words: [
      'night', 'silent', 'stocking', 'fireplace', 'chimney', 'cookie', 'milk', 'sleigh', 'reindeer', 'gift',
      'wrap', 'ribbon', 'candle', 'carol', 'twinkle', 'glow', 'snow', 'frost', 'manger', 'star', 'tree',
      'ornament', 'garland', 'wreath', 'family', 'cozy', 'wonder', 'eve', 'hush', 'bow', 'lantern',
      'candlelight', 'hearth', 'cocoa', 'blanket', 'slumber', 'dreamy', 'peaceful', 'nativity', 'shepherd',
      'lullaby', 'evergreen', 'pinecone', 'flurry', 'snowfall', 'tidings', 'yuletide', 'mantel', 'whisper',
      'glisten'],
  },
  {
    id: 'christmas', name: 'Christmas', emoji: '🎅',
    date: () => ({ month: 12, day: 25 }),
    words: [
      'gift', 'present', 'tree', 'ornament', 'garland', 'wreath', 'holly', 'mistletoe', 'reindeer', 'sleigh',
      'snow', 'frost', 'carol', 'jingle', 'bell', 'candy', 'cane', 'cocoa', 'stocking', 'chimney', 'elf',
      'merry', 'festive', 'family', 'ribbon', 'star', 'angel', 'joy', 'tinsel', 'mittens', 'yuletide',
      'nutcracker', 'gingerbread', 'peppermint', 'snowman', 'snowflake', 'blizzard', 'evergreen', 'pinecone',
      'nativity', 'shepherd', 'scarf', 'cheerful', 'glisten', 'twinkle', 'tidings', 'candle', 'hearth'],
  },
  {
    id: 'new-years-eve', name: "New Year's Eve", emoji: '🥂',
    date: () => ({ month: 12, day: 31 }),
    words: [
      'midnight', 'countdown', 'party', 'toast', 'champagne', 'bubbly', 'glass', 'sparkle', 'glitter',
      'confetti', 'balloon', 'ribbon', 'streamer', 'music', 'dance', 'crowd', 'cheer', 'kiss', 'clock',
      'twelve', 'firework', 'gather', 'friend', 'festive', 'horn', 'song', 'celebrate', 'evening', 'silver',
      'resolution', 'sparkler', 'ballroom', 'gala', 'revelry', 'jubilant', 'anticipation', 'twinkle',
      'shimmer', 'dazzle', 'glow', 'applause', 'embrace', 'fireworks', 'partygoer', 'noisemaker', 'banner',
      'bubbles', 'cheers'],
  },
];

// The holiday whose computed date matches the given "YYYY-M-D" seed string, or
// null. The seed is split numerically (it may be unpadded, e.g. "2026-7-4").
function holidayFor(seedStr) {
  if (typeof seedStr !== 'string') return null;
  const parts = seedStr.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [year, month, day] = parts;
  for (const h of HOLIDAYS) {
    const md = h.date(year);
    if (md.month === month && md.day === day) {
      return { id: h.id, name: h.name, emoji: h.emoji, words: h.words };
    }
  }
  return null;
}

window.holidayFor = holidayFor;
window.HOLIDAYS = HOLIDAYS;
