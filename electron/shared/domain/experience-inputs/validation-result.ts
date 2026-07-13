// ---------------------------------------------------------------------------
// Field-level errors and warnings
// ---------------------------------------------------------------------------

/**
 * A validation error that blocks the write or activation.
 * `field` is a dot-separated path to the offending value, e.g.
 * `"subscriptions[0].cadence.every"`.
 */
export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/**
 * A non-blocking advisory attached to a specific field, e.g. a warning that
 * an instrument is outside the validated research universe.
 */
export interface FieldWarning {
  field: string;
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Generic validation result
// ---------------------------------------------------------------------------

/**
 * Outcome of any catalog, subscription, or draft validation pass.
 * `valid` is true only when `errors` is empty.
 */
export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
  warnings: FieldWarning[];
}

export function validationResult(
  errors: FieldError[],
  warnings: FieldWarning[] = [],
): ValidationResult {
  return { valid: errors.length === 0, errors, warnings };
}

export function validResult(warnings: FieldWarning[] = []): ValidationResult {
  return { valid: true, errors: [], warnings };
}

// ---------------------------------------------------------------------------
// Session draft validation
// ---------------------------------------------------------------------------

/**
 * Validation result specific to a `SessionConfigurationDraft`.
 *
 * `subscriptionResults` has one entry per subscription item in the draft,
 * in the same order. A draft is fully valid only when `overall.valid` is true.
 */
export interface SessionDraftValidation {
  overall: ValidationResult;
  subscriptionResults: ValidationResult[];
  /**
   * Whether at least one subscription uses instruments outside the template's
   * validated research universe. The UI must surface this.
   */
  usesUnvalidatedUniverse: boolean;
}
