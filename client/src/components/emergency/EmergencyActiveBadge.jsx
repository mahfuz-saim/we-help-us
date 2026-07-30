/**
 * EmergencyActiveBadge — small red pill used on resource list rows
 * (owner's own dashboard, search list, volunteer's request rows).
 *
 * Driven entirely by a `show` boolean — the parent decides what that
 * flag means. Convention: the resource payload exposes
 * `areaEmergencyActive === true` when the resource sits inside an
 * active emergency activation (HIERARCHY or CIRCLE) — see
 * `server/utils/emergencyScope.isAreaInEmergency`.
 *
 * Module 9 — Emergency System Rework. Lives on the owner surface and
 * the search list. It does NOT render a "Deactivate" button — the
 * activator owns that affordance (volunteer dashboard, moderator
 * dashboard). It is a read-only signal.
 *
 * Privacy: nothing in this component exposes owner phone/email/contact
 * info. It's a label + an icon.
 */

export default function EmergencyActiveBadge({ show }) {
  if (!show) return null;
  return (
    <span
      role="status"
      aria-label="Emergency active in this area"
      data-testid="emergency-active-badge"
      className="inline-flex items-center gap-1 rounded-full bg-alert-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm"
    >
      <span aria-hidden className="text-[10px] leading-none">
        ⚠
      </span>
      <span>Emergency</span>
    </span>
  );
}
