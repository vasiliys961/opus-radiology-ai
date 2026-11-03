/** DICOM PS3.3 C.8.2.1: original, non-localizer, non-multi-energy CT is HU.
 * Conservative subset: classic CT Image Storage, explicitly ORIGINAL + AXIAL.
 * https://dicom.nema.org/medical/dicom/2025d/output/chtml/part03/sect_C.8.2.html
 * No modality-only, coefficient-only or appearance-based inference.
 */
export function standardCtRescaleUnit(raw:string|null,modality:string,sopClass:string|null,imageType:string|null,multiEnergy:string|null):'HU'|'OTHER'|'UNSPECIFIED'{
 if(raw!==null)return raw.trim().toUpperCase()==='HU'?'HU':'OTHER';
 const type=imageType?.trim().toUpperCase().split('\\');
 return modality==='CT'&&sopClass==='1.2.840.10008.5.1.4.1.1.2'&&type?.[0]==='ORIGINAL'&&type?.[2]==='AXIAL'&&
  (multiEnergy===null||multiEnergy.trim().toUpperCase()==='NO')?'HU':'UNSPECIFIED';
}
