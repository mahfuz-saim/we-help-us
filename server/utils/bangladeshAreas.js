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
 * Districts: all 65 entries from the canonical slug list
 * (including both `Chapainawabganj` and `Nawabganj` for the same
 * physical district under two common names).
 *
 * Upazilas: REAL names, sourced from the operator-supplied mapping
 * below. Where a district has no real mapping yet, the seed falls
 * back to the synthetic "<District> North/Central/South" pattern so
 * the dropdown always shows something usable.
 *
 * Unions / wards / villages: kept as synthetic mock data
 * ("East/West", "Ward 1/2", "Village A/B") because the user-supplied
 * mapping stops at upazila. The cascading dropdown still works end
 * to end, and Module 4.3 / future migrations can fill the deeper
 * levels from data.gov.bd exports.
 *
 * Boundary polygons are intentionally OMITTED — they're public GeoJSON
 * and would balloon this file beyond reason. Module 4.3 (interactive
 * map) can populate them later from an external source.
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

/**
 * REAL upazila names per district. Sourced from operator-supplied
 * data. Keyed by exact district name (must match an entry in
 * DISTRICTS above). Districts without an entry here fall back to
 * the synthetic "<District> <Cardinal>" pattern.
 *
 * Nawabganj shares its upazilas with Chapainawabganj (same physical
 * district) so we mirror the entry under both names.
 */
