/**
 * Fail-closed release gate for *real* patient images and narratives.
 *
 * This app does NOT yet have independent clinical de-identification,
 * clinician authorization or audited consent records. No browser checkbox,
 * bearer token, or field in user-submitted JSON is trusted as an attestation.
 */
export const PATIENT_CLOUD_TRANSMISSION_RELEASED = false as boolean;

export const PATIENT_CLOUD_REQUIREMENTS = [
  { id: "physician-auth", label: "Подтверждённая сессия и роль врача" },
  { id: "study-consent", label: "Согласие и законное основание для конкретного исследования" },
  { id: "dicom-deidentification", label: "Стандартное обезличивание DICOM и частных тегов" },
  { id: "pixel-privacy", label: "Проверка текста внутри пикселей и биометрических рисков" },
  { id: "provider-jurisdiction", label: "Проверка провайдера, региона и обработки медицинских данных" },
  { id: "audit-retention", label: "Серверный аудит, сроки хранения и право доступа" },
  { id: "clinical-validation", label: "Валидация передачи и врачебного review workflow" },
] as const;

export type ServerVerifiedCloudRequirements = {
  // Only future trusted server-side implementation may produce these flags.
  physicianAuthentication: boolean;
  studyConsent: boolean;
  dicomDeidentification: boolean;
  pixelPrivacy: boolean;
  providerJurisdiction: boolean;
  auditRetention: boolean;
  clinicalValidation: boolean;
};
export type CloudReleaseDecision = {
  permitted: false;
  reason: string;
  missing: string[];
};

/** Intentionally cannot release patient data until an audited milestone. */
export function evaluatePatientCloudRelease(
  context: Partial<ServerVerifiedCloudRequirements> | null,
): CloudReleaseDecision {
  const requirements: Array<keyof ServerVerifiedCloudRequirements> = [
    "physicianAuthentication", "studyConsent", "dicomDeidentification",
    "pixelPrivacy", "providerJurisdiction", "auditRetention", "clinicalValidation",
  ];
  const missing = requirements.filter(key => context?.[key] !== true);
  return {
    permitted: false,
    reason: PATIENT_CLOUD_TRANSMISSION_RELEASED ?
      "Blocked: no trusted production authorization flow is connected." :
      "Blocked: patient-cloud transmission has not been clinically/privacy released.",
    missing: [
      ...missing,
      "production-release-not-implemented",
    ],
  };
}
