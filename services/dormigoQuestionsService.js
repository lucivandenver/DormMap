import { BploSystemSetting } from '../models/adminModels.js';

export const dormigoQuestionsKey = 'dormigo_quick_questions';
const defaults = [
  'What dorms are available near MinSU?',
  'What are the budget boarding houses in Bongabong?',
  'How can I contact a boarding house owner?',
  'How can I pay rent with QR Ph?',
  'How do I find a BPLO-verified boarding house?'
];

export function validateDormigoQuestions(value) {
  if (!Array.isArray(value) || value.length !== defaults.length ||
      value.some(question => typeof question !== 'string' || !question.trim() || question.trim().length > 160)) {
    throw Object.assign(new Error('Enter five Dormigo questions, each up to 160 characters.'), { status: 422 });
  }
  return value.map(question => question.trim());
}

export async function getDormigoQuestions() {
  const setting = await BploSystemSetting.findByPk(dormigoQuestionsKey);
  if (setting) {
    try { return validateDormigoQuestions(JSON.parse(setting.value)); } catch { /* Use defaults for invalid stored values. */ }
  }
  return defaults;
}
