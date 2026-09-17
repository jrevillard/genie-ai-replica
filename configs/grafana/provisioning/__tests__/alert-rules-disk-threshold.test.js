const fs = require('fs');
const path = require('path');

describe('alert-rules.yml — disk-storage thresholds', () => {
  const yml = fs.readFileSync(
    path.join(__dirname, '..', 'alerting', 'alert-rules.yml'),
    'utf8'
  );

  function diskAlertBlocks() {
    // Extract every alert group whose title/description mentions disk.
    // Grafana provisioning uses `- orgId:` as the group marker
    // (indented with 2 spaces). End-of-string lookahead uses `$` since
    // JavaScript regex does not support `\Z`.
    const re = /(- orgId:[\s\S]*?(?=\n  - orgId:|$))/g;
    return [...yml.matchAll(re)].map((m) => m[1])
      .filter((b) => /disk/i.test(b));
  }

  it('uses gt[] (not lt[]) for disk-storage alerts', () => {
    const disk = diskAlertBlocks();
    expect(disk.length).toBeGreaterThan(0);
    for (const block of disk) {
      // The bug was `type: lt` with threshold 1073741824 — would fire
      // when disk is empty. Disk-full alerts MUST be gt[].
      expect(block).toMatch(/type:\s*gt\b/);
      expect(block).not.toMatch(/type:\s*lt\b/);
    }
  });

  it('keeps 1073741824 (1 GiB) as the threshold value', () => {
    expect(yml).toContain('1073741824');
  });
});
