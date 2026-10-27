# Working CT/MR lesion-size caliper in the physician viewer

The main DICOM workstation includes a real **two-click in-plane millimeter
caliper** on original CT/MRI source images. The physician clicks two points,
sees a line on the actual source image and obtains millimeters calculated
from DICOM PixelSpacing, not browser zoom or a guessed scale. Up to 16
source-SOP-bound linear measurements can be retained across the selected
series and exported locally as unsigned JSON.

This is an immediate imaging measurement feature, not a model candidate,
medical diagnostic claim, or whole-tumor dimension/volume. Anatomic location
and lesion borders are selected by the physician. PixelSpacing must be
present and valid; only original uncompressed single-frame monochrome
CT/MR DICOM are handled in this bounded component. Other DICOM formats
remain available in the regular Cornerstone viewer but are not silently
assigned measured lengths.

Source UIDs in exported JSON can be sensitive metadata; do not upload them
to external LLM services. Local calculation does not transmit source DICOM.
