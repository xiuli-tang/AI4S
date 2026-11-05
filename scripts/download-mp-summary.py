"""Download one immutable official MP Summary snapshot with bounded memory."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--expected-bytes', required=True, type=int)
    args = parser.parse_args()
    if not args.url.startswith('https://materialsproject-build.s3.amazonaws.com/collections/summary/'):
        raise ValueError('Use the official Materials Project Summary bucket URL')
    root = Path(args.output_dir)
    root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < 8 * 1024**3:
        raise RuntimeError('At least 8 GiB free space is required for download and indexing')
    target, partial = root / 'summary.parquet', root / 'summary.parquet.part'
    identity_path, manifest_path = root / 'download-identity.json', root / 'manifest.json'
    if target.exists() and (not identity_path.exists() or not manifest_path.exists()):
        raise RuntimeError('Existing completed file has no identity/manifest; it was not adopted')
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    with urllib.request.urlopen(urllib.request.Request(args.url, method='HEAD'), timeout=30) as response:
        size, etag = int(response.headers['Content-Length']), response.headers['ETag']
        modified = response.headers.get('Last-Modified')
    if size != args.expected_bytes:
        raise RuntimeError('The remote snapshot size differs from the reviewed manifest')
    identity = {'sourceURL': args.url, 'version': args.version, 'bytes': size, 'etag': etag, 'lastModified': modified}
    if identity_path.exists() and json.loads(identity_path.read_text()) != identity:
        raise RuntimeError('Existing download belongs to a different remote snapshot')
    if previous and any(previous.get(key) != value for key, value in identity.items()):
        raise RuntimeError('Existing manifest belongs to a different remote snapshot')
    identity_path.write_text(json.dumps(identity, indent=2))
    for attempt in range(3):
        if target.exists():
            break
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > size:
            raise RuntimeError('Partial download exceeds expected size')
        if offset == size:
            break
        headers = {'If-Match': etag}
        if offset:
            headers['Range'] = f'bytes={offset}-'
        try:
            with urllib.request.urlopen(urllib.request.Request(args.url, headers=headers), timeout=45) as response:
                if response.status != (206 if offset else 200):
                    raise RuntimeError('Unexpected range response; partial data was preserved')
                if response.headers.get('ETag') != etag:
                    raise RuntimeError('Remote object changed during download')
                last = 0
                with partial.open('ab' if offset else 'wb') as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        offset += len(chunk)
                        if time.monotonic() - last > 5:
                            progress = {'downloadedBytes': offset, 'totalBytes': size, 'percent': round(offset / size * 100, 2)}
                            (root / 'download-status.json').write_text(json.dumps(progress))
                            print(json.dumps(progress), flush=True)
                            last = time.monotonic()
                    output.flush()
                    os.fsync(output.fileno())
            break
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(3)
    file = target if target.exists() else partial
    if file.stat().st_size != size:
        raise RuntimeError('Downloaded byte count does not match the snapshot manifest')
    digest = hashlib.sha256()
    with file.open('rb') as data:
        if data.read(4) != b'PAR1':
            raise RuntimeError('Invalid Parquet header')
        data.seek(-4, os.SEEK_END)
        if data.read(4) != b'PAR1':
            raise RuntimeError('Invalid Parquet footer')
        data.seek(0)
        while chunk := data.read(4 * 1024 * 1024):
            digest.update(chunk)
    if not target.exists():
        partial.rename(target)
        target.chmod(0o644)
    if previous and previous.get('sha256') != digest.hexdigest():
        raise RuntimeError('Existing manifest SHA256 does not match the downloaded file')
    manifest = {**identity, 'sha256': digest.hexdigest(), 'downloadedAt': previous['downloadedAt'] if previous else dt.datetime.now(dt.timezone.utc).isoformat()}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    (root / 'download-status.json').write_text(json.dumps({'downloadedBytes': size, 'totalBytes': size, 'percent': 100}))
    print(json.dumps({'downloadComplete': True, **manifest}), flush=True)


if __name__ == '__main__':
    main()
