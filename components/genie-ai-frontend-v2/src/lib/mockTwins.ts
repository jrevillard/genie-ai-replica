// Sample data so the dashboard renders meaningfully before the backend is wired.
// Replace with API-backed Pinia store once endpoints exist.

export interface AiTwin {
  id: string;
  name: string;
  avatar: string;
  dateEdited: string;
  dateCreated: string;
  voiceLibrary: string;
  numberOfChats: number;
  numberOfCalls: number;
  active: boolean;
  description?: string;
}

export const mockTwins: AiTwin[] = Array.from({ length: 6 }).map((_, i) => ({
  id: `twin-${i + 1}`,
  name: 'Andrew Ainsley',
  avatar: 'https://i.pravatar.cc/120?img=' + (i + 11),
  dateEdited: 'March 18, 2024',
  dateCreated: 'March 7, 2024',
  voiceLibrary: 'Voice Sample 01',
  numberOfChats: 125,
  numberOfCalls: 27,
  active: true,
  description:
    'It is a long established fact that a reader will be distracted by the readable content of a page when looking at its layout.',
}));
