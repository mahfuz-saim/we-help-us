/**
 * Tiny reusable badge used to display a user's role.
 * Demonstrates the alert / safe / caution palette.
 */

const COLOR_FOR_ROLE = {
  OWNER: 'alert', // owners list resources so they're "primary" in the alert family
  VOLUNTEER: 'safe',
  MODERATOR: 'caution',
  ADMIN: 'brand',
};

export default function RoleBadge({ role, className = '' }) {
  const family = COLOR_FOR_ROLE[role] || 'slate';

  const styles = {
    alert:   'bg-alert-100 text-alert-800 ring-alert-200',
    safe:    'bg-safe-100 text-safe-800 ring-safe-200',
    caution: 'bg-caution-100 text-caution-800 ring-caution-200',
    brand:   'bg-brand-100 text-brand-800 ring-brand-200',
    slate:   'bg-slate-100 text-slate-700 ring-slate-200',
  };

  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
        (styles[family] || styles.slate) +
        ' ' +
        className
      }
    >
      {role || 'UNKNOWN'}
    </span>
  );
}
