from pathlib import Path
import gzip,shutil,json,hashlib,sys
import numpy as np
import nibabel as nib
# Explicit local source only. No downloads, provider calls or ground-truth reads.
root=Path(sys.argv[1]).resolve()
if not str(root).startswith(('/tmp/','/private/tmp/')):raise ValueError('Temporary public-data directory required')
expected={'longciu_img.nii.gz':'af54aff713e7054d204b5e5e2aa0598c856006229901eea791ece8ae2efe8ab8',
'longciu_splits.json':'7f4d62f33f68a16cd2df10cc320e087d43802970de63e6e459885f5c7e5604bf'}
for name,sha in expected.items():
 h=hashlib.sha256()
 with (root/name).open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 if h.hexdigest()!=sha:raise ValueError('Public source checksum mismatch: '+name)
source=root/'longciu_img.nii'
with gzip.open(root/'longciu_img.nii.gz','rb') as src,source.open('wb') as dst:shutil.copyfileobj(src,dst,1024*1024)
image=nib.load(source,mmap=True)
if image.shape!=(512,512,90):raise ValueError('Unexpected shape')
split=json.loads((root/'longciu_splits.json').read_text())
cases=[]
for serial,index in enumerate([0,40],1):
 if index not in split['test']:raise ValueError('Not author test split')
 plane=np.asarray(image.dataobj[:,:,index],dtype=np.float32).T
 if not np.isfinite(plane).all() or plane.min() < -2048 or plane.max()>10000:raise ValueError('Invalid source HU')
 path=root/f'case-{serial:02d}.f32';plane.astype('<f4').tofile(path)
 cases.append({'caseId':f'case-{serial:02d}','sourceSliceIndex':index,'sourceSplit':'author-test',
 'valuesFile':path.name,'valuesSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'width':512,'height':512})
(root/'cases.json').write_text(json.dumps({'dataset':'LongCIU','doi':'10.25820/data.007301','license':'ODC-By 1.0','revision':'c4b975090c16fabe59079a528dd920d956e16c66','selection':'fixed test indices 0 and 40, before mask inspection; each image independent, not contiguous CT','cases':cases},indent=2))
print(json.dumps({'prepared':len(cases),'shape':image.shape,'groundTruthRead':False}))
