export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/** GenerateContent thinking levels supported by the Gemini models in Deus. */
export function geminiThinkingLevels(model: string): GeminiThinkingLevel[] {
	return model === 'gemini-3.8-flash' ? ['low', 'medium', 'high'] : ['minimal', 'low', 'medium', 'high'];
}
export function resolveGeminiThinking(model: string, value?: string): GeminiThinkingLevel {
	return geminiThinkingLevels(model).find(level => level === value) ?? (model === 'gemini-3.8-flash' ? 'low' : 'minimal');
}
