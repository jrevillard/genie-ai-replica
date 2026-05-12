import { sha256Hex } from './crypto';
import { api } from './http';

// API shape mirrors `/api/patients` exactly. Patients are created and managed
// per-admin (the backend scopes by adminId).

export interface PatientPersonalIdentification {
  fullName: string;
  firstName: string;
  lastName: string;
  phone: string;
  dob: string;
}

export interface Patient {
  _key: string;
  email: string;
  loginName: string;
  adminId: string;
  role: 'User';
  personalIdentification: PatientPersonalIdentification;
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Backend-enriched fields from `/api/patients`. All optional because the
  // detail endpoint may not include every counter, and older snapshots in
  // memory predate this enrichment.
  emailVerified?: boolean;
  twinsAllowedCount?: number | null;
  lastActivityAt?: string | null;
  totalSessions?: number;
  numChats?: number;
  lastChatAt?: string | null;
  numWhatsappChats?: number;
  numCalls?: number;
  lastCallAt?: string | null;
}

export interface ListPatientsParams {
  offset?: number;
  limit?: number;
}

export interface ListPatientsResponse {
  patients: Patient[];
  total: number;
  offset: number;
  limit: number;
}

export interface CreatePatientPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
}

// Update accepts every create field plus an optional password — but unlike
// create, password is fully optional (existing one stays put when omitted).
export type UpdatePatientPayload = Partial<Omit<CreatePatientPayload, 'email'>> & {
  email?: string;
  password?: string;
};

// `null` means "no whitelist — patient sees every twin the admin owns".
// `[]` means "explicitly blocked from every twin". The tristate is intentional
// and the UI must preserve it on the way out.
export interface PatientTwinAccess {
  patientKey: string;
  allowedTwinIds: string[] | null;
  // Backend may include a human-readable success message (e.g. "Twin added to
  // patient's allowed list"). Surfaced in the UI as a toast when present.
  message?: string;
}

export async function listPatients(params: ListPatientsParams = {}): Promise<ListPatientsResponse> {
  const res = await api.get<ListPatientsResponse>('/patients', {
    params: { offset: params.offset ?? 0, limit: params.limit ?? 50 },
  });
  return res.data;
}

export async function getPatient(patientId: string): Promise<Patient> {
  const res = await api.get<Patient>(`/patients/${encodeURIComponent(patientId)}`);
  return res.data;
}

export async function createPatient(
  payload: CreatePatientPayload,
  signal?: AbortSignal
): Promise<Patient> {
  // Match the project's auth-flow convention: hash with SHA-256 hex on the
  // client before sending. The backend stores/compares the hex digest.
  const body: CreatePatientPayload = {
    ...payload,
    password: await sha256Hex(payload.password),
  };
  const res = await api.post<Patient>('/patients', body, { signal });
  return res.data;
}

export async function updatePatient(
  patientId: string,
  payload: UpdatePatientPayload
): Promise<Patient> {
  // Same hashing convention — only when the caller actually included a new
  // password. Profile-only updates leave the field undefined and skip this.
  const body: UpdatePatientPayload =
    payload.password !== undefined
      ? { ...payload, password: await sha256Hex(payload.password) }
      : payload;
  // Note: backend uses PUT here (AI Twins use PATCH — different endpoints).
  const res = await api.put<Patient>(`/patients/${encodeURIComponent(patientId)}`, body);
  return res.data;
}

export async function deletePatient(patientId: string): Promise<void> {
  await api.delete(`/patients/${encodeURIComponent(patientId)}`);
}

// ---------- Twin access (tristate whitelist) ----------

export async function getTwinAccess(patientId: string): Promise<PatientTwinAccess> {
  const res = await api.get<PatientTwinAccess>(
    `/patients/${encodeURIComponent(patientId)}/twin-access`
  );
  return res.data;
}

export async function setTwinAccess(
  patientId: string,
  allowedTwinIds: string[] | null
): Promise<PatientTwinAccess> {
  const res = await api.put<PatientTwinAccess>(
    `/patients/${encodeURIComponent(patientId)}/twin-access`,
    { allowedTwinIds }
  );
  return res.data;
}

export async function enableTwin(
  patientId: string,
  twinId: string
): Promise<PatientTwinAccess> {
  const res = await api.post<PatientTwinAccess>(
    `/patients/${encodeURIComponent(patientId)}/twin-access/${encodeURIComponent(twinId)}`
  );
  return res.data;
}

export async function disableTwin(
  patientId: string,
  twinId: string
): Promise<PatientTwinAccess> {
  const res = await api.delete<PatientTwinAccess>(
    `/patients/${encodeURIComponent(patientId)}/twin-access/${encodeURIComponent(twinId)}`
  );
  return res.data;
}
