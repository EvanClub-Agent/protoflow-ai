export interface ProjectQuestion {
  question: string;
  options: string[];
}

export function validateProjectQuestions(value: unknown): asserts value is ProjectQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new Error('请提交 1 至 5 个澄清问题');
  }
  for (const item of value) {
    if (typeof item?.question !== 'string' || !item.question.trim() || !Array.isArray(item.options)
      || item.options.length < 2 || item.options.length > 4
      || item.options.some((opt: unknown) => typeof opt !== 'string' || !opt.trim())
      || new Set(item.options).size !== item.options.length) {
      throw new Error('每个问题需要明确的题目和 2 至 4 个不同的备选答案');
    }
  }
}
