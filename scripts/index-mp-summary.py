"""Stream a reviewed MP Summary Parquet into the bounded-query AI4S index."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import resource
import sqlite3
import sys

FORMAT = 'ai4s-mp-summary-1'
FIELDS = ['material_id', 'formula_pretty', 'composition', 'structure', 'symmetry',
          'band_gap', 'formation_energy_per_atom', 'energy_above_hull', 'origins', 'deprecated']
TARGETS = [('band-gap', 'band_gap', 'eV'), ('formation-energy', 'formation_energy_per_atom', 'eV/atom'),
           ('energy-above-hull', 'energy_above_hull', 'eV/atom')]


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def clean(value):
    if isinstance(value, dict):
        return {key: fixed for key, item in value.items() if (fixed := clean(item)) is not None}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def checked_structure(raw, composition, symbols):
    if not raw:
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get('lattice'), dict):
        raise ValueError('invalid structure object')
    raw = clean(raw)
    lattice = raw.get('lattice', {}).get('matrix')
    if not isinstance(lattice, list) or len(lattice) != 3 or any(not isinstance(v, list) or len(v) != 3 or not all(finite(x) for x in v) for v in lattice):
        raise ValueError('invalid lattice')
    a, b, c = lattice
    volume = abs(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))
    if not finite(volume) or volume < 1e-8 or any(math.hypot(*v) < 1e-8 for v in lattice):
        raise ValueError('singular lattice')
    pbc = raw.get('lattice', {}).get('pbc')
    if pbc is not None and (not isinstance(pbc, list) or len(pbc) != 3 or any(x is not True for x in pbc)):
        raise ValueError('nonperiodic structure')
    sites = raw.get('sites')
    if not isinstance(sites, list) or not 1 <= len(sites) <= 5000:
        raise ValueError('site limit')
    counts = Counter()
    for site in sites:
        if not isinstance(site, dict):
            raise ValueError('invalid site object')
        xyz = site.get('abc')
        if not isinstance(xyz, list) or len(xyz) != 3 or not all(finite(x) for x in xyz):
            raise ValueError('invalid coordinates')
        if not all(math.isfinite(sum(xyz[j]*lattice[j][i] for j in range(3))) for i in range(3)):
            raise ValueError('coordinate overflow')
        species = site.get('species')
        if not isinstance(species, list) or not species:
            raise ValueError('missing species')
        seen, total = set(), 0
        for item in species:
            if not isinstance(item, dict):
                raise ValueError('invalid species object')
            element, occupancy = item.get('element'), item.get('occu')
            if element not in symbols or element in seen or not finite(occupancy) or not 0 < occupancy <= 1:
                raise ValueError('invalid occupancy')
            seen.add(element); total += occupancy; counts[element] += occupancy
        if total > 1 + 1e-6:
            raise ValueError('excess occupancy')
    n, m = sum(composition.values()), sum(counts.values())
    if any(abs(composition.get(el, 0)/n-counts.get(el, 0)/m) > 1e-6 for el in set(composition) | set(counts)):
        raise ValueError('structure composition mismatch')
    if len(json.dumps(raw, ensure_ascii=False).encode()) > 5 * 1024**2:
        raise ValueError('structure byte limit')
    return raw


def normalize(row, manifest, symbols, stats):
    material_id, formula = row.get('material_id'), row.get('formula_pretty')
    if not isinstance(material_id, str) or not re.fullmatch(r'(?:mp|mvc)-[a-z0-9]+(?:-[a-z0-9]+)*', material_id) or len(material_id) > 64:
        raise ValueError('material_id')
    if not isinstance(formula, str) or not formula.strip() or len(formula) > 200:
        raise ValueError('formula')
    composition = dict(row.get('composition') or {})
    if not composition or any(el not in symbols or not finite(n) or n < 0 for el, n in composition.items()):
        raise ValueError('composition')
    composition = {el: n for el, n in composition.items() if n > 0}
    if not composition or not finite(sum(composition.values())):
        raise ValueError('composition total')
    values, units = {}, {}
    for target, field, unit in TARGETS:
        value = row.get(field)
        if finite(value) and abs(value) <= 1e9 and (target == 'formation-energy' or value >= 0):
            values[target], units[target] = value, unit
        elif value is not None:
            stats['invalid_' + field] += 1
    structure = None
    try:
        structure = checked_structure(row.get('structure'), composition, symbols)
    except (ValueError, TypeError, KeyError, ZeroDivisionError):
        stats['invalidStructures'] += 1
    provenance = {
        'reference': f"Materials Project Summary AWS OpenData; doi:10.1063/1.4812323; snapshot SHA256 {manifest['sha256']}",
        'url': f'https://materialsproject.org/materials/{material_id}',
        'datasetVersion': f"MP-Summary-{manifest['version']}", 'retrievedAt': manifest['downloadedAt'],
        'license': 'Materials Project Terms of Use; https://materialsproject.org/about/terms; official AWS OpenData',
        'taskIds': list(dict.fromkeys(origin['task_id'].strip() for origin in row.get('origins') or []
            if isinstance(origin, dict) and isinstance(origin.get('task_id'), str) and 0 < len(origin['task_id'].strip()) <= 100))[:50],
    }
    record = {'id': material_id, 'formula': formula.strip(), 'composition': composition, 'values': values, 'units': units,
              'source': 'MP-DFT', 'fidelity': 'low-dft', 'methodMeta': 'MP Summary AWS OpenData; inspect origins task IDs for underlying calculation methods',
              'cohort': 'MP-summary', 'provenance': provenance}
    if structure:
        record['structure'] = structure
    if isinstance(row.get('symmetry'), dict):
        record['symmetry'] = clean(row['symmetry'])
    return record


def main():
    import pyarrow.parquet as pq
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--elements', required=True)
    args = parser.parse_args()
    root, output = Path(args.snapshot_dir), Path(args.output)
    temporary = output.with_suffix(output.suffix + '.building')
    if output.exists() or temporary.exists():
        raise RuntimeError('Index output already exists; existing data was preserved')
    manifest = json.loads((root/'manifest.json').read_text())
    source = root/'summary.parquet'
    if source.stat().st_size != manifest['bytes']:
        raise RuntimeError('Snapshot byte count mismatch')
    digest = hashlib.sha256()
    with source.open('rb') as file:
        while chunk := file.read(4 * 1024**2):
            digest.update(chunk)
    if digest.hexdigest() != manifest['sha256']:
        raise RuntimeError('Snapshot SHA256 mismatch')
    symbols = set(json.loads(Path(args.elements).read_text())['elements'])
    parquet = pq.ParquetFile(source)
    missing = set(FIELDS)-set(parquet.schema_arrow.names)
    if missing:
        raise RuntimeError(f'Missing required Summary columns: {sorted(missing)}')
    output.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(temporary)
    db.executescript('''PRAGMA journal_mode=DELETE; PRAGMA synchronous=OFF; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
      CREATE TABLE mirror_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE materials(id TEXT PRIMARY KEY,formula TEXT NOT NULL,chemical_system TEXT NOT NULL,
        band_gap REAL,formation_energy REAL,energy_above_hull REAL,deprecated INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE material_elements(element TEXT NOT NULL,material_id TEXT NOT NULL,PRIMARY KEY(element,material_id)) WITHOUT ROWID;''')
    stats = Counter({key: 0 for key in ['sourceRecords', 'indexedRecords', 'rejectedRecords', 'deprecatedRecords', 'activeRecords', 'activeStructures', 'invalidStructures']})
    rejected = Counter()
    for batch in parquet.iter_batches(batch_size=64, columns=FIELDS, use_threads=False):
        for row in batch.to_pylist():
            stats['sourceRecords'] += 1
            try:
                record = normalize(row, manifest, symbols, stats)
            except (ValueError, TypeError, KeyError) as error:
                stats['rejectedRecords'] += 1; rejected[str(error)] += 1
                continue
            deprecated = row.get('deprecated') is True
            payload = json.dumps(record, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            db.execute('INSERT INTO materials VALUES(?,?,?,?,?,?,?,?)', (record['id'], record['formula'], '-'.join(sorted(record['composition'])),
                record['values'].get('band-gap'), record['values'].get('formation-energy'), record['values'].get('energy-above-hull'), int(deprecated), payload))
            db.executemany('INSERT INTO material_elements VALUES(?,?)', [(element, record['id']) for element in record['composition']])
            stats['indexedRecords'] += 1
            stats['deprecatedRecords'] += int(deprecated)
            if not deprecated:
                stats['activeRecords'] += 1
                stats['activeStructures'] += int(bool(record.get('structure')))
                for target, field, _ in TARGETS:
                    stats['available_' + field] += int(target in record['values'])
        if stats['sourceRecords'] % 4096 == 0:
            db.commit(); print(json.dumps(dict(stats)), flush=True)
    if stats['sourceRecords'] != parquet.metadata.num_rows or stats['indexedRecords'] + stats['rejectedRecords'] != stats['sourceRecords']:
        raise RuntimeError('Summary record counts did not reconcile')
    db.executescript('''CREATE INDEX materials_chemical_system ON materials(chemical_system,id);
      CREATE INDEX materials_active_id ON materials(id) WHERE deprecated=0;
      CREATE INDEX materials_bandgap_counts ON materials(deprecated,band_gap,id);
      CREATE INDEX materials_formation_counts ON materials(deprecated,formation_energy,id);
      CREATE INDEX materials_hull_counts ON materials(deprecated,energy_above_hull,id);
      CREATE INDEX materials_bandgap_id ON materials(id) WHERE deprecated=0 AND band_gap IS NOT NULL;
      CREATE INDEX materials_formation_id ON materials(id) WHERE deprecated=0 AND formation_energy IS NOT NULL;
      CREATE INDEX materials_hull_id ON materials(id) WHERE deprecated=0 AND energy_above_hull IS NOT NULL;''')
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024**2 if sys.platform == 'darwin' else 1024)
    metadata = {**manifest, **dict(stats), 'format': FORMAT, 'rejectedReasons': dict(rejected), 'cohort': 'MP-summary', 'peakRSSMiB': round(peak, 2)}
    db.execute('INSERT INTO mirror_meta VALUES(?,?)', ('manifest', json.dumps(metadata, ensure_ascii=False)))
    db.execute('ANALYZE'); db.commit()
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise RuntimeError('Index integrity check failed')
    db.close(); temporary.rename(output); output.chmod(0o644)
    output.with_suffix('.manifest.json').write_text(json.dumps(metadata, indent=2, ensure_ascii=False))
    print(json.dumps({'indexComplete': True, **metadata}), flush=True)


if __name__ == '__main__':
    main()
