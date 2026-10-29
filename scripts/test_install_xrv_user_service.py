#!/usr/bin/env python3
"""No-root Linux service installer checks, never invokes systemctl in CI."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

from install_xrv_user_service import (
    UNIT,render_unit,install,enable_service
)


class PrivateOriginalXrvService(unittest.TestCase):
    def test_render_does_not_embed_secrets_or_patient_data(self):
        with tempfile.TemporaryDirectory() as root:
            repo=Path(root)/"opus";(repo/"scripts").mkdir(parents=True)
            (repo/"scripts/start_xrv_research_worker.py").write_text("print('test')")
            (repo/"web").mkdir()
            config=render_unit(repo,Path(root)/"original-weight-cache",
                               Path(sys.executable),repo/"web/.env.local")
            self.assertIn("NoNewPrivileges=yes",config)
            self.assertIn("Restart=on-failure",config)
            self.assertIn("UMask=0077",config)
            self.assertIn("127.0.0.1:3000",config)
            self.assertIn("ProtectSystem=full",config)
            self.assertIn("start_xrv_research_worker.py",config)
            for forbidden in ("OAuth ","YANDEX_DISK_TOKEN=",
                              "Bearer ","PatientName","patient-data/"):
                self.assertNotIn(forbidden,config)
            with self.assertRaisesRegex(ValueError,"cache_must_not"):
                render_unit(repo,repo/"weights",Path(sys.executable),
                            repo/"web/.env.local")
            with self.assertRaisesRegex(ValueError,"server_environment"):
                render_unit(repo,Path(root)/"cache",Path(sys.executable),
                            repo/"settings.env")
            self.assertFalse((repo/"web/.env.local").exists())

    def test_install_is_idempotent_never_overwrites_without_explicit_replace(self):
        with tempfile.TemporaryDirectory() as root:
            dest=Path(root)/"systemd/user"
            unit,changed=install(dest,"[Service]\nType=simple\n")
            self.assertTrue(changed)
            self.assertEqual(unit.name,UNIT)
            self.assertEqual(unit.stat().st_mode&0o777,0o600)
            same,changed=install(dest,"[Service]\nType=simple\n")
            self.assertFalse(changed)
            self.assertEqual(same,unit)
            with self.assertRaisesRegex(ValueError,"explicit_--replace"):
                install(dest,"different\n")
            updated,changed=install(dest,"different\n",replace=True)
            self.assertTrue(changed)
            self.assertEqual(updated.read_text(),"different\n")

    def test_symlinked_unit_refused_even_with_replace(self):
        with tempfile.TemporaryDirectory() as root:
            dest=Path(root)/"systemd/user"
            dest.mkdir(parents=True)
            target=Path(root)/"outside"
            target.write_text("DO NOT TOUCH")
            (dest/UNIT).symlink_to(target)
            with self.assertRaisesRegex(ValueError,"symlink"):
                install(dest,"replace",replace=True)
            self.assertEqual(target.read_text(),"DO NOT TOUCH")

    def test_systemd_never_enabled_without_operator_explicit_action(self):
        calls=[]
        def fake_run(args,*,check):
            self.assertTrue(check)
            calls.append(args)
        enable_service(run=fake_run)
        self.assertEqual(calls,[
            ["systemctl","--user","daemon-reload"],
            ["systemctl","--user","enable","--now",UNIT],
        ])


if __name__=="__main__":
    unittest.main()
