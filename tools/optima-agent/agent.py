#!/usr/bin/env python3
"""Optima Agent v0.3 — reads Optima "Reservation Search" Excel exports and sends the changes to optimaIngest.
Read only: no ODBC, no SQL, no writing into Optima. Python standard library only.

Modes:
  python agent.py parse EXPORT.xlsx --hotel hostel      dry run: writes summary/payload/review files, sends nothing
  python agent.py run [--once]                          loop: per hotel, newest .xlsx in its inbox → diff → send → delete
Stop at once: create a file named STOP in the agent folder (or stop the scheduled task).
"""
import argparse, collections, datetime as dt, hashlib, json, os, pathlib, re, sys, time, urllib.error, urllib.request, xml.etree.ElementTree as ET, zipfile

VERSION = '0.3.1'
BASE = pathlib.Path(__file__).resolve().parent
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
HOTELS = ('sola', 'boheme', 'sevenseas', 'hostel')
REQUIRED = ('c_master_id', 'c_reservation_id', 'c_arrival_date', 'c_depart_date', 'c_reservation_status', 'c_room_type', 'c_room_number', 'c_adults')
# Every column the agent may read. Anything else in the export (passport, payment, phone, e-mail…) is never kept in memory, logged or sent.
ALLOWED = set(REQUIRED) | {'c_children', 'c_babies', 'c_juniors', 'c_bed_number', 'c_hotel_name', 'c_first_name', 'c_last_name', 'c_vip_code', 'c_group_name', 'c_group_code', 'c_room_category'}
DEFAULT_CFG = {
    'ingest_url': '',
    'interval_sec': 120,          # pause after each full round of the 4 hotels
    'window_back_days': 1, 'window_ahead_days': 60,
    'full_every_hours': 24,       # once a day every booking is sent again (reconcile), otherwise only changes
    'batch': 150,
    # Optima status codes → our stay state. res / chkin / chkou verified on real Hostel 180 exports (Nov 19, Nov 27). Cancel: not seen yet.
    'status_map': {'res': 'res', 'chkin': 'in', 'chkou': 'out'},
    # optional columns: our field → candidate Optima column names (first one present wins). Names unverified until a real header is checked.
    'optional': {'guest': ['c_guest_name', 'c_full_name'], 'comment': ['c_remarks', 'c_guest_remarks', 'c_comments'], 'board': ['c_plan', 'c_meal_plan', 'c_board'], 'channel': ['c_source', 'c_agent_name', 'c_channel']},
    'hotels': {h: {'inbox': str(BASE / 'inbox' / h), 'hotel_names': {'hostel': ['180 Beach Front Boutiqe Hostel']}.get(h, [])} for h in HOTELS},
}

# ---------- Excel ----------
def colnum(ref):
    n = 0
    for c in re.match(r'[A-Z]+', ref).group(): n = n * 26 + ord(c) - 64
    return n - 1