const DISTRICT_UPAZILAS = {
  Bagerhat: [
    'Bagerhat Sadar',
    'Chitalmari',
    'Fakirahat',
    'Kachua',
    'Mollarhat',
    'Mongla',
    'Morrelganj',
    'Rampal',
    'Sarankhola',
  ],
  Bandarban: [
    'Alikadam',
    'Bandarban Sadar',
    'Lama',
    'Naikhongchhari',
    'Rowangchhari',
    'Ruma',
    'Thanchi',
  ],
  Barguna: [
    'Amtali',
    'Bamna',
    'Barguna Sadar',
    'Betagi',
    'Patharghata',
    'Taltali',
  ],
  Barishal: [
    'Agailjhara',
    'Babuganj',
    'Bakerganj',
    'Banaripara',
    'Barishal Sadar',
    'Gournadi',
    'Hizla',
    'Mehendiganj',
    'Muladi',
    'Wazirpur',
  ],
  Bhola: [
    'Bhola Sadar',
    'Burhanuddin',
    'Char Fasson',
    'Daulatkhan',
    'Lalmohan',
    'Manpura',
    'Tazumuddin',
  ],
  Bogura: [
    'Adamdighi',
    'Bogura Sadar',
    'Dhunat',
    'Dhupchanchia',
    'Gabtali',
    'Kahaloo',
    'Nandigram',
    'Sariakandi',
    'Shajahanpur',
    'Sherpur',
    'Shibganj',
    'Sonatala',
  ],
  Brahmanbaria: [
    'Akhaura',
    'Ashuganj',
    'Banchharampur',
    'Bijoynagar',
    'Brahmanbaria Sadar',
    'Kasba',
    'Nabinagar',
    'Nasirnagar',
    'Sarail',
  ],
  Chandpur: [
    'Chandpur Sadar',
    'Faridganj',
    'Haimchar',
    'Haziganj',
    'Kachua',
    'Matlab Dakshin',
    'Matlab Uttar',
    'Shahrasti',
  ],
  Chapainawabganj: [
    'Bholahat',
    'Chapainawabganj Sadar',
    'Gomastapur',
    'Nachole',
    'Rohanpur',
    'Shibganj',
  ],
  Chattogram: [
    'Anwara',
    'Banshkhali',
    'Boalkhali',
    'Chandanaish',
    'Chattogram Sadar',
    'Fatikchhari',
    'Hathazari',
    'Karnaphuli',
    'Lohagara',
    'Mirsharai',
    'Patiya',
    'Rangunia',
    'Raozan',
    'Sandwip',
    'Satkania',
    'Sitakunda',
  ],
  Chuadanga: [
    'Alamdanga',
    'Chuadanga Sadar',
    'Damurhuda',
    'Jibannagar',
  ],
  "Cox's Bazar": [
    'Chakaria',
    "Cox's Bazar Sadar",
    'Kutubdia',
    'Maheshkhali',
    'Pekua',
    'Ramu',
    'Teknaf',
    'Ukhia',
  ],
  Cumilla: [
    'Barura',
    'Brahmanpara',
    'Burichong',
    'Chandina',
    'Chauddagram',
    'Cumilla Sadar',
    'Cumilla Sadar Dakshin',
    'Daudkandi',
    'Debidwar',
    'Homna',
    'Laksam',
    'Lalmai',
    'Meghna',
    'Monohorgonj',
    'Muradnagar',
    'Nangalkot',
    'Titas',
  ],
  Dhaka: [
    'Dhamrai',
    'Dohar',
    'Keraniganj',
    'Nawabganj',
    'Savar',
  ],
  Dinajpur: [
    'Birampur',
    'Birganj',
    'Biral',
    'Bochaganj',
    'Chirirbandar',
    'Dinajpur Sadar',
    'Ghoraghat',
    'Hakimpur',
    'Kaharole',
    'Khansama',
    'Nawabganj',
    'Parbatipur',
    'Phulbari',
  ],
  Faridpur: [
    'Alfadanga',
    'Bhanga',
    'Boalmari',
    'Char Bhadrasan',
    'Faridpur Sadar',
    'Madhukhali',
    'Nagarkanda',
    'Sadarpur',
    'Saltha',
  ],
  Feni: [
    'Chhagalnaiya',
    'Daganbhuiyan',
    'Feni Sadar',
    'Fulgazi',
    'Parshuram',
    'Sonagazi',
  ],
  Gaibandha: [
    'Fulchhari',
    'Gaibandha Sadar',
    'Gobindaganj',
    'Palashbari',
    'Sadullapur',
    'Saghata',
    'Sundarganj',
  ],
  Gazipur: [
    'Gazipur Sadar',
    'Kaliakair',
    'Kaliganj',
    'Kapasia',
    'Sreepur',
  ],
  Gopalganj: [
    'Gopalganj Sadar',
    'Kashiani',
    'Kotalipara',
    'Muksudpur',
    'Tungipara',
  ],
  Habiganj: [
    'Ajmiriganj',
    'Bahubal',
    'Baniachong',
    'Chunarughat',
    'Habiganj Sadar',
    'Lakhai',
    'Madhabpur',
    'Nabiganj',
    'Sayestaganj',
  ],
  Jamalpur: [
    'Bakshiganj',
    'Dewanganj',
    'Islampur',
    'Jamalpur Sadar',
    'Madarganj',
    'Melandaha',
    'Sarishabari',
  ],
  Jashore: [
    'Abhaynagar',
    'Bagherpara',
    'Chaugachha',
    'Jashore Sadar',
    'Jhikargachha',
    'Keshabpur',
    'Manirampur',
    'Sharsha',
  ],
  Jhalokati: [
    'Jhalokati Sadar',
    'Kathalia',
    'Nalchity',
    'Rajapur',
  ],
  Jhenaidah: [
    'Harinakunda',
    'Jhenaidah Sadar',
    'Kaliganj',
    'Kotchandpur',
    'Moheshpur',
    'Shailkupa',
  ],
  Joypurhat: [
    'Akkelpur',
    'Joypurhat Sadar',
    'Kalai',
    'Khetlal',
    'Panchbibi',
  ],
  Khagrachari: [
    'Dighinala',
    'Guimara',
    'Khagrachari Sadar',
    'Lakshmichhari',
    'Mahalchhari',
    'Manikchhari',
    'Matiranga',
    'Panchhari',
    'Ramgarh',
  ],
  Khulna: [
    'Batiaghata',
    'Dacope',
    'Dumuria',
    'Dighalia',
    'Koyra',
    'Paikgachha',
    'Phultala',
    'Rupsha',
    'Terokhada',
  ],
  Kishoreganj: [
    'Austagram',
    'Bajitpur',
    'Bhairab',
    'Hossainpur',
    'Itna',
    'Karimganj',
    'Katiadi',
    'Kishoreganj Sadar',
    'Kuliarchar',
    'Mithamain',
    'Nikli',
    'Pakundia',
    'Tarail',
  ],
  Kurigram: [
    'Bhurungamari',
    'Char Rajibpur',
    'Chilmari',
    'Kurigram Sadar',
    'Nageshwari',
    'Phulbari',
    'Rajarhat',
    'Raomari',
    'Ulipur',
  ],
  Kushtia: [
    'Bheramara',
    'Daulatpur',
    'Khoksa',
    'Kumarkhali',
    'Kushtia Sadar',
    'Mirpur',
  ],
  Lakshmipur: [
    'Kamalnagar',
    'Lakshmipur Sadar',
    'Raipur',
    'Ramganj',
    'Ramgati',
  ],
  Lalmonirhat: [
    'Aditmari',
    'Hatibandha',
    'Kaliganj',
    'Lalmonirhat Sadar',
    'Patgram',
  ],
  Madaripur: [
    'Dasar',
    'Kalkini',
    'Madaripur Sadar',
    'Rajoir',
    'Shibchar',
  ],
  Magura: [
    'Magura Sadar',
    'Mohammadpur',
    'Salikha',
    'Sreepur',
  ],
  Manikganj: [
    'Daulatpur',
    'Ghior',
    'Harirampur',
    'Manikganj Sadar',
    'Saturia',
    'Shivalaya',
    'Singair',
  ],
  Meherpur: [
    'Gangni',
    'Meherpur Sadar',
    'Mujibnagar',
  ],
  Moulvibazar: [
    'Barlekha',
    'Juri',
    'Kamalganj',
    'Kulaura',
    'Moulvibazar Sadar',
    'Rajnagar',
    'Sreemangal',
  ],
  Munshiganj: [
    'Gazaria',
    'Lohajang',
    'Munshiganj Sadar',
    'Sirajdikhan',
    'Sreenagar',
    'Tongibari',
  ],
  Mymensingh: [
    'Bhaluka',
    'Dhobaura',
    'Fulbaria',
    'Gafargaon',
    'Gauripur',
    'Haluaghat',
    'Ishwarganj',
    'Muktagachha',
    'Mymensingh Sadar',
    'Nandail',
    'Phulpur',
    'Tarakanda',
    'Trishal',
  ],
  Naogaon: [
    'Atrai',
    'Badalgachhi',
    'Dhamoirhat',
    'Manda',
    'Mahadebpur',
    'Naogaon Sadar',
    'Niamatpur',
    'Patnitala',
    'Porsha',
    'Raninagar',
    'Sapahar',
  ],
  Narail: [
    'Kalia',
    'Lohagara',
    'Narail Sadar',
  ],
  Narayanganj: [
    'Araihazar',
    'Bandar',
    'Narayanganj Sadar',
    'Rupganj',
    'Sonargaon',
  ],
  Narsingdi: [
    'Belabo',
    'Monohardi',
    'Narsingdi Sadar',
    'Palash',
    'Raipura',
    'Shibpur',
  ],
  Natore: [
    'Bagatipara',
    'Baraigram',
    'Gurudaspur',
    'Lalpur',
    'Naldanga',
    'Natore Sadar',
    'Singra',
  ],
  Nawabganj: [
    'Bholahat',
    'Chapainawabganj Sadar',
    'Gomastapur',
    'Nachole',
    'Rohanpur',
    'Shibganj',
  ],
  Netrokona: [
    'Atpara',
    'Barhatta',
    'Durgapur',
    'Khaliajuri',
    'Kalmakanda',
    'Kendua',
    'Madan',
    'Mohanganj',
    'Netrokona Sadar',
    'Purbadhala',
  ],
  Nilphamari: [
    'Dimla',
    'Domar',
    'Jaldhaka',
    'Kishoreganj',
    'Nilphamari Sadar',
    'Saidpur',
  ],
  Noakhali: [
    'Begumganj',
    'Chatkhil',
    'Companiganj',
    'Hatiya',
    'Kabirhat',
    'Noakhali Sadar',
    'Senbagh',
    'Sonaimuri',
    'Subarnachar',
  ],
  Pabna: [
    'Atgharia',
    'Bera',
    'Bhangura',
    'Chatmohar',
    'Faridpur',
    'Ishwardi',
    'Pabna Sadar',
    'Santhia',
    'Sujanagar',
  ],
  Panchagarh: [
    'Atwari',
    'Boda',
    'Debiganj',
    'Panchagarh Sadar',
    'Tetulia',
  ],
  Patuakhali: [
    'Bauphal',
    'Dashmina',
    'Dumki',
    'Galachipa',
    'Kalapara',
    'Mirzaganj',
    'Patuakhali Sadar',
    'Rangabali',
  ],
  Pirojpur: [
    'Bhandaria',
    'Kawkhali',
    'Mothbaria',
    'Nazirpur',
    'Nesarabad',
    'Pirojpur Sadar',
  ],
  Rajbari: [
    'Baliakandi',
    'Goalandaghat',
    'Pangsha',
    'Rajbari Sadar',
  ],
  Rajshahi: [
    'Bagha',
    'Bagmara',
    'Charghat',
    'Durgapur',
    'Godagari',
    'Mohanpur',
    'Paba',
    'Puthia',
    'Rajshahi Sadar',
    'Tanore',
  ],
  Rangamati: [
    'Baghaichhari',
    'Barkal',
    'Belaichhari',
    'Juraichhari',
    'Kaptai',
    'Kaukhali',
    'Langadu',
    'Mannerchar',
    'Rajasthali',
    'Rangamati Sadar',
  ],
  Rangpur: [
    'Badarganj',
    'Gangachara',
    'Kaunia',
    'Mithapukur',
    'Pirgachha',
    'Pirganj',
    'Rangpur Sadar',
    'Taraganj',
  ],
  Satkhira: [
    'Assasuni',
    'Debhata',
    'Kalaroa',
    'Kaliganj',
    'Satkhira Sadar',
    'Shyamnagar',
    'Tala',
  ],
  Shariatpur: [
    'Bhedarganj',
    'Damudya',
    'Gosairhat',
    'Naria',
    'Shariatpur Sadar',
    'Zanjira',
  ],
  Sherpur: [
    'Jhenaigati',
    'Nakla',
    'Nalitabari',
    'Sherpur Sadar',
    'Sreebardi',
  ],
  Sirajganj: [
    'Belkuchi',
    'Chauhali',
    'Kamarkhanda',
    'Kazipur',
    'Raiganj',
    'Shahjadpur',
    'Sirajganj Sadar',
    'Tarash',
    'Ullapara',
  ],
  Sunamganj: [
    'Bishwamvarpur',
    'Chhatak',
    'Dakshin Sunamganj',
    'Derai',
    'Dharampasha',
    'Dowarabazar',
    'Jagannathpur',
    'Jamalganj',
    'Sulla',
    'Sunamganj Sadar',
    'Tahirpur',
  ],
  Sylhet: [
    'Balaganj',
    'Beanibazar',
    'Bishwanath',
    'Companiganj',
    'Dakshin Surma',
    'Fenchuganj',
    'Golapganj',
    'Gowainghat',
    'Jaintiapur',
    'Kanaighat',
    'Osmani Nagar',
    'Sylhet Sadar',
    'Zakiganj',
  ],
  Tangail: [
    'Basail',
    'Bhuapur',
    'Delduar',
    'Dhanbari',
    'Ghatail',
    'Gopalpur',
    'Kalihati',
    'Madhupur',
    'Mirzapur',
    'Nagarpur',
    'Sakhipur',
    'Tangail Sadar',
  ],
  Thakurgaon: [
    'Baliadangi',
    'Haripur',
    'Pirganj',
    'Ranisankail',
    'Thakurgaon Sadar',
  ],
};

