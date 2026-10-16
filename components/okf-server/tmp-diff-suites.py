"""One-off: which test suites did the host jest run skip vs the file list."""
ran = set()
for line in open('/tmp/osh.log', encoding='utf-8', errors='replace'):
    if line.startswith('PASS '):
        p = line[5:].split(' (')[0]
        ran.add(p.replace(chr(92), '/'))
allf = set(open('/tmp/all.txt').read().split())
norm_ran = {r.split('__tests__/')[-1] for r in ran if '__tests__/' in r}
norm_all = {a.split('__tests__/')[-1] for a in allf}
print('ran:', len(norm_ran), 'all:', len(norm_all))
print('MISSING on host:', sorted(norm_all - norm_ran))
