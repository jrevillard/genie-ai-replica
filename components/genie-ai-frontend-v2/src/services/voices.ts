import { api } from './http';

export type VoiceGender = 'female' | 'male' | string;

export interface Voice {
  _key: string;
  name: string;
  language: string;
  gender: VoiceGender;
  modelVoiceId: string;
  enabled: boolean;
}

export async function listVoices(): Promise<Voice[]> {
  const res = await api.get<Voice[]>('/voices');
  return res.data;
}

export async function previewVoice(voiceId: string, text: string): Promise<Blob> {
  const res = await api.post<Blob>(
    `/voices/${encodeURIComponent(voiceId)}/preview`,
    { text },
    { responseType: 'blob' }
  );
  return res.data;
}
