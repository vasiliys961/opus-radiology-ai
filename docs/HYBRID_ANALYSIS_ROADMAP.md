# Hybrid analysis: agreed direction and implementation boundaries

Status after v1.4.0: local DICOM, 2D, MPR and volume rendering are implemented.
Segmentation, pathology detection, external visual analysis and clinical synthesis
are not connected. The disabled analysis controls must stay disabled until a real
provider is implemented and its results can be traced to source evidence.

## Processing contract for the next stage

1. Validate the complete selected DICOM series and preserve source geometry:
   orientation, position, spacing, frame of reference and scalar transform.
   The specialized model input must be a physical 3D volume, not a handful of
   JPEG screenshots. Record missing sequences, incomplete coverage and anisotropy.
2. Route to a specialized model by modality, anatomy, sequence and task. Model
   weights belong in a separate inference service/cache, outside the public git
   repository and outside the browser bundle. Use a compatible, isolated Python
   environment; do not install heavyweight models in ATLAXIS or Doctor Opus.
3. Return versioned masks, physical-coordinate findings, supported measurements,
   provenance and quality checks. Register every output against the source volume.
   A segmentation mask is not a disease diagnosis; finding unsupported anatomy
   or sequences must produce an explicit unsupported result.
4. Run an independent visual analysis when a real provider is available. Adapt
   the useful Gemini/Doctor Opus interfaces after auditing them. Display exactly
   which frames or derived representations the visual model has received; it
   must not imply inspection of the complete study when it saw sampled images.
5. Reconcile observations by location and evidence. Keep contradictions visible,
   do not resolve them by majority voting between LLMs. Missing model coverage
   must not be reported as a negative finding.
6. Supply the reconciled evidence and clinical context to Claude/GPT through a
   protected server API. Separate source observations, model outputs, measured
   values, interpretation and limitations in a structured reviewable report.
   Clinical context enriches interpretation; it must not overwrite source facts.

## Model selection

Candidates discussed include TotalSegmentator, MONAI/nnU-Net task-specific models,
SynthSeg for supported brain MRI, interactive MedSAM, and VISTA-based models.
These are candidates, not installed providers or universal disease detectors.
Before connecting any exact checkpoint, record its code and weight licenses,
commercial-use conditions, supported modalities and sequences, hardware needs,
training domain, validation data and known failure modes. Recheck these against
the current primary model documentation instead of relying on earlier chat claims.

The knee MRI used for viewer testing must not be sent to an arbitrary CT or brain
model. Choose and validate the first narrow segmentation task before enabling it.
No numeric diagnostic-accuracy target can be promised from combined LLM/model
outputs without task-specific validation on held-out reference studies.

## Resource and privacy boundaries

- Keep the existing Mac M1 8 GiB input limits until memory profiling supports a
  change. New rendering quality presets only change ray sampling, not the voxel
  grid or the information content of the study.
- Audit deidentification before exporting anything. Do not reuse peripheral
  image masking from Doctor Opus: preserving anatomical coverage is required.
  Metadata removal alone does not establish that burned-in text or facial
  information is absent. Any external export needs the required consent.
- Keep API credentials on the server, never in git or browser code. Do not
  enable an analysis button just because OPENROUTER_API_KEY exists locally.
- A successful build is not Safari runtime validation or clinical validation.

## Acceptance of the next segmentation milestone

Select one supported task, run an actual compatible provider, validate source-to-
mask geometry on a legal reference dataset, overlay masks on MPR, then generate
surfaces with documented interpolation. Include reproducible checks for spacing,
coordinate alignment, unsupported inputs, cancelled jobs and resource release.
Only after this milestone should the hybrid clinical-synthesis path be enabled.
