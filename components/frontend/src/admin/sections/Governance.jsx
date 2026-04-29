/**
 * Governance section — new ops-canvas workspace (GovernanceWorkspace.jsx).
 *
 * The legacy AdminDashboard audit viewer is preserved inside the
 * LegacyFallback archive below the new workspace — a proper
 * disclosure surface, not a bare toggle.
 */

import GovernanceWorkspace from "./GovernanceWorkspace.jsx";
import AdminDashboard from "../../AdminDashboard.jsx";
import LegacyFallback from "./LegacyFallback.jsx";


export default function Governance({ token }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <GovernanceWorkspace />

      <LegacyFallback
        kicker="Archive"
        title="Legacy audit viewer"
        subtitle="Raw event stream from the v0 admin dashboard — useful when debugging hash-chain issues or cross-referencing specific audit IDs. Preserved as-is for forensic parity."
      >
        <AdminDashboard
          token={token}
          onLogout={() => {}}
          embedded
          initialTab="audit"
          hideTabs={[
            "overview", "patients", "consultations", "community",
            "knowledge", "verify", "transfers", "dhis2", "dhis2tracker",
          ]}
        />
      </LegacyFallback>
    </div>
  );
}
