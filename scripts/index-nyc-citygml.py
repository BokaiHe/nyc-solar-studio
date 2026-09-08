"""Index original CityGML building fragments; geometry is decoded only on selection."""
import argparse
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import zlib

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--sevenzip', required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit('Choose a new output path; existing indexes are preserved.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(args.output)
    db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE buildings(id INTEGER PRIMARY KEY,gml_id TEXT,bin TEXT,xml BLOB);
        CREATE VIRTUAL TABLE bounds USING rtree(id,min_x,max_x,min_y,max_y);
        CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
    ''')
    process = subprocess.Popen([args.sevenzip, 'x', '-so', args.archive], stdout=subprocess.PIPE)
    pending = b''
    end = b'</cityObjectMember>'
    start = time.monotonic()
    count = 0
    try:
        while chunk := process.stdout.read(4 * 1024 * 1024):
            parts = (pending + chunk).split(end)
            pending = parts.pop()
            for part in parts:
                member_start = part.find(b'<cityObjectMember>')
                if member_start < 0:
                    raise ValueError('Unexpected CityGML member structure')
                xml = part[member_start:] + end
                header = xml.split(b'<bldg:boundedBy>', 1)[0]
                if b'srsName="EPSG32118"' not in header:
                    raise ValueError('Unexpected coordinate reference system')
                lo = list(map(float, re.search(rb'<gml:lowerCorner>([^<]+)', header)[1].split()))
                hi = list(map(float, re.search(rb'<gml:upperCorner>([^<]+)', header)[1].split()))
                identifier = re.search(rb'<bldg:Building gml:id="([^"]+)', header)[1].decode()
                bin_match = re.search(rb'name="building_identification_number">\s*<gen:value>([^<]+)', header)
                count += 1
                db.execute('INSERT INTO buildings VALUES(?,?,?,?)', (count, identifier, bin_match[1].decode() if bin_match else '', zlib.compress(xml, 1)))
                db.execute('INSERT INTO bounds VALUES(?,?,?,?,?)', (count,lo[0],hi[0],lo[1],hi[1]))
                if count % 25000 == 0:
                    db.commit()
                    print(f'{count:,} original buildings indexed in {time.monotonic()-start:.0f}s', flush=True)
        if process.wait() != 0:
            raise RuntimeError('7-Zip decompression failed')
        if b'</CityModel>' not in pending:
            raise ValueError('Truncated CityGML document')
        db.execute('CREATE INDEX by_bin ON buildings(bin)')
        db.execute('CREATE INDEX by_gml_id ON buildings(gml_id)')
        db.executemany('INSERT INTO metadata VALUES(?,?)', [('complete','true'),('encoding','citygml-zlib'),('source','NYC / TUM LoD2 2017')])
        db.commit()
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        db.execute('PRAGMA journal_mode=DELETE')
        print(json.dumps({'buildings':count,'bytes':args.output.stat().st_size,'seconds':round(time.monotonic()-start)}), flush=True)
    finally:
        if process.poll() is None:
            process.terminate()
        db.close()

if __name__ == '__main__':
    main()
