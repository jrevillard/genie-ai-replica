import { z } from 'zod';

// Single source of truth for all client-side form validation. Schemas mirror
// the service-layer payloads in src/services/* — keep them in sync when the
// API shape changes. Inferred types are exported alongside each schema so
// callers can reuse them instead of redeclaring field-by-field.

const trimmed = (msg: string) =>
  z
    .string()
    .trim()
    .min(1, msg);

// ---------- Auth ----------

export const signInSchema = z.object({
  loginName: trimmed('Username or email is required'),
  password: z.string().min(1, 'Password is required'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  firstName: trimmed('First name is required'),
  lastName: trimmed('Last name is required'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  agreedToTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to the terms to continue' }),
  }),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

// Verification UI uses 6 digits today; the backend currently expects a hex
// link-token, but the form-level rule is what the user types must be 6 digits.
export const verifyEmailSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z
  .object({
    token: trimmed('Reset token is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from current password',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------- AI Twins ----------

export const createAiTwinSchema = z.object({
  name: trimmed('Name is required').max(120, 'Name is too long'),
  description: z.string().trim().max(2000, 'Description is too long').optional().or(z.literal('')),
  profilePicUrl: z.string().url('Invalid image URL').nullable().optional(),
  linkedKbFileIds: z.array(z.string().min(1)).optional(),
});
export type CreateAiTwinInput = z.infer<typeof createAiTwinSchema>;

export const updateAiTwinSchema = createAiTwinSchema.partial();
export type UpdateAiTwinInput = z.infer<typeof updateAiTwinSchema>;

// ---------- Patients ----------

export const createPatientSchema = z
  .object({
    firstName: trimmed('First name is required').max(120, 'First name is too long'),
    lastName: trimmed('Last name is required').max(120, 'Last name is too long'),
    email: z.string().trim().email('Enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm the password'),
    phone: z.string().trim().max(40, 'Phone number is too long').optional().or(z.literal('')),
    // ISO yyyy-mm-dd from <input type="date"> — keep loose so empty strings pass.
    dateOfBirth: z.string().trim().optional().or(z.literal('')),
    notes: z.string().trim().max(2000, 'Notes are too long').optional().or(z.literal('')),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

// Update flow leaves password to a dedicated subsection so it's never
// silently cleared by a profile save. The General-tab form uses this schema.
// `confirmPassword` is a UI-only field; strip it before unwrapping with
// `.partial()` since `.omit()` works on the inner object.
const patientObjectSchema = z.object({
  firstName: trimmed('First name is required').max(120, 'First name is too long'),
  lastName: trimmed('Last name is required').max(120, 'Last name is too long'),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().trim().max(40, 'Phone number is too long').optional().or(z.literal('')),
  dateOfBirth: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().max(2000, 'Notes are too long').optional().or(z.literal('')),
});
export const updatePatientSchema = patientObjectSchema.partial();
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const changePatientPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm the password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type ChangePatientPasswordInput = z.infer<typeof changePatientPasswordSchema>;
