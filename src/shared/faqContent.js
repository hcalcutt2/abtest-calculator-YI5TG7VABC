/** FAQ copy — keep in sync with public/schema-faq.json and index.html static block */
export const FAQ_ITEMS = [
  {
    q: "What is an A/B test calculator?",
    a: "It helps you plan and analyse experiments without spreadsheets. Eclipse covers sample size planning, statistical significance testing, conversion rate analysis, and revenue metrics, with confidence levels, confidence intervals, and p-values explained in plain English.",
  },
  {
    q: "How does this A/B testing calculator work?",
    a: "Use Plan a test to estimate sample size and test duration from your baseline conversion rate, MDE, traffic, confidence level, and statistical power. When your test finishes, open Analyse results to check significance. Paste control and variant counts or upload revenue data to see p-values, uplift, and confidence intervals.",
  },
  {
    q: "Is my A/B test statistically significant?",
    a: "Enter visitors and conversions for your control group and each variant, or upload revenue data. The tool runs the right test (a z-test for conversion rate or Welch's t-test for revenue) and compares the p-value to your confidence level. You get a plain-English verdict and a confidence interval for the uplift.",
  },
  {
    q: "What sample size do I need for A/B testing?",
    a: "It depends on baseline conversion rate, minimum detectable effect, confidence level, statistical power, and how many variants you run. Plan a test returns visitors needed per variant, total traffic, and estimated weeks to reach that sample at your current volume.",
  },
  {
    q: "How long should an A/B test run?",
    a: "Run until you hit the sample size your plan requires. Stopping early inflates false positives. Ideally cover one to two full business weeks so weekday and weekend patterns are both represented. Plan a test estimates duration from your traffic.",
  },
  {
    q: "What confidence level should I use in A/B testing?",
    a: "Confidence level is how sure you want to be before calling a winner. 95% is the usual default (about a 1-in-20 false-positive risk). This calculator supports 90%, 95%, and 99%. Higher confidence needs more traffic but reduces false alarms.",
  },
  {
    q: "What is a confidence interval in A/B testing?",
    a: "A confidence interval is the range where the true uplift likely falls at your chosen confidence level. If the uplift interval excludes zero, the result is statistically significant. The interval also shows how large the effect might be, not just whether it cleared the bar.",
  },
  {
    q: "What is statistical power in A/B testing?",
    a: "Statistical power is the probability your test detects a real lift when one exists. At 80% power (the default here) there is roughly a one-in-five chance of missing a genuine winner. Set power alongside confidence level in Plan a test before you start.",
  },
  {
    q: "What is the minimum detectable effect (MDE)?",
    a: "The MDE is the smallest relative uplift you want the test to reliably spot. For example, 10% on a 2% baseline means detecting a move from 2.00% to 2.20%. Smaller MDEs need much larger samples. Pick an MDE based on the smallest change that would actually change your decision.",
  },
  {
    q: "What is a p-value in A/B testing?",
    a: "The p-value answers: if there were truly no difference between control and variant, how often would you see a gap at least this large just from randomness? If p-value is below your significance threshold (e.g. 0.05 at 95% confidence), the result is statistically significant.",
  },
  {
    q: "One-sided vs two-sided test: which should I use?",
    a: "A two-sided test asks whether the variant is different, better or worse. A one-sided test asks only whether it is better. Use one-sided only when a decrease in conversion rate would be treated exactly the same as no change. Two-sided is the default here.",
  },
  {
    q: "Can this A/B testing calculator handle more than two variants?",
    a: "Yes. Compare three or more variants against control at once. Holm-Bonferroni correction is applied automatically so your overall false-positive rate stays near your confidence level. You can also set unequal traffic splits.",
  },
  {
    q: "Can I measure revenue, not just conversion rate?",
    a: "Yes. Upload order-level revenue data to measure revenue per visitor (RPV) and average order value (AOV). Revenue is analysed with Welch's t-test for skewed data. You can cap outliers at the 90th, 95th, or 99th percentile before analysis.",
  },
  {
    q: "What is a sample ratio mismatch (SRM)?",
    a: "A sample ratio mismatch happens when actual traffic splits do not match the planned allocation, often pointing to a tracking or redirect bug. Eclipse flags mismatches in results so you can check your implementation before acting on the numbers.",
  },
];
