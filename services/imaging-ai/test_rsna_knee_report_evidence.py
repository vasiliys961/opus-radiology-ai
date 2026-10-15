import json
import csv
import tempfile
import unittest
from pathlib import Path
from rsna_knee_report_evidence import candidate_states,extract
from rsna_knee_label_prep import load_jsonl

class CandidateEvidenceTests(unittest.TestCase):
    def test_explicit_and_missing(self):
        result=candidate_states("Complete ACL tear. No joint effusion.")
        self.assertEqual(result["ACL"],"positive")
        self.assertEqual(result["Effusion"],"negative")
        self.assertEqual(result["Synovitis"],"not_mentioned")
    def test_uncertainty_and_conflict(self):
        self.assertEqual(candidate_states("Possible acute fracture.")["Fracture"],"uncertain")
        self.assertEqual(candidate_states("Acute fracture. No fracture.")["Fracture"],"uncertain")
        self.assertEqual(candidate_states("No evidence of complete ACL tear.")["ACL"],"uncertain")
    def test_explicit_abstention(self):
        self.assertEqual(candidate_states("Meniscal signal abnormality. Normal other structures.")["Medial Meniscus"],"not_mentioned")
        self.assertEqual(candidate_states("Old ACL tear.")["ACL"],"uncertain")
        self.assertEqual(candidate_states("разрыв передней крестообразной связки")["ACL"],"not_mentioned")
    def test_all_twelve_candidate_coverage(self):
        examples={
            "ACL":"ACL rupture",
            "MCL":"MCL tear",
            "Medial Meniscus":"Medial meniscus tear",
            "Lateral Meniscus":"Lateral meniscus tear",
            "Medial OA":"Medial compartment osteoarthritis",
            "Lateral OA":"Lateral compartment osteoarthrosis",
            "PF OA":"Patellofemoral osteoarthritis",
            "Effusion":"Small joint effusion",
            "Synovitis":"Diffuse synovitis",
            "Baker's":"Baker's cyst present",
            "Contusion":"Bone contusion",
            "Fracture":"Acute fracture",
        }
        for label,report in examples.items():
            with self.subTest(label=label):
                self.assertEqual(candidate_states(report)[label],"positive")
    def test_no_unmentioned_negative_and_contradiction(self):
        self.assertEqual(candidate_states("No knee effusion.")["ACL"],"not_mentioned")
        self.assertEqual(candidate_states("No lateral meniscus tear.")["Lateral Meniscus"],"uncertain")
        self.assertEqual(candidate_states("Baker's cyst present. No Baker's cyst.")["Baker's"],"uncertain")
    def test_explicit_negatives_are_negative(self):
        samples={
            "Effusion":"No joint effusion.",
            "Fracture":"No acute fracture.",
            "Synovitis":"No evidence of synovitis.",
            "Baker's":"No Baker's cyst.",
            "Contusion":"No bone contusion.",
        }
        for label,phrase in samples.items():
            with self.subTest(label=label):
                self.assertEqual(candidate_states(phrase)[label],"negative")
    def test_jsonl_contract_and_no_text_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with (root/"train.csv").open("w",newline="") as f:
                writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID","Report"])
                writer.writeheader()
                writer.writerow({"StudyInstanceUID":"study-A","Report":"Complete ACL tear."})
            path=root/"candidate.jsonl"
            summary=extract(root/"train.csv",path)
            self.assertEqual(summary["studies"],1)
            self.assertEqual(len(list(load_jsonl(path))),1)
            self.assertNotIn("Complete ACL tear",path.read_text())
    def test_duplicate_uid(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with (root/"train.csv").open("w",newline="") as f:
                writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID","Report"])
                writer.writeheader()
                writer.writerow({"StudyInstanceUID":"a","Report":"Acute fracture"})
                writer.writerow({"StudyInstanceUID":"a","Report":"No fracture"})
            with self.assertRaises(ValueError):
                extract(root/"train.csv",root/"out.jsonl")
if __name__=="__main__":unittest.main()
