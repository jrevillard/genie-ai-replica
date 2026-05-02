import { reactive } from 'vue';
import type { z, ZodIssue, ZodTypeAny } from 'zod';

// Thin Vue wrapper around a zod schema. Keeps the same `errors[field]` shape
// the existing forms already bind to via `:error="errors.x"`, so adopting it
// is a swap of the form's local `validate()` for `form.validate()` — no
// template changes needed.

type ErrorMap<T> = { [K in keyof T]: string | null };

export interface ZodForm<T extends Record<string, unknown>> {
  errors: ErrorMap<T>;
  validate: (data: T) => boolean;
  validateField: (field: keyof T, data: T) => boolean;
  reset: () => void;
}

function emptyErrors<T extends Record<string, unknown>>(keys: ReadonlyArray<keyof T>): ErrorMap<T> {
  const map = {} as ErrorMap<T>;
  for (const k of keys) map[k] = null;
  return map;
}

function pickFieldError(issues: ZodIssue[], field: PropertyKey): string | null {
  const issue = issues.find((i) => i.path[0] === field);
  return issue?.message ?? null;
}

export function useZodForm<S extends ZodTypeAny>(
  schema: S,
  fieldNames: ReadonlyArray<keyof z.infer<S>>
): ZodForm<z.infer<S>> {
  type T = z.infer<S>;
  const errors = reactive(emptyErrors<T>(fieldNames)) as ErrorMap<T>;

  function clear(): void {
    for (const k of fieldNames) errors[k] = null;
  }

  function validate(data: T): boolean {
    clear();
    const result = schema.safeParse(data);
    if (result.success) return true;
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof T | undefined;
      if (key !== undefined && fieldNames.includes(key) && !errors[key]) {
        errors[key] = issue.message;
      }
    }
    return false;
  }

  function validateField(field: keyof T, data: T): boolean {
    const result = schema.safeParse(data);
    errors[field] = result.success ? null : pickFieldError(result.error.issues, field);
    return errors[field] === null;
  }

  return { errors, validate, validateField, reset: clear };
}
