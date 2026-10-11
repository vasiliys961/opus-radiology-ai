/** Six-case, 12-inference pilot from public-imaging-pilot.zip,
 * deliverables/summary.json. Research-only, not an estimate of diagnosis accuracy.
 * Inference settings differed (Total 3mm, NV 1.5mm) and the sample is tiny.
 */
export type PilotCase = {
  id: string; modality: "CT" | "MR"; region: string; structures: number;
  totalDice: number; nvDice: number; totalSeconds: number; nvSeconds: number;
  geometryPassed: boolean;
};
export const PILOT_CASES: readonly PilotCase[] = [
  { id: "ct-head-s1641", modality: "CT", region: "Голова", structures: 2, totalDice: .8682502265, nvDice: .901636186, totalSeconds: 4.825101861, nvSeconds: 11.302697551, geometryPassed: true },
  { id: "ct-thorax-s0029", modality: "CT", region: "Грудная клетка", structures: 8, totalDice: .951258125, nvDice: .953375642, totalSeconds: 40.81204385, nvSeconds: 216.067668241, geometryPassed: true },
  { id: "ct-abdomen-s0013", modality: "CT", region: "Живот", structures: 7, totalDice: .923724565, nvDice: .942826504, totalSeconds: 17.578780254, nvSeconds: 68.494611664, geometryPassed: true },
  { id: "mr-head-s0537", modality: "MR", region: "Голова", structures: 1, totalDice: .975193816, nvDice: .937328268, totalSeconds: 3.838678255, nvSeconds: 13.338682542, geometryPassed: true },
  { id: "mr-thorax-s0175", modality: "MR", region: "Грудная область (МРТ всего тела)", structures: 4, totalDice: .937489029, nvDice: .935413256, totalSeconds: 40.463695028, nvSeconds: 339.390775017, geometryPassed: true },
  { id: "mr-abdomen-s0143", modality: "MR", region: "Живот", structures: 7, totalDice: .888714306, nvDice: .890613763, totalSeconds: 13.844099549, nvSeconds: 42.147499188, geometryPassed: true },
];
export const PILOT_NOTES = {
  nCases: 6,
  successfulRuns: 12,
  geometryValidated: true,
  pathologyValidated: false,
  externalValidation: false,
  weakMRPancreasTotalDice: .646,
  weakMRPancreasNvDice: .623,
  imagingModelInstalled: false,
  m1Validated: false,
} as const;
