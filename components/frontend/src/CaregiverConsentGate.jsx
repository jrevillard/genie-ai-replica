/**
 * CaregiverConsentGate — first-launch training-consent modal for caregivers.
 *
 * Thin wrapper around ConsentGate that injects caregiver-appropriate copy.
 * Kept in its own file so the ConsentBootstrap can import the right
 * component based on which JWT is present in localStorage without any
 * runtime branching inside ConsentGate itself.
 */

import ConsentGate from "./ConsentGate.jsx";

export default function CaregiverConsentGate(props) {
  return (
    <ConsentGate
      {...props}
      actorRole="caregiver"
      headline="Help AMINA learn from caregiver conversations?"
      subhead={
        "your questions and the guidance you get can help improve how AMINA " +
        "supports other caregivers in The Gambia."
      }
    />
  );
}