def read_xlsx(path, wanted):
    """Rows as dicts with ONLY the wanted columns. Other cells are skipped while reading."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if 'xl/workbook.xml' not in names: raise ValueError('not an Excel file')
        strings = []
        if 'xl/sharedStrings.xml' in names:
            root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            strings = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])) for si in root.findall('m:si', NS)]
        sheets = sorted((x for x in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', x)), key=lambda x: int(re.search(r'\d+', x).group()))
        if not sheets: raise ValueError('no worksheet')
        root = ET.fromstring(z.read(sheets[0]))
    rows = root.findall('.//m:sheetData/m:row', NS)
    if not rows: raise ValueError('empty worksheet')
    def cell(c):
        v = c.findtext('m:v', default='', namespaces=NS)
        if c.get('t') == 's': return strings[int(v)] if v else ''
        if c.get('t') == 'inlineStr': return ''.join(t.text or '' for t in c.iter('{%s}t' % NS['m']))
        return v
    head = {}
    for c in rows[0].findall('m:c', NS):
        h = str(cell(c)).strip()
        if h in wanted and h not in head.values(): head[colnum(c.attrib['r'])] = h   # repeated names: first one only
    missing = set(REQUIRED) - set(head.values())
    if missing: raise ValueError('missing required columns: ' + ', '.join(sorted(missing)))
    out = []
    for r in rows[1:]:
        d = {}
        for c in r.findall('m:c', NS):
            i = colnum(c.attrib['r'])
            if i in head: d[head[i]] = str(cell(c)).strip()
        if any(d.values()): out.append(d)
    return out, sorted(head.values())

def date(v):
    v = str(v or '').strip()
    if not v: return ''
    if re.fullmatch(r'\d+(?:\.\d+)?', v): return (dt.datetime(1899, 12, 30) + dt.timedelta(days=float(v))).date().isoformat()
    m = re.match(r'(\d{4})-(\d{1,2})-(\d{1,2})', v)
    if m: return '%s-%02d-%02d' % (m[1], int(m[2]), int(m[3]))
    m = re.match(r'(\d{1,2})[./](\d{1,2})[./](\d{2,4})', v)   # Israeli day/month/year
    if m: return '%s-%02d-%02d' % (m[3] if len(m[3]) == 4 else '20' + m[3], int(m[2]), int(m[1]))
    return ''

def num(v):
    try: return max(0, int(float(v)))
    except (TypeError, ValueError): return 0

def board(v):
    x = str(v or '').lower()
    if re.search(r'full\s*board|\bfb\b|פנסיון מלא', x): return 'FB'
    if re.search(r'half\s*board|\bhb\b|חצי פנסיון', x): return 'HB'
    if re.search(r'room\s*only|\bro\b|לינה בלבד', x): return 'RO'
    if re.search(r'breakfast|\bbb\b|b\s*[&/]\s*b|ארוחת בוקר', x): return 'BB'
    return ''

# ---------- rows → bookings ----------
def parse(rows, cfg, present, since=''):
    """One booking per c_master_id, one room line per c_reservation_id (rid). Nothing is dropped silently:
    a booking with an unknown status or bad dates goes to review and is not sent."""
    opt = {k: next((c for c in cands if c in present), None) for k, cands in cfg['optional'].items()}
    smap = {k.lower(): v for k, v in cfg['status_map'].items()}
    by_master = collections.OrderedDict()
    for r in rows:
        m = r.get('c_master_id', '')
        if m: by_master.setdefault(re.sub(r'[^\w-]', '', m)[:40], []).append(r)
    items, review = [], []
    for conf, group in by_master.items():
        bad = None; lines = collections.OrderedDict()
        for r in group:
            raw = r.get('c_reservation_status', '').strip().lower()
            if raw not in smap: bad = {'conf': conf, 'reason': 'unknown_status', 'raw': raw}; break
            ci, co = date(r.get('c_arrival_date')), date(r.get('c_depart_date'))
            if not ci or not co or co < ci: bad = {'conf': conf, 'reason': 'bad_dates'}; break
            rid = re.sub(r'[^\w-]', '', r.get('c_reservation_id', ''))[:40]
            if not rid: bad = {'conf': conf, 'reason': 'no_reservation_id'}; break
            room, bed = r.get('c_room_number', ''), r.get('c_bed_number', '')
            people = num(r.get('c_adults')) + num(r.get('c_children')) + num(r.get('c_juniors')) + num(r.get('c_babies'))
            # the same rid in more rows: same room+dates = more beds of one line; other room or dates = a room move → its own segment
            seg = next((k for k, x in lines.items() if k.split('#')[0] == rid and x['room'] == room and x['ci'] == ci and x['co'] == co), None)
            if seg:
                if bed and bed not in lines[seg]['beds']: lines[seg]['beds'].append(bed)
                lines[seg]['people'] = max(lines[seg]['people'], len(lines[seg]['beds']))   # dorm: one bed per guest at least
                continue
            n = sum(1 for k in lines if k.split('#')[0] == rid)
            # room type: c_room_category first (same field as the Nov 17 import, so types don't flip), else c_room_type
            lines[rid if not n else '%s#%d' % (rid, n)] = {'room': room, 'beds': [bed] if bed else [], 'type': (r.get('c_room_category', '') or r.get('c_room_type', ''))[:60], 'ci': ci, 'co': co,
                'adults': num(r.get('c_adults')), 'children': num(r.get('c_children')) + num(r.get('c_juniors')), 'babies': num(r.get('c_babies')), 'people': people,
                'board': board(r.get(opt['board'])) if opt['board'] else '', 'stay': smap[raw],
                'guest': ' '.join(x for x in (r.get('c_first_name', ''), r.get('c_last_name', '')) if x)[:100], 'vip': bool(r.get('c_vip_code', '').strip())}
        if bad: review.append(bad); continue
        if since and all(x['co'] < since for x in lines.values()): continue   # stays that ended before the window: nothing to update
        first = group[0]
        for x in lines.values():
            if not x['guest']: del x['guest']
            if not x['vip']: del x['vip']
        it = {'conf': conf, 'rooms': [dict(rid=k, **{**v, 'room': re.sub(r'[^\w-]', '', v['room'])[:10], 'beds': v['beds'][:12]}) for k, v in lines.items()]}
        for k in ('guest', 'comment', 'channel'):
            if opt[k] and first.get(opt[k]): it[k] = first[opt[k]][:600 if k == 'comment' else 100]
        if 'guest' not in it and it['rooms'][0].get('guest'): it['guest'] = it['rooms'][0]['guest']
        grp = next((r.get('c_group_name', '') or r.get('c_group_code', '') for r in group if r.get('c_group_name', '') or r.get('c_group_code', '')), '')
        if grp: it['group'] = grp[:80]
        items.append(it)
    return items, review

def check_hotel(rows, names):
    """Each Optima belongs to one hotel. If the export names a hotel that is not this one → stop (someone exported the wrong screen)."""
    seen = {r.get('c_hotel_name', '').strip() for r in rows} - {''}
    if not names or not seen: return None
    wrong = sorted(n for n in seen if n.lower() not in {x.lower() for x in names})
    return 'export is of another hotel: ' + ', '.join(wrong) if wrong else None

# ---------- state, queue, sending ----------
def sig(it): return hashlib.sha256(json.dumps(it, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]

def load(p, d):
    try: return json.loads(p.read_text(encoding='utf-8'))
    except Exception: return d

def save(p, x):
    p.parent.mkdir(parents=True, exist_ok=True); tmp = p.with_suffix('.tmp'); tmp.write_text(json.dumps(x, ensure_ascii=False), encoding='utf-8'); os.replace(tmp, p)

def key_for(hotel):
    """The key is never in the code: environment variable OPTIMA_KEY_<HOTEL>, or keys/<hotel>.key (folder readable only by the agent user)."""
    k = os.environ.get('OPTIMA_KEY_' + hotel.upper(), '')
    if not k:
        f = BASE / 'keys' / (hotel + '.key')
        if f.exists(): k = f.read_text(encoding='utf-8').strip()
    return k

def post(url, key, body):
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'), method='POST', headers={'Content-Type': 'application/json', 'x-optima-key': key})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read() or b'{}')

def flush(cfg, hotel, log):
    """Send queued payloads oldest first. A failure leaves the file in the queue for the next round (no internet = nothing lost)."""
    url, key, q = cfg['ingest_url'], key_for(hotel), BASE / 'queue' / hotel
    if not list(q.glob('*.json')): return True
    if not url.startswith('https://') or not key: log('%s: not sending (ingest_url or key missing)' % hotel); return False
    for f in sorted(q.glob('*.json')):
        try:
            res = post(url, key, load(f, {}))
            if not res.get('ok'): log('%s: server refused %s: %s' % (hotel, f.name, str(res.get('error') or res)[:200])); return False
            f.unlink(); log('%s: sent %s saved=%s skipped=%s' % (hotel, f.name, res.get('saved'), res.get('skipped')))
        except (urllib.error.URLError, OSError, ValueError) as e:
            log('%s: send failed, kept in queue (%s)' % (hotel, type(e).__name__)); return False
    return True

def process(cfg, hotel, xlsx, log):
    st_path = BASE / 'state' / (hotel + '.json'); st = load(st_path, {'sig': {}, 'fullAt': 0})
    rows, present = read_xlsx(xlsx, ALLOWED | {c for cs in cfg['optional'].values() for c in cs})
    err = check_hotel(rows, cfg['hotels'][hotel].get('hotel_names') or [])
    if err: log('%s: STOP %s' % (hotel, err)); return False
    today = dt.date.today(); since = (today - dt.timedelta(days=cfg['window_back_days'])).isoformat()
    items, review = parse(rows, cfg, present, since)
    snap = int(os.path.getmtime(xlsx) * 1000)   # export time = the moment this picture of Optima was taken
    window = {'from': (today - dt.timedelta(days=cfg['window_back_days'])).isoformat(), 'to': (today + dt.timedelta(days=cfg['window_ahead_days'])).isoformat()}
    full = time.time() - st.get('fullAt', 0) > cfg['full_every_hours'] * 3600
    send = items if full else [x for x in items if st['sig'].get(x['conf']) != sig(x)]
    q = BASE / 'queue' / hotel; q.mkdir(parents=True, exist_ok=True)
    for i in range(0, len(send), cfg['batch']):
        save(q / ('%d_%04d.json' % (snap, i)), {'op': 'bookings', 'hotel': hotel, 'agent': VERSION, 'snapshotAt': snap, 'window': window, 'full': full, 'items': send[i:i + cfg['batch']]})
    if review: save(q / ('%d_review.json' % snap), {'op': 'review', 'hotel': hotel, 'agent': VERSION, 'snapshotAt': snap, 'items': review})
    st['sig'] = {x['conf']: sig(x) for x in items}
    if full: st['fullAt'] = time.time()
    save(st_path, st)
    log('%s: rows=%d bookings=%d sending=%d review=%d full=%s' % (hotel, len(rows), len(items), len(send), len(review), full))
    return True

def run(cfg, once):
    lock = BASE / 'agent.lock'
    try: fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY); os.write(fd, str(os.getpid()).encode()); os.close(fd)
    except FileExistsError:
        if time.time() - lock.stat().st_mtime < 3600: sys.exit('another agent is running (agent.lock)')
        lock.unlink(); return run(cfg, once)
    (BASE / 'logs').mkdir(exist_ok=True)
    def log(s):   # counts and file names only — never guest data
        line = '%s %s' % (dt.datetime.now().isoformat(timespec='seconds'), s); print(line)
        with open(BASE / 'logs' / ('%s.log' % dt.date.today()), 'a', encoding='utf-8') as f: f.write(line + '\n')
    try:
        while not (BASE / 'STOP').exists():
            lock.touch(); errs = 0
            for h in HOTELS:
                inbox = pathlib.Path(cfg['hotels'][h]['inbox']); inbox.mkdir(parents=True, exist_ok=True)
                files = sorted(inbox.glob('*.xlsx'), key=os.path.getmtime)
                try:
                    if files:
                        if process(cfg, h, files[-1], log):
                            for f in files: f.unlink()    # the export holds passports / payments: delete it right after reading
                        else: errs += 1
                    flush(cfg, h, log)
                except Exception as e:                    # one hotel failing never stops the others
                    errs += 1; log('%s: error %s: %s' % (h, type(e).__name__, str(e)[:200]))
            try: post(cfg['ingest_url'], key_for(HOTELS[0]), {'op': 'heartbeat', 'agent': VERSION, 'errors': errs, 'at': int(time.time() * 1000)})
            except Exception: pass
            if once: break
            time.sleep(cfg['interval_sec'])
    finally:
        lock.unlink(missing_ok=True)

def config():
    c = json.loads(json.dumps(DEFAULT_CFG)); f = BASE / 'config.json'
    if f.exists():
        u = json.loads(f.read_text(encoding='utf-8'))
        for k, v in u.items():
            if k == 'hotels': [c['hotels'][h].update(v.get(h, {})) for h in HOTELS]
            else: c[k] = v
    return c

def main():
    p = argparse.ArgumentParser(description='Optima Agent (read only)')
    sp = p.add_subparsers(dest='cmd', required=True)
    a = sp.add_parser('parse'); a.add_argument('xlsx'); a.add_argument('--hotel', required=True, choices=HOTELS); a.add_argument('--out', default=str(BASE / 'output'))
    b = sp.add_parser('run'); b.add_argument('--once', action='store_true')
    args = p.parse_args(); cfg = config()
    if args.cmd == 'run': return run(cfg, args.once)
    rows, present = read_xlsx(args.xlsx, ALLOWED | {c for cs in cfg['optional'].values() for c in cs})
    since = (dt.date.today() - dt.timedelta(days=cfg['window_back_days'])).isoformat()
    items, review = parse(rows, cfg, present, since)
    out = pathlib.Path(args.out); out.mkdir(parents=True, exist_ok=True)
    multi = sum(1 for x in items if len(x['rooms']) > 1)
    names = cfg['hotels'][args.hotel].get('hotel_names') or []
    seen = sorted({r.get('c_hotel_name', '').strip() for r in rows} - {''})
    summary = {'hotel': args.hotel, 'hotelCheck': check_hotel(rows, names) or ('ok: ' + ', '.join(seen) if names and seen else 'not configured'),
               'columnsRead': present, 'rows': len(rows), 'bookings': len(items), 'multiRoom': multi, 'review': len(review),
               'since': since, 'stay': dict(collections.Counter(r['stay'] for x in items for r in x['rooms']))}
    save(out / 'summary.json', summary); save(out / 'review_required.json', review)
    save(out / 'bookings_payload.json', {'op': 'bookings', 'hotel': args.hotel, 'items': items})
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
