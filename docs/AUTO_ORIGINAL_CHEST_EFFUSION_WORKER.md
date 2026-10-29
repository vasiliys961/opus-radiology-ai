# Chest CT: automatic original TotalSegmentator task315 without browser tokens

The same unified DICOM chest CT Analyze button automatically checks
\`GET /api/local-effusion\` and, **if the genuine trained original model is
actually installed and running**, uses the privately held server
\`OPUS_EFFUSION_WORKER_TOKEN\` instead of asking the physician for host and
token.

The same source HU NIfTI is created ONCE in browser and is used by
the existing nodule and pleural/pericardial fluid tasks sequentially.
No duplicated pleural effusion model or cloud inference. The
original task 315 executes exactly on the private fixed localhost 8774
Linux worker; original checkpoint SHA and vendor-execution limitations
are checked by existing strict capability and report parsers.
Reports with missing/mismatched original model provenance do not
become clinical negative findings.

The new Next route supports only GET capabilities and POST one
source-bound research CT, requires same-origin localhost development,
explicit nonpatient research authorization and original NIfTI SHA,
streams at most 352+512×512×300×4 source bytes, and bounds original
returned JSON. It never forwards clinician-supplied arbitrary URLs
or server credentials. An unconfigured worker is shown as unavailable,
not completed; a manual research fallback remains for developers.

An administrator must once configure the original Linux worker with
an exact matching token in ignored Next \`web/.env.local\`:
\`OPUS_EFFUSION_WORKER_TOKEN\`. This PR does not install that original
pretrained model or run it on the user's own server. An actual
native public DICOM-to-worker end-to-end trial remains outstanding.
It is not a patient/clinical/commercial deployment.
