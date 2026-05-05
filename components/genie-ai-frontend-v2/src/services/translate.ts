import { api } from './http';

interface TranslateResponse {
  translated_texts: string[];
}

interface TranslateMarkdownResponse {
  translated_markdown: string;
}

export async function translateTexts(
  texts: string[],
  sourceLang: string,
  targetLang: string
): Promise<string[]> {
  const res = await api.post<TranslateResponse>('/translate', {
    texts,
    source_lang: sourceLang,
    target_lang: targetLang,
  });
  return res.data.translated_texts ?? [];
}

export async function translateMarkdown(
  markdown: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const res = await api.post<TranslateMarkdownResponse>('/translate/markdown', {
    markdown,
    source_lang: sourceLang,
    target_lang: targetLang,
  });
  return res.data.translated_markdown ?? markdown;
}
