const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

// ============================================================
// POPUP NOTIFIKASI CUSTOM -- ganti alert()/confirm() bawaan browser (yang jelek &
// blocking) sama popup ala app ini sendiri.
// - toast(message, type) -- ganti alert(). type: 'success' | 'error' | 'warn' | 'info'.
//   Muncul di kanan-bawah, ilang sendiri, bisa ditutup manual juga.
// - confirmDialog(message, opts) -- ganti confirm(). Return Promise<boolean>, jadi
//   PAKE "await" di depannya. opts: { danger: true } buat tombol konfirmasi warna
//   merah (aksi ngerusak/hapus), confirmLabel buat ganti teks tombolnya
//   (default "Ya, Lanjutkan").
// State-nya taro di luar setup() (module-level) biar konsisten satu-satunya di
// seluruh app, terus di-expose lewat return di setup() biar kepake di template.
// ============================================================
const toasts = ref([]);
let toastSeq = 0;
function toast(message, type = 'info') {
    const id = ++toastSeq;
    toasts.value.push({ id, message, type });
    setTimeout(() => dismissToast(id), 4000);
}
function dismissToast(id) {
    toasts.value = toasts.value.filter(t => t.id !== id);
}

const confirmState = ref(null); // { message, danger, confirmLabel, resolve } -- null = lagi gak ada dialog kebuka
function confirmDialog(message, opts = {}) {
    return new Promise((resolve) => {
        confirmState.value = {
            message,
            danger: !!opts.danger,
            confirmLabel: opts.confirmLabel || 'Ya, Lanjutkan',
            resolve
        };
    });
}
function resolveConfirm(result) {
    if (confirmState.value) {
        confirmState.value.resolve(result);
        confirmState.value = null;
    }
}

// ============================================================
// KONFIGURASI SUPABASE -- GANTI 2 BARIS INI
// Ambil dari: Supabase Dashboard > Project Settings > API
// PAKE "anon" "public" key -- JANGAN PERNAH pake service_role di sini,
// soalnya file JS ini kebaca semua orang yang buka website-nya.
// ============================================================
const SUPABASE_URL = "https://onruaqagzmeiyvpvjhve.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ucnVhcWFnem1laXl2cHZqaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NTAsImV4cCI6MjEwNDQyOTg1MH0._LF6NqW1uvcz2lq-d8LY2GOcyUak7M592wNhA7uG7Rk";

// Session Supabase sengaja disimpen di sessionStorage (BUKAN localStorage default) --
// sessionStorage otomatis ke-hapus browser sendiri begitu TAB-nya ditutup, jadi begitu
// dibuka lagi (tab baru/browser baru) otomatis balik ke layar login, gak perlu timer/event
// listener tambahan yang gak reliable (browser gak bisa bedain "nutup tab" vs "refresh").
// Refresh (F5) di tab yang SAMA tetep aman, sessionStorage-nya gak ilang -- cuma nutup
// tab/browser yang bikin harus login ulang.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: window.sessionStorage }
});

// Bikin nomor PR/PO berdasarkan TANGGAL dibuat (bukan random/jam), format: PREFIX-DDMMYYYY-NN.
// Contoh: PR-16092026-01, PO-16092026-01.
//
// NN di belakang itu nomor urut ke-berapa di tanggal itu -- WAJIB ada soalnya kolom
// pr_number/po_number itu UNIQUE di database, dan lebih dari 1 PR/PO di hari yang
// sama itu kejadian normal (bukan edge case), jadi tanggal doang gak cukup.
//
// Nomor urutnya digenerate lewat FUNCTION DI DATABASE (generate_doc_number, liat
// schema.sql / add_soc_audit_fields_migration.sql), bukan dihitung manual di sini.
// Sengaja gitu soalnya kalo dihitung manual (query COUNT PR hari ini, +1) ada 2 bug:
// 1. RLS bikin user brand-scoped (AM/SM) cuma "liat" PR/PO brand-nya sendiri pas
//    query -- jadi Almaz Fried Chicken & Kebuli Abuya yang sama-sama bikin PR
//    pertama di hari yang sama bakal dapet nomor SAMA (masing-masing ngitung
//    "punya sendiri" mulai dari 0) terus nabrak pas disimpen.
// 2. 2 orang submit bebarengan juga bisa ngitung angka final yang sama (race
//    condition).
// Function di database gak kena 2 masalah itu (baca/tulis ke tabel counter
// terpisah yang gak di-RLS per-brand, dan atomik lewat row lock Postgres).
async function generateNumber(prefix) {
    const { data, error } = await supabaseClient.rpc('generate_doc_number', { p_prefix: prefix });
    if (error) throw error;
    return data;
}

// Cari kolom di data Excel biarpun beda kapital/spasi/underscore
function findCol(row, ...candidates) {
    const normalize = (s) => String(s).trim().toLowerCase().replace(/[\s_]/g, '');
    const keys = Object.keys(row);
    for (const cand of candidates) {
        const target = normalize(cand);
        const found = keys.find((k) => normalize(k) === target);
        if (found) return found;
    }
    return null;
}

// Tebak brand dari nama cabang, contoh: "Almaz Fried Chicken - Bintara" -> "Almaz Fried Chicken"
function deriveBrandFromBranchName(branchName) {
    const n = String(branchName || '').toLowerCase();
    if (n.includes('almaz')) return 'Almaz Fried Chicken';
    if (n.includes('kebuli')) return 'Kebuli Abuya';
    return null;
}

// ============================================================
// SESSION EXPIRATION -- otomatis logout kalo user gak ada aktivitas
// sekian lama. Ganti angka ini kalo mau lebih pendek/panjang.
// ============================================================
const SESSION_TIMEOUT_MINUTES = 30;

// ============================================================
// KOMPONEN DROPDOWN CUSTOM -- bisa di-search & scroll, ganti <select> biasa
// dipake di semua dropdown yang isinya banyak (Cabang, Barang, Filter Status).
// Props: modelValue (v-model), options: [{ value, label }], placeholder
// ============================================================
const SearchableSelect = {
    props: {
        modelValue: { default: '' },
        options: { type: Array, default: () => [] },
        placeholder: { type: String, default: '-- Pilih --' },
        // Searchbar internal (ketik buat nyaring opsi) DEFAULT-nya mati -- kebanyakan dropdown di
        // app ini opsinya dikit/fixed (Status, Shipping, PIC, dst), jadi searchbar cuma nambah
        // langkah. Cuma dropdown yang opsinya bisa banyak/panjang (Branch, Barang/Product) yang
        // nyalain ini lewat prop :searchable="true".
        searchable: { type: Boolean, default: false }
    },
    emits: ['update:modelValue'],
    template: `
        <div class="ss-wrap" ref="wrapEl">
            <div class="ss-control" :class="{ open: isOpen }" tabindex="0"
                 @click="toggleOpen" @keydown.enter.prevent="toggleOpen" @keydown.esc="closeDropdown">
                <span :class="{ 'ss-placeholder': !selectedLabel }">{{ selectedLabel || placeholder }}</span>
                <i class="bi" :class="isOpen ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
            </div>
            <Transition name="pop">
                <div v-if="isOpen" class="ss-panel">
                    <div v-if="searchable" class="ss-search" @click.stop>
                        <i class="bi bi-search"></i>
                        <input type="text" v-model="searchQuery" placeholder="Cari..." ref="searchInput">
                    </div>
                    <div class="ss-options">
                        <div v-for="opt in filteredOptions" :key="opt.value" class="ss-option"
                             :class="{ selected: opt.value === modelValue }" @click="selectOption(opt)">
                            {{ opt.label }}
                        </div>
                        <div v-if="filteredOptions.length === 0" class="ss-empty">Gak ada yang cocok.</div>
                    </div>
                </div>
            </Transition>
        </div>
    `,
    setup(props, { emit }) {
        const isOpen = ref(false);
        const searchQuery = ref('');
        const wrapEl = ref(null);
        const searchInput = ref(null);

        const selectedLabel = computed(() => {
            const found = props.options.find(o => o.value === props.modelValue);
            return found ? found.label : '';
        });

        const filteredOptions = computed(() => {
            if (!props.searchable || !searchQuery.value) return props.options;
            const q = searchQuery.value.toLowerCase();
            return props.options.filter(o => String(o.label).toLowerCase().includes(q));
        });

        const closeDropdown = () => { isOpen.value = false; };
        const toggleOpen = () => {
            isOpen.value = !isOpen.value;
            if (isOpen.value && props.searchable) {
                searchQuery.value = '';
                nextTick(() => searchInput.value && searchInput.value.focus());
            }
        };
        const selectOption = (opt) => {
            emit('update:modelValue', opt.value);
            closeDropdown();
        };

        const handleClickOutside = (e) => {
            if (wrapEl.value && !wrapEl.value.contains(e.target)) closeDropdown();
        };
        onMounted(() => document.addEventListener('click', handleClickOutside));
        onUnmounted(() => document.removeEventListener('click', handleClickOutside));

        return { isOpen, searchQuery, wrapEl, searchInput, selectedLabel, filteredOptions, toggleOpen, closeDropdown, selectOption };
    }
};

