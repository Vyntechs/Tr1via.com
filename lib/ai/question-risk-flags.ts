import type { GeneratedQuestion } from "./generate-questions";

export type QuestionRiskFlag =
  | "time_sensitive"
  | "ranking_or_superlative"
  | "geography_sensitive"
  | "subjective_wording"
  | "multiple_answer_risk";

type RiskScanQuestion = Pick<
  GeneratedQuestion,
  "prompt" | "options" | "factBlurb"
>;

const RULES: Array<{ flag: QuestionRiskFlag; pattern: RegExp }> = [
  {
    flag: "time_sensitive",
    pattern: /\b(current|currently|today|newest|latest|as of|record|modern|recent|now)\b/i,
  },
  {
    flag: "ranking_or_superlative",
    pattern: /\b(first|largest|oldest|biggest|smallest|longest|shortest|most|least|best|only|record)\b/i,
  },
  {
    flag: "geography_sensitive",
    pattern: /\b(country|countries|capital|state|city|world|national|continent|territory|province|region)\b/i,
  },
  {
    flag: "subjective_wording",
    pattern: /\b(best|greatest|favorite|famous|popular|iconic|legendary|often called)\b/i,
  },
  {
    flag: "multiple_answer_risk",
    pattern: /\b(except|not|all of these|both|either|neither|which of these)\b/i,
  },
];

function scanText(question: RiskScanQuestion): string {
  return [question.prompt, ...question.options, question.factBlurb]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function riskFlagsForQuestion(
  question: RiskScanQuestion,
): QuestionRiskFlag[] {
  const text = scanText(question);
  return RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.flag,
  );
}
