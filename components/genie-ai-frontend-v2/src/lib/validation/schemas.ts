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
  remember: z.boolean().optional(),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  firstName: trimmed('First name is required'),
  lastName: trimmed('Last name is required'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
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
