/**
 * Integrations section — new DHIS2 ops workspace (IntegrationsWorkspace.jsx).
 *
 * The legacy AdminDashboard DHIS2 sync + tracker tabs live inside the
 * LegacyFallback archive at the bottom — a deliberate disclosure
 * surface rather than a bare ghost button.
 */

import IntegrationsWorkspace from "./IntegrationsWorkspace.jsx";
import AdminDashboard from "../../AdminDashboard.jsx";
import LegacyFallback from "./LegacyFallback.jsx";


export default function Integrations({ token }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <IntegrationsWorkspace />

      <LegacyFallback
        kicker="Archive"
        title="Legacy DHIS2 panels"
        subtitle="Original sync &amp; tracker console from the v0 admin dashboard. Preserved for verification, edge-case workflows, and parity testing — every write-path still routes to the same backend."
      >
        <AdminDashboard
          token={token}
          onLogout={() => {}}
          embedded
          initialTab="dhis2"
          hideTabs={[
            "overview", "patients", "consultations", "community",
            "knowledge", "audit", "verify", "transfers",
          ]}
        />
      </LegacyFallback>
    </div>
  );
}
