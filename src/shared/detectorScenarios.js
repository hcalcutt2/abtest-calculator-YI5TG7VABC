export const SCENARIOS = [
  {
    id: "winner",
    title: "Calling an A/B winner",
    sliderPrompt: "You ship the variant only when the test is at least this sure it won:",
    sliderLow: "ship on the slightest hint of a lift",
    sliderHigh: "ship only when almost certain",
    tagline: "Each icon is one metric you checked on the same experiment — conversion, bounce, RPV, and so on.",
    baseRateNote: "On 20 of these 100 checks the variant truly beat control. The other 80 were flat or noise.",
    itemNoun: "metric check",
    itemIcon: "chart",
    yesWhen: "You call a winner and ship",
    noWhen: "You keep control live",
    outcomes: {
      hit: { label: "Correct ship", short: "Real lift; you shipped the winner" },
      miss: { label: "Miss (Type II)", short: "Real lift; you left the winner on the shelf" },
      falseAlarm: { label: "False alarm (Type I)", short: "No real lift; you shipped anyway" },
      correctPass: { label: "Correct hold", short: "No lift; you kept control" },
    },
    type1Card: {
      title: "False alarm (Type I)",
      gloss: "Called a winner when control was fine",
      example: (n) => `${n} ${n === 1 ? "metric" : "metrics"} where you shipped a change that did nothing`,
    },
    type2Card: {
      title: "Miss (Type II)",
      gloss: "Missed a winner that was really there",
      example: (n) => `${n} real ${n === 1 ? "lift" : "lifts"} you never rolled out`,
    },
  },
  {
    id: "bounce",
    title: "Bounce-rate alert",
    sliderPrompt: "You flag a landing page as “high bounce” only when you are at least this sure:",
    sliderLow: "alert on the slightest hint",
    sliderHigh: "alert only when almost certain",
    tagline: "Each icon is one day of bounce data for a page. You either raise an alert or leave it alone.",
    baseRateNote: "On 20 of these 100 days bounce was genuinely worse than your site average. The other 80 were normal.",
    itemNoun: "day",
    itemIcon: "bounce",
    yesWhen: "You flag high bounce",
    noWhen: "You leave the page alone",
    outcomes: {
      hit: { label: "Correct alert", short: "High bounce; you investigated" },
      miss: { label: "Miss (Type II)", short: "High bounce; you missed it" },
      falseAlarm: { label: "False alarm (Type I)", short: "Normal bounce; you chased a ghost" },
      correctPass: { label: "Correct quiet", short: "Normal bounce; no alert" },
    },
    type1Card: {
      title: "False alarm (Type I)",
      gloss: "Flagged a page that was fine",
      example: (n) => `${n} normal ${n === 1 ? "day" : "days"} you sent the team on a wild goose chase`,
    },
    type2Card: {
      title: "Miss (Type II)",
      gloss: "Missed a page that really was bouncing",
      example: (n) => `${n} bad-bounce ${n === 1 ? "day" : "days"} you never investigated`,
    },
  },
  {
    id: "engage",
    title: "Engagement drop",
    sliderPrompt: "You report “engagement is down” only when you are at least this sure:",
    sliderLow: "report on the slightest dip",
    sliderHigh: "report only when almost certain",
    tagline: "Each icon is one week of time-on-page and element-click data for a key template.",
    baseRateNote: "On 20 of these 100 weeks engagement truly fell. The other 80 were steady or seasonal noise.",
    itemNoun: "week",
    itemIcon: "engage",
    yesWhen: "You report a real drop",
    noWhen: "You treat it as normal variation",
    outcomes: {
      hit: { label: "Correct call", short: "Real drop; you acted" },
      miss: { label: "Miss (Type II)", short: "Real drop; you ignored it" },
      falseAlarm: { label: "False alarm (Type I)", short: "Normal week; you overreacted" },
      correctPass: { label: "Correct steady", short: "Normal week; no panic" },
    },
    type1Card: {
      title: "False alarm (Type I)",
      gloss: "Reported a drop that was not real",
      example: (n) => `${n} quiet ${n === 1 ? "week" : "weeks"} you treated as a crisis`,
    },
    type2Card: {
      title: "Miss (Type II)",
      gloss: "Missed a real engagement slide",
      example: (n) => `${n} ${n === 1 ? "week" : "weeks"} users were disengaging and you did not notice`,
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
