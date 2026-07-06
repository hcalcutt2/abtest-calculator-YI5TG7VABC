export const SCENARIOS = [
  {
    id: "rain",
    title: "Rain forecast",
    sliderPrompt: "The forecast announces rain only when it is at least this sure:",
    sliderLow: "says yes on the slightest hint",
    sliderHigh: "says yes only when almost certain",
    tagline: "Each icon is one day. The forecast either warns about rain or not.",
    baseRateNote: "On 20 of these 100 days it actually rains. The other 80 stay dry.",
    itemNoun: "day",
    itemIcon: "cloud",
    yesWhen: "Forecast warns: rain",
    noWhen: "Forecast says: dry day",
    outcomes: {
      hit: { label: "Correct warning", short: "Rained; you were prepared" },
      miss: { label: "Miss (Type II)", short: "Rained; forecast said dry" },
      falseAlarm: { label: "False alarm (Type I)", short: "Stayed dry; forecast warned rain" },
      correctPass: { label: "Correct all-clear", short: "Dry; forecast said dry" },
    },
    type1Card: {
      title: "False alarm (Type I)",
      gloss: "Said yes when the answer was no",
      example: (n) => `${n} dry ${n === 1 ? "day" : "days"} you carried an umbrella you did not need`,
    },
    type2Card: {
      title: "Miss (Type II)",
      gloss: "Said no when the answer was yes",
      example: (n) => `${n} rainy ${n === 1 ? "day" : "days"} you were caught without a rain plan`,
    },
  },
  {
    id: "plant",
    title: "Plant watering",
    sliderPrompt: "You water the plant only when you are at least this sure it is thirsty:",
    sliderLow: "water on the slightest hint",
    sliderHigh: "water only when almost certain",
    tagline: "Each icon is one plant check. You either water or leave it alone.",
    baseRateNote: "20 of these 100 plants are actually thirsty. The other 80 are fine.",
    itemNoun: "plant",
    itemIcon: "plant",
    yesWhen: "You water the plant",
    noWhen: "You leave it alone",
    outcomes: {
      hit: { label: "Correct watering", short: "Thirsty plant; you watered" },
      miss: { label: "Miss (Type II)", short: "Thirsty plant; you skipped water" },
      falseAlarm: { label: "False alarm (Type I)", short: "Fine plant; you watered anyway" },
      correctPass: { label: "Correct skip", short: "Fine plant; you left it" },
    },
    type1Card: {
      title: "False alarm (Type I)",
      gloss: "Said yes when the answer was no",
      example: (n) => `${n} healthy ${n === 1 ? "plant" : "plants"} you overwatered`,
    },
    type2Card: {
      title: "Miss (Type II)",
      gloss: "Said no when the answer was yes",
      example: (n) => `${n} thirsty ${n === 1 ? "plant" : "plants"} you let wilt`,
    },
  },
  {
    id: "spam",
    title: "Spam filter",
    sliderPrompt: "The filter sends email to junk only when it is at least this sure it is spam:",
    sliderLow: "bins mail on the slightest hint",
    sliderHigh: "bins mail only when almost certain",
    tagline: "Each icon is one email. The filter either sends it to junk or keeps it in the inbox.",
    baseRateNote: "20 of these 100 emails are actually spam. The other 80 are real mail.",
    itemNoun: "email",
    itemIcon: "email",
    yesWhen: "Filter sends to junk",
    noWhen: "Filter keeps in inbox",
    outcomes: {
      hit: { label: "Correct catch", short: "Spam; filter junked it" },
      miss: { label: "Miss (Type II)", short: "Spam; filter let it through" },
      falseAlarm: { label: "False alarm (Type I)", short: "Real mail; filter junked it" },
      correctPass: { label: "Correct keep", short: "Real mail; stayed in inbox" },
    },
    type1Card: {
      title: "False alarm (Type I)",
      gloss: "Said yes when the answer was no",
      example: (n) => `${n} real ${n === 1 ? "email" : "emails"} buried in junk`,
    },
    type2Card: {
      title: "Miss (Type II)",
      gloss: "Said no when the answer was yes",
      example: (n) => `${n} spam ${n === 1 ? "email" : "emails"} that reached your inbox`,
    },
  },
];

export const OUTCOME_ORDER = ["hit", "miss", "falseAlarm", "correctPass"];

export const OUTCOME_META = {
  hit: { css: "hit", legend: "Hit — correct yes" },
  miss: { css: "miss", legend: "Miss (Type II) — said no, but yes was right", isError: true },
  falseAlarm: { css: "false-alarm", legend: "False alarm (Type I) — said yes, but no was right", isError: true },
  correctPass: { css: "pass", legend: "Correct pass — correct no" },
};
