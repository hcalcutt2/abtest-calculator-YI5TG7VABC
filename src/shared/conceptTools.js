export const CONCEPT_TOOLS = [
  {
    path: "/concepts/type-errors",
    title: "Type I & Type II errors",
    tag: "Null hypothesis mistakes",
    desc: "See false winners (Type I error) and missed lifts (Type II error) when testing control vs variant, and how confidence level and statistical power trade off.",
  },
  {
    path: "/concepts/power",
    title: "Statistical power",
    tag: "Will you spot a real lift?",
    desc: "How statistical power, MDE, and sample size interact, and why under-powered tests miss real conversion rate or revenue wins.",
  },
  {
    path: "/concepts/p-hacking",
    title: "P-hacking & p-values",
    tag: "Too many metrics on one test",
    desc: "Why peeking, optional stopping, and testing many metrics inflate false discovery rate, and make p-values look significant when the null hypothesis is true.",
  },
  {
    path: "/concepts/simpsons",
    title: "Simpson's paradox",
    tag: "When the total flips",
    desc: "Segment-level conversion rate can disagree with the headline when traffic mix shifts between control and variant groups.",
  },
  {
    path: "/concepts/law-large-numbers",
    title: "Law of large numbers",
    tag: "Small samples jump around",
    desc: "Why baseline conversion rate and uplift look noisy with few visitors, and settle as sample size grows toward your planned test duration.",
  },
  {
    path: "/concepts/distributions",
    title: "Distribution types",
    tag: "Shapes behind your metrics",
    desc: "Normal, binomial, and skewed revenue distributions: when a t-test is appropriate, and how winsorization affects confidence intervals.",
  },
];
