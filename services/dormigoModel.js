import { GoogleGenAI } from '@google/genai';

const models = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-flash-latest'];

export function dormigoModelConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function generateDormigoText(contents, config) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('Dormigo model is not configured.');

  const ai = new GoogleGenAI({ apiKey });
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({ model, contents, config });
      if (response.text?.trim()) return response.text;
    } catch (error) {
      console.warn('[Dormigo] Model request failed:', model, error?.message);
    }
  }
  throw new Error('No response generated from Gemini models.');
}
