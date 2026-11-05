import importlib.util
import contextlib
import hashlib
import io
import json
from collections import Counter
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('summary_index', Path(__file__).parents[1]/'scripts/index-mp-summary.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SummaryNormalizationTests(unittest.TestCase):
    def row(self):
        return {'material_id': 'mp-test', 'formula_pretty': 'Li2O', 'composition': [('Li', 2), ('O', 1)],
                'band_gap': 0, 'formation_energy_per_atom': -2, 'energy_above_hull': None,
                'structure': {'lattice': {'matrix': [[3, 0, 0], [0, 3, 0], [0, 0, 3]], 'pbc': None},
                    'sites': [{'abc': [i/3, 0, 0], 'species': [{'element': el, 'occu': 1}]} for i, el in enumerate(['Li', 'Li', 'O'])]},
                'origins': [None, {'task_id': 'mp-task'}]}

    def convert(self, row):
        stats = Counter()
        result = module.normalize(row, {'sha256': 'a'*64, 'version': '2026-09-28', 'downloadedAt': '2026-11-01T00:00:00Z'}, {'Li', 'O'}, stats)
        return result, stats

    def test_zero_and_missing_labels_remain_distinct(self):
        result, _ = self.convert(self.row())
        self.assertEqual(result['values']['band-gap'], 0)
        self.assertEqual(result['values']['formation-energy'], -2)
        self.assertNotIn('energy-above-hull', result['values'])
        self.assertEqual(result['provenance']['taskIds'], ['mp-task'])
        self.assertIn('structure', result)

    def test_invalid_geometry_is_not_fabricated(self):
        row = self.row(); row['structure']['lattice']['matrix'][2] = [0, 0, 0]
        result, stats = self.convert(row)
        self.assertNotIn('structure', result)
        self.assertEqual(stats['invalidStructures'], 1)
        self.assertEqual(result['values']['band-gap'], 0)

    def test_nonfinite_and_negative_nonnegative_properties_stay_missing(self):
        row = self.row(); row['band_gap'] = float('nan'); row['energy_above_hull'] = -1
        result, _ = self.convert(row)
        self.assertEqual(result['values'], {'formation-energy': -2})

    def test_structure_and_formula_compositions_must_match(self):
        row = self.row(); row['composition'] = {'Li': 1, 'O': 1}
        result, stats = self.convert(row)
        self.assertNotIn('structure', result)
        self.assertEqual(stats['invalidStructures'], 1)

    def test_unsupported_elements_are_rejected(self):
        row = self.row(); row['composition'] = {'NotAnElement': 1}
        with self.assertRaises(ValueError): self.convert(row)

    def test_nullable_sites_and_species_are_rejected_without_aborting_records(self):
        for target in ['sites', 'species']:
            row = self.row()
            if target == 'sites': row['structure']['sites'] = [None]
            else: row['structure']['sites'][0]['species'] = [None]
            result, stats = self.convert(row)
            self.assertNotIn('structure', result)
            self.assertEqual(stats['invalidStructures'], 1)

    @unittest.skipUnless(importlib.util.find_spec('pyarrow'), 'PyArrow is required for the Parquet integration fixture')
    def test_parquet_to_sqlite_counts_and_payload_contract(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = []
            for index in range(5):
                row = self.row(); row['material_id'] = f'mp-fixture{index}'
                row['deprecated'] = index == 2; row['symmetry'] = {'symbol': 'P1'}
                rows.append(row)
            rows[1]['band_gap'] = None
            rows[3]['structure']['sites'] = [None]
            rows[4]['composition'] = [('NotAnElement', 1)]
            inferred = pa.Table.from_pylist([{**row, 'composition': dict(row['composition'])} for row in rows]).schema
            fields = [pa.field(field.name, pa.map_(pa.string(), pa.float64())) if field.name == 'composition' else field for field in inferred]
            parquet = root/'summary.parquet'; pq.write_table(pa.Table.from_pylist(rows, schema=pa.schema(fields)), parquet)
            digest = hashlib.sha256(parquet.read_bytes()).hexdigest()
            (root/'manifest.json').write_text(json.dumps({'bytes': parquet.stat().st_size, 'sha256': digest,
                'version': '2026-09-28', 'downloadedAt': '2026-11-01T00:00:00Z', 'sourceURL': 'https://fixtures.invalid/parquet'}))
            elements = root/'elements.json'; elements.write_text(json.dumps({'elements': {'Li': {}, 'O': {}}}))
            output = root/'summary.sqlite'
            with patch.object(sys, 'argv', ['index', '--snapshot-dir', str(root), '--output', str(output), '--elements', str(elements)]), contextlib.redirect_stdout(io.StringIO()):
                module.main()
            db = sqlite3.connect(output)
            metadata = json.loads(db.execute("SELECT value FROM mirror_meta WHERE key='manifest'").fetchone()[0])
            self.assertEqual([metadata[k] for k in ['sourceRecords', 'indexedRecords', 'activeRecords', 'deprecatedRecords', 'rejectedRecords']], [5, 4, 3, 1, 1])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM materials WHERE deprecated=0 AND band_gap IS NOT NULL').fetchone()[0], 2)
            payload = json.loads(db.execute("SELECT payload FROM materials WHERE id='mp-fixture3'").fetchone()[0])
            self.assertNotIn('structure', payload)
            self.assertEqual(payload['values']['band-gap'], 0)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            db.close()


if __name__ == '__main__':
    unittest.main()