// Number of representative children we seed per level. Keep small
// so the demo DB stays readable in Atlas; the cascading dropdown
// only ever renders one slice at a time anyway.
const FALLBACK_UPAZILAS_PER_DISTRICT = 3;
const UNIONS_PER_UPAZILA = 2;
const WARDS_PER_UNION = 2;
const VILLAGES_PER_WARD = 2;

// Cardinals used to synthesize deterministic fallback upazila names
// for districts without a real mapping. Deterministic so the same
// seed always produces the same hierarchy.
const CARDINALS = ['North', 'Central', 'South'];

// Used to synthesize union / ward / village names per parent.
const UNION_NAMES = ['East', 'West'];
const WARD_NUMBERS = ['1', '2'];
const VILLAGE_LETTERS = ['A', 'B'];

/**
 * Look up the upazila list for a given district. Returns the real
 * list if one is defined in DISTRICT_UPAZILAS, otherwise synthesizes
 * a fallback list of N entries using the cardinals pattern.
 *
 * @param {string} districtName  exact district name (as in DISTRICTS)
 * @returns {string[]} array of upazila names (never empty)
 */
function upazilasForDistrict(districtName) {
  const real = DISTRICT_UPAZILAS[districtName];
  if (real && real.length > 0) return real;
  const out = [];
  for (let i = 0; i < FALLBACK_UPAZILAS_PER_DISTRICT; i += 1) {
    out.push(`${districtName} ${CARDINALS[i] || `Upazila ${i + 1}`}`);
  }
  return out;
}

module.exports = {
  DISTRICTS,
  DISTRICT_UPAZILAS,
  upazilasForDistrict,
  FALLBACK_UPAZILAS_PER_DISTRICT,
  UNIONS_PER_UPAZILA,
  WARDS_PER_UNION,
  VILLAGES_PER_WARD,
  CARDINALS,
  UNION_NAMES,
  WARD_NUMBERS,
  VILLAGE_LETTERS,
};