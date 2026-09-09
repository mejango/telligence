import type { FormErrors, FormValidate } from "./forms";

export type ValidationPath = Array<string | number>;

export interface ValidationIssue {
  message: string;
  path: ValidationPath;
}

type ValidationResult<Values> =
  { data: Values; success: true } | { error: { issues: ValidationIssue[] }; success: false };

export interface ValidationSchema<Values> {
  safeParse: (input: unknown) => ValidationResult<Values>;
}

type ErrorNode = Record<string | number, unknown> | unknown[];

function setIssue(root: ErrorNode, path: ValidationPath, message: string): void {
  if (!path.length) {
    (root as Record<string, unknown>)._form = message;
    return;
  }

  let cursor = root;
  for (const [index, segment] of path.entries()) {
    const key = String(segment);
    if (index === path.length - 1) {
      const existing = (cursor as Record<string, unknown>)[key];
      if (typeof existing === "object" && existing !== null) {
        (existing as Record<string, unknown>)._form = message;
      } else {
        (cursor as Record<string, unknown>)[key] = message;
      }
      return;
    }

    const next = path[index + 1];
    const existing = (cursor as Record<string, unknown>)[key];
    if (typeof existing === "object" && existing !== null) {
      cursor = existing as ErrorNode;
      continue;
    }

    const child: ErrorNode = typeof next === "number" ? [] : {};
    if (typeof existing === "string") {
      (child as Record<string, unknown>)._form = existing;
    }
    (cursor as Record<string, unknown>)[key] = child;
    cursor = child;
  }
}

export function schema<Values>(
  validate: (input: unknown) => ValidationIssue[],
): ValidationSchema<Values> {
  return {
    safeParse(input): ValidationResult<Values> {
      const issues = validate(input);
      return issues.length
        ? { error: { issues }, success: false }
        : { data: input as Values, success: true };
    },
  };
}

export function withSchema<Values>(
  validationSchema: ValidationSchema<Values>,
): FormValidate<Values> {
  return (values) => {
    const result = validationSchema.safeParse(values);
    if (result.success) return {} as FormErrors<Values>;

    const errors: ErrorNode = {};
    for (const issue of result.error.issues) {
      setIssue(errors, issue.path, issue.message);
    }
    return errors as FormErrors<Values>;
  };
}

export function issue(issues: ValidationIssue[], path: ValidationPath, message: string): void {
  issues.push({ message, path });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
