import importlib.util
import unittest
from pathlib import Path
S=Path(__file__).with_name("admit-jlu-onfh-original-mri-studies.py")
sp=importlib.util.spec_from_file_location("onfh",S)
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)

class StudyLevelContract(unittest.TestCase):
    def tree(self):
        entries=[]
        for cls,patient in (("ONFH","subject-A"),("HEALTH","subject-B")):
            for i in range(3):
                entries.append({"path":f"orginal_dataset/{cls}/{patient}/{i}.png",
                                "type":"blob","sha":("%040x" % (i+(100 if cls=="ONFH" else 200)))})
        return {"truncated":False,"tree":entries}
    def test_source_subject_not_slice_is_evaluation_unit(self):
        out=m.inspect_tree(self.tree(),"a"*40)
        self.assertEqual(out["originalStudyCount"],2)
        self.assertEqual(out["originalPngSliceCount"],6)
        self.assertEqual(out["studyCountsByAuthorLabel"],{"HEALTH":1,"ONFH":1})
        self.assertFalse(out["pathologyInferenceCompleted"])
        self.assertIsNone(out["clinicalSensitivity"])
    def test_truncated_tree_refused(self):
        x=self.tree();x["truncated"]=True
        with self.assertRaisesRegex(ValueError,"complete"):m.inspect_tree(x,"a"*40)
    def test_same_study_images_in_both_labels_refused(self):
        x=self.tree()
        for z in x["tree"][3:]:
            z["sha"]="%040x" % (int(z["path"].split("/")[-1][0])+100)
        result=m.inspect_tree(x,"a"*40)
        self.assertEqual(result["duplicateStudyContentGroupCount"],1)
        self.assertFalse(result["safeForStudyLevelTrainTestSplit"])
if __name__=="__main__":unittest.main()
