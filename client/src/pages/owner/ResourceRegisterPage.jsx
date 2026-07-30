/**
 * ResourceRegisterPage — multi-step resource registration form (Module 3.4).
 *
 * Walks an OWNER through five steps to register a resource:
 *   1. CATEGORY  — pick one of the 6 enums (with emoji + color)
 *   2. DETAILS   — title, description, capacity, condition
 *   3. PHOTOS    — up to 5 files, 5 MB each, image-only, with previews
 *   4. LOCATION  — AreaSelector (hierarchy + map pin), both optional
 *   5. REVIEW    — read-only summary of every field + Submit
 *
 * Architecture:
 *   - One react-hook-form `useForm()` carries ALL fields across the
 *     whole flow. The state isn't reset between steps — switching
 *     steps just hides the inactive fields. This means the user can
 *     jump back to any step and see their values intact.
 *   - Photos are kept in a separate `useState` array because the
 *     native file <input> doesn't play nicely with react-hook-form's
 *     value-tracking — and we want `File` objects (not just the
 *     synthetic event) so we can build FormData on submit.
 *   - Per-step validation is delegated to `utils/resourceForm.js`
 *     helpers. The helpers are pure functions so the smoke test
 *     exercises them in isolation; the page just calls them and
 *     surfaces the returned errors via `setError`.
 *   - The submit handler builds a FormData via `buildCreatePayload`
 *     and POSTs to /api/resources (multipart). axios reads the
 *     multipart boundary automatically — we never set Content-Type
 *     manually or the boundary is lost.
 *
 * Failure modes & UX:
 *   - User clicks "Next" without picking a category → step-level
 *     errors render in the same style as the auth/profile pages.
 *   - User picks a 6th photo → the file input's onChange rejects it
 *     BEFORE the FileList is added to state. The user sees the banner.
 *   - User picks a 6 MB image → rejected on selection; the preview
 *     isn't shown.
 *   - Server returns 403 (non-OWNER) → fetch the current user role
 *     and show a friendly "your account isn't allowed to register
 *     resources" banner. The route guard already redirects non-OWNER
 *     users, so this is a belt-and-braces defensive message.
 *   - Server returns 503 (Cloudinary unconfigured) → surface a
 *     friendly inline notice (matches the avatar upload pattern).
 *
 * KEY DESIGN REMINDERS honored:
 *   - Role restriction: route is OWNER-only. Server enforces too.
 *   - Photo uploads: 5 files × 5 MB × image-only. Both client- and
 *     server-side; client-side is instant feedback, server-side is
 *     the source of truth.
 *   - Privacy: ownerId is set by the server from the JWT — the form
 *     never sends it. The form never asks for or displays owner
 *     contact info.
 *   - Geospatial: when the user picks a pin, the form sends a
 *     GeoJSON Point `{ type: 'Point', coordinates: [lng, lat] }` in
 *     JSON-encoded form (the server's zod validator accepts that).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AreaSelector from '../../components/AreaSelector';
import { useAreaChain } from '../../hooks/useAreas';
import {
  CATEGORIES,
  CATEGORY_META,
  getCategoryEmoji,
  getCategoryLabel,
} from '../../utils/categories';
import { UPLOAD_LIMITS } from '../../utils/constants';
import { extractFormError } from '../../utils/formErrors';
import {
  CONDITIONS,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  STEPS,
  TITLE_MAX,
  TITLE_MIN,
  blankResourceDefaults,
  buildCreatePayload,
  validateCategoryStep,
  validateDetailsStep,
  validateLocationStep,
  validatePhotosStep,
} from '../../utils/resourceForm';

// ── Photo cap mirrors UPLOAD_LIMITS so the input rejects the 6th file
//    before it's even added to state. ─────────────────────────────────────────
const MAX_PHOTOS = UPLOAD_LIMITS.MAX_FILES;
const MAX_PHOTO_BYTES = UPLOAD_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPT_ATTR = UPLOAD_LIMITS.ACCEPTED_EXTENSIONS;

// ── Component ───────────────────────────────────────────────────────────────

export default function ResourceRegisterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // ── Profile location (default seed for the resource location) ─────────
  // We prefill the resource's location picker with the OWNER's saved
  // location from /api/auth/me so they don't have to re-pick it. Both
  // the hierarchy (areaId) and the map pin (lng/lat) come from the
  // user record. The chain query resolves the ancestor chain so the
  // dropdowns pre-select the saved hierarchy.
  const profileCoords = useMemo(() => {
    const coords = user?.location?.coordinates;
    if (!Array.isArray(coords)) return { lng: null, lat: null };
    return { lng: coords[0] ?? null, lat: coords[1] ?? null };
  }, [user]);
  const profileChainQuery = useAreaChain({
    areaId: user?.areaId || null,
    enabled: Boolean(user?.areaId),
  });
  const profileChain = useMemo(() => {
    const data = profileChainQuery.data;
    if (!data || !Array.isArray(data.chain) || data.chain.length === 0) {
      return [];
    }
    return data.chain;
  }, [profileChainQuery.data]);
  const profileChainLabel = useMemo(() => {
    if (profileChain.length === 0) return null;
    return profileChain.map((n) => n.name).filter(Boolean).join(' › ') || null;
  }, [profileChain]);

  // ── Form state (whole flow, all fields visible to react-hook-form) ─────
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    setError,
    watch,
    formState: { errors, isDirty },
    trigger,
  } = useForm({
    mode: 'onTouched',
    defaultValues: blankResourceDefaults(),
  });

  const values = watch();

  // ── Seed `area` from the OWNER's profile location ─────────────────────
  // Runs once the user object has hydrated AND the chain (if any) has
  // resolved. We seed the area field with the profile's saved values so
  // the picker opens at the right location. The user can still override
  // any of these in the picker — subsequent edits flow through the
  // Controller's onChange and overwrite this seed.
  //
  // We only seed once per session (tracked via a ref) so that user
  // edits in the picker aren't blown away by a re-render.
  const seededFromProfileRef = useRef(false);
  useEffect(() => {
    if (seededFromProfileRef.current) return;
    if (!user) return;
    // If the user has a saved areaId, wait for the chain query to
    // resolve before seeding, so the dropdowns render with the right
    // initial selection. If there's no areaId, seed immediately.
    const hasSavedArea = Boolean(user.areaId);
    if (hasSavedArea && profileChainQuery.isLoading) return;
    seededFromProfileRef.current = true;
    const current = values.area || {};
    // Only seed when the area field is still at its default (empty)
    // — never overwrite a user edit mid-flow.
    const isUntouched =
      !current.areaId &&
      current.lng == null &&
      current.lat == null;
    if (!isUntouched) return;
    reset(
      {
        ...blankResourceDefaults(),
        area: {
          areaId: user.areaId || null,
          lng: profileCoords.lng,
          lat: profileCoords.lat,
          areaLabel: profileChainLabel,
          chain: profileChain,
        },
      },
      { keepDirtyValues: false, keepValues: false }
    );
    // We intentionally omit `values` from deps — we only want this
    // effect to run once the seed data is ready, not on every form
    // change. `values` is read inside as a snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profileChainQuery.isLoading, profileChain, profileChainLabel, profileCoords, reset]);

  // ── Photos live in a separate state because they aren't strings ──────
  const [photos, setPhotos] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [photoError, setPhotoError] = useState(null);
  const fileRef = useRef(null);

  // ── Step navigation ───────────────────────────────────────────────────
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  // ── Submit handler ────────────────────────────────────────────────────
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setServerError(null);
    setSubmitting(true);
    try {
      const form = buildCreatePayload(values, photos);
      const { data } = await api.post('/resources', form);
      const created = data?.data?.resource;
      const newId = created?.id;
      toast.success('Resource registered');
      // Send the owner to the future dashboard (3.5). We use the
      // explicit "registered" route so the page doesn't redirect back
      // to a placeholder in 3.5.
      navigate(
        newId ? `/owner/resources?new=${encodeURIComponent(newId)}` : '/owner/resources',
        { replace: true }
      );
    } catch (err) {
      const { topMessage, fieldErrors, status } = extractFormError(err);
      // Special-case 503 — the server's createResource throws 503 when
      // Cloudinary isn't configured (matches the avatar upload pattern).
      // The topMessage from the server is already human-readable, but
      // we attach a meta note so the UI can render a calmer banner.
      setServerError({ message: topMessage, status });
      // Map server-side zod issues onto the matching fields so the
      // user sees the red border + message on the offending input.
      for (const [field, msg] of Object.entries(fieldErrors)) {
        if (['category', 'title', 'description', 'capacity', 'condition'].includes(field)) {
          setError(field, { type: 'server', message: msg });
        }
      }
      // Scroll to the alert so the user notices it.
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step actions ──────────────────────────────────────────────────────
  async function goNext() {
    // Validate the current step's fields via react-hook-form AND the
    // pure helpers. react-hook-form's `trigger` surfaces the visual
    // errors on the right input; the pure helpers cover anything
    // react-hook-form doesn't track (e.g. the photo file list — it's
    // not part of the form state).
    if (step.id === 'category') {
      const ok = await trigger('category');
      const helperErrs = validateCategoryStep(values);
      if (!ok || helperErrs) {
        if (helperErrs) setError('category', { type: 'manual', message: helperErrs.category });
        return;
      }
    } else if (step.id === 'details') {
      const ok = await trigger(['title', 'description', 'capacity', 'condition']);
      const helperErrs = validateDetailsStep(values);
      if (!ok || helperErrs) {
        if (helperErrs) {
          for (const [k, m] of Object.entries(helperErrs)) {
            setError(k, { type: 'manual', message: m });
          }
        }
        return;
      }
    } else if (step.id === 'photos') {
      const photoErrs = validatePhotosStep(photos);
      if (photoErrs) {
        setPhotoError(photoErrs.join(' '));
        return;
      }
      setPhotoError(null);
    } else if (step.id === 'location') {
      const ok = await trigger('area');
      const helperErrs = validateLocationStep(values);
      if (!ok || helperErrs) {
        if (helperErrs && helperErrs.location) {
          setError('area', { type: 'manual', message: helperErrs.location });
        }
        return;
      }
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
    // Scroll into view so the user sees the new step.
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // ── Photo handlers ───────────────────────────────────────────────────
  function onPickPhotos(e) {
    setPhotoError(null);
    const raw = e.target.files;
    if (!raw || raw.length === 0) return;
    const incoming = Array.from(raw);

    // Cap at MAX_PHOTOS. If the user added more, reject the whole batch.
    // The input's `multiple` attribute already lets them pick many, so
    // we have to enforce the cap here.
    if (photos.length + incoming.length > MAX_PHOTOS) {
      setPhotoError(
        `You can upload at most ${MAX_PHOTOS} photos. You already have ${photos.length}; this batch would add ${incoming.length}.`
      );
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    // Per-file validation (size + mime).
    const offenders = [];
    for (const f of incoming) {
      if (!UPLOAD_LIMITS.ACCEPTED_MIME_TYPES.includes(f.type)) {
        offenders.push(`${f.name}: unsupported type "${f.type}"`);
      }
      if (typeof f.size === 'number' && f.size > MAX_PHOTO_BYTES) {
        offenders.push(`${f.name}: must be under ${UPLOAD_LIMITS.MAX_FILE_SIZE_MB} MB`);
      }
    }
    if (offenders.length) {
      setPhotoError(offenders.join('; '));
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    // Build previews. We use FileReader.readAsDataURL so the preview
    // is a plain data: URL that works without an extra round-trip.
    const readers = incoming.map(
      (f) =>
        new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.readAsDataURL(f);
        })
    );
    Promise.all(readers).then((urls) => {
      setPhotos((prev) => [...prev, ...incoming]);
      setPhotoPreviews((prev) => [...prev, ...urls]);
    });
    // Reset the input so picking the same file twice still triggers onChange.
    if (fileRef.current) fileRef.current.value = '';
  }

  function removePhoto(idx) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));
    setPhotoError(null);
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Header user={user} />

      <StepIndicator activeIndex={stepIndex} />

      {serverError && (
        <div
          role="alert"
          className={
            'rounded-md border p-3 text-sm ' +
            (serverError.status === 503
              ? 'border-caution-300 bg-caution-50 text-caution-800'
              : serverError.status === 403
              ? 'border-caution-300 bg-caution-50 text-caution-800'
              : 'border-alert-200 bg-alert-50 text-alert-800')
          }
        >
          {serverError.message}
        </div>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        {step.id === 'category' && (
          <CategoryStep
            register={register}
            value={values.category}
            error={errors.category?.message}
          />
        )}
        {step.id === 'details' && (
          <DetailsStep
            register={register}
            errors={errors}
            values={values}
          />
        )}
        {step.id === 'photos' && (
          <PhotosStep
            photos={photos}
            previews={photoPreviews}
            onPick={onPickPhotos}
            onRemove={removePhoto}
            error={photoError}
            fileRef={fileRef}
          />
        )}
        {step.id === 'location' && (
          <LocationStep
            control={control}
            error={errors.area?.message}
          />
        )}
        {step.id === 'review' && (
          <ReviewStep
            values={values}
            photos={photos}
            previews={photoPreviews}
          />
        )}

        <StepNav
          stepIndex={stepIndex}
          onBack={goBack}
          onNext={goNext}
          submitting={submitting}
          isDirty={isDirty}
          hasPhotos={photos.length > 0}
        />
      </form>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({ user }) {
  return (
    <header>
      <h1 className="text-xl font-semibold text-slate-900">Register a resource</h1>
      <p className="mt-1 text-sm text-slate-600">
        {user ? (
          <>
            Add a resource you can share — vehicles, equipment, space, skills.
            Registered as <span className="font-medium">{user.name || user.email}</span>.
          </>
        ) : (
          'Add a resource you can share with your community.'
        )}
      </p>
    </header>
  );
}

// ── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ activeIndex }) {
  return (
    <ol
      className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-2 text-xs"
      aria-label="Form steps"
    >
      {STEPS.map((s, i) => {
        const isActive = i === activeIndex;
        const isDone = i < activeIndex;
        return (
          <li
            key={s.id}
            className="flex items-center gap-1"
            aria-current={isActive ? 'step' : undefined}
          >
            <span
              className={
                'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ' +
                (isActive
                  ? 'bg-alert-700 text-white'
                  : isDone
                  ? 'bg-safe-500 text-white'
                  : 'bg-slate-100 text-slate-500')
              }
              aria-hidden
            >
              {isDone ? '✓' : i + 1}
            </span>
            <span
              className={
                'pr-2 ' +
                (isActive ? 'font-semibold text-slate-900' : 'text-slate-600')
              }
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Step 1: Category ────────────────────────────────────────────────────────

function CategoryStep({ register, value, error }) {
  return (
    <fieldset>
      <legend className="text-base font-semibold text-slate-900">
        What kind of resource are you sharing?
      </legend>
      <p className="mt-1 text-sm text-slate-600">
        Pick one category. Volunteers browsing the search page will see
        this grouping.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {CATEGORY_META.map((meta) => {
          const selected = value === meta.value;
          return (
            <label
              key={meta.value}
              className={
                'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ' +
                (selected
                  ? 'border-alert-700 bg-alert-50 ring-1 ring-alert-700'
                  : 'border-slate-300 hover:border-slate-400')
              }
            >
              <input
                type="radio"
                value={meta.value}
                className="mt-1 h-4 w-4 text-alert-700 focus:ring-alert-500"
                {...register('category', {
                  required: 'Pick a category',
                  validate: (v) =>
                    CATEGORY_META.some((m) => m.value === v) || 'Pick a category',
                })}
              />
              <span className="text-2xl leading-none" aria-hidden>
                {meta.emoji}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-900">
                  {meta.label}
                </span>
                <span className="block text-xs text-slate-500">
                  {categoryHint(meta.value)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-alert-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function categoryHint(value) {
  switch (value) {
    case CATEGORIES.TRANSPORTATION:
      return 'Cars, trucks, boats, motorbikes — anything that moves people or supplies.';
    case CATEGORIES.RESCUE_EQUIPMENT:
      return 'Helmets, ropes, life jackets, search tools, AEDs, etc.';
    case CATEGORIES.MEDICAL:
      return 'First-aid kits, oxygen, prescription medicine, wheelchairs.';
    case CATEGORIES.INFRASTRUCTURE:
      return 'Generators, water pumps, shelter space, fencing.';
    case CATEGORIES.UTILITIES:
      return 'Power banks, lanterns, fuel, connectivity (Wi-Fi hotspots).';
    case CATEGORIES.SKILLED_PROFESSIONALS:
      return 'Doctors, electricians, drivers, language translators.';
    default:
      return '';
  }
}

// ── Step 2: Details ─────────────────────────────────────────────────────────

function DetailsStep({ register, errors, values }) {
  const titleLen = (values.title || '').length;
  const descLen = (values.description || '').length;
  return (
    <fieldset>
      <legend className="text-base font-semibold text-slate-900">
        Tell volunteers what you have
      </legend>
      <p className="mt-1 text-sm text-slate-600">
        A clear title and description help volunteers pick the right
        resource quickly during a crisis.
      </p>

      <div className="mt-4 space-y-4">
        <Field
          label="Title"
          htmlFor="title"
          error={errors.title?.message}
          hint={`${titleLen}/${TITLE_MAX} — at least ${TITLE_MIN} characters.`}
        >
          <input
            id="title"
            type="text"
            placeholder="E.g. Spare 4x4 truck, can carry 1 ton"
            aria-invalid={Boolean(errors.title)}
            className={inputClass(Boolean(errors.title))}
            {...register('title', {
              required: 'Title is required',
              minLength: { value: TITLE_MIN, message: `Title must be at least ${TITLE_MIN} characters` },
              maxLength: { value: TITLE_MAX, message: `Title must be at most ${TITLE_MAX} characters` },
            })}
          />
        </Field>

        <Field
          label="Description"
          htmlFor="description"
          error={errors.description?.message}
          hint={`${descLen}/${DESCRIPTION_MAX} — at least ${DESCRIPTION_MIN} characters.`}
        >
          <textarea
            id="description"
            rows={4}
            placeholder="Describe the resource, the condition, any operating limits, and when it's available."
            aria-invalid={Boolean(errors.description)}
            className={inputClass(Boolean(errors.description))}
            {...register('description', {
              required: 'Description is required',
              minLength: { value: DESCRIPTION_MIN, message: `Description must be at least ${DESCRIPTION_MIN} characters` },
              maxLength: { value: DESCRIPTION_MAX, message: `Description must be at most ${DESCRIPTION_MAX} characters` },
            })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Capacity (optional)"
            htmlFor="capacity"
            error={errors.capacity?.message}
            hint="Passengers, people, or units — whatever makes sense for this resource."
          >
            <input
              id="capacity"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="e.g. 7"
              aria-invalid={Boolean(errors.capacity)}
              className={inputClass(Boolean(errors.capacity))}
              {...register('capacity', {
                validate: (v) => {
                  if (v === undefined || v === null || v === '') return true;
                  const n = Number(v);
                  if (!Number.isFinite(n) || !Number.isInteger(n)) {
                    return 'Capacity must be a whole number';
                  }
                  if (n < 0 || n > 100000) return 'Capacity must be between 0 and 100000';
                  return true;
                },
              })}
            />
          </Field>

          <Field
            label="Condition"
            htmlFor="condition"
            error={errors.condition?.message}
          >
            <select
              id="condition"
              aria-invalid={Boolean(errors.condition)}
              className={inputClass(Boolean(errors.condition))}
              {...register('condition', {
                validate: (v) =>
                  !v || CONDITIONS.includes(v) || 'Pick a condition',
              })}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {conditionLabel(c)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    </fieldset>
  );
}

function conditionLabel(c) {
  switch (c) {
    case 'NEW': return 'New — unused';
    case 'GOOD': return 'Good — works as expected';
    case 'FAIR': return 'Fair — usable with minor wear';
    case 'NEEDS_REPAIR': return 'Needs repair — fixable';
    default: return c;
  }
}

// ── Step 3: Photos ──────────────────────────────────────────────────────────

function PhotosStep({ photos, previews, onPick, onRemove, error, fileRef }) {
  const remaining = MAX_PHOTOS - photos.length;
  return (
    <fieldset>
      <legend className="text-base font-semibold text-slate-900">
        Add photos (optional)
      </legend>
      <p className="mt-1 text-sm text-slate-600">
        Up to {MAX_PHOTOS} photos. Each must be an image (JPG, PNG, WebP, GIF)
        under {UPLOAD_LIMITS.MAX_FILE_SIZE_MB} MB. Photos help volunteers
        recognise the resource at a glance.
      </p>

      <div className="mt-4">
        <label
          htmlFor="photos"
          className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm hover:border-slate-400"
        >
          <span className="text-2xl" aria-hidden>📷</span>
          <span className="mt-2 font-medium text-slate-700">
            Click to pick photos
          </span>
          <span className="mt-1 text-xs text-slate-500">
            {remaining > 0
              ? `${remaining} of ${MAX_PHOTOS} slots remaining`
              : `You have ${MAX_PHOTOS} photos — remove one to add another`}
          </span>
          <input
            ref={fileRef}
            id="photos"
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            onChange={onPick}
            disabled={remaining <= 0}
            className="sr-only"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-alert-700">
          {error}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {photos.map((f, i) => (
            <li
              key={i}
              className="relative overflow-hidden rounded-md border border-slate-200 bg-white"
            >
              <img
                src={previews[i]}
                alt={f.name || `Photo ${i + 1}`}
                className="aspect-square w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute right-1 top-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-700 shadow hover:bg-white"
                aria-label={`Remove photo ${i + 1}`}
              >
                ✕
              </button>
              <div className="truncate p-2 text-xs text-slate-600">
                {f.name}
              </div>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

// ── Step 4: Location ───────────────────────────────────────────────────────

function LocationStep({ control, error }) {
  return (
    <fieldset>
      <legend className="text-base font-semibold text-slate-900">
        Where is the resource?
      </legend>
      <p className="mt-1 text-sm text-slate-600">
        Optional but recommended. Pre-filled from your profile location —
        change it here if this resource is somewhere else. You can pick by
        district hierarchy, by address search, or by dropping a pin on the
        map. Either surface alone is enough — the form accepts both.
      </p>
      <div className="mt-4">
        <Controller
          control={control}
          name="area"
          render={({ field }) => (
            <AreaSelector
              initialAreaId={field.value?.areaId || null}
              initialLng={field.value?.lng ?? null}
              initialLat={field.value?.lat ?? null}
              initialAreaLabel={field.value?.areaLabel || null}
              initialChain={
                Array.isArray(field.value?.chain) &&
                field.value.chain.length > 0
                  ? field.value.chain
                  : null
              }
              onChange={(next) => field.onChange(next)}
            />
          )}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-alert-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ── Step 5: Review ──────────────────────────────────────────────────────────

function ReviewStep({ values, photos, previews }) {
  const hasArea = Boolean(values.area?.areaId);
  const hasPin = values.area?.lng != null && values.area?.lat != null;
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Review</h2>
      <p className="mt-1 text-sm text-slate-600">
        Sanity-check the details below. Use the Back button to fix
        anything. Submitting registers the resource immediately.
      </p>

      <dl className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200">
        <Row label="Category">
          <span className="text-xl" aria-hidden>{getCategoryEmoji(values.category)}</span>{' '}
          <span className="font-medium text-slate-900">
            {getCategoryLabel(values.category)}
          </span>
        </Row>
        <Row label="Title">
          <span className="font-medium text-slate-900">{values.title || '—'}</span>
        </Row>
        <Row label="Description">
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {values.description || '—'}
          </p>
        </Row>
        <Row label="Capacity">
          {values.capacity !== '' && values.capacity !== undefined && values.capacity !== null
            ? values.capacity
            : '—'}
        </Row>
        <Row label="Condition">{conditionLabel(values.condition)}</Row>
        <Row label="Photos">
          {photos.length === 0 ? (
            <span className="text-slate-500">No photos</span>
          ) : (
            <ul className="grid grid-cols-5 gap-2">
              {previews.map((src, i) => (
                <li key={i} className="overflow-hidden rounded-md border border-slate-200">
                  <img src={src} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Location">
          <div className="space-y-1 text-sm">
            {hasArea && (
              <div className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
                {values.area.areaLabel || 'Area selected'}
              </div>
            )}
            {hasPin && (
              <div className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                {Number(values.area.lat).toFixed(5)}, {Number(values.area.lng).toFixed(5)}
              </div>
            )}
            {!hasArea && !hasPin && (
              <span className="text-slate-500">No location picked</span>
            )}
          </div>
        </Row>
      </dl>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[10rem,1fr]">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

// ── Step nav (back / next / submit) ─────────────────────────────────────────

function StepNav({ stepIndex, onBack, onNext, submitting, isDirty, hasPhotos }) {
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
      <button
        type="button"
        onClick={onBack}
        disabled={isFirst || submitting}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Back
      </button>
      <div className="text-xs text-slate-500">
        Step {stepIndex + 1} of {STEPS.length}
      </div>
      {isLast ? (
        <button
          type="submit"
          disabled={submitting || !isDirty}
          className="rounded-md bg-alert-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Registering…' : 'Register resource'}
        </button>
      ) : (
        <button
          type="button"
          onClick={onNext}
          disabled={submitting}
          className="rounded-md bg-alert-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Next
        </button>
      )}
    </div>
  );
}

// ── Reusable bits (kept local so the page is self-contained) ────────────────

function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-700"
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error && (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-alert-700">{error}</p>}
    </div>
  );
}

function inputClass(hasError) {
  return [
    'block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm',
    'placeholder:text-slate-400 focus:outline-none focus:ring-2',
    hasError
      ? 'border-alert-300 focus:border-alert-500 focus:ring-alert-200'
      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200',
  ].join(' ');
}
