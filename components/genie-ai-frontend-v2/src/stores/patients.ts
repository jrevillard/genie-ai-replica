import { defineStore } from 'pinia';
import * as api from '../services/patients';
import type {
  CreatePatientPayload,
  Patient,
  PatientTwinAccess,
  UpdatePatientPayload,
} from '../services/patients';
import { extractError } from '../lib/errors';

interface PatientsState {
  patients: Patient[];
  total: number;
  offset: number;
  limit: number;
  current: Patient | null;
  // The patient detail page's twin-access tab keeps its own copy so the
  // mutations there don't have to round-trip through the patient object.
  currentAccess: PatientTwinAccess | null;
  loading: boolean;
  saving: boolean;
  accessLoading: boolean;
  error: string | null;
}

export const usePatientsStore = defineStore('patients', {
  state: (): PatientsState => ({
    patients: [],
    total: 0,
    offset: 0,
    limit: 50,
    current: null,
    currentAccess: null,
    loading: false,
    saving: false,
    accessLoading: false,
    error: null,
  }),

  actions: {
    async fetchAll(params?: { offset?: number; limit?: number }): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const res = await api.listPatients({
          offset: params?.offset ?? this.offset,
          limit: params?.limit ?? this.limit,
        });
        this.patients = res.patients;
        this.total = res.total;
        this.offset = res.offset;
        this.limit = res.limit;
      } catch (err) {
        this.error = extractError(err, 'Failed to load patients');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(patientId: string): Promise<Patient> {
      // Drop the previous patient from `current` so the detail view shows its
      // skeleton instead of the prior patient while the new fetch lands.
      if (this.current?._key !== patientId) {
        this.current = null;
        this.currentAccess = null;
      }
      this.loading = true;
      this.error = null;
      try {
        const patient = await api.getPatient(patientId);
        this.current = patient;
        upsert(this.patients, patient);
        return patient;
      } catch (err) {
        this.error = extractError(err, 'Failed to load patient');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async create(payload: CreatePatientPayload): Promise<Patient> {
      this.saving = true;
      this.error = null;
      try {
        const patient = await api.createPatient(payload);
        this.patients.unshift(patient);
        this.total += 1;
        return patient;
      } catch (err) {
        this.error = extractError(err, 'Failed to create patient');
        throw err;
      } finally {
        this.saving = false;
      }
    },

    async update(patientId: string, payload: UpdatePatientPayload): Promise<Patient> {
      this.saving = true;
      this.error = null;
      try {
        const patient = await api.updatePatient(patientId, payload);
        upsert(this.patients, patient);
        if (this.current?._key === patientId) this.current = patient;
        return patient;
      } catch (err) {
        this.error = extractError(err, 'Failed to update patient');
        throw err;
      } finally {
        this.saving = false;
      }
    },

    async remove(patientId: string): Promise<void> {
      this.saving = true;
      this.error = null;
      try {
        await api.deletePatient(patientId);
        this.patients = this.patients.filter((p) => p._key !== patientId);
        this.total = Math.max(0, this.total - 1);
        if (this.current?._key === patientId) {
          this.current = null;
          this.currentAccess = null;
        }
      } catch (err) {
        this.error = extractError(err, 'Failed to delete patient');
        throw err;
      } finally {
        this.saving = false;
      }
    },

    async fetchAccess(patientId: string): Promise<PatientTwinAccess> {
      this.accessLoading = true;
      try {
        const access = await api.getTwinAccess(patientId);
        this.currentAccess = access;
        return access;
      } catch (err) {
        this.error = extractError(err, 'Failed to load twin access');
        throw err;
      } finally {
        this.accessLoading = false;
      }
    },

    async setAccess(
      patientId: string,
      allowedTwinIds: string[] | null
    ): Promise<PatientTwinAccess> {
      const previous = this.currentAccess;
      // Optimistic — flip the toggle immediately so the UI feels live, then
      // revert if the server rejects.
      this.currentAccess = { patientKey: patientId, allowedTwinIds };
      try {
        const next = await api.setTwinAccess(patientId, allowedTwinIds);
        this.currentAccess = next;
        return next;
      } catch (err) {
        this.currentAccess = previous;
        this.error = extractError(err, 'Failed to update twin access');
        throw err;
      }
    },

    async enableTwin(patientId: string, twinId: string): Promise<PatientTwinAccess> {
      const previous = this.currentAccess;
      // Optimistic local merge: enable means add to the array (creating one
      // if previously null).
      const previousIds = previous?.allowedTwinIds ?? [];
      const set = new Set(previousIds);
      set.add(twinId);
      this.currentAccess = { patientKey: patientId, allowedTwinIds: Array.from(set) };
      try {
        const next = await api.enableTwin(patientId, twinId);
        this.currentAccess = next;
        return next;
      } catch (err) {
        this.currentAccess = previous;
        this.error = extractError(err, 'Failed to enable twin');
        throw err;
      }
    },

    async disableTwin(patientId: string, twinId: string): Promise<PatientTwinAccess> {
      const previous = this.currentAccess;
      const previousIds = previous?.allowedTwinIds ?? [];
      const filtered = previousIds.filter((id) => id !== twinId);
      this.currentAccess = { patientKey: patientId, allowedTwinIds: filtered };
      try {
        const next = await api.disableTwin(patientId, twinId);
        this.currentAccess = next;
        return next;
      } catch (err) {
        this.currentAccess = previous;
        this.error = extractError(err, 'Failed to disable twin');
        throw err;
      }
    },
  },
});

function upsert(list: Patient[], patient: Patient): void {
  const idx = list.findIndex((p) => p._key === patient._key);
  if (idx >= 0) list[idx] = patient;
  else list.unshift(patient);
}
