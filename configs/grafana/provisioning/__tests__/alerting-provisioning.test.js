const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ALERT_RULES_PATH = path.resolve(
  __dirname,
  '..',
  'alerting',
  'alert-rules.yml'
);
const CONTACT_POINTS_PATH = path.resolve(
  __dirname,
  '..',
  'alerting',
  'contact-points.yml'
);
const NOTIFICATION_POLICIES_PATH = path.resolve(
  __dirname,
  '..',
  'alerting',
  'notification-policies.yml'
);
const VM_DATASOURCE_PATH = path.resolve(
  __dirname,
  '..',
  'datasources',
  'vm-datasource.yml'
);
const DASHBOARD_PATH = path.resolve(
  __dirname,
  '..',
  'dashboards',
  'observability',
  'observability-stack-health.json'
);
const ENV_TEMPLATE_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'env');

describe('Alerting Provisioning', () => {
  let alertRules;
  let contactPoints;
  let notificationPolicies;
  let vmDatasource;
  let dashboard;
  let envTemplate;

  beforeAll(() => {
    alertRules = yaml.safeLoad(fs.readFileSync(ALERT_RULES_PATH, 'utf8'));
    contactPoints = yaml.safeLoad(fs.readFileSync(CONTACT_POINTS_PATH, 'utf8'));
    notificationPolicies = yaml.safeLoad(
      fs.readFileSync(NOTIFICATION_POLICIES_PATH, 'utf8')
    );
    vmDatasource = yaml.safeLoad(fs.readFileSync(VM_DATASOURCE_PATH, 'utf8'));
    dashboard = JSON.parse(fs.readFileSync(DASHBOARD_PATH, 'utf8'));
    envTemplate = fs.readFileSync(ENV_TEMPLATE_PATH, 'utf8');
  });

  // ---------------------------------------------------------------------------
  // AC1-4: Alert rules
  // ---------------------------------------------------------------------------
  describe('Alert Rules (AC1-4)', () => {
    test('alert-rules.yml is valid YAML with apiVersion 1', () => {
      expect(alertRules.apiVersion).toBe(1);
    });

    test('contains exactly 4 alert rule groups', () => {
      expect(alertRules.groups).toBeDefined();
      expect(alertRules.groups).toHaveLength(4);
    });

    test('all groups have stable unique UIDs', () => {
      const uids = alertRules.groups.map((g) => g.uid);
      expect(new Set(uids).size).toBe(4);
    });

    test('contains 5 alert rules (4 ACs + extra VictoriaTraces ingestion)', () => {
      const allRules = alertRules.groups.flatMap((g) => g.rules);
      expect(allRules).toHaveLength(5);
    });

    const expectedRules = [
      { uid: 'otel_collector_down', title: 'OTel Collector Down' },
      {
        uid: 'vm_storage_high',
        title: 'VictoriaMetrics Storage Usage High',
      },
      { uid: 'vlogs_ingestion_drop', title: 'VictoriaLogs Ingestion Drop' },
      {
        uid: 'vtraces_export_failures',
        title: 'VictoriaTraces Export Failures',
      },
      {
        uid: 'vtraces_ingestion_drop',
        title: 'VictoriaTraces Ingestion Rate Drop',
      },
    ];

    expectedRules.forEach(({ uid, title }) => {
      describe(`Rule: ${title}`, () => {
        let rule;

        beforeAll(() => {
          rule = alertRules.groups
            .flatMap((g) => g.rules)
            .find((r) => r.uid === uid);
        });

        test(`rule ${uid} exists`, () => {
          expect(rule).toBeDefined();
        });

        test(`rule ${uid} has correct title`, () => {
          expect(rule.title).toBe(title);
        });

        test(`rule ${uid} references datasourceUid victoriametrics`, () => {
          const promQueries = rule.data.filter(
            (d) => d.datasourceUid === 'victoriametrics'
          );
          expect(promQueries.length).toBeGreaterThan(0);
        });

        test(`rule ${uid} has annotations with description`, () => {
          expect(rule.annotations).toBeDefined();
          expect(rule.annotations.description).toBeDefined();
          expect(typeof rule.annotations.description).toBe('string');
          expect(rule.annotations.description.length).toBeGreaterThan(10);
        });

        test(`rule ${uid} has severity label`, () => {
          expect(rule.labels).toBeDefined();
          expect(rule.labels.severity).toBeDefined();
          expect(['critical', 'warning']).toContain(rule.labels.severity);
        });

        test(`rule ${uid} has component label`, () => {
          expect(rule.labels.component).toBeDefined();
        });

        test(`rule ${uid} has condition field`, () => {
          expect(rule.condition).toBeDefined();
        });

        test(`rule ${uid} has for duration`, () => {
          expect(rule.for).toBeDefined();
        });
      });
    });

    test('OTel Collector Down alert has critical severity', () => {
      const rule = alertRules.groups
        .flatMap((g) => g.rules)
        .find((r) => r.uid === 'otel_collector_down');
      expect(rule.labels.severity).toBe('critical');
    });

    test('OTel Collector Down uses noDataState: Alerting', () => {
      const rule = alertRules.groups
        .flatMap((g) => g.rules)
        .find((r) => r.uid === 'otel_collector_down');
      expect(rule.noDataState).toBe('Alerting');
    });

    test('OTel Collector Down uses execErrState: Alerting', () => {
      const rule = alertRules.groups
        .flatMap((g) => g.rules)
        .find((r) => r.uid === 'otel_collector_down');
      expect(rule.execErrState).toBe('Alerting');
    });

    test('non-critical alerts use noDataState: OK (except collector-down and vtraces-ingestion)', () => {
      const nonCritical = alertRules.groups
        .flatMap((g) => g.rules)
        .filter(
          (r) =>
            r.uid !== 'otel_collector_down' &&
            r.uid !== 'vtraces_ingestion_drop'
        );
      nonCritical.forEach((rule) => {
        expect(rule.noDataState).toBe('OK');
      });
    });

    test('all alerts use PromQL queries via victoriametrics datasource', () => {
      const allRules = alertRules.groups.flatMap((g) => g.rules);
      allRules.forEach((rule) => {
        const promQuery = rule.data.find(
          (d) => d.datasourceUid === 'victoriametrics'
        );
        expect(promQuery).toBeDefined();
        expect(promQuery.model.expr).toBeDefined();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Datasource UID alignment
  // ---------------------------------------------------------------------------
  describe('Datasource UID Alignment', () => {
    test('vm-datasource.yml has uid: victoriametrics', () => {
      const vmDs = vmDatasource.datasources.find(
        (d) => d.name === 'VictoriaMetrics'
      );
      expect(vmDs).toBeDefined();
      expect(vmDs.uid).toBe('victoriametrics');
    });

    test('all alert rule datasourceUid values match provisioned UIDs', () => {
      const allRules = alertRules.groups.flatMap((g) => g.rules);
      allRules.forEach((rule) => {
        const vmRefs = rule.data
          .filter((d) => d.datasourceUid !== '__expr__')
          .map((d) => d.datasourceUid);
        vmRefs.forEach((uid) => {
          // Must match a provisioned datasource UID
          const provisionedUids = vmDatasource.datasources.map((d) => d.uid);
          expect(provisionedUids).toContain(uid);
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // AC5: Contact points and notification policies
  // ---------------------------------------------------------------------------
  describe('Contact Points (AC5)', () => {
    test('contact-points.yml is valid YAML with apiVersion 1', () => {
      expect(contactPoints.apiVersion).toBe(1);
    });

    test('has at least one contact point', () => {
      expect(contactPoints.contactPoints).toBeDefined();
      expect(contactPoints.contactPoints.length).toBeGreaterThan(0);
    });

    test('default contact point has name and type', () => {
      const cp = contactPoints.contactPoints[0];
      expect(cp.name).toBeDefined();
      expect(cp.receivers).toBeDefined();
      expect(cp.receivers.length).toBeGreaterThan(0);
      expect(cp.receivers[0].type).toBeDefined();
    });

    test('contact point has a stable UID', () => {
      const cp = contactPoints.contactPoints[0];
      expect(cp.receivers[0].uid).toBeDefined();
    });

    test('contact point does not contain real credentials', () => {
      const content = fs.readFileSync(CONTACT_POINTS_PATH, 'utf8');
      // Should not contain real URLs (only localhost placeholder)
      expect(content).not.toMatch(/https:\/\/hooks\.slack\.com/);
      expect(content).not.toMatch(/https:\/\/.*\.pagerduty\.com/);
    });
  });

  describe('Notification Policies (AC5)', () => {
    test('notification-policies.yml is valid YAML with apiVersion 1', () => {
      expect(notificationPolicies.apiVersion).toBe(1);
    });

    test('has a default policy with receiver', () => {
      expect(notificationPolicies.policies).toBeDefined();
      expect(notificationPolicies.policies.length).toBeGreaterThan(0);
      expect(notificationPolicies.policies[0].receiver).toBeDefined();
    });

    test('default policy groups by alertname and component', () => {
      const policy = notificationPolicies.policies[0];
      expect(policy.group_by).toBeDefined();
      expect(policy.group_by).toContain('alertname');
      expect(policy.group_by).toContain('component');
    });

    test('default policy has timing configuration', () => {
      const policy = notificationPolicies.policies[0];
      expect(policy.group_wait).toBeDefined();
      expect(policy.group_interval).toBeDefined();
      expect(policy.repeat_interval).toBeDefined();
    });

    test('receiver name matches a contact point', () => {
      const receiverName = notificationPolicies.policies[0].receiver;
      const cpNames = contactPoints.contactPoints.map((cp) => cp.name);
      expect(cpNames).toContain(receiverName);
    });
  });

  // ---------------------------------------------------------------------------
  // AC6: Dashboard structure
  // ---------------------------------------------------------------------------
  describe('Dashboard (AC6)', () => {
    test('dashboard JSON is valid with title', () => {
      expect(dashboard.title).toBe('Observability Stack Health');
    });

    test('dashboard has unique UID', () => {
      expect(dashboard.uid).toBe('observability-stack-health');
    });

    test('dashboard has required panels', () => {
      const panelTitles = dashboard.panels.map((p) => p.title);
      expect(panelTitles).toContain('OTel Collector Status');
      expect(panelTitles).toContain('VictoriaMetrics Ingestion Rate');
      expect(panelTitles).toContain('VictoriaMetrics Storage Usage');
      expect(panelTitles).toContain('VictoriaLogs Ingestion Rate');
      expect(panelTitles).toContain('VictoriaTraces Export Metrics');
      expect(panelTitles).toContain('Grafana Health');
      expect(panelTitles).toContain('Tempo Proxy Health');
      expect(panelTitles).toContain('Query Latency — VictoriaMetrics');
    });

    test('all panels reference victoriametrics datasource', () => {
      dashboard.panels.forEach((panel) => {
        if (panel.datasource) {
          expect(panel.datasource.uid).toBe('victoriametrics');
        }
      });
    });

    test('query latency panel exists (Task 3.8)', () => {
      const queryLatency = dashboard.panels.find(
        (p) => p.title === 'Query Latency — VictoriaMetrics'
      );
      expect(queryLatency).toBeDefined();
      expect(queryLatency.targets.length).toBeGreaterThan(0);
      expect(queryLatency.targets[0].expr).toContain(
        'vm_request_duration_seconds'
      );
    });

    test('dashboard includes alert state annotations', () => {
      const alertAnnotation = dashboard.annotations.list.find(
        (a) => a.name === 'Alert State'
      );
      expect(alertAnnotation).toBeDefined();
      expect(alertAnnotation.datasource).toBeDefined();
    });

    test('dashboard has observability tags', () => {
      expect(dashboard.tags).toContain('observability');
      expect(dashboard.tags).toContain('meta-monitoring');
    });

    test('dashboard panels have grid positioning', () => {
      dashboard.panels.forEach((panel) => {
        expect(panel.gridPos).toBeDefined();
        expect(panel.gridPos.h).toBeGreaterThan(0);
        expect(panel.gridPos.w).toBeGreaterThan(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Env template alerting variables
  // ---------------------------------------------------------------------------
  describe('Env Template Variables', () => {
    test('env template contains GRAFANA_ALERT_WEBHOOK_URL', () => {
      expect(envTemplate).toContain('GRAFANA_ALERT_WEBHOOK_URL');
    });

    test('env template contains GRAFANA_ALERT_EMAIL', () => {
      expect(envTemplate).toContain('GRAFANA_ALERT_EMAIL');
    });

    test('alerting variables are optional (commented out)', () => {
      const lines = envTemplate.split('\n');
      const webhookLine = lines.find((l) =>
        l.includes('GRAFANA_ALERT_WEBHOOK_URL')
      );
      expect(webhookLine.trim()).toMatch(/^#/);
    });
  });
});
