# Local diagnostic review — available separately from patient cloud

**No patient-cloud bypass.** The existing \`PATIENT_CLOUD_TRANSMISSION_RELEASED\`
remains false, even with a claimed browser consent checkbox or API token.

The new \`evaluateLocalDiagnosticReview\` grants permission to write an unsigned,
local-only CT/MR **physician differential and synthesis** when the imported AI
evidence has been linked to the currently open DICOM source.
\`AiEvidenceReview\` is the entry point. The user can formulate a clinical
question, record possible explanations per AI finding, and download a JSON draft.
Changes to the opened source invalidate the UI's linkage and block export.
This does not call or unlock any cloud model, store data on the server,
authenticate the clinician or issue a signed diagnosis.

Automatic CT/MR pathology detection remains model-specific and **not**
unlocked by a policy boolean. Models / labels must be validated and connected
to a source-bound on-device or private worker task. This first increment
unblocks *clinician-local analysis and drafting*, not patient-cloud transfer or
autonomous clinical diagnostic approval.

Next: local evidence fusion for specialist pathology checkpoints; independent
reference benchmarks; auditable reviewer and study identity when operating with
real patients; patient egress only after actual audited regulatory/privacy controls.
