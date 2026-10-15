# RSNA knee: weak-label admission

This module does **not** call external LLMs or send any reports over a network. It ingests a local JSONL previously prepared by a legally authorized process. Each JSONL entry must contain `StudyInstanceUID` and `labels` with all twelve keys exactly matching the competition header. Allowed states are `positive`, `negative`, `uncertain`, `not_mentioned`. **No mention is not a negative.**

Clinical caution: report-derived labels are *weak* supervision, not expert ground truth. An old MCL sprain, cartilage defect, OA, and subchondral osteonecrosis require careful interpretation of the actual competition label ontology. No universal rule-based mapping is asserted.

To merge known binary gold labels with independently reviewed weak labels:

```bash
python services/imaging-ai/rsna_knee_label_prep.py \
  --csv /kaggle/input/competitions/rsna-knee-abnormality-detection/train.csv \
  --labels-jsonl /kaggle/working/reviewed-labels.jsonl \
  --out /kaggle/working/knee-labels.csv
```

Output: CSV of 12 label columns and an audit JSON. Source gold labels take precedence, and unknown values are blank, not 0. A positive-precision gate can block classes with poor gold performance, but performance estimated on the same gold used for prompt development is biased. Protect an untouched validation subset of gold studies, prevent patient/study overlap, evaluate sensitivity as well as precision, and seek additional expert annotations before relying on weak labels.

Only use external LLMs or commercial APIs after verifying RSNA MIRA licensing, competition participation eligibility, cross-border transfer permissions, privacy obligations, provider terms and budget caps. Do not commit actual reports, labels, DICOMs, API keys, or model weights without explicit authorization.

Current code is a training data preparation *component*, not an end-to-end Kaggle training notebook.