// ============================================================
// KOMPONEN DROPDOWN MULTISELECT -- checkbox list buat milih LEBIH DARI SATU opsi sekaligus
// (dipake buat filter Branch di Daftar PR/PO & Dashboard). Strukturnya SENGAJA disamain persis
// kayak SearchableSelect (pake class ss-wrap/ss-control/ss-panel/ss-search/ss-options/ss-empty
// yang SAMA, bukan bikin class sendiri) -- biar box-nya (padding, tinggi, warna, posisi chevron)
// keliatan IDENTIK sama dropdown lain (Request Number, Status, dst), gak ada bedanya. Search
// buat nyaring opsi juga ditaro DI DALEM PANEL (.ss-search) pas kebuka, sama persis kayak
// SearchableSelect versi :searchable="true", bukan input nempel di box utamanya.
// Bedanya cuma: modelValue-nya ARRAY, box utamanya nampilin RINGKASAN teks doang (bukan chip
// satu-satu) biar box-nya SELALU 1 baris & UKURANNYA GAK BERUBAH walau kepilih banyak cabang,
// dan checkbox-nya BARU ke-apply (emit ke parent) pas tombol "Apply" di-klik / di-Clear.
// Props: modelValue (array), options: [{ value, label }], placeholder
// ============================================================
const MultiSelectDropdown = {
    props: {
        modelValue: { type: Array, default: () => [] },
        options: { type: Array, default: () => [] },
        placeholder: { type: String, default: '-- Pilih --' }
    },
    emits: ['update:modelValue'],
    template: `
        <div class="ss-wrap" ref="wrapEl">
            <div class="ss-control" :class="{ open: isOpen }" tabindex="0"
                 @click="toggleOpen" @keydown.enter.prevent="toggleOpen" @keydown.esc="closeDropdown">
                <span :class="{ 'ss-placeholder': modelValue.length === 0 }">{{ summaryLabel }}</span>
                <i class="bi" :class="isOpen ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
            </div>
            <Transition name="pop">
                <div v-if="isOpen" class="ss-panel" @click.stop>
                    <div class="ss-search" @click.stop>
                        <i class="bi bi-search"></i>
                        <input type="text" v-model="searchQuery" placeholder="Cari..." ref="searchInput">
                    </div>
                    <div class="ss-options">
                        <div v-for="opt in filteredOptions" :key="opt.value" class="ms-option" @click="togglePending(opt.value)">
                            <span class="ms-checkbox" :class="{ checked: pending.includes(opt.value) }"><i v-if="pending.includes(opt.value)" class="bi bi-check-lg"></i></span>
                            <span>{{ opt.label }}</span>
                        </div>
                        <div v-if="filteredOptions.length === 0" class="ss-empty">Gak ada yang cocok.</div>
                    </div>
                    <div class="ms-panel-footer">
                        <button type="button" class="ms-clear-btn" @click="clearPending">Clear</button>
                        <button type="button" class="btn-primary ms-apply-btn" @click="applyPending">Apply</button>
                    </div>
                </div>
            </Transition>
        </div>
    `,
    setup(props, { emit }) {
        const isOpen = ref(false);
        const searchQuery = ref('');
        const wrapEl = ref(null);
        const searchInput = ref(null);
        // Salinan lokal sementara pas dropdown lagi kebuka -- checkbox nyentang/nglepas cuma
        // ngubah ini dulu, BELUM ke-emit ke parent sampe tombol Apply di-klik.
        const pending = ref([...props.modelValue]);

        const labelFor = (v) => {
            const found = props.options.find(o => o.value === v);
            return found ? found.label : v;
        };

        // Ringkasan yang keliatan di box utama pas ketutup: kosong -> placeholder, 1 kepilih ->
        // nama cabangnya, lebih dari 1 -> "N dipilih" -- SELALU 1 baris (dipotong "..." kalo
        // kepanjangan lewat rule .ss-control > span yang udah ada), jadi box-nya gak pernah melar.
        const summaryLabel = computed(() => {
            if (props.modelValue.length === 0) return props.placeholder;
            if (props.modelValue.length === 1) return labelFor(props.modelValue[0]);
            return props.modelValue.length + ' dipilih';
        });

        // Nyaring TAMPILAN list opsi doang (berdasarkan ketikan di search box DALEM panel) --
        // gak ngaruh ke pending/modelValue.
        const filteredOptions = computed(() => {
            if (!searchQuery.value) return props.options;
            const q = searchQuery.value.toLowerCase();
            return props.options.filter(o => String(o.label).toLowerCase().includes(q));
        });

        const closeDropdown = () => { isOpen.value = false; };
        const toggleOpen = () => {
            isOpen.value = !isOpen.value;
            if (isOpen.value) {
                pending.value = [...props.modelValue]; // reset ke selection terakhir tiap dibuka
                searchQuery.value = '';
                nextTick(() => searchInput.value && searchInput.value.focus());
            }
        };
        const togglePending = (v) => {
            const idx = pending.value.indexOf(v);
            if (idx === -1) pending.value.push(v); else pending.value.splice(idx, 1);
        };
        const clearPending = () => { pending.value = []; };
        const applyPending = () => {
            emit('update:modelValue', [...pending.value]);
            closeDropdown();
        };

        const handleClickOutside = (e) => {
            if (wrapEl.value && !wrapEl.value.contains(e.target)) closeDropdown();
        };
        onMounted(() => document.addEventListener('click', handleClickOutside));
        onUnmounted(() => document.removeEventListener('click', handleClickOutside));

        return { isOpen, searchQuery, wrapEl, searchInput, pending, summaryLabel, filteredOptions, toggleOpen, closeDropdown, togglePending, clearPending, applyPending };
    }
};

// Bikin format tanggal Date -> 'YYYY-MM-DD' (dipake barengan sama DateRangeFilter & DatePickerField)
function dateToISO(d) {
    if (!d) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// "Hari ini" versi WIB (UTC+7, gak ada DST) -- BUKAN versi timezone device yang lagi buka app.
// Indonesia punya 3 zona waktu (WIB/WITA/WIT, beda 1-2 jam), jadi kalo ngandelin new Date() polos
// (yang notoin timezone si DEVICE), AM/Master yang buka app dari WITA/WIT bisa dapet "hari ini"
// yang beda sama pg_cron di database (yang eksplisit WIB) -- bisa ketuker expire PR-nya beda 1-2
// jam tergantung siapa yang duluan ngecek. Dipakein sebagai "jam acuan perusahaan" yang sama biar
// konsisten, gak peduli device-nya lagi di zona jam mana. Trik-nya: Date.now() itu UTC epoch (gak
// kepengaruh timezone device), tinggal digeser +7 jam terus dibaca komponen UTC-nya balik.
function todayWIB() {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const yyyy = wib.getUTCFullYear();
    const mm = String(wib.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(wib.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// "Besok" versi WIB -- dipake buat notifikasi "PR hampir Expired" di Dashboard: PR yang Required
// Date-nya JATUH BESOK berarti HARI INI adalah H-1 (batas terakhir take action), soalnya PR baru
// beneran ke-expire begitu tanggal HARI INI udah nyampe/lewat Required Date-nya (liat
// expireOverduePRs()). Jadi "besok" di sini persis nunjukin PR yang paling mendesak.
function tomorrowWIB() {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
    const yyyy = wib.getUTCFullYear();
    const mm = String(wib.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(wib.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Paksa lebar kalender flatpickr SAMA PERSIS kayak lebar box pemicunya (boxEl),
// biar gak ada kalender yang lebih lebar/sempit dari box-nya kayak yang dikeluhin.
// flatpickr nge-set lebar beberapa elemen internalnya sendiri (inline style), jadi
// kita timpa manual abis instance-nya kebentuk/dibuka.
function syncFlatpickrWidth(instance, boxEl) {
    if (!instance || !boxEl) return;
    const w = boxEl.offsetWidth;
    if (!w) return;
    const px = w + 'px';
    instance.calendarContainer.style.width = px;
    ['.flatpickr-innerContainer', '.flatpickr-rContainer', '.flatpickr-months', '.flatpickr-weekdays', '.flatpickr-days', '.dayContainer']
        .forEach(sel => {
            const el = instance.calendarContainer.querySelector(sel);
            if (el) { el.style.width = px; el.style.minWidth = px; el.style.maxWidth = px; }
        });
    // flatpickr udah nentuin posisi kalender SEBELUM kita timpa lebarnya di atas -- jadi kalo
    // lebar box beda dari lebar default kalender, posisi awal (pas pertama kali buka) keitung
    // pake lebar LAMA dan kalender keliatan geser dikit ke kiri. Setelah lebar ditimpa, suruh
    // flatpickr itung ulang posisinya pake lebar yang udah bener -- ini yang bikin klik pertama
    // sekarang langsung bener (sebelumnya baru bener pas klik kedua, soalnya browser "kebetulan"
    // udah inget lebar barunya dari kalkulasi klik pertama).
    if (typeof instance._positionCalendar === 'function') {
        instance._positionCalendar();
    }
}

// Kalender flatpickr defaultnya selalu nampilin 6 baris (42 sel) biar tingginya konsisten tiap
// bulan -- kadang baris TERAKHIR isinya full tanggal bulan BERIKUTNYA doang (padding doang, gak
// ada gunanya) yang bikin kalender keliatan kepanjangan ke bawah. Baris itu kita sembunyiin, TAPI
// cuma kalo semua 7 sel di baris itu emang punya class nextMonthDay -- kalo ada satu aja tanggal
// bulan berjalan yang nyempil di baris ke-6 itu (bulan yang tanggal terakhirnya jatuh di baris
// itu), baris itu TETEP ditampilin biar tanggalnya gak ilang.
function trimTrailingWeek(instance) {
    if (!instance || !instance.calendarContainer) return;
    const dayContainer = instance.calendarContainer.querySelector('.dayContainer');
    if (!dayContainer) return;
    const days = dayContainer.querySelectorAll('.flatpickr-day');
    if (days.length < 42) return; // gak sampe 6 baris, gak ada yang perlu disembunyiin
    const lastRow = Array.from(days).slice(35, 42);
    const allNextMonth = lastRow.length === 7 && lastRow.every(d => d.classList.contains('nextMonthDay'));
    lastRow.forEach(d => { d.style.display = allNextMonth ? 'none' : ''; });
}

// ============================================================
// KOMPONEN DATE RANGE PICKER -- kalender beneran (dari-sampe) pake library
// flatpickr (di-load di index.html). Ganti 2 kotak <input type=date> yang lama.
// v-model isinya object { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } (kosong kalo belum dipilih).
// ============================================================
const DateRangeFilter = {
    props: {
        modelValue: { type: Object, default: () => ({ from: '', to: '' }) },
        placeholder: { type: String, default: 'Pilih tanggal...' }
    },
    emits: ['update:modelValue'],
    template: `
        <div class="date-range-filter" ref="wrapEl">
            <i class="bi bi-calendar3"></i>
            <input type="text" ref="inputEl" :placeholder="placeholder" readonly>
            <button v-if="modelValue.from || modelValue.to" type="button" class="drf-clear" @click="clearRange" title="Hapus filter tanggal">
                <i class="bi bi-x-circle-fill"></i>
            </button>
        </div>
    `,
    setup(props, { emit }) {
        const inputEl = ref(null);
        const wrapEl = ref(null);
        let fp = null;

        onMounted(() => {
            fp = flatpickr(inputEl.value, {
                mode: 'range',
                dateFormat: 'd-m-Y',
                showMonths: 1, // 1 bulan aja -- 2 bulan kegedean di layar kecil
                positionElement: wrapEl.value, // posisi kalender ngikutin box bungkusnya (bukan cuma <input>-nya), biar nempel pas di bawah box & rata kiri-kanan
                onReady: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onOpen: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onMonthChange: (sd, ds, instance) => trimTrailingWeek(instance),
                onYearChange: (sd, ds, instance) => trimTrailingWeek(instance),
                onChange: (selectedDates) => {
                    if (selectedDates.length === 2) {
                        emit('update:modelValue', { from: dateToISO(selectedDates[0]), to: dateToISO(selectedDates[1]) });
                    } else if (selectedDates.length === 0) {
                        emit('update:modelValue', { from: '', to: '' });
                    }
                }
            });
        });
        onUnmounted(() => { if (fp) fp.destroy(); });

        const clearRange = () => {
            if (fp) fp.clear();
            emit('update:modelValue', { from: '', to: '' });
        };

        return { inputEl, wrapEl, clearRange };
    }
};

// ============================================================
// KOMPONEN DATE PICKER SATUAN -- sama tampilannya kayak DateRangeFilter di
// Daftar PR (ikon kalender + kalender flatpickr pas diklik), tapi cuma milih
// 1 tanggal (bukan range). Dipake di field "Required Date" pas Buat PR.
// v-model isinya string 'YYYY-MM-DD' (kosong kalo belum dipilih).
// ============================================================
const DatePickerField = {
    props: {
        modelValue: { type: String, default: '' },
        placeholder: { type: String, default: 'Pilih tanggal...' }
    },
    emits: ['update:modelValue'],
    template: `
        <div class="date-picker-field" ref="wrapEl">
            <i class="bi bi-calendar3"></i>
            <input type="text" ref="inputEl" :placeholder="placeholder" readonly>
        </div>
    `,
    setup(props, { emit }) {
        const inputEl = ref(null);
        const wrapEl = ref(null);
        let fp = null;

        onMounted(() => {
            fp = flatpickr(inputEl.value, {
                mode: 'single',
                dateFormat: 'd-m-Y',
                defaultDate: props.modelValue || undefined,
                positionElement: wrapEl.value,
                onReady: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onOpen: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onMonthChange: (sd, ds, instance) => trimTrailingWeek(instance),
                onYearChange: (sd, ds, instance) => trimTrailingWeek(instance),
                onChange: (selectedDates) => {
                    emit('update:modelValue', selectedDates.length ? dateToISO(selectedDates[0]) : '');
                }
            });
        });
        onUnmounted(() => { if (fp) fp.destroy(); });

        return { inputEl, wrapEl };
    }
};

// Opsi tetap buat dropdown filter status di Daftar PR
const STATUS_OPTIONS = [
    { value: '', label: 'All Status' },
    { value: 'Pending', label: 'Pending' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Rejected', label: 'Rejected' },
    { value: 'Expired', label: 'Expired' }
];

// Urutan & warna segmen donut chart status PR di Dashboard -- warnanya SAMA persis kayak
// .status-badge di style.css biar konsisten sama badge yang keliatan di tabel Daftar PR.
// color = vivid, dipake buat cincin donut & label persentase.
// soft  = versi lembut dari color yang sama, dipake buat titik/dot di kotak status.
// bg    = background kotak status, warna soft yang senada sama status-nya.
const DASHBOARD_STATUS_CONFIG = [
    { key: 'Pending', label: 'Pending', color: '#bd7410', soft: '#dc9a3f', bg: '#fff6e7' },
    { key: 'Approved', label: 'Approved', color: '#117b58', soft: '#3fa889', bg: '#e9f8f2' },
    { key: 'Rejected', label: 'Rejected', color: '#d64157', soft: '#e2707f', bg: '#fff0f2' },
    { key: 'Expired', label: 'Expired', color: '#71809a', soft: '#98a4bb', bg: '#eef1f5' }
];

// Opsi buat dropdown Kategori Pengiriman di form PR. Ini daftar LENGKAPnya (Almaz Fried
// Chicken pake ini apa adanya) -- Kebuli Abuya di-filter lewat computed shippingCategoryOptions
// di setup() (cuma nyisain "Direct" doang, soalnya Kebuli Abuya gak pake skema Indirect/PIC).
const SHIPPING_CATEGORY_OPTIONS = [
    { value: 'Direct', label: 'Direct (Distribution Center)' },
    { value: 'Indirect', label: 'Indirect (Vendor)' }
];

// Opsi dropdown PIC -- CUMA muncul kalo Kategori Pengiriman = Indirect (khusus Almaz Fried
// Chicken, soalnya Kebuli Abuya gak punya opsi Indirect sama sekali).
const PIC_OPTIONS = [
    { value: 'Iis', label: 'Iis' },
    { value: 'Dinda', label: 'Dinda' },
    { value: 'Caca', label: 'Caca' }
];

// Opsi dropdown "Select Target Column" -- pilih kolom yang mau di-search di Daftar PR. Kalo yang
// dipilih "Branch", search box di sampingnya DIGANTI jadi multi-select Branch (bukan text box
// biasa) -- field lain (Request Number/PIC/Notes) tetep text box biasa & diketik manual (PIC bisa
// macem-macem/nambah kapan aja jadi lebih fleksibel diketik daripada dropdown fixed).
const PR_SEARCH_FIELDS = [
    { value: 'pr_number', label: 'Request Number' },
    { value: 'branch_name', label: 'Branch' },
    { value: 'pic', label: 'PIC' },
    { value: 'notes', label: 'Notes' }
];

// Sama, tapi buat Daftar PO
const PO_SEARCH_FIELDS = [
    { value: 'po_number', label: 'PO Number' },
    { value: 'pr_number', label: 'PR Reference' },
    { value: 'branch_name', label: 'Branch' },
    { value: 'pic', label: 'PIC' }
];

// Dropdown FILTER Kategori Pengiriman (Daftar PR & Daftar PO) -- fixed 2 opsi + "All Shipping"
// biar bisa direset ke gak difilter sama sekali. Beda sama SHIPPING_CATEGORY_OPTIONS yang label-nya
// lebih panjang (dipake di form Buat PR) -- di sini sengaja label-nya diringkes.
const SHIPPING_FILTER_OPTIONS = [
    { value: '', label: 'All Shipping' },
    { value: 'Direct', label: 'Direct' },
    { value: 'Indirect', label: 'Indirect' }
];

// ============================================================
// DIREKTIF v-stickyroll -- "stickyroll biasa" buat list dashboard yang bisa kepanjangan
// (Notifikasi PR Hampir Expired, Top Item by PO, Top Item by Qty).
// v-stickyroll="true" (item > 5) HANYA mepasin tinggi container biar pas nampung persis 5
// baris pertama -- TIDAK ADA auto-scroll/animasi apapun (Yoyo/Ping-Pong sudah di-disable).
// Kalo item-nya lebih dari 5, baris ke-6 dst otomatis ke-luar area & butuh di-scroll MANUAL
// (mouse wheel/trackpad/scrollbar/swipe touch native) buat keliatan -- murni native scroll
// bawaan browser, gerakannya 100% dikontrol user, gak ada gerakan otomatis sama sekali.
// ============================================================
const STICKYROLL_ROWS = 5;   // tinggi container dipas-in buat nampung persis segini baris

// Ngukur tinggi beneran dari N baris pertama LANGSUNG dari DOM (bukan nebak angka px tetap
// kayak sebelumnya) -- soalnya tinggi 1 baris beda-beda tiap list (Notifikasi vs Top Item),
// beda font/zoom browser, dsb. Kemarin dipatok "max-height:280px" doang, dan itu KEBETULAN
// pas banget sama tinggi 6 baris pendek (1 baris teks) di beberapa kondisi -- jadi kelihatannya
// "gak overflow apa-apa, makanya gak ada yang di-scroll" (bukan animasinya yang rusak, konten-
// nya emang kebetulan udah muat semua). Diukur dari DOM langsung biar SELALU presisi: berapapun
// tinggi baris sebenernya (misalnya teksnya wrap ke 2 baris, atau beda ukuran font), container-
// nya selalu dipas-in nampung PERSIS 5 baris pertama -- baris ke-6 dst PASTI ke-luar area & PASTI
// kebutuhan di-scroll buat keliatan, gak pernah "kebetulan muat semua" lagi.
function measureStickyrollMaxHeight(el) {
    const track = el.querySelector('.stickyroll-track');
    if (!track || track.children.length === 0) return null;
    const n = Math.min(STICKYROLL_ROWS, track.children.length);
    const lastRow = track.children[n - 1];
    return lastRow.offsetTop + lastRow.offsetHeight;
}

// Nyalain/matiin fade di atas & bawah container SESUAI posisi scroll SEKARANG -- bukan dekorasi
// statis yang nempel diem di tempat yang sama. Fade ATAS cuma nongol kalo udah di-scroll turun
// dikit (nandain ada konten yang ke-skip di atas), fade BAWAH cuma nongol kalo MASIH ada konten
// di bawah yang belum keliatan (scrollTop belum nyampe max). Begitu udah mentok scroll paling
// bawah, fade bawah otomatis ilang -- gak lagi nutupin baris terakhir yang padahal udah keliatan
// penuh (ini yang bikin baris ke-5 kemarin keliatan "pudar" padahal itu baris terakhir yang valid).
function updateStickyrollEdgeFade(el) {
    if (!el._srActive) { el.classList.remove('at-top', 'at-bottom'); return; }
    const max = el.scrollHeight - el.clientHeight;
    el.classList.toggle('at-top', el.scrollTop <= 1);
    el.classList.toggle('at-bottom', max <= 1 || el.scrollTop >= max - 1);
}

const stickyrollDirective = {
    mounted(el, binding) {
        el._srActive = !!binding.value;

        const syncMaxHeight = () => {
            if (!el._srActive) { el.style.maxHeight = ''; return; }
            const h = measureStickyrollMaxHeight(el);
            if (h) el.style.maxHeight = h + 'px';
        };
        const syncAll = () => { syncMaxHeight(); updateStickyrollEdgeFade(el); };

        el._srOnScroll = () => updateStickyrollEdgeFade(el);
        el.addEventListener('scroll', el._srOnScroll, { passive: true });

        // ResizeObserver -- kalo lebar kolom berubah (resize window/zoom browser) yang bikin
        // teks item ikut wrap beda jumlah baris, tinggi 5-baris-pertama & status fade ke-ukur
        // ulang otomatis.
        const track = el.querySelector('.stickyroll-track');
        el._srRO = new ResizeObserver(() => syncAll());
        if (track) el._srRO.observe(track);
        syncAll();
    },
    updated(el, binding) {
        const nowActive = !!binding.value;
        if (!nowActive && el._srActive) { el.scrollTop = 0; el.style.maxHeight = ''; }
        el._srActive = nowActive;
        if (nowActive) {
            const h = measureStickyrollMaxHeight(el);
            if (h) el.style.maxHeight = h + 'px';
        }
        updateStickyrollEdgeFade(el);
    },
    unmounted(el) {
        if (el._srRO) el._srRO.disconnect();
        el.removeEventListener('scroll', el._srOnScroll);
    }
};

const app = createApp({
    setup() {
        // STATE AUTENTIKASI
        const isLoggedIn = ref(false);
        const userEmail = ref('');
        const userRole = ref('');
        const loginForm = ref({ email: '', password: '' });
        const loginError = ref('');
        const sessionExpiredMessage = ref(''); // pesan pas sesi abis (beda dari salah password)
        const isLoading = ref(false);

        // Dipake buat bedain signOut() yang emang kita sengaja panggil (logout manual/idle)
        // vs signOut yang kejadian sendiri di luar kontrol kita (token invalid, dsb).
        let manualSignOut = false;
        let idleTimer = null;
        let lastActivityAt = Date.now();
        const IDLE_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

        const resetIdleTimer = () => { lastActivityAt = Date.now(); };

        const startIdleWatcher = () => {
            lastActivityAt = Date.now();
            IDLE_EVENTS.forEach(evt => window.addEventListener(evt, resetIdleTimer, { passive: true }));
            idleTimer = setInterval(() => {
                const idleMinutes = (Date.now() - lastActivityAt) / 60000;
                if (idleMinutes >= SESSION_TIMEOUT_MINUTES) expireSessionDueToIdle();
            }, 30000); // cek tiap 30 detik
        };

        const stopIdleWatcher = () => {
            IDLE_EVENTS.forEach(evt => window.removeEventListener(evt, resetIdleTimer));
            if (idleTimer) clearInterval(idleTimer);
            idleTimer = null;
        };

        // ============================================================
        // SINKRON SESI ANTAR TAB -- sesi Supabase sengaja disimpen di sessionStorage (liat komentar
        // di atas SUPABASE_URL), biar begitu SEMUA tab ditutup, otomatis ke-anggep logout. Tapi
        // sessionStorage itu per-tab, jadi tab BARU (misal dibuka lewat klik-kanan "Buka di tab
        // baru" di menu sidebar / tombol Edit PR) gak kebagian sesi yang sama & kepaksa diminta
        // login lagi, padahal user aslinya masih login di tab lain.
        //
        // Fix-nya: pas tab baru kebuka & belom ada sesi sendiri, dia "nanya" ke tab lain lewat
        // localStorage -- dipake CUMA sebagai jalur pesan sesaat antar tab (browser "storage" event
        // cuma nyala di tab LAIN, gak di tab yang nulis), bukan buat nyimpen sesi beneran, makanya
        // langsung dihapus lagi abis dipake. Kalo ada tab lain yang masih login, dia "jawab" ngasih
        // access/refresh token-nya, terus dipasang ke client Supabase tab ini lewat setSession() --
        // gak perlu login ulang. Kalo GAK ADA tab lain yang lagi login (misal semua tab browser abis
        // ditutup terus buka baru), gak ada yang jawab dalam 500ms -> tetep diminta login kayak
        // biasa, jadi auto-logout pas semua tab ditutup TETAP jalan sesuai niat awal.
        const SESSION_SYNC_REQUEST_KEY = 'apv_session_sync_request';
        const SESSION_SYNC_RESPONSE_PREFIX = 'apv_session_sync_response_';

        // Tab ini "jawab" kalo ada tab LAIN yang nanya (minta sesi) & tab ini emang lagi login.
        window.addEventListener('storage', async (ev) => {
            if (ev.key !== SESSION_SYNC_REQUEST_KEY || !ev.newValue || !isLoggedIn.value) return;
            try {
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (!session) return;
                const responseKey = SESSION_SYNC_RESPONSE_PREFIX + ev.newValue;
                localStorage.setItem(responseKey, JSON.stringify({
                    access_token: session.access_token,
                    refresh_token: session.refresh_token
                }));
                // Numpang lewat doang -- bukan tempat nyimpen sesi, jadi dibersihin lagi sesaat abis itu.
                setTimeout(() => { try { localStorage.removeItem(responseKey); } catch (e) {} }, 2000);
            } catch (e) {}
        });

        // Minta sesi ke tab lain (dipanggil pas tab ini kebuka & sessionStorage-nya sendiri kosong).
        // Nunggu maksimal 500ms buat jawaban; kalo gak ada yang jawab, resolve null.
        const requestSessionFromOtherTabs = () => {
            return new Promise((resolve) => {
                const token = Date.now() + '_' + Math.random().toString(36).slice(2);
                const responseKey = SESSION_SYNC_RESPONSE_PREFIX + token;
                let settled = false;
                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    window.removeEventListener('storage', onStorage);
                    clearTimeout(timer);
                    resolve(result);
                };
                const onStorage = (ev) => {
                    if (ev.key !== responseKey || !ev.newValue) return;
                    try {
                        const parsed = JSON.parse(ev.newValue);
                        localStorage.removeItem(responseKey);
                        finish(parsed);
                    } catch (e) { finish(null); }
                };
                window.addEventListener('storage', onStorage);
                const timer = setTimeout(() => finish(null), 500);
                try { localStorage.setItem(SESSION_SYNC_REQUEST_KEY, token); } catch (e) { finish(null); return; }
                setTimeout(() => { try { localStorage.removeItem(SESSION_SYNC_REQUEST_KEY); } catch (e) {} }, 600);
            });
        };

        // Bersihin semua state login (dipake bareng sama expiry maupun logout manual)
        const clearSessionState = () => {
            isLoggedIn.value = false;
            userEmail.value = '';
            userRole.value = '';
            userBrand.value = null;
            loginForm.value = { email: '', password: '' };
            editingPRId.value = null;
            viewingPOId.value = null;
            currentTab.value = 'dashboard';
        };

        const expireSessionDueToIdle = async () => {
            stopIdleWatcher();
            manualSignOut = true;
            await supabaseClient.auth.signOut();
            manualSignOut = false;
            clearSessionState();
            sessionExpiredMessage.value = `Sesi lo abis karena kelamaan gak ada aktivitas (lebih dari ${SESSION_TIMEOUT_MINUTES} menit). Login lagi ya.`;
        };

        // Jaring pengaman: kalo Supabase sendiri yang ngeluarin sesi (token expired/invalid,
        // atau logout dari tab/perangkat lain) di luar signOut() yang kita panggil sendiri
        supabaseClient.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT' && !manualSignOut && isLoggedIn.value) {
                stopIdleWatcher();
                clearSessionState();
                sessionExpiredMessage.value = 'Sesi login lo udah gak valid lagi. Login lagi ya.';
            }
        });

        // STATE BRAND -- selectedBrand = brand yang dipilih di layar sebelum login
        // userBrand = brand ASLI yang nempel di akun (dari user_roles), null = Master (bebas semua brand)
        const selectedBrand = ref('');
        const userBrand = ref(null);
        const backToBrandPicker = () => {
            selectedBrand.value = '';
            loginError.value = '';
            sessionExpiredMessage.value = '';
            try { localStorage.removeItem('activeBrandChoice'); } catch (e) {}
        };

        const currentTab = ref('dashboard');
        // 4 menu utama di sidebar -- ini doang yang punya URL (#hash) sendiri. Tab lain
        // (buat-pr/edit-pr/master-branch/master-product/view-po) butuh data spesifik (PR/PO/produk
        // yang lagi dibuka) yang cuma ada di memori browser, jadi gak bisa "dibuka lewat link".
        const SIDEBAR_TABS = ['dashboard', 'daftar-pr', 'daftar-po', 'master-hub'];
        // Baca tab dari #hash di URL (misal dibuka dari link "Open in new tab") -- null kalo
        // gak ada / gak valid, biar fallback normal (localStorage / default dashboard) yang jalan.
        const tabFromHash = () => {
            const h = (window.location.hash || '').replace('#', '');
            return SIDEBAR_TABS.includes(h) ? h : null;
        };
        // Simpen tab yang lagi dibuka biar refresh halaman gak balik ke Dashboard lagi, DAN
        // update #hash di address bar (replaceState -- gak nambah entry history baru) buat 4 menu
        // utama, biar url-nya "jujur" nunjuk ke tab yang lagi kebuka (bisa di-bookmark/di-share/
        // klik kanan "Buka di tab baru" dari sidebar dan bener-bener nyampe ke tab yang sama).
        watch(currentTab, (val) => {
            try { localStorage.setItem('lastActiveTab', val); } catch (e) {}
            try {
                if (SIDEBAR_TABS.includes(val)) history.replaceState(null, '', '#' + val);
            } catch (e) {}
        });
        // Balikin tab terakhir, tapi tolak tab Master Data kalo role-nya bukan Master
        // (jaga-jaga di browser bareng: akun Master abis buka Master Data, logout,
        // akun AM login di browser yang sama -- jangan sampe ke-lempar ke tab itu)
        const restoreLastTab = (role) => {
            try {
                // #hash di URL (misal dari link yang di-klik-kanan "Buka di tab baru") menang
                // duluan dibanding tab terakhir yang kesimpen di localStorage.
                const hashTab = tabFromHash();
                if (hashTab && (hashTab !== 'master-hub' || role === 'Master')) {
                    currentTab.value = hashTab;
                    return;
                }
                const saved = localStorage.getItem('lastActiveTab');
                // 'edit-pr'/'view-po' gak di-restore -- editingPR/viewingPO cuma ada di memori
                // browser, ilang pas refresh, jadi kalo dipaksa balik ke tab ini layarnya bakal kosong
                if (saved && saved !== 'edit-pr' && saved !== 'view-po' && (!saved.startsWith('master') || role === 'Master')) {
                    currentTab.value = saved;
                }
            } catch (e) {}
        };
        // Dipake di @click link sidebar -- link-nya sekarang punya href="#tab" beneran (bukan
        // cuma div/@click doang) biar browser ngeh ada "alamat" tujuannya, jadi klik-kanan-nya
        // otomatis punya pilihan "Buka link di tab baru" / "Salin alamat link" kayak link biasa.
        // Klik kiri polos -> tetep pindah tab di HALAMAN YANG SAMA (SPA, gak reload) makanya
        // di-preventDefault. Tapi Ctrl/Cmd/Shift+klik atau klik tengah/kanan (buat buka tab baru /
        // window baru / lewat menu klik-kanan) SENGAJA DIBIARIN jalan normal ke href-nya.
        const goToTab = (e, tab) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            currentTab.value = tab;
        };
        const prs = ref([]);
        const pos = ref([]);
        const prItems = ref([]); // isi purchase_request_items -- item-item di tiap PR (1 PR bisa banyak item sekarang)
        const masterBranches = ref([]);
        const masterProducts = ref([]);

        // form Buat PR -- gak ada harga/total lagi, item-nya dikumpulin dulu di form.items
        // sebelum di-submit bareng-bareng (baru masuk DB pas tombol Submit diklik)
        const form = ref({ branch_name: '', required_date: '', shipping_category: '', pic: '', notes: '', items: [] });
        // PIC cuma relevan kalo Kategori Pengiriman = Indirect -- kalo user ganti balik ke
        // Direct (atau kategori lain), kosongin lagi PIC-nya biar gak ke-submit nyangkut/stale.
        watch(() => form.value.shipping_category, (val) => {
            if (val !== 'Indirect') form.value.pic = '';
        });
        const newItemProductId = ref('');
        // qty defaultnya null (bukan 0) -- kalo di-set 0, input type="number" bakal nampilin
        // angka "0" literal (nutupin placeholder "Jumlah"), jadi keliatan kayak udah keisi
        // padahal belom, dan orang gak sadar harus dihapus dulu sebelum ngetik jumlah beneran.
        // null bikin field-nya kosong beneran (placeholder keliatan), tapi validasi "harus > 0"
        // tetep jalan sama kayak sebelumnya (null itu falsy juga).
        const newItemQty = ref(null);

        // State edit-in-place buat item yang UDAH ditambahin ke form.items (belum ke-submit ke DB).
        // Sebelumnya cuma bisa dihapus doang, sekarang barang/qty-nya bisa diganti tanpa hapus+tambah ulang.
        const editingFormItemIdx = ref(null);
        const editFormItemProductId = ref('');
        const editFormItemQty = ref(null);

        // Balikin form Buat PR ke kosong total -- dipake pas Cancel, pas mau buka
        // form baru (biar gak kebawa data PR yang sebelumnya lagi diisi/dibatalin),
        // dan abis submit sukses.
        const resetPRForm = () => {
            form.value = { branch_name: '', required_date: '', shipping_category: '', pic: '', notes: '', items: [] };
            newItemProductId.value = '';
            newItemQty.value = null;
            editingFormItemIdx.value = null;
            editFormItemProductId.value = '';
            editFormItemQty.value = null;
        };
        const openBuatPR = () => {
            resetPRForm();
            currentTab.value = 'buat-pr';
        };
        const cancelBuatPR = () => {
            resetPRForm();
            currentTab.value = 'daftar-pr';
        };

        const filterStatus = ref('');
        const prFilterShipping = ref(''); // filter dropdown Shipping di Daftar PR ('' = semua)
        const prDateRange = ref({ from: '', to: '' });
        const poDateRange = ref({ from: '', to: '' });
        const poFilterShipping = ref(''); // filter dropdown Shipping di Daftar PO ('' = semua)
        const branchSearchQuery = ref('');
        const productSearchQuery = ref('');

        // ============================================================
        // FILTER "Select Target Column" + search box di Daftar PR/PO -- pilih dulu kolom yang mau
        // di-search (dropdown), terus ketik query-nya di search box sampingnya. KHUSUS kolom
        // "Branch": search box-nya DIGANTI jadi multi-select Branch (prBranchFilter/poBranchFilter,
        // array) + tombol Apply yang keliatan di sampingnya -- field lain (Request/PO Number, PIC,
        // Notes) tetep pake 1 search box teks biasa (searchQuery/poSearchQuery).
        // ============================================================
        const prSearchField = ref('pr_number');
        const prSearchFieldLabel = computed(() => (PR_SEARCH_FIELDS.find(f => f.value === prSearchField.value) || {}).label || '');
        const searchQuery = ref('');
        const prBranchFilter = ref([]);

        const poSearchField = ref('po_number');
        const poSearchFieldLabel = computed(() => (PO_SEARCH_FIELDS.find(f => f.value === poSearchField.value) || {}).label || '');
        const poSearchQuery = ref('');
        const poBranchFilter = ref([]);

        // ============================================================
        // FILTER Dashboard -- Branch (multiselect) & range tanggal di atas Dashboard Overview.
        // CUMA mempengaruhi donut chart + 2 list Top Items, notifikasi TETEP nampilin semua
        // (sesuai request eksplisit -- notifikasi PR hampir Expired gak boleh ke-filter).
        // ============================================================
        const dashBranchFilter = ref([]);
        const dashDateRange = ref({ from: '', to: '' });

        // Kelompokin item per pr_id biar gampang dipanggil di template: itemsByPrId[pr.id]
        const itemsByPrId = computed(() => {
            const map = {};
            prItems.value.forEach(it => {
                if (!map[it.pr_id]) map[it.pr_id] = [];
                map[it.pr_id].push(it);
            });
            return map;
        });

        // Nambah 1 item ke list form Buat PR (belum masuk DB, baru lokal di browser dulu)
        const addFormItem = () => {
            if (!newItemProductId.value) { toast('Pilih barang dulu ya.', 'warn'); return; }
            if (!newItemQty.value || newItemQty.value <= 0) { toast('Isi jumlah dulu ya (harus lebih dari 0).', 'warn'); return; }
            const product = masterProducts.value.find(p => p.id === newItemProductId.value);
            if (!product) return;
            const displayName = product.unit ? `${product.name} (${product.unit})` : product.name;
            if (form.value.items.some(it => it.product_id === product.id)) {
                toast('Item ini udah ada di list. Kalo mau ubah jumlahnya, edit langsung item-nya di list bawah.', 'warn');
                return;
            }
            form.value.items.push({ product_id: product.id, item_name: displayName, qty: newItemQty.value });
            newItemProductId.value = '';
            newItemQty.value = null;
        };
        const removeFormItem = (idx) => {
            form.value.items.splice(idx, 1);
            if (editingFormItemIdx.value === idx) editingFormItemIdx.value = null;
        };

        // Edit-in-place item yang udah ditambahin (ganti barang dan/atau qty-nya, tanpa hapus+tambah ulang)
        const startEditFormItem = (idx) => {
            const it = form.value.items[idx];
            editingFormItemIdx.value = idx;
            editFormItemProductId.value = it.product_id;
            editFormItemQty.value = it.qty;
        };
        const cancelEditFormItem = () => { editingFormItemIdx.value = null; };
        const saveEditFormItem = (idx) => {
            if (!editFormItemProductId.value) { toast('Pilih barang dulu ya.', 'warn'); return; }
            if (!editFormItemQty.value || editFormItemQty.value <= 0) { toast('Isi jumlah dulu ya (harus lebih dari 0).', 'warn'); return; }
            const product = masterProducts.value.find(p => p.id === editFormItemProductId.value);
            if (!product) return;
            const isDuplicate = form.value.items.some((it, i) => i !== idx && it.product_id === product.id);
            if (isDuplicate) { toast('Barang ini udah ada di item lain di list.', 'warn'); return; }
            const displayName = product.unit ? `${product.name} (${product.unit})` : product.name;
            form.value.items[idx] = { product_id: product.id, item_name: displayName, qty: editFormItemQty.value };
            editingFormItemIdx.value = null;
        };

        // ============================================================
        // AM/MASTER REVIEW PR -- edit item (tambah/hapus/ubah qty) + approve/reject.
        // Beda sama form.items di atas: di sini tiap aksi LANGSUNG nyimpen ke DB
        // (bukan draft lokal dulu), soalnya PR-nya emang udah ada/tersimpan.
        // ============================================================
        const editingPRId = ref(null); // ID PR yang lagi dibuka di layar Detail/Edit
        // Ambil objek PR-nya langsung dari prs (bukan disimpen sebagai objek statis) biar
        // begitu fetchData() jalan lagi (misal abis approve/tambah item), datanya ikut ke-update
        const editingPR = computed(() => editingPRId.value ? (prs.value.find(pr => pr.id === editingPRId.value) || null) : null);
        const editPRNewItemProductId = ref('');
        const editPRNewItemQty = ref(null); // null biar field kosong (placeholder "Jumlah" keliatan), bukan nampilin "0"

        const editPRItems = computed(() => editingPR.value ? (itemsByPrId.value[editingPR.value.id] || []) : []);
        // Cuma AM/Master yang bisa edit, dan cuma kalo PR-nya masih Pending
        const canEditPR = computed(() =>
            !!editingPR.value && editingPR.value.status === 'Pending' && (userRole.value === 'AM' || userRole.value === 'Master')
        );

        // ============================================================
        // VIEW DETAIL PO -- read-only, dibuka dari tombol "View" di Daftar PO
        // (item PO gak lagi di-show langsung di tabel list, biar tabelnya gak sesak)
        // ============================================================
        const viewingPOId = ref(null);
        const viewingPO = computed(() => viewingPOId.value ? (pos.value.find(po => po.id === viewingPOId.value) || null) : null);
        const viewingPOItems = computed(() => viewingPO.value ? (itemsByPrId.value[viewingPO.value.pr_id] || []) : []);
        const openViewPO = (po) => { viewingPOId.value = po.id; currentTab.value = 'view-po'; };
        const backFromViewPO = () => { viewingPOId.value = null; currentTab.value = 'daftar-po'; };

        // STATE EDIT & BULK SELECT -- Master Branch
        const editingBranchId = ref(null);
        const editBranchForm = ref({ branch_name: '', branch_code: '', brand: '' });
        const selectedBranchIds = ref([]);

        // STATE EDIT & BULK SELECT -- Master Product
        const editingProductId = ref(null);
        const editProductForm = ref({ name: '', unit: '', brand: '' });
        const selectedProductIds = ref([]);

        // Brand yang lagi "aktif" di workspace ini: AM selalu kekunci ke brand-nya sendiri,
        // Master ngikut brand yang dia pilih di layar login (biar pas masuk salah satu "kamar"
        // brand, data brand yang satunya gak ikut ketarik).
        const activeBrand = computed(() => userBrand.value || selectedBrand.value || null);

        // Kebuli Abuya gak pake skema Indirect/PIC sama sekali -- jadi dropdown Kategori
        // Pengiriman-nya di-filter cuma nyisain "Direct". Brand lain (Almaz Fried Chicken)
        // tetep dapet pilihan lengkap (Direct + Indirect).
        const shippingCategoryOptions = computed(() => {
            if (activeBrand.value === 'Kebuli Abuya') {
                return SHIPPING_CATEGORY_OPTIONS.filter(o => o.value === 'Direct');
            }
            return SHIPPING_CATEGORY_OPTIONS;
        });

        // Semua PR/PO di-scope ke activeBrand dulu -- ini yang bikin isi brand lain gak ikut nongol
        const brandPRs = computed(() => {
            if (!activeBrand.value) return prs.value;
            return prs.value.filter(pr => pr.brand === activeBrand.value);
        });
        const brandPOs = computed(() => {
            if (!activeBrand.value) return pos.value;
            return pos.value.filter(po => po.purchase_requests?.brand === activeBrand.value);
        });

        const pendingPRs = computed(() => brandPRs.value.filter(pr => pr.status === 'Pending'));

        // ============================================================
        // DASHBOARD -- donut chart status PR, notifikasi PR hampir Expired, & top item by count of PO.
        // ============================================================
        // brandPRs/brandPOs abis di-filter lagi pake filter Branch + range tanggal Dashboard
        // (dashBranchFilter/dashDateRange) -- CUMA dipake sama donut chart & 2 list Top Items,
        // notifikasi (expiringSoonPRs di bawah) sengaja TETEP pake brandPRs mentah (gak kefilter).
        const dashFilteredPRs = computed(() => {
            let result = brandPRs.value;
            if (dashBranchFilter.value.length) result = result.filter(pr => dashBranchFilter.value.includes(pr.branch_name));
            if (dashDateRange.value.from) result = result.filter(pr => pr.created_at && pr.created_at.slice(0, 10) >= dashDateRange.value.from);
            if (dashDateRange.value.to) result = result.filter(pr => pr.created_at && pr.created_at.slice(0, 10) <= dashDateRange.value.to);
            return result;
        });
        const dashFilteredPOs = computed(() => {
            let result = brandPOs.value;
            if (dashBranchFilter.value.length) result = result.filter(po => dashBranchFilter.value.includes(po.purchase_requests?.branch_name));
            if (dashDateRange.value.from) result = result.filter(po => po.created_at && po.created_at.slice(0, 10) >= dashDateRange.value.from);
            if (dashDateRange.value.to) result = result.filter(po => po.created_at && po.created_at.slice(0, 10) <= dashDateRange.value.to);
            return result;
        });

        // Jumlah PR per status (buat donut chart & 4 kotak angka di sampingnya)
        const prStatusCounts = computed(() => {
            const counts = { Pending: 0, Approved: 0, Rejected: 0, Expired: 0 };
            dashFilteredPRs.value.forEach(pr => {
                if (Object.prototype.hasOwnProperty.call(counts, pr.status)) counts[pr.status]++;
            });
            return counts;
        });
        const donutTotal = computed(() => dashFilteredPRs.value.length);

        // Hitung tiap segmen donut: dash-array/offset buat gambar busur SVG-nya, plus posisi
        // (x,y) buat naro label persentase PAS DI PINGGIR donat-nya (bukan di tengah/di dalem).
        const donutSegments = computed(() => {
            const total = donutTotal.value;
            const R = 70, CX = 100, CY = 100;
            const circumference = 2 * Math.PI * R;
            let cumulative = 0;
            return DASHBOARD_STATUS_CONFIG.map(cfg => {
                const count = prStatusCounts.value[cfg.key] || 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                const dash = total > 0 ? (count / total) * circumference : 0;
                const offset = cumulative;
                cumulative += dash;
                // -Math.PI/2 biar segmen pertama mulai dari jam 12 (bukan jam 3, default SVG)
                const midAngle = total > 0 ? ((offset + dash / 2) / circumference) * 2 * Math.PI - Math.PI / 2 : 0;
                // Label persentase digeser lebih jauh dari cincin donut (labelR), dan dikasih
                // garis penghubung ("benang") dari pinggir cincin (lineR1) ke deket label-nya
                // (lineR2) biar jelas persentase itu punya segmen yang mana + gak mepet ke donat.
                const labelR = R + 40;
                const lineR1 = R + 15;
                const lineR2 = labelR - 12;
                return {
                    key: cfg.key,
                    label: cfg.label,
                    color: cfg.color,
                    soft: cfg.soft,
                    bg: cfg.bg,
                    count,
                    pct,
                    dashArray: `${dash} ${circumference - dash}`,
                    dashOffset: -offset,
                    labelX: CX + labelR * Math.cos(midAngle),
                    labelY: CY + labelR * Math.sin(midAngle),
                    lineX1: CX + lineR1 * Math.cos(midAngle),
                    lineY1: CY + lineR1 * Math.sin(midAngle),
                    lineX2: CX + lineR2 * Math.cos(midAngle),
                    lineY2: CY + lineR2 * Math.sin(midAngle)
                };
            });
        });
        // Cuma segmen yang count-nya > 0 -- dipisah dari donutSegments biar template svg-nya
        // gak perlu v-for+v-if bareng di satu <text> (rawan bug percampuran scope di Vue 3).
        const donutLabelSegments = computed(() => donutSegments.value.filter(s => s.count > 0));

        // Notifikasi "PR Hampir Expired" -- PR Pending yang Required Date-nya jatuh BESOK (artinya
        // HARI INI udah H-1, batas terakhir buat di-take action sebelum otomatis ke-expire).
        const expiringSoonPRs = computed(() => {
            const limit = tomorrowWIB();
            return brandPRs.value.filter(pr => pr.status === 'Pending' && pr.required_date === limit);
        });

        // Top item paling sering dipesan diliat dari BERAPA KALI item itu nongol di PO yang beda
        // (count of PO), BUKAN dari total qty-nya -- jadi item yang muncul di 5 PO beda (qty 1
        // masing-masing) tetep menang dibanding item yang cuma muncul di 1 PO tapi qty-nya 100.
        const topItemsByPOCount = computed(() => {
            const counts = {};
            dashFilteredPOs.value.forEach(po => {
                const items = itemsByPrId.value[po.pr_id] || [];
                const uniqueNamesInThisPO = new Set(items.map(it => it.item_name));
                uniqueNamesInThisPO.forEach(name => {
                    counts[name] = (counts[name] || 0) + 1;
                });
            });
            return Object.entries(counts)
                .map(([item_name, count]) => ({ item_name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);
        });

        // Top item paling sering dipesan diliat dari TOTAL QTY-nya (jumlah semua qty item itu
        // digabung dari semua PO) -- beda sama topItemsByPOCount yang ngitung frekuensi PO, ini
        // ngitung total banyaknya barang yang dipesan.
        const topItemsByQtyCount = computed(() => {
            const totals = {};
            dashFilteredPOs.value.forEach(po => {
                const items = itemsByPrId.value[po.pr_id] || [];
                items.forEach(it => {
                    totals[it.item_name] = (totals[it.item_name] || 0) + (Number(it.qty) || 0);
                });
            });
            return Object.entries(totals)
                .map(([item_name, qty]) => ({ item_name, qty }))
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 10);
        });

        // Sort state buat tabel Daftar PR & Daftar PO. Klik header sekali = urut naik (asc),
        // klik lagi di kolom yang sama = kebalik (desc), klik kolom lain = pindah ke kolom itu (asc).
        const prSortField = ref('created_at');
        const prSortDir = ref('desc');
        const poSortField = ref('created_at');
        const poSortDir = ref('desc');
        const toggleSortPR = (field) => {
            if (prSortField.value === field) {
                prSortDir.value = prSortDir.value === 'asc' ? 'desc' : 'asc';
            } else {
                prSortField.value = field;
                prSortDir.value = 'asc';
            }
        };
        const toggleSortPO = (field) => {
            if (poSortField.value === field) {
                poSortDir.value = poSortDir.value === 'asc' ? 'desc' : 'asc';
            } else {
                poSortField.value = field;
                poSortDir.value = 'asc';
            }
        };
        // Comparator generik: string di-lowercase biar A-Z gak beda sama a-z, angka/tanggal
        // (string ISO) langsung bisa dibandingin langsung.
        const compareSortVal = (a, b) => {
            if (a === null || a === undefined || a === '') a = '';
            if (b === null || b === undefined || b === '') b = '';
            if (typeof a === 'string') a = a.toLowerCase();
            if (typeof b === 'string') b = b.toLowerCase();
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        };

        const filteredPRs = computed(() => {
            let result = brandPRs.value;
            if (filterStatus.value) result = result.filter(pr => pr.status === filterStatus.value);
            if (prFilterShipping.value) result = result.filter(pr => pr.shipping_category === prFilterShipping.value);
            if (prDateRange.value.from) result = result.filter(pr => pr.required_date && pr.required_date >= prDateRange.value.from);
            if (prDateRange.value.to) result = result.filter(pr => pr.required_date && pr.required_date <= prDateRange.value.to);
            // Kolom "Branch" kepilih -> filter pake multi-select (prBranchFilter), kolom lain
            // (Request Number/PIC/Notes) -> filter pake search box teks biasa (searchQuery).
            if (prSearchField.value === 'branch_name') {
                if (prBranchFilter.value.length) result = result.filter(pr => prBranchFilter.value.includes(pr.branch_name));
            } else if (searchQuery.value) {
                const query = searchQuery.value.toLowerCase();
                result = result.filter(pr => String(pr[prSearchField.value] || '').toLowerCase().includes(query));
            }
            const field = prSortField.value;
            const dir = prSortDir.value === 'asc' ? 1 : -1;
            result = [...result].sort((a, b) => compareSortVal(a[field], b[field]) * dir);
            return result;
        });

        // Sama polanya kayak filteredPRs, cuma buat Daftar PO. Branch/PIC-nya ngikut PR induk
        // (po.purchase_requests), soalnya PO sendiri gak nyimpen itu.
        const getPOSortVal = (po, field) => {
            if (field === 'po_number' || field === 'created_at') return po[field];
            return po.purchase_requests?.[field];
        };
        const filteredPOs = computed(() => {
            let result = brandPOs.value;
            if (poFilterShipping.value) result = result.filter(po => po.purchase_requests?.shipping_category === poFilterShipping.value);
            if (poDateRange.value.from) result = result.filter(po => po.created_at && po.created_at.slice(0, 10) >= poDateRange.value.from);
            if (poDateRange.value.to) result = result.filter(po => po.created_at && po.created_at.slice(0, 10) <= poDateRange.value.to);
            if (poSearchField.value === 'branch_name') {
                if (poBranchFilter.value.length) result = result.filter(po => poBranchFilter.value.includes(po.purchase_requests?.branch_name));
            } else if (poSearchQuery.value) {
                const query = poSearchQuery.value.toLowerCase();
                result = result.filter(po => {
                    const raw = poSearchField.value === 'po_number' ? po.po_number : po.purchase_requests?.[poSearchField.value];
                    return String(raw || '').toLowerCase().includes(query);
                });
            }
            const field = poSortField.value;
            const dir = poSortDir.value === 'asc' ? 1 : -1;
            result = [...result].sort((a, b) => compareSortVal(getPOSortVal(a, field), getPOSortVal(b, field)) * dir);
            return result;
        });

        // Master Branch/Product SEKARANG ikut ke-scope brand yang lagi aktif juga.
        // Cabang/produk yang brand-nya belum ketandain (NULL) tetep keliatan di semua brand,
        // biar data lama yang belum sempet ditag gak ujug-ujug ilang.
        const brandManagedBranches = computed(() => {
            if (!activeBrand.value) return masterBranches.value;
            return masterBranches.value.filter(b => !b.brand || b.brand === activeBrand.value);
        });
        const brandManagedProducts = computed(() => {
            if (!activeBrand.value) return masterProducts.value;
            return masterProducts.value.filter(p => !p.brand || p.brand === activeBrand.value);
        });

        const filteredBranches = computed(() => {
            if (!branchSearchQuery.value) return brandManagedBranches.value;
            const query = branchSearchQuery.value.toLowerCase();
            return brandManagedBranches.value.filter(b => (b.branch_name || '').toLowerCase().includes(query));
        });

        const filteredProducts = computed(() => {
            if (!productSearchQuery.value) return brandManagedProducts.value;
            const query = productSearchQuery.value.toLowerCase();
            return brandManagedProducts.value.filter(p => (p.name || '').toLowerCase().includes(query));
        });

        // "Select all" nyala kalo semua baris yang lagi keliatan (hasil search) udah dipilih
        const allBranchesSelected = computed(() =>
            filteredBranches.value.length > 0 && selectedBranchIds.value.length === filteredBranches.value.length
        );
        const allProductsSelected = computed(() =>
            filteredProducts.value.length > 0 && selectedProductIds.value.length === filteredProducts.value.length
        );

        // Dropdown cabang & item pas Buat PR -- ngikut brand yang lagi aktif (AM: brand-nya sendiri,
        // Master: brand yang lagi dia buka). Pake list yang sama kayak Master Data biar konsisten.
        const brandBranches = brandManagedBranches;
        const brandProducts = brandManagedProducts;

        // Opsi buat dropdown searchable (SearchableSelect) di form Buat PR
        const branchOptions = computed(() => brandBranches.value.map(b => ({ value: b.branch_name, label: b.branch_name })));
        const productOptions = computed(() => brandProducts.value.map(p => ({
            value: p.id,
            label: p.unit ? `${p.name} (${p.unit})` : p.name
        })));

        const formatRp = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka || 0);
        const formatDate = (dateStr) => {
            if (!dateStr) return '-';
            return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        };

        // Sama kayak formatDate, tapi ikut nampilin jam:menit -- dipake di box "Information"
        // (kapan PR/PO dibuat & diedit).
        const formatDateTime = (dateStr) => {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
            const timePart = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            return `${datePart}, ${timePart}`;
        };

        // Ambil role + brand user dari tabel user_roles (RLS cuma ngebolehin liat row diri sendiri)
        const fetchRoleAndBrand = async (email) => {
            const { data, error } = await supabaseClient
                .from('user_roles')
                .select('role, brand')
                .ilike('email', email)
                .maybeSingle();
            if (error) console.error('Gagal ambil role:', error);
            return { role: data?.role || 'SM', brand: data?.brand ?? null };
        };

        const handleLogin = async () => {
            isLoading.value = true;
            loginError.value = '';
            sessionExpiredMessage.value = '';
            try {
                const usernameInput = loginForm.value.email || '';
                const fullEmail = usernameInput.includes('@') ? usernameInput : `${usernameInput}@abuyagroup.com`;

                const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                    email: fullEmail,
                    password: loginForm.value.password
                });

                if (authError) {
                    loginError.value = 'Username atau Password salah / Belum terdaftar!';
                    return;
                }

                const { role, brand } = await fetchRoleAndBrand(fullEmail);

                // Kalo akun ini kekunci ke brand tertentu (bukan Master) dan beda sama brand yang dipilih -> tolak
                if (brand && brand !== selectedBrand.value) {
                    manualSignOut = true;
                    await supabaseClient.auth.signOut();
                    manualSignOut = false;
                    loginError.value = `Akun ini gak punya akses ke brand "${selectedBrand.value}".`;
                    return;
                }

                isLoggedIn.value = true;
                userEmail.value = usernameInput;
                userRole.value = role;
                userBrand.value = brand;
                // Simpen brand yang lagi dibuka biar kalo halaman di-refresh, Master gak
                // balik ngeliat semua brand lagi (workspace tetep ke-scope ke brand ini)
                try { localStorage.setItem('activeBrandChoice', selectedBrand.value); } catch (e) {}
                startIdleWatcher();
                await fetchData();
            } catch (err) {
                console.error('Error login:', err);
                loginError.value = 'Gagal terhubung ke Supabase.';
            } finally {
                isLoading.value = false;
            }
        };

        const handleLogout = async () => {
            stopIdleWatcher();
            manualSignOut = true;
            await supabaseClient.auth.signOut();
            manualSignOut = false;
            clearSessionState();
            sessionExpiredMessage.value = '';
            try { localStorage.removeItem('lastActiveTab'); } catch (e) {}
        };

        // PR yang statusnya masih Pending tapi udah lewat batas waktu take action otomatis
        // di-expire jadi status "Expired". Batasnya: AM/Master masih bisa Approve/Reject sampe
        // H-1 dari Required Date (misal Required Date tanggal 18, masih bisa di-take action
        // sepanjang tanggal 17 -- begitu ganti hari/masuk tanggal 18, udah kelewatan). Jadi
        // aturannya: begitu tanggal HARI INI udah >= Required Date-nya sendiri (bukan H-1-nya),
        // dan PR-nya masih Pending, otomatis Expired.
        // PR yang Expired otomatis gak bisa di-approve/reject lagi (tombolnya ilang sendiri,
        // liat computed canEditPR yang syaratnya status === 'Pending') dan otomatis gak akan
        // pernah jadi PO (PO cuma kebikin pas approvePR() jalan, dan itu gak bisa lagi soalnya
        // PR-nya udah bukan Pending).
        // Dicek tiap kali fetchData() jalan (abis login & abis ada perubahan data) -- ini
        // lapisan KEDUA doang buat reaksi cepet pas ada yang buka app; lapisan utamanya sekarang
        // pg_cron di database (jalan sendiri tiap jam, gak nunggu ada yang buka app). Pake
        // todayWIB() (bukan new Date() polos) biar "hari ini"-nya konsisten sama pg_cron,
        // gak peduli device yang buka app lagi di WIB/WITA/WIT.
        const expireOverduePRs = async () => {
            const todayStr = todayWIB();
            const overdue = prs.value.filter(pr => pr.status === 'Pending' && pr.required_date && pr.required_date <= todayStr);
            if (overdue.length === 0) return;
            const { error } = await supabaseClient.from('purchase_requests').update({
                status: 'Expired',
                updated_at: new Date().toISOString(),
                updated_by: 'system (auto-expired)'
            }).in('id', overdue.map(pr => pr.id));
            if (error) {
                console.error('Gagal auto-expire PR:', error);
                return;
            }
            overdue.forEach(pr => { pr.status = 'Expired'; }); // optimistic update biar langsung keliatan gak usah nunggu refetch
        };

        const fetchData = async () => {
            try {
                const [prRes, poRes, branchRes, productRes, itemRes] = await Promise.all([
                    supabaseClient.from('purchase_requests').select('*').order('created_at', { ascending: false }),
                    supabaseClient.from('purchase_orders').select('*, purchase_requests(pr_number, branch_name, brand, shipping_category, pic, required_date)').order('created_at', { ascending: false }),
                    supabaseClient.from('master_branches').select('*').order('branch_name'),
                    supabaseClient.from('master_products').select('*').order('name'),
                    supabaseClient.from('purchase_request_items').select('*').order('id'),
                ]);
                prs.value = prRes.data || [];
                pos.value = poRes.data || [];
                masterBranches.value = branchRes.data || [];
                masterProducts.value = productRes.data || [];
                prItems.value = itemRes.data || [];

                // Cuma AM/Master yang punya hak UPDATE status PR di RLS -- SM gak perlu/gak
                // bisa nge-trigger ini (update-nya bakal ke-block RLS aja kalo dipaksa).
                if (userRole.value === 'AM' || userRole.value === 'Master') {
                    await expireOverduePRs();
                }
            } catch (err) {
                console.error('Gagal ambil data:', err);
            }
        };

        // UPLOAD EXCEL PRODUK -- satu-satunya cara nambah produk sekarang
        const handleProductFileUpload = async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            isLoading.value = true;
            try {
                const buffer = await file.arrayBuffer();
                const workbook = XLSX.read(buffer, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                if (rows.length === 0) {
                    toast('File Excel kosong!', 'warn');
                    return;
                }

                const nameCol = findCol(rows[0], 'Product Name', 'product_name', 'name', 'nama_produk', 'nama produk');
                if (!nameCol) {
                    toast(`Gagal! Kolom nama produk tidak ditemukan. Kolom yang kebaca: ${Object.keys(rows[0]).join(', ')}`, 'error');
                    return;
                }
                // Kolom Brand & Unit OPSIONAL -- Brand kosong = shared (keliatan di semua brand).
                // Unit kosong dianggap NULL (produk sama boleh punya beberapa baris beda unit,
                // misal "Air Mineral 220ml" ada yang Carton ada yang pcs).
                const brandCol = findCol(rows[0], 'Brand', 'brand', 'Merk', 'merk');
                const unitCol = findCol(rows[0], 'Unit', 'unit', 'Satuan', 'satuan');

                const payload = rows
                    .map((row) => ({
                        name: String(row[nameCol] ?? '').trim(),
                        unit: unitCol ? (String(row[unitCol] ?? '').trim() || null) : null,
                        brand: brandCol ? (String(row[brandCol] ?? '').trim() || null) : null
                    }))
                    .filter((r) => r.name && r.name.toLowerCase() !== 'nan');

                if (payload.length === 0) {
                    toast('Gak ada baris valid buat diimport.', 'warn');
                    return;
                }

                const { error } = await supabaseClient
                    .from('master_products')
                    .upsert(payload, { onConflict: 'name,unit', ignoreDuplicates: true });

                if (error) {
                    toast('Gagal upload: ' + error.message, 'error');
                    return;
                }

                toast(`Berhasil diproses ${payload.length} baris produk!`, 'success');
                fetchData();
            } catch (err) {
                console.error(err);
                toast('Gagal memproses file Excel.', 'error');
            } finally {
                isLoading.value = false;
                event.target.value = '';
            }
        };

        const submitPR = async () => {
            // Validasi manual -- dropdown Cabang & Kategori Pengiriman sekarang komponen custom
            // (SearchableSelect), bukan <select required> asli, jadi validasi HTML5 gak jalan
            if (!form.value.branch_name) { toast('Pilih cabang dulu ya.', 'warn'); return; }
            if (!form.value.required_date) { toast('Pilih Required Date dulu ya.', 'warn'); return; }
            if (!form.value.shipping_category) { toast('Pilih kategori pengiriman dulu ya.', 'warn'); return; }
            if (form.value.shipping_category === 'Indirect' && !form.value.pic) { toast('Pilih PIC dulu ya.', 'warn'); return; }
            if (form.value.items.length === 0) { toast('Tambahkan minimal 1 item barang dulu ya.', 'warn'); return; }
            try {
                // Brand PR ini ngikut brand cabang yang dipilih (bukan brand user, biar Master
                // yang bisa akses semua brand tetep ke-tag PR-nya dengan bener)
                const matchedBranch = masterBranches.value.find(b => b.branch_name === form.value.branch_name);
                const prBrand = matchedBranch?.brand || deriveBrandFromBranchName(form.value.branch_name);

                const prNumber = await generateNumber('PR');

                // Bikin dulu PR-nya (tanpa item), .select().single() biar dapet id-nya balik
                const { data: newPR, error } = await supabaseClient.from('purchase_requests').insert({
                    pr_number: prNumber,
                    branch_name: form.value.branch_name,
                    shipping_category: form.value.shipping_category,
                    pic: form.value.shipping_category === 'Indirect' ? form.value.pic : null,
                    required_date: form.value.required_date || null,
                    notes: form.value.notes,
                    brand: prBrand,
                    status: 'Pending',
                    created_by: userEmail.value
                }).select().single();

                if (error) {
                    toast('Gagal submit PR: ' + error.message, 'error');
                    return;
                }

                // Abis PR-nya kebikin, baru masukin semua item yang udah dikumpulin di form.items
                const itemsPayload = form.value.items.map(it => ({
                    pr_id: newPR.id,
                    item_name: it.item_name,
                    qty: it.qty
                }));
                const { error: itemsError } = await supabaseClient.from('purchase_request_items').insert(itemsPayload);
                if (itemsError) {
                    toast('PR kebikin, tapi gagal simpan item-nya: ' + itemsError.message, 'error');
                    return;
                }

                resetPRForm();
                await fetchData();
                currentTab.value = 'daftar-pr';
            } catch (err) {
                toast('Gagal submit PR', 'error');
            }
        };

        // Buka layar Detail/Edit PR (AM/Master pake ini buat ngecek item yang direquest SM)
        const openEditPR = (pr) => {
            editingPRId.value = pr.id;
            editPRNewItemProductId.value = '';
            editPRNewItemQty.value = null;
            currentTab.value = 'edit-pr';
            // #hash-nya nunjuk ke PR spesifik ini (bukan cuma 'edit-pr' doang) -- biar tombol
            // Edit/View di baris tabel punya "alamat" sendiri-sendiri (klik kanan -> Buka di tab
            // baru / Salin alamat link beneran nyampe ke Detail PR yang sama, bukan cuma ke tab
            // Purchase Request kosong).
            try { history.replaceState(null, '', '#edit-pr/' + pr.id); } catch (e) {}
        };
        const backFromEditPR = () => {
            editingPRId.value = null;
            currentTab.value = 'daftar-pr';
        };
        // Dipake di @click tombol Edit/View tiap baris PR -- href-nya udah nunjuk ke #edit-pr/<id>
        // (lihat markup di index.html), sama kayak goToTab: klik kiri polos pindah di halaman yang
        // sama, Ctrl/Cmd/Shift+klik / klik kanan "Buka di tab baru" dibiarin jalan normal ke href-nya.
        const goToEditPR = (e, pr) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            openEditPR(pr);
        };
        // Kalo #hash di URL nunjuk ke "edit-pr/<id>" yang valid (misal dibuka dari link "Buka di
        // tab baru"), langsung buka Detail PR itu. Dipanggil abis fetchData() -- butuh prs.value
        // udah keisi dulu, soalnya PR-nya dicari dari situ.
        const tryOpenPRFromHash = () => {
            const h = (window.location.hash || '').replace('#', '');
            const m = h.match(/^edit-pr\/(\d+)$/);
            if (!m) return false;
            const pr = prs.value.find(p => p.id === Number(m[1]));
            if (pr) { openEditPR(pr); return true; }
            return false;
        };

        // "Sentuh" PR induk -- update updated_at/updated_by-nya ke sekarang & user yang lagi
        // login. Dipanggil abis tiap perubahan ke PR (item ditambah/diubah/dihapus, approve,
        // reject), biar box "Information" di Detail PR nunjukin siapa & kapan terakhir ngedit.
        // Silent (gak toast kalo gagal) -- ini metadata pelengkap, bukan aksi utamanya.
        const touchPR = async (prId) => {
            await supabaseClient.from('purchase_requests').update({
                updated_at: new Date().toISOString(),
                updated_by: userEmail.value
            }).eq('id', prId);
        };

        // Nambah item baru ke PR yang lagi di-review -- LANGSUNG kesimpen ke DB (auto-save),
        // gak pake tombol "Simpan" terpisah, soalnya PR-nya emang udah ada/tersimpan.
        const addItemToEditingPR = async () => {
            if (!editingPR.value) return;
            if (!editPRNewItemProductId.value) { toast('Pilih barang dulu ya.', 'warn'); return; }
            if (!editPRNewItemQty.value || editPRNewItemQty.value <= 0) { toast('Isi jumlah dulu ya (harus lebih dari 0).', 'warn'); return; }
            const product = masterProducts.value.find(p => p.id === editPRNewItemProductId.value);
            if (!product) return;
            const displayName = product.unit ? `${product.name} (${product.unit})` : product.name;
            if (editPRItems.value.some(it => it.item_name === displayName)) {
                toast('Item ini udah ada di PR ini.', 'warn');
                return;
            }
            const { error } = await supabaseClient.from('purchase_request_items').insert({
                pr_id: editingPR.value.id,
                item_name: displayName,
                qty: editPRNewItemQty.value
            });
            if (error) { toast('Gagal nambah item: ' + error.message, 'error'); return; }
            editPRNewItemProductId.value = '';
            editPRNewItemQty.value = null;
            await touchPR(editingPR.value.id);
            await fetchData();
        };

        // Ubah qty item yang udah ada -- auto-save langsung begitu diubah
        const updateEditingPRItemQty = async (item) => {
            const qty = Number(item.qty) || 1;
            const { error } = await supabaseClient.from('purchase_request_items').update({ qty }).eq('id', item.id);
            if (error) toast('Gagal update jumlah: ' + error.message, 'error');
            if (editingPR.value) await touchPR(editingPR.value.id);
            await fetchData();
        };

        const removeItemFromEditingPR = async (itemId) => {
            if (!(await confirmDialog('Hapus item ini dari PR?', { danger: true, confirmLabel: 'Ya, Hapus' }))) return;
            const { error } = await supabaseClient.from('purchase_request_items').delete().eq('id', itemId);
            if (error) { toast('Gagal hapus item: ' + error.message, 'error'); return; }
            if (editingPR.value) await touchPR(editingPR.value.id);
            await fetchData();
        };

        const approvePR = async (id) => {
            if (!(await confirmDialog('Approve PR ini dan rilis PO?', { confirmLabel: 'Ya, Approve' }))) return;

            const { error: updateError } = await supabaseClient.from('purchase_requests').update({
                status: 'Approved',
                updated_at: new Date().toISOString(),
                updated_by: userEmail.value
            }).eq('id', id);
            if (updateError) {
                toast('Gagal approve PR: ' + updateError.message, 'error');
                return;
            }

            try {
                const poNumber = await generateNumber('PO');
                const { error: poError } = await supabaseClient.from('purchase_orders').insert({
                    po_number: poNumber,
                    pr_id: id,
                    created_by: userEmail.value
                });
                if (poError) toast('PR ke-approve, tapi gagal bikin PO: ' + poError.message, 'error');
            } catch (err) {
                toast('PR ke-approve, tapi gagal bikin PO: ' + err.message, 'error');
            }

            editingPRId.value = null;
            currentTab.value = 'daftar-pr';
            fetchData();
        };

        const rejectPR = async (id) => {
            if (!(await confirmDialog('Yakin mau menolak PR ini?', { danger: true, confirmLabel: 'Ya, Tolak' }))) return;
            const { error } = await supabaseClient.from('purchase_requests').update({
                status: 'Rejected',
                updated_at: new Date().toISOString(),
                updated_by: userEmail.value
            }).eq('id', id);
            if (error) toast('Gagal menolak PR: ' + error.message, 'error');
            editingPRId.value = null;
            currentTab.value = 'daftar-pr';
            fetchData();
        };

        // UPLOAD EXCEL -- parse langsung di browser pake SheetJS, gak lewat backend sama sekali
        const handleFileUpload = async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            isLoading.value = true;
            try {
                const buffer = await file.arrayBuffer();
                const workbook = XLSX.read(buffer, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                if (rows.length === 0) {
                    toast('File Excel kosong!', 'warn');
                    return;
                }

                const nameCol = findCol(rows[0], 'Branch Name', 'branch_name');
                if (!nameCol) {
                    toast(`Gagal! Kolom nama cabang tidak ditemukan. Kolom yang kebaca: ${Object.keys(rows[0]).join(', ')}`, 'error');
                    return;
                }
                const codeCol = findCol(rows[0], 'Branch Code', 'branch_code');

                const payload = rows
                    .map((row) => {
                        const branch_name = String(row[nameCol] ?? '').trim();
                        return {
                            branch_name,
                            branch_code: codeCol ? String(row[codeCol] ?? '').trim() : '',
                            brand: deriveBrandFromBranchName(branch_name)
                        };
                    })
                    .filter((r) => r.branch_name && r.branch_name.toLowerCase() !== 'nan');

                if (payload.length === 0) {
                    toast('Gak ada baris valid buat diimport.', 'warn');
                    return;
                }

                // upsert + ignoreDuplicates biar cabang yang udah ada gak bikin gagal semua batch
                const { error } = await supabaseClient
                    .from('master_branches')
                    .upsert(payload, { onConflict: 'branch_name', ignoreDuplicates: true });

                if (error) {
                    toast('Gagal upload: ' + error.message, 'error');
                    return;
                }

                toast(`Berhasil diproses ${payload.length} baris cabang!`, 'success');
                fetchData();
            } catch (err) {
                console.error(err);
                toast('Gagal memproses file Excel.', 'error');
            } finally {
                isLoading.value = false;
                event.target.value = '';
            }
        };

        // ============================================================
        // EDIT & HAPUS -- MASTER BRANCH (Master only, dicek juga sama RLS di DB)
        // ============================================================
        const toggleBranchSelect = (id) => {
            const idx = selectedBranchIds.value.indexOf(id);
            if (idx === -1) selectedBranchIds.value.push(id);
            else selectedBranchIds.value.splice(idx, 1);
        };
        const toggleSelectAllBranches = () => {
            selectedBranchIds.value = allBranchesSelected.value ? [] : filteredBranches.value.map(b => b.id);
        };
        const startEditBranch = (b) => {
            editingProductId.value = null; // tutup edit produk kalo lagi kebuka
            editingBranchId.value = b.id;
            editBranchForm.value = { branch_name: b.branch_name, branch_code: b.branch_code || '', brand: b.brand || '' };
        };
        const cancelEditBranch = () => { editingBranchId.value = null; };
        const saveEditBranch = async (id) => {
            if (!editBranchForm.value.branch_name.trim()) { toast('Nama cabang gak boleh kosong.', 'warn'); return; }
            const { error } = await supabaseClient
                .from('master_branches')
                .update({
                    branch_name: editBranchForm.value.branch_name.trim(),
                    branch_code: editBranchForm.value.branch_code.trim(),
                    brand: editBranchForm.value.brand || null
                })
                .eq('id', id);
            if (error) {
                toast('Gagal simpan: ' + error.message, 'error');
                return;
            }
            editingBranchId.value = null;
            fetchData();
        };
        const deleteBranches = async (ids) => {
            if (ids.length === 0) return;
            if (!(await confirmDialog(`Yakin mau hapus ${ids.length} cabang ini? Gak bisa di-undo.`, { danger: true, confirmLabel: 'Ya, Hapus' }))) return;
            const { error } = await supabaseClient.from('master_branches').delete().in('id', ids);
            if (error) {
                toast('Gagal hapus: ' + error.message, 'error');
                return;
            }
            selectedBranchIds.value = selectedBranchIds.value.filter(id => !ids.includes(id));
            fetchData();
        };

        // ============================================================
        // EDIT & HAPUS -- MASTER PRODUCT (Master only, dicek juga sama RLS di DB)
        // ============================================================
        const toggleProductSelect = (id) => {
            const idx = selectedProductIds.value.indexOf(id);
            if (idx === -1) selectedProductIds.value.push(id);
            else selectedProductIds.value.splice(idx, 1);
        };
        const toggleSelectAllProducts = () => {
            selectedProductIds.value = allProductsSelected.value ? [] : filteredProducts.value.map(p => p.id);
        };
        const startEditProduct = (p) => {
            editingBranchId.value = null; // tutup edit cabang kalo lagi kebuka
            editingProductId.value = p.id;
            editProductForm.value = { name: p.name, unit: p.unit || '', brand: p.brand || '' };
        };
        const cancelEditProduct = () => { editingProductId.value = null; };
        const saveEditProduct = async (id) => {
            if (!editProductForm.value.name.trim()) { toast('Nama produk gak boleh kosong.', 'warn'); return; }
            const { error } = await supabaseClient
                .from('master_products')
                .update({
                    name: editProductForm.value.name.trim(),
                    unit: editProductForm.value.unit.trim() || null,
                    brand: editProductForm.value.brand || null
                })
                .eq('id', id);
            if (error) {
                toast('Gagal simpan: ' + error.message, 'error');
                return;
            }
            editingProductId.value = null;
            fetchData();
        };
        const deleteProducts = async (ids) => {
            if (ids.length === 0) return;
            if (!(await confirmDialog(`Yakin mau hapus ${ids.length} produk ini? Gak bisa di-undo.`, { danger: true, confirmLabel: 'Ya, Hapus' }))) return;
            const { error } = await supabaseClient.from('master_products').delete().in('id', ids);
            if (error) {
                toast('Gagal hapus: ' + error.message, 'error');
                return;
            }
            selectedProductIds.value = selectedProductIds.value.filter(id => !ids.includes(id));
            fetchData();
        };

        // Kalau session Supabase masih ada (misal habis refresh halaman), langsung login otomatis
        // (brand mismatch gak perlu dicek ulang di sini karena session ini emang udah lolos validasi pas login pertama)
        onMounted(async () => {
            // Balikin brand yang terakhir dibuka (penting buat Master, yang gak kekunci
            // brand-nya di database -- tanpa ini, refresh halaman bakal balik ngeliat semua brand lagi)
            try {
                const savedBrand = localStorage.getItem('activeBrandChoice');
                if (savedBrand) selectedBrand.value = savedBrand;
            } catch (e) {}

            let { data: { session } } = await supabaseClient.auth.getSession();

            // Tab ini belom punya sesi sendiri (sessionStorage-nya kosong) -- coba minta ke tab
            // lain yang mungkin masih login (kasus paling umum: tab ini abis kebuka dari klik-kanan
            // "Buka di tab baru" di sidebar/tombol Edit).
            if (!session) {
                const shared = await requestSessionFromOtherTabs();
                if (shared?.access_token && shared?.refresh_token) {
                    const { data, error } = await supabaseClient.auth.setSession({
                        access_token: shared.access_token,
                        refresh_token: shared.refresh_token
                    });
                    if (!error) session = data.session;
                }
            }

            if (session?.user?.email) {
                const { role, brand } = await fetchRoleAndBrand(session.user.email);
                isLoggedIn.value = true;
                userEmail.value = session.user.email.split('@')[0];
                userRole.value = role;
                userBrand.value = brand;
                restoreLastTab(role); // <-- ini yang bikin tetep stay di tab yang sama pas refresh
                startIdleWatcher();
                await fetchData();
                // Baru dicek ABIS fetchData selesai -- kalo hash-nya nunjuk ke Detail PR spesifik
                // (#edit-pr/<id>) yang valid, ini nimpa balik tab yang barusan dibalikin restoreLastTab().
                tryOpenPRFromHash();
            }

            // Jaga-jaga: kalo user ngetik/ganti #hash manual di address bar pas udah login
            // (bukan lewat klik sidebar/tombol Edit), ikutin pindah ke tab yang sesuai.
            window.addEventListener('hashchange', () => {
                if (!isLoggedIn.value) return;
                if (tryOpenPRFromHash()) return;
                const hashTab = tabFromHash();
                if (hashTab && (hashTab !== 'master-hub' || userRole.value === 'Master')) {
                    currentTab.value = hashTab;
                }
            });
        });

        return {
            toasts, dismissToast, confirmState, resolveConfirm,
            isLoggedIn, userEmail, userRole, loginForm, loginError, sessionExpiredMessage, isLoading, handleLogin, handleLogout,
            selectedBrand, userBrand, activeBrand, backToBrandPicker,
            currentTab, goToTab, prs, pos, prItems, itemsByPrId, form, pendingPRs, filteredPRs, brandPRs, brandPOs, filteredPOs, filterStatus,
            donutTotal, donutSegments, donutLabelSegments, expiringSoonPRs, topItemsByPOCount, topItemsByQtyCount,
            dashBranchFilter, dashDateRange,
            prFilterShipping, poFilterShipping, SHIPPING_FILTER_OPTIONS,
            prSortField, prSortDir, poSortField, poSortDir, toggleSortPR, toggleSortPO,
            prDateRange, poDateRange,
            prSearchField, prSearchFieldLabel, PR_SEARCH_FIELDS, searchQuery, prBranchFilter,
            poSearchField, poSearchFieldLabel, PO_SEARCH_FIELDS, poSearchQuery, poBranchFilter,
            masterBranches, masterProducts, brandBranches, brandProducts, branchOptions, productOptions, STATUS_OPTIONS,
            SHIPPING_CATEGORY_OPTIONS, shippingCategoryOptions, PIC_OPTIONS, newItemProductId, newItemQty, addFormItem, removeFormItem, openBuatPR, cancelBuatPR,
            editingFormItemIdx, editFormItemProductId, editFormItemQty, startEditFormItem, cancelEditFormItem, saveEditFormItem,
            editingPR, editPRNewItemProductId, editPRNewItemQty, editPRItems, canEditPR,
            openEditPR, goToEditPR, backFromEditPR, addItemToEditingPR, updateEditingPRItemQty, removeItemFromEditingPR,
            viewingPO, viewingPOItems, openViewPO, backFromViewPO,
            branchSearchQuery, filteredBranches, productSearchQuery, filteredProducts,
            handleFileUpload, handleProductFileUpload,
            editingBranchId, editBranchForm, selectedBranchIds, allBranchesSelected,
            toggleBranchSelect, toggleSelectAllBranches, startEditBranch, cancelEditBranch, saveEditBranch, deleteBranches,
            editingProductId, editProductForm, selectedProductIds, allProductsSelected,
            toggleProductSelect, toggleSelectAllProducts, startEditProduct, cancelEditProduct, saveEditProduct, deleteProducts,
            formatRp, formatDate, formatDateTime, submitPR, approvePR, rejectPR
        };
    }
})
    .component('searchable-select', SearchableSelect)
    .component('multi-select', MultiSelectDropdown)
    .component('date-range-filter', DateRangeFilter)
    .component('date-picker-field', DatePickerField)
    .directive('stickyroll', stickyrollDirective)
    .mount('#app');