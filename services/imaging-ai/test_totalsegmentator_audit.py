import hashlib
import json
import pytest
from totalsegmentator_audit import audit,plan,DATASETS,TRAINER,file_record


def test_ct_lobes_need_fast_and_localization_checkpoints():
    p=plan('CT')
    assert p['requiredDatasetIds']==[297,298] and p['fast'] and p['device']=='cpu'
    assert [v['id'] for v in p['labels']]==[10,11,12,13,14]
    assert p['modelSpacingMm']==3 and p['cropModelSpacingMm']==6
    assert plan('CT',roi=['lung_lower_lobe_right'])['labels']==[{'id':14,'name':'lung_lower_lobe_right'}]


@pytest.mark.parametrize('modality,task,roi',[('MR','total',None),('CT','total_mr',None),('CT','coronary_arteries',None),
                                           ('CT','total',[]),('CT','total',['unknown']),('CT','total',['lung_lower_lobe_right']*2),('CT','total','lung_lower_lobe_right'),
                                           ('CT','total',{'lung_lower_lobe_right':True}),('CT','total',[{}])])
def test_unknown_or_restricted_requests_are_rejected(modality,task,roi):
    with pytest.raises(ValueError):plan(modality,task,roi)


def test_missing_and_present_assets_never_claim_ready_or_serialize_config(tmp_path):
    config=tmp_path/'config.json';config.write_text(json.dumps({'send_usage_stats':False,'license_number':'secret-do-not-export'}))
    r=audit(tmp_path,config,installed_version='2.18.0');assert len(r['files'])==6
    assert all(f['status']=='missing' for f in r['files'])
    for folder in DATASETS.values():
        root=tmp_path/folder/TRAINER
        for suffix in ['plans.json','dataset.json','fold_0/checkpoint_final.pth']:
            target=root/suffix;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'synthetic-model-fixture')
    r=audit(tmp_path,config,installed_version='2.18.0')
    assert r['packageStatus']=='version-matched' and r['telemetryStatus']=='disabled-in-local-config'
    assert all(f['status']=='present-unverified' and f['sha256']==hashlib.sha256(b'synthetic-model-fixture').hexdigest() for f in r['files'])
    assert r['canRun'] is False and r['adapterConnected'] is False
    assert 'secret-do-not-export' not in json.dumps(r) and str(tmp_path) not in json.dumps(r)
    assert audit(tmp_path,config,installed_version='2.17.0')['packageStatus']=='missing-or-incompatible'


def test_link_and_empty_file_rejected(tmp_path):
    target=tmp_path/'empty';target.touch()
    assert file_record(tmp_path,'empty')['status']=='rejected-size'
    (tmp_path/'link').symlink_to(target)
    assert file_record(tmp_path,'link')['status']=='rejected-symlink-or-unsafe-file'


def test_oversized_file_is_refused_before_hashing(tmp_path,monkeypatch):
    import totalsegmentator_audit as module
    monkeypatch.setattr(module,'MAX_FILE_BYTES',2)
    (tmp_path/'large').write_bytes(b'123')
    assert file_record(tmp_path,'large')['status']=='rejected-size'


def test_directory_symlink_and_path_escape_are_rejected(tmp_path):
    source=tmp_path/'trusted';source.mkdir()
    (source/'data').write_bytes(b'known')
    (tmp_path/'linked').symlink_to(source, target_is_directory=True)
    assert file_record(tmp_path,'linked/data')['status']=='rejected-symlink-or-unsafe-file'
    assert file_record(tmp_path,'../elsewhere')['status']=='rejected-path'
    assert file_record(tmp_path,'/etc/passwd')['status']=='rejected-path'


def test_fifo_never_blocks_audit(tmp_path):
    import os
    os.mkfifo(tmp_path/'stream')
    assert file_record(tmp_path,'stream')['status']=='rejected-type'


def test_changed_file_is_not_accepted(tmp_path,monkeypatch):
    import totalsegmentator_audit as module
    original_read=module.os.read
    target=tmp_path/'weights'
    target.write_bytes(b'first')
    first=[True]
    def changed_read(fd,n):
        data=original_read(fd,n)
        if first[0]:
            first[0]=False
            target.write_bytes(b'other')
        return data
    monkeypatch.setattr(module.os,'read',changed_read)
    assert file_record(tmp_path,'weights')['status']=='changed-during-audit'
