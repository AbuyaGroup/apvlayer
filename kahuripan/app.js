const { createApp, ref, computed, onMounted } = Vue;

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

createApp({
    setup() {
        // STATE AUTENTIKASI
        const isLoggedIn = ref(false);
        const userEmail = ref('');
        const userRole = ref('');
        const loginForm = ref({ email: '', password: '' });
        const loginError = ref('');
        const isLoading = ref(false);

        // STATE BRAND -- selectedBrand = brand yang dipilih di layar sebelum login
        // userBrand = brand ASLI yang nempel di akun (dari user_roles), null = Master (bebas semua brand)
        const selectedBrand = ref('');
        const userBrand = ref(null);
        const backToBrandPicker = () => {
            selectedBrand.value = '';
            loginError.value = '';
        };

        const currentTab = ref('dashboard');
        const prs = ref([]);
        const pos = ref([]);
        const masterBranches = ref([]);
        const masterProducts = ref([]);

        const form = ref({ branch_name: '', required_date: '', item: '', qty: 1, price: 0, notes: '' });
        const searchQuery = ref('');
        const filterStatus = ref('');
        const branchSearchQuery = ref('');
        const productSearchQuery = ref('');

        const pendingPRs = computed(() => prs.value.filter(pr => pr.status === 'Pending'));
        const filteredPRs = computed(() => {
            let result = prs.value;
            if (filterStatus.value) result = result.filter(pr => pr.status === filterStatus.value);
            if (searchQuery.value) {
                const query = searchQuery.value.toLowerCase();
                result = result.filter(pr => pr.pr_number.toLowerCase().includes(query));
            }
            return result;
        });

        const filteredBranches = computed(() => {
            if (!branchSearchQuery.value) return masterBranches.value;
            const query = branchSearchQuery.value.toLowerCase();
            return masterBranches.value.filter(b => (b.branch_name || '').toLowerCase().includes(query));
        });

        const filteredProducts = computed(() => {
            if (!productSearchQuery.value) return masterProducts.value;
            const query = productSearchQuery.value.toLowerCase();
            return masterProducts.value.filter(p => (p.name || '').toLowerCase().includes(query));
        });

        // Dropdown cabang pas Buat PR -- AM cuma liat cabang brand-nya sendiri, Master liat semua
        const brandBranches = computed(() => {
            if (!userBrand.value) return masterBranches.value;
            return masterBranches.value.filter(b => b.brand === userBrand.value);
        });

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
                    await supabaseClient.auth.signOut();
                    loginError.value = `Akun ini gak punya akses ke brand "${selectedBrand.value}".`;
                    return;
                }

                isLoggedIn.value = true;
                userEmail.value = usernameInput;
                userRole.value = role;
                userBrand.value = brand;
                await fetchData();
            } catch (err) {
                console.error('Error login:', err);
                loginError.value = 'Gagal terhubung ke Supabase.';
            } finally {
                isLoading.value = false;
            }
        };

        const handleLogout = async () => {
            await supabaseClient.auth.signOut();
            isLoggedIn.value = false;
            userEmail.value = '';
            userRole.value = '';
            userBrand.value = null;
            loginForm.value = { email: '', password: '' };
            currentTab.value = 'dashboard';
        };

        const fetchData = async () => {
            try {
                const [prRes, poRes, branchRes, productRes] = await Promise.all([
                    supabaseClient.from('purchase_requests').select('*').order('created_at', { ascending: false }),
                    supabaseClient.from('purchase_orders').select('*, purchase_requests(pr_number, item_name, qty, total_price)').order('created_at', { ascending: false }),
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

                const payload = rows
                    .map((row) => ({ name: String(row[nameCol] ?? '').trim() }))
                    .filter((r) => r.name && r.name.toLowerCase() !== 'nan');

                if (payload.length === 0) {
                    alert('Gak ada baris valid buat diimport.');
                    return;
                }

                const { error } = await supabaseClient
                    .from('master_products')
                    .upsert(payload, { onConflict: 'name', ignoreDuplicates: true });

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
            try {
                const totalPrice = (form.value.qty || 0) * (form.value.price || 0);
                // Brand PR ini ngikut brand cabang yang dipilih (bukan brand user, biar Master
                // yang bisa akses semua brand tetep ke-tag PR-nya dengan bener)
                const matchedBranch = masterBranches.value.find(b => b.branch_name === form.value.branch_name);
                const prBrand = matchedBranch?.brand || deriveBrandFromBranchName(form.value.branch_name);

                const { error } = await supabaseClient.from('purchase_requests').insert({
                    pr_number: generateNumber('PR'),
                    branch_name: form.value.branch_name,
                    item_name: form.value.item,
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

        // Kalau session Supabase masih ada (misal habis refresh halaman), langsung login otomatis
        // (brand mismatch gak perlu dicek ulang di sini karena session ini emang udah lolos validasi pas login pertama)
        onMounted(async () => {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session?.user?.email) {
                const { role, brand } = await fetchRoleAndBrand(session.user.email);
                isLoggedIn.value = true;
                userEmail.value = session.user.email.split('@')[0];
                userRole.value = role;
                userBrand.value = brand;
                fetchData();
            }
        });

        return {
            isLoggedIn, userEmail, userRole, loginForm, loginError, isLoading, handleLogin, handleLogout,
            selectedBrand, userBrand, backToBrandPicker,
            currentTab, prs, pos, form, pendingPRs, filteredPRs, searchQuery, filterStatus,
            masterBranches, masterProducts, brandBranches,
            branchSearchQuery, filteredBranches, productSearchQuery, filteredProducts,
            handleFileUpload, handleProductFileUpload,
            formatRp, formatDate, submitPR, approvePR, rejectPR
        };
    }
}).mount('#app');
