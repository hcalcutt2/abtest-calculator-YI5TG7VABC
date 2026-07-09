export const ADVANCED_TOOLS = [
  {
    path: "/advanced/sequential",
    title: "Sequential testing",
    tag: "Sequential sampling",
    desc: "Plan interim looks and efficacy boundaries for sequential sampling. Stop a test early without inflating Type I error on the null hypothesis.",
  },
  {
    path: "/advanced/poisson",
    title: "Poisson means test",
    tag: "Event rates per exposure",
    desc: "Compare count rates per unit of exposure with a chi-squared-style check: errors per day, orders per 1,000 sessions, or tickets per user-week.",
  },
  {
    path: "/advanced/survival",
    title: "Survival curves",
    tag: "Time-to-event & test duration",
    desc: "Compare time until churn, activation, or purchase with Kaplan-Meier curves and a log-rank test when test duration matters more than conversion rate alone.",
  },
  {
    path: "/advanced/fdr",
    title: "FDR / TDR control",
    tag: "False discovery rate",
    desc: "Control false discovery rate when testing many metrics or variants. Estimate how many significant results are real vs Type I errors.",
  },
  {
    path: "/advanced/bayesian",
    title: "Bayesian A/B test",
    tag: "Probability of winning",
    desc: "Bayesian A/B testing: combine prior beliefs with control and variant conversions to estimate the probability the variant beats control.",
  },
];
