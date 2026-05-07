import { api } from './http';

// API shapes mirror /api/analytics/admin and /api/analytics/admin/patients
// exactly. Display-only fields belong in components, not here.

export interface AnalyticsPeriod {
  from: string;
  to: string;
}

export interface AnalyticsKpis {
  totalChatSessions: number;
  totalCalls: number;
  activePatients: number;
  newPatients: number;
  totalMessages: number;
  avgResponseTimeMs: number | null;
  avgCallDurationSecs: number | null;
}

export interface ActivityByDayPoint {
  day: string;
  chatSessions: number;
  calls: number;
}

export type AnalyticsChannel = 'chat' | 'whatsapp' | 'call';

export interface ChannelSplitItem {
  channel: AnalyticsChannel;
  count: number;
}

export interface TwinBreakdownRow {
  twinId: string;
  name: string;
  chatSessions: number;
  calls: number;
  avgResponseTimeMs: number | null;
  avgMsgsPerSession: number | null;
  avgCallDurationSecs: number | null;
}

export type SessionLengthBucket = '1-5' | '6-10' | '11-20' | '21+';
export interface SessionLengthDistribution {
  bucket: SessionLengthBucket;
  count: number;
}

export type CallDurationBucket = '<1min' | '1-5min' | '5-15min' | '15+min';
export interface CallDurationDistribution {
  bucket: CallDurationBucket;
  count: number;
}

export interface TopCategoryItem {
  category: string;
  count: number;
}

export interface CallLanguageItem {
  language: string;
  count: number;
}

export interface HourlyDistributionPoint {
  hour: number;
  count: number;
}

export interface AdminAnalyticsSummary {
  period: AnalyticsPeriod;
  kpis: AnalyticsKpis;
  activityByDay: ActivityByDayPoint[];
  channelSplit: ChannelSplitItem[];
  twinBreakdown: TwinBreakdownRow[];
  sessionLengthDistribution: SessionLengthDistribution[];
  callDurationDistribution: CallDurationDistribution[];
  topCategories: TopCategoryItem[];
  callLanguages: CallLanguageItem[];
  hourlyDistribution: HourlyDistributionPoint[];
}

export interface PatientAnalyticsRow {
  patientId: string;
  name: string;
  email: string;
  createdAt: string;
  chatSessions: number;
  calls: number;
  totalMessages: number;
  avgSessionLength: number | null;
  totalCallSecs: number | null;
  avgResponseTimeMs: number | null;
  lastActive: string | null;
}

export interface AdminPatientsResponse {
  total: number;
  offset: number;
  limit: number;
  patients: PatientAnalyticsRow[];
}

export interface RangeParams {
  from: string;
  to: string;
}

export async function getAdminSummary(params: RangeParams): Promise<AdminAnalyticsSummary> {
  const res = await api.get('/analytics/admin', { params });
  return res.data;
}

export interface PatientsParams extends RangeParams {
  offset?: number;
  limit?: number;
}

export async function getAdminPatients(params: PatientsParams): Promise<AdminPatientsResponse> {
  const res = await api.get('/analytics/admin/patients', { params });
  return res.data;
}
