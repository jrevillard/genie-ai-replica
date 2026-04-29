/**
 * Care Records section — new clinical workspace (CareRecords.jsx).
 *
 * The legacy AdminDashboard consultations / community / knowledge
 * tabs are preserved inside the LegacyFallback archive below the
 * new workspace — a proper disclosure surface, not a bare toggle.
 */

import CareRecords from "./CareRecords.jsx";
import AdminDashboard from "../../AdminDashboard.jsx";
import LegacyFallback from "./LegacyFallback.jsx";


export default function CareSection({ token }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <CareRecords />

      <LegacyFallback
        kicker="Archive"
        title="Legacy care panels"
        subtitle="Original consultations, community records, and knowledge-base tabs from the v0 admin dashboard. Every write-path still functions — kept for verification and edge-case workflows."
      >
        <AdminDashboard
          token={token}
          onLogout={() => {}}
          embedded
          initialTab="consultations"
          hideTabs={[
            "overview", "patients", "verify", "transfers",
            "audit", "dhis2", "dhis2tracker",
          ]}
        />
      </LegacyFallback>
    </div>
  );
}
