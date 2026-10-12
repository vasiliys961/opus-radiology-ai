# TotalSegmentator measured resource admission (research preparation)
This is a **pure preflight calculator only**, not a connected worker or an authorization to execute inference.
Only matching, externally verified *measured* peak RAM evidence for the exact checkpoint/task/hardware profile can pass.
A minimum additional 512 MiB reserve is applied, together with a conservative disk budget for native input/output.
Unknown model memory, altered checkpoint, other hardware profiles and insufficient RAM/disk fail closed.
On the user's Mac M1/8 GB there is **no validated TotalSegmentator resource evidence**: it therefore rejects by default.
An allow decision still sets `inferenceEnabled=false`. No weights, Torch, DICOM, network, or patient data are accessed.
Synthetic positive and negative tests do not claim model accuracy, memory measurement, or device acceptance.
