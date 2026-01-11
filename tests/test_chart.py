import unittest

from seating_chart.chart import SeatingChart, SeatingChartError


class TestSeatingChart(unittest.TestCase):
    def test_init(self):
        c = SeatingChart(2, 3)
        self.assertEqual(c.rows, 2)
        self.assertEqual(c.cols, 3)
        self.assertTrue(c.is_available(0, 0))

    def test_assign_and_get(self):
        c = SeatingChart(1, 1)
        c.assign(0, 0, "Alice")
        self.assertEqual(c.get(0, 0), "Alice")
        self.assertFalse(c.is_available(0, 0))

    def test_assign_occupied_raises(self):
        c = SeatingChart(1, 1)
        c.assign(0, 0, "Alice")
        with self.assertRaises(SeatingChartError):
            c.assign(0, 0, "Bob")

    def test_overwrite(self):
        c = SeatingChart(1, 1)
        c.assign(0, 0, "Alice")
        c.assign(0, 0, "Bob", overwrite=True)
        self.assertEqual(c.get(0, 0), "Bob")

    def test_swap(self):
        c = SeatingChart(1, 2)
        c.assign(0, 0, "Alice")
        c.assign(0, 1, "Bob")
        c.swap(0, 0, 0, 1)
        self.assertEqual(c.get(0, 0), "Bob")
        self.assertEqual(c.get(0, 1), "Alice")

    def test_find(self):
        c = SeatingChart(2, 2)
        c.assign(1, 0, "Charlie")
        seat = c.find("Charlie")
        self.assertIsNotNone(seat)
        self.assertEqual((seat.row, seat.col), (1, 0))


if __name__ == "__main__":
    unittest.main()

