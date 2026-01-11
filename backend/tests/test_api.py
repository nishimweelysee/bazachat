import os
import tempfile
import unittest


class TestVenueSeatingAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Point the app at a temporary sqlite DB for tests.
        cls._tmpdir = tempfile.TemporaryDirectory()
        os.environ["VENUE_SEATING_DATA_DIR"] = cls._tmpdir.name
        # Import after env var set so db uses the temp dir.
        from backend.app.db import init_db
        from backend.app.main import app

        cls.app = app
        init_db()

    @classmethod
    def tearDownClass(cls):
        cls._tmpdir.cleanup()

    def test_health(self):
        from fastapi.testclient import TestClient

        c = TestClient(self.app)
        self.assertEqual(c.get("/health").json(), {"ok": True})

    def test_create_venue_level_section_row_seats_and_summary(self):
        from fastapi.testclient import TestClient

        c = TestClient(self.app)

        v = c.post("/venues", json={"name": "Arena"}).json()
        venue_id = v["id"]

        lvl = c.post(f"/venues/{venue_id}/levels", json={"name": "Lower"}).json()
        level_id = lvl["id"]

        # Valid section polygon (rectangle)
        sec = c.post(
            f"/levels/{level_id}/sections",
            json={"code": "101", "polygon": {"points": [[0, 0], [10, 0], [10, 5], [0, 5]]}},
        ).json()
        section_id = sec["id"]

        # Row: simple horizontal line
        row = c.post(
            f"/sections/{section_id}/rows",
            json={
                "label": "A",
                "order_index": 0,
                "path": {"segments": [{"type": "line", "x1": 1, "y1": 1, "x2": 9, "y2": 1}], "gaps": []},
            },
        ).json()
        row_id = row["id"]

        # Generate seats (should be within section polygon)
        gen = c.post(
            f"/rows/{row_id}/generate-seats",
            json={"seat_pitch_m": 1.0, "start_offset_m": 0.0, "end_offset_m": 0.0, "seat_number_start": 1, "overwrite": True},
        ).json()
        self.assertGreater(gen["created"], 0)

        cfg = c.post(f"/venues/{venue_id}/configs", json={"name": "Event"}).json()
        config_id = cfg["id"]

        snap = c.get(f"/venues/{venue_id}/snapshot?config_id={config_id}").json()
        seats = snap["seats"]
        self.assertGreater(len(seats), 0)

        # Bulk block first 2 seats
        seat_ids = [seats[0]["id"], seats[1]["id"]] if len(seats) >= 2 else [seats[0]["id"]]
        res = c.put(f"/configs/{config_id}/overrides/bulk", json={"seat_ids": seat_ids, "status": "blocked"}).json()
        self.assertTrue("updated" in res or "created" in res or "deleted" in res)

        summary = c.get(f"/venues/{venue_id}/summary?config_id={config_id}").json()
        self.assertEqual(summary["venue_id"], venue_id)
        self.assertEqual(summary["config_id"], config_id)
        self.assertGreaterEqual(summary["seats_total"], len(seats))
        self.assertGreaterEqual(summary["seats_blocked"], len(seat_ids))

        # Undo-like batch restore: set those seats back to sellable (clears overrides)
        batch = c.put(
            f"/configs/{config_id}/overrides/batch",
            json={"items": [{"seat_id": sid, "status": "sellable", "notes": ""} for sid in seat_ids]},
        ).json()
        self.assertTrue("deleted" in batch or "updated" in batch or "created" in batch)

    def test_polygon_validation_rejects_self_intersection(self):
        from fastapi.testclient import TestClient

        c = TestClient(self.app)
        v = c.post("/venues", json={"name": "BadPoly"}).json()
        venue_id = v["id"]
        lvl = c.post(f"/venues/{venue_id}/levels", json={"name": "L1"}).json()
        level_id = lvl["id"]

        # Bow-tie self-intersecting polygon
        r = c.post(
            f"/levels/{level_id}/sections",
            json={"code": "X", "polygon": {"points": [[0, 0], [2, 2], [0, 2], [2, 0]]}},
        )
        self.assertEqual(r.status_code, 400)

    def test_delete_venue_cascades(self):
        from fastapi.testclient import TestClient

        c = TestClient(self.app)
        v = c.post("/venues", json={"name": "ToDelete"}).json()
        venue_id = v["id"]
        lvl = c.post(f"/venues/{venue_id}/levels", json={"name": "L"}).json()
        level_id = lvl["id"]
        sec = c.post(
            f"/levels/{level_id}/sections",
            json={"code": "1", "polygon": {"points": [[0, 0], [10, 0], [10, 5], [0, 5]]}},
        ).json()
        section_id = sec["id"]
        z = c.post(
            f"/sections/{section_id}/zones",
            json={"name": "Standing", "capacity": 10, "polygon": {"points": [[1, 1], [2, 1], [2, 2], [1, 2]]}},
        ).json()
        self.assertIn("id", z)

        d = c.delete(f"/venues/{venue_id}").json()
        self.assertEqual(d, {"deleted": True})


if __name__ == "__main__":
    unittest.main()

