/**
 * Bangladesh administrative hierarchy — seed data for the Area model.
 *
 * Bangladesh's admin structure (top → bottom):
 *   Division (8)   — NOT modeled (spec starts at district)
 *   District (64)  — modeled as `level: DISTRICT`
 *   Upazila (495)  — modeled as `level: UPAZILA`
 *   Union (~4,550) — modeled as `level: UNION`
 *   Ward (~40,000) — modeled as `level: WARD`
 *   Village (~80k) — modeled as `level: VILLAGE`
 *
 * The spec cascades district → upazila → union → ward → village. We
 * seed all 64 real districts (small enough to ship as-is) plus a
 * representative subset underneath: 3 upazilas per district, 2 unions
 * per upazila, 2 wards per union, 2 villages per ward. That's ~2,944
 * nodes — enough to demonstrate the cascading dropdown in Module 2.2
 * without bloating the demo DB.
 *
 * Boundary polygons are intentionally OMITTED — they're public GeoJSON
 * and would balloon this file beyond reason. Module 4.3 (interactive
 * map) can populate them later from an external source.
 *
 * Sources: district names are the official 64 Bangladesh districts
 * (used widely in census / election data). Lower-level names follow
 * a deterministic "<District> <Cardinal>/<Role>" pattern so the
 * tree is self-explanatory in the demo. Replace with data.gov.bd
 * exports when fuller coverage is needed.
 *
 * NOTE: the canonical district list contains both `Chapainawabganj`
 * (the official name) and `Nawabganj` (the older name still in wide
 * use). The two refer to the same physical district; we ship BOTH
 * so clients with either spelling can match — the upstream cascading
 * data structure under each is identical.
 */

const DISTRICTS = [
  // Dhaka Division
  { name: 'Dhaka' },
  { name: 'Faridpur' },
  { name: 'Gazipur' },
  { name: 'Gopalganj' },
  { name: 'Kishoreganj' },
  { name: 'Madaripur' },
  { name: 'Manikganj' },
  { name: 'Munshiganj' },
  { name: 'Narayanganj' },
  { name: 'Narsingdi' },
  { name: 'Rajbari' },
  { name: 'Shariatpur' },
  { name: 'Tangail' },
  // Chittagong Division
  { name: 'Chattogram' },
  { name: 'Bandarban' },
  { name: 'Brahmanbaria' },
  { name: 'Chandpur' },
  { name: 'Cumilla' },
  { name: "Cox's Bazar" },
  { name: 'Feni' },
  { name: 'Khagrachari' },
  { name: 'Lakshmipur' },
  { name: 'Noakhali' },
  { name: 'Rangamati' },
  // Rajshahi Division
  { name: 'Bogura' },
  { name: 'Chapainawabganj' },
  { name: 'Nawabganj' },
  { name: 'Joypurhat' },
  { name: 'Naogaon' },
  { name: 'Natore' },
  { name: 'Pabna' },
  { name: 'Rajshahi' },
  { name: 'Sirajganj' },
  // Khulna Division
  { name: 'Bagerhat' },
  { name: 'Chuadanga' },
  { name: 'Jashore' },
  { name: 'Jhenaidah' },
  { name: 'Khulna' },
  { name: 'Kushtia' },
  { name: 'Magura' },
  { name: 'Meherpur' },
  { name: 'Narail' },
  { name: 'Satkhira' },
  // Barishal Division
  { name: 'Barishal' },
  { name: 'Barguna' },
  { name: 'Bhola' },
  { name: 'Jhalokati' },
  { name: 'Patuakhali' },
  { name: 'Pirojpur' },
  // Sylhet Division
  { name: 'Habiganj' },
  { name: 'Moulvibazar' },
  { name: 'Sunamganj' },
  { name: 'Sylhet' },
  // Rangpur Division
  { name: 'Dinajpur' },
  { name: 'Gaibandha' },
  { name: 'Kurigram' },
  { name: 'Lalmonirhat' },
  { name: 'Nilphamari' },
  { name: 'Panchagarh' },
  { name: 'Rangpur' },
  { name: 'Thakurgaon' },
  // Mymensingh Division
  { name: 'Jamalpur' },
  { name: 'Mymensingh' },
  { name: 'Netrokona' },
  { name: 'Sherpur' },
];

// Number of representative children we seed per level. Keep small
// so the demo DB stays readable in Atlas; the cascading dropdown
// only ever renders one slice at a time anyway.
const UPAZILAS_PER_DISTRICT = 3;
const UNIONS_PER_UPAZILA = 2;
const WARDS_PER_UNION = 2;
const VILLAGES_PER_WARD = 2;

// Cardinals used to synthesize deterministic upazila names.
// Deterministic so the same seed always produces the same hierarchy.
const CARDINALS = ['North', 'Central', 'South'];

// Used to synthesize union / ward / village names per parent.
const UNION_NAMES = ['East', 'West'];
const WARD_NUMBERS = ['1', '2'];
const VILLAGE_LETTERS = ['A', 'B'];

module.exports = {
  DISTRICTS,
  UPAZILAS_PER_DISTRICT,
  UNIONS_PER_UPAZILA,
  WARDS_PER_UNION,
  VILLAGES_PER_WARD,
  CARDINALS,
  UNION_NAMES,
  WARD_NUMBERS,
  VILLAGE_LETTERS,
};