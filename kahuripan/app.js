const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

// ============================================================
// KONFIGURASI SUPABASE -- GANTI 2 BARIS INI
// Ambil dari: Supabase Dashboard > Project Settings > API
// PAKE "anon" "public" key -- JANGAN PERNAH pake service_role di sini,
// soalnya file JS ini kebaca semua orang yang buka website-nya.
// ============================================================
const SUPABASE_URL = "https://onruaqagzmeiyvpvjhve.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ucnVhcWFnem1laXl2cHZqaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NTAsImV4cCI6MjEwNDQyOTg1MH0._LF6NqW1uvcz2lq-d8LY2GOcyUak7M592wNhA7uG7Rk";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Bikin nomor PR/PO dinamis, format sama kayak sebelumnya: PREFIX-2026-HHMMSS
function generateNumber(prefix) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${prefix}-2026-${hh}${mm}${ss}`;
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
        placeholder: { type: String, default: '-- Pilih --' }
    },
    emits: ['update:modelValue'],
    template: `
        <div class="ss-wrap" ref="wrapEl">
            <div class="ss-control" :class="{ open: isOpen }" tabindex="0"
                 @click="toggleOpen" @keydown.enter.prevent="toggleOpen" @keydown.esc="closeDropdown">
                <span :class="{ 'ss-placeholder': !selectedLabel }">{{ selectedLabel || placeholder }}</span>
                <i class="bi" :class="isOpen ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
            </div>
            <div v-if="isOpen" class="ss-panel">
                <div class="ss-search" @click.stop>
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
            if (!searchQuery.value) return props.options;
            const q = searchQuery.value.toLowerCase();
            return props.options.filter(o => String(o.label).toLowerCase().includes(q));
        });

        const closeDropdown = () => { isOpen.value = false; };
        const toggleOpen = () => {
            isOpen.value = !isOpen.value;
            if (isOpen.value) {
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

// Opsi tetap buat dropdown filter status di Daftar PR
const STATUS_OPTIONS = [
    { value: '', label: 'All Status' },
    { value: 'Pending', label: 'Pending' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Rejected', label: 'Rejected' }
];

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

        // Bersihin semua state login (dipake bareng sama expiry maupun logout manual)
        const clearSessionState = () => {
            isLoggedIn.value = false;
            userEmail.value = '';
            userRole.value = '';
            userBrand.value = null;
            loginForm.value = { email: '', password: '' };
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
        // Simpen tab yang lagi dibuka biar refresh halaman gak balik ke Dashboard lagi
        watch(currentTab, (val) => {
            try { localStorage.setItem('lastActiveTab', val); } catch (e) {}
        });
        // Balikin tab terakhir, tapi tolak tab Master Data kalo role-nya bukan Master
        // (jaga-jaga di browser bareng: akun Master abis buka Master Data, logout,
        // akun AM login di browser yang sama -- jangan sampe ke-lempar ke tab itu)
        const restoreLastTab = (role) => {
            try {
                const saved = localStorage.getItem('lastActiveTab');
                if (saved && (!saved.startsWith('master') || role === 'Master')) {
                    currentTab.value = saved;
                }
            } catch (e) {}
        };
        const prs = ref([]);
        const pos = ref([]);
        const masterBranches = ref([]);
        const masterProducts = ref([]);

        const form = ref({ branch_name: '', required_date: '', item: '', qty: 1, price: 0, notes: '' });
        const searchQuery = ref('');
        const filterStatus = ref('');
        const branchSearchQuery = ref('');
        const productSearchQuery = ref('');

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
        const filteredPRs = computed(() => {
            let result = brandPRs.value;
            if (filterStatus.value) result = result.filter(pr => pr.status === filterStatus.value);
            if (searchQuery.value) {
                const query = searchQuery.value.toLowerCase();
                result = result.filter(pr => pr.pr_number.toLowerCase().includes(query));
            }
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

        const fetchData = async () => {
            try {
                const [prRes, poRes, branchRes, productRes] = await Promise.all([
                    supabaseClient.from('purchase_requests').select('*').order('created_at', { ascending: false }),
                    supabaseClient.from('purchase_orders').select('*, purchase_requests(pr_number, item_name, qty, total_price, brand)').order('created_at', { ascending: false }),
                    supabaseClient.from('master_branches').select('*').order('branch_name'),
                    supabaseClient.from('master_products').select('*').order('name'),
                ]);
                prs.value = prRes.data || [];
                pos.value = poRes.data || [];
                masterBranches.value = branchRes.data || [];
                masterProducts.value = productRes.data || [];
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
                    alert('File Excel kosong!');
                    return;
                }

                const nameCol = findCol(rows[0], 'Product Name', 'product_name', 'name', 'nama_produk', 'nama produk');
                if (!nameCol) {
                    alert(`Gagal! Kolom nama produk tidak ditemukan. Kolom yang kebaca: ${Object.keys(rows[0]).join(', ')}`);
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
                    alert('Gak ada baris valid buat diimport.');
                    return;
                }

                const { error } = await supabaseClient
                    .from('master_products')
                    .upsert(payload, { onConflict: 'name,unit', ignoreDuplicates: true });

                if (error) {
                    alert('Gagal upload: ' + error.message);
                    return;
                }

                alert(`Berhasil diproses ${payload.length} baris produk!`);
                fetchData();
            } catch (err) {
                console.error(err);
                alert('Gagal memproses file Excel.');
            } finally {
                isLoading.value = false;
                event.target.value = '';
            }
        };

        const submitPR = async () => {
            // Validasi manual -- dropdown Cabang & Barang sekarang komponen custom
            // (SearchableSelect), bukan <select required> asli, jadi validasi HTML5 gak jalan
            if (!form.value.branch_name) { alert('Pilih cabang dulu ya.'); return; }
            if (!form.value.item) { alert('Pilih barang/item dulu ya.'); return; }
            try {
                const totalPrice = (form.value.qty || 0) * (form.value.price || 0);
                // Brand PR ini ngikut brand cabang yang dipilih (bukan brand user, biar Master
                // yang bisa akses semua brand tetep ke-tag PR-nya dengan bener)
                const matchedBranch = masterBranches.value.find(b => b.branch_name === form.value.branch_name);
                const prBrand = matchedBranch?.brand || deriveBrandFromBranchName(form.value.branch_name);

                // form.item sekarang nyimpen ID produk (bukan nama), soalnya nama produk bisa
                // dobel kalo unit-nya beda (misal "Air Mineral 220ml" Carton vs pcs)
                const matchedProduct = masterProducts.value.find(p => p.id === form.value.item);
                const itemName = matchedProduct
                    ? (matchedProduct.unit ? `${matchedProduct.name} (${matchedProduct.unit})` : matchedProduct.name)
                    : form.value.item;

                const { error } = await supabaseClient.from('purchase_requests').insert({
                    pr_number: generateNumber('PR'),
                    branch_name: form.value.branch_name,
                    item_name: itemName,
                    qty: form.value.qty,
                    price: form.value.price,
                    total_price: totalPrice,
                    required_date: form.value.required_date || null,
                    notes: form.value.notes,
                    brand: prBrand,
                    status: 'Pending'
                });

                if (error) {
                    alert('Gagal submit PR: ' + error.message);
                    return;
                }

                form.value = { branch_name: '', required_date: '', item: '', qty: 1, price: 0, notes: '' };
                await fetchData();
                currentTab.value = 'daftar-pr';
            } catch (err) {
                alert('Gagal submit PR');
            }
        };

        const approvePR = async (id) => {
            if (!confirm('Approve PR ini dan rilis PO?')) return;

            const { error: updateError } = await supabaseClient.from('purchase_requests').update({ status: 'Approved' }).eq('id', id);
            if (updateError) {
                alert('Gagal approve PR: ' + updateError.message);
                return;
            }

            const { error: poError } = await supabaseClient.from('purchase_orders').insert({
                po_number: generateNumber('PO'),
                pr_id: id
            });
            if (poError) alert('PR ke-approve, tapi gagal bikin PO: ' + poError.message);

            fetchData();
        };

        const rejectPR = async (id) => {
            if (!confirm('Yakin mau menolak PR ini?')) return;
            const { error } = await supabaseClient.from('purchase_requests').update({ status: 'Rejected' }).eq('id', id);
            if (error) alert('Gagal menolak PR: ' + error.message);
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
                    alert('File Excel kosong!');
                    return;
                }

                const nameCol = findCol(rows[0], 'Branch Name', 'branch_name');
                if (!nameCol) {
                    alert(`Gagal! Kolom nama cabang tidak ditemukan. Kolom yang kebaca: ${Object.keys(rows[0]).join(', ')}`);
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
                    alert('Gak ada baris valid buat diimport.');
                    return;
                }

                // upsert + ignoreDuplicates biar cabang yang udah ada gak bikin gagal semua batch
                const { error } = await supabaseClient
                    .from('master_branches')
                    .upsert(payload, { onConflict: 'branch_name', ignoreDuplicates: true });

                if (error) {
                    alert('Gagal upload: ' + error.message);
                    return;
                }

                alert(`Berhasil diproses ${payload.length} baris cabang!`);
                fetchData();
            } catch (err) {
                console.error(err);
                alert('Gagal memproses file Excel.');
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
            if (!editBranchForm.value.branch_name.trim()) { alert('Nama cabang gak boleh kosong.'); return; }
            const { error } = await supabaseClient
                .from('master_branches')
                .update({
                    branch_name: editBranchForm.value.branch_name.trim(),
                    branch_code: editBranchForm.value.branch_code.trim(),
                    brand: editBranchForm.value.brand || null
                })
                .eq('id', id);
            if (error) {
                alert('Gagal simpan: ' + error.message);
                return;
            }
            editingBranchId.value = null;
            fetchData();
        };
        const deleteBranches = async (ids) => {
            if (ids.length === 0) return;
            if (!confirm(`Yakin mau hapus ${ids.length} cabang ini? Gak bisa di-undo.`)) return;
            const { error } = await supabaseClient.from('master_branches').delete().in('id', ids);
            if (error) {
                alert('Gagal hapus: ' + error.message);
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
            if (!editProductForm.value.name.trim()) { alert('Nama produk gak boleh kosong.'); return; }
            const { error } = await supabaseClient
                .from('master_products')
                .update({
                    name: editProductForm.value.name.trim(),
                    unit: editProductForm.value.unit.trim() || null,
                    brand: editProductForm.value.brand || null
                })
                .eq('id', id);
            if (error) {
                alert('Gagal simpan: ' + error.message);
                return;
            }
            editingProductId.value = null;
            fetchData();
        };
        const deleteProducts = async (ids) => {
            if (ids.length === 0) return;
            if (!confirm(`Yakin mau hapus ${ids.length} produk ini? Gak bisa di-undo.`)) return;
            const { error } = await supabaseClient.from('master_products').delete().in('id', ids);
            if (error) {
                alert('Gagal hapus: ' + error.message);
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

            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session?.user?.email) {
                const { role, brand } = await fetchRoleAndBrand(session.user.email);
                isLoggedIn.value = true;
                userEmail.value = session.user.email.split('@')[0];
                userRole.value = role;
                userBrand.value = brand;
                restoreLastTab(role); // <-- ini yang bikin tetep stay di tab yang sama pas refresh
                startIdleWatcher();
                fetchData();
            }
        });

        return {
            isLoggedIn, userEmail, userRole, loginForm, loginError, sessionExpiredMessage, isLoading, handleLogin, handleLogout,
            selectedBrand, userBrand, activeBrand, backToBrandPicker,
            currentTab, prs, pos, form, pendingPRs, filteredPRs, brandPRs, brandPOs, searchQuery, filterStatus,
            masterBranches, masterProducts, brandBranches, brandProducts, branchOptions, productOptions, STATUS_OPTIONS,
            branchSearchQuery, filteredBranches, productSearchQuery, filteredProducts,
            handleFileUpload, handleProductFileUpload,
            editingBranchId, editBranchForm, selectedBranchIds, allBranchesSelected,
            toggleBranchSelect, toggleSelectAllBranches, startEditBranch, cancelEditBranch, saveEditBranch, deleteBranches,
            editingProductId, editProductForm, selectedProductIds, allProductsSelected,
            toggleProductSelect, toggleSelectAllProducts, startEditProduct, cancelEditProduct, saveEditProduct, deleteProducts,
            formatRp, formatDate, submitPR, approvePR, rejectPR
        };
    }
})
    .component('searchable-select', SearchableSelect)
    .mount('#app');