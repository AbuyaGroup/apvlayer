const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

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

const confirmState = ref(null);
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

const SUPABASE_URL = "https://onruaqagzmeiyvpvjhve.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ucnVhcWFnem1laXl2cHZqaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NTAsImV4cCI6MjEwNDQyOTg1MH0._LF6NqW1uvcz2lq-d8LY2GOcyUak7M592wNhA7uG7Rk";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: window.sessionStorage }
});

const CREATE_USER_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/create-user`;
const DELETE_USER_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/delete-user`;

async function generateNumber(prefix) {
    const { data, error } = await supabaseClient.rpc('generate_doc_number', { p_prefix: prefix });
    if (error) throw error;
    return data;
}

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

function deriveBrandFromBranchName(branchName) {
    const n = String(branchName || '').toLowerCase();
    if (n.includes('almaz')) return 'Almaz Fried Chicken';
    if (n.includes('kebuli')) return 'Kebuli Abuya';
    return null;
}

const SESSION_TIMEOUT_MINUTES = 30;
const SESSION_HEARTBEAT_INTERVAL_MS = 30000;
const SESSION_STALE_THRESHOLD_SECONDS = 180;

const SearchableSelect = {
    props: {
        modelValue: { default: '' },
        options: { type: Array, default: () => [] },
        placeholder: { type: String, default: '-- Pilih --' },
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
                <div v-if="isOpen" class="ss-panel" :style="panelStyle">
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
        const panelStyle = ref({});

        const selectedLabel = computed(() => {
            const found = props.options.find(o => o.value === props.modelValue);
            return found ? found.label : '';
        });

        const filteredOptions = computed(() => {
            if (!props.searchable || !searchQuery.value) return props.options;
            const q = searchQuery.value.toLowerCase();
            return props.options.filter(o => String(o.label).toLowerCase().includes(q));
        });

        const updatePanelPosition = () => {
            if (!wrapEl.value) return;
            const rect = wrapEl.value.getBoundingClientRect();
            panelStyle.value = {
                position: 'fixed',
                top: (rect.bottom + 6) + 'px',
                left: rect.left + 'px',
                width: rect.width + 'px'
            };
        };

        const closeDropdown = () => { isOpen.value = false; };
        const toggleOpen = () => {
            isOpen.value = !isOpen.value;
            if (isOpen.value) {
                updatePanelPosition();
                if (props.searchable) {
                    searchQuery.value = '';
                    nextTick(() => searchInput.value && searchInput.value.focus({ preventScroll: true }));
                }
            }
        };
        const selectOption = (opt) => {
            emit('update:modelValue', opt.value);
            closeDropdown();
        };

        const handleClickOutside = (e) => {
            if (wrapEl.value && !wrapEl.value.contains(e.target)) closeDropdown();
        };
        const handleScrollOrResize = (e) => {
            if (!isOpen.value) return;
            if (e && e.target && wrapEl.value && wrapEl.value.contains(e.target)) return;
            closeDropdown();
        };
        onMounted(() => {
            document.addEventListener('click', handleClickOutside);
            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);
        });
        onUnmounted(() => {
            document.removeEventListener('click', handleClickOutside);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        });

        return { isOpen, searchQuery, wrapEl, searchInput, panelStyle, selectedLabel, filteredOptions, toggleOpen, closeDropdown, selectOption };
    }
};

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
                <div v-if="isOpen" class="ss-panel" :style="panelStyle" @click.stop>
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
        const pending = ref([...props.modelValue]);
        const panelStyle = ref({});

        const labelFor = (v) => {
            const found = props.options.find(o => o.value === v);
            return found ? found.label : v;
        };

        const summaryLabel = computed(() => {
            if (props.modelValue.length === 0) return props.placeholder;
            if (props.modelValue.length === 1) return labelFor(props.modelValue[0]);
            return props.modelValue.length + ' dipilih';
        });

        const filteredOptions = computed(() => {
            if (!searchQuery.value) return props.options;
            const q = searchQuery.value.toLowerCase();
            return props.options.filter(o => String(o.label).toLowerCase().includes(q));
        });

        const updatePanelPosition = () => {
            if (!wrapEl.value) return;
            const rect = wrapEl.value.getBoundingClientRect();
            panelStyle.value = {
                position: 'fixed',
                top: (rect.bottom + 6) + 'px',
                left: rect.left + 'px',
                width: rect.width + 'px'
            };
        };

        const closeDropdown = () => { isOpen.value = false; };
        const toggleOpen = () => {
            isOpen.value = !isOpen.value;
            if (isOpen.value) {
                updatePanelPosition();
                pending.value = [...props.modelValue];
                searchQuery.value = '';
                nextTick(() => searchInput.value && searchInput.value.focus({ preventScroll: true }));
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
        const handleScrollOrResize = (e) => {
            if (!isOpen.value) return;
            if (e && e.target && wrapEl.value && wrapEl.value.contains(e.target)) return;
            closeDropdown();
        };
        onMounted(() => {
            document.addEventListener('click', handleClickOutside);
            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);
        });
        onUnmounted(() => {
            document.removeEventListener('click', handleClickOutside);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        });

        return { isOpen, searchQuery, wrapEl, searchInput, pending, panelStyle, summaryLabel, filteredOptions, toggleOpen, closeDropdown, togglePending, clearPending, applyPending };
    }
};

function dateToISO(d) {
    if (!d) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function todayWIB() {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const yyyy = wib.getUTCFullYear();
    const mm = String(wib.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(wib.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function tomorrowWIB() {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
    const yyyy = wib.getUTCFullYear();
    const mm = String(wib.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(wib.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

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

    if (typeof instance._positionCalendar === 'function') {
        instance._positionCalendar();
    }
}

function trimTrailingWeek(instance) {
    if (!instance || !instance.calendarContainer) return;
    const dayContainer = instance.calendarContainer.querySelector('.dayContainer');
    if (!dayContainer) return;
    const days = dayContainer.querySelectorAll('.flatpickr-day');
    if (days.length < 42) return;
    const lastRow = Array.from(days).slice(35, 42);
    const allNextMonth = lastRow.length === 7 && lastRow.every(d => d.classList.contains('nextMonthDay'));
    lastRow.forEach(d => { d.style.display = allNextMonth ? 'none' : ''; });
}


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
                showMonths: 1,
                positionElement: wrapEl.value,
                onReady: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onOpen: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onMonthChange: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onYearChange: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
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
                onMonthChange: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onYearChange: (sd, ds, instance) => { syncFlatpickrWidth(instance, wrapEl.value); trimTrailingWeek(instance); },
                onChange: (selectedDates) => {
                    emit('update:modelValue', selectedDates.length ? dateToISO(selectedDates[0]) : '');
                }
            });
        });
        onUnmounted(() => { if (fp) fp.destroy(); });

        return { inputEl, wrapEl };
    }
};

const STATUS_OPTIONS = [
    { value: '', label: 'All Status' },
    { value: 'Pending', label: 'Pending' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Rejected', label: 'Rejected' },
    { value: 'Expired', label: 'Expired' }
];

const DASHBOARD_STATUS_CONFIG = [
    { key: 'Pending', label: 'Pending', color: '#bd7410', soft: '#dc9a3f', bg: '#fff6e7' },
    { key: 'Approved', label: 'Approved', color: '#117b58', soft: '#3fa889', bg: '#e9f8f2' },
    { key: 'Rejected', label: 'Rejected', color: '#d64157', soft: '#e2707f', bg: '#fff0f2' },
    { key: 'Expired', label: 'Expired', color: '#71809a', soft: '#98a4bb', bg: '#eef1f5' }
];

const SHIPPING_CATEGORY_OPTIONS = [
    { value: 'Direct', label: 'Direct (Distribution Center)' },
    { value: 'Indirect', label: 'Indirect (Vendor)' }
];

const PIC_SHIPPING_SELECT_OPTIONS = [
    { value: 'Direct', label: 'Direct' },
    { value: 'Indirect', label: 'Indirect' }
];

const BRAND_SELECT_OPTIONS = [
    { value: 'Kebuli Abuya', label: 'Kebuli Abuya' },
    { value: 'Almaz Fried Chicken', label: 'Almaz Fried Chicken' }
];

const ROLE_SELECT_OPTIONS = [
    { value: 'SM', label: 'SM (Store Manager)' },
    { value: 'AM', label: 'AM (Area Manager)' },
    { value: 'Master', label: 'Master Layer' }
];

const PR_SEARCH_FIELDS = [
    { value: 'pr_number', label: 'Request Number' },
    { value: 'branch_name', label: 'Branch' },
    { value: 'pic', label: 'PIC' },
    { value: 'notes', label: 'Notes' }
];

const PO_SEARCH_FIELDS = [
    { value: 'po_number', label: 'PO Number' },
    { value: 'pr_number', label: 'PR Reference' },
    { value: 'branch_name', label: 'Branch' },
    { value: 'pic', label: 'PIC' }
];

const SHIPPING_FILTER_OPTIONS = [
    { value: '', label: 'All Shipping' },
    { value: 'Direct', label: 'Direct' },
    { value: 'Indirect', label: 'Indirect' }
];

const STICKYROLL_ROWS = 5;

function measureStickyrollMaxHeight(el) {
    const track = el.querySelector('.stickyroll-track');
    if (!track || track.children.length === 0) return null;
    const n = Math.min(STICKYROLL_ROWS, track.children.length);
    const lastRow = track.children[n - 1];
    return lastRow.offsetTop + lastRow.offsetHeight;
}

const stickyrollDirective = {
    mounted(el, binding) {
        el._srActive = !!binding.value;

        const syncMaxHeight = () => {
            if (!el._srActive) { el.style.maxHeight = ''; return; }
            const h = measureStickyrollMaxHeight(el);
            if (h) el.style.maxHeight = h + 'px';
        };

        const track = el.querySelector('.stickyroll-track');
        el._srRO = new ResizeObserver(() => syncMaxHeight());
        if (track) el._srRO.observe(track);
        syncMaxHeight();
    },
    updated(el, binding) {
        const nowActive = !!binding.value;
        if (!nowActive && el._srActive) { el.scrollTop = 0; el.style.maxHeight = ''; }
        el._srActive = nowActive;
        if (nowActive) {
            const h = measureStickyrollMaxHeight(el);
            if (h) el.style.maxHeight = h + 'px';
        }
    },
    unmounted(el) {
        if (el._srRO) el._srRO.disconnect();
    }
};

const app = createApp({
    setup() {

        const isLoggedIn = ref(false);
        const userEmail = ref('');
        const userRole = ref('');
        const loginForm = ref({ email: '', password: '' });
        const loginError = ref('');
        const sessionExpiredMessage = ref('');
        const isLoading = ref(false);
        const showPassword = ref(false);

        let manualSignOut = false;
        let idleTimer = null;
        let lastActivityAt = Date.now();
        const IDLE_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

        let activeSessionId = null;
        let currentSessionEmail = null;
        let heartbeatTimer = null;
        let visibilityHandler = null;

        const sendHeartbeatOnce = async (email) => {
            try {
                await supabaseClient
                    .from('active_sessions')
                    .update({ last_seen: new Date().toISOString() })
                    .eq('email', email)
                    .eq('session_id', activeSessionId);
            } catch (e) {}
        };

        const startSessionHeartbeat = (email) => {
            stopSessionHeartbeat();
            sendHeartbeatOnce(email);
            heartbeatTimer = setInterval(() => sendHeartbeatOnce(email), SESSION_HEARTBEAT_INTERVAL_MS);
            visibilityHandler = () => {
                if (document.visibilityState === 'visible') sendHeartbeatOnce(email);
            };
            document.addEventListener('visibilitychange', visibilityHandler);
        };

        const stopSessionHeartbeat = () => {
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
            if (visibilityHandler) {
                document.removeEventListener('visibilitychange', visibilityHandler);
                visibilityHandler = null;
            }
        };

        const claimActiveSession = async (email) => {
            let savedSessionId = null;
            try { savedSessionId = sessionStorage.getItem('activeSessionId'); } catch (e) {}

            const { data: existing } = await supabaseClient
                .from('active_sessions')
                .select('session_id, last_seen')
                .eq('email', email)
                .maybeSingle();

            const isSameDevice = !!existing && !!savedSessionId && existing.session_id === savedSessionId;

            if (existing && !isSameDevice) {
                const lastSeenMs = new Date(existing.last_seen).getTime();
                const isStale = (Date.now() - lastSeenMs) > SESSION_STALE_THRESHOLD_SECONDS * 1000;
                if (!isStale) return false;
            }

            const newSessionId = isSameDevice ? existing.session_id : crypto.randomUUID();
            const { error } = await supabaseClient
                .from('active_sessions')
                .upsert({ email, session_id: newSessionId, last_seen: new Date().toISOString() }, { onConflict: 'email' });

            if (error) return false;

            activeSessionId = newSessionId;
            currentSessionEmail = email;
            try { sessionStorage.setItem('activeSessionId', newSessionId); } catch (e) {}
            startSessionHeartbeat(email);
            return true;
        };

        const touchActiveSession = async (email) => {
            let sid = null;
            try { sid = sessionStorage.getItem('activeSessionId'); } catch (e) {}
            if (!sid) {
                sid = crypto.randomUUID();
                try { sessionStorage.setItem('activeSessionId', sid); } catch (e) {}
            }
            activeSessionId = sid;
            currentSessionEmail = email;
            try {
                await supabaseClient
                    .from('active_sessions')
                    .upsert({ email, session_id: sid, last_seen: new Date().toISOString() }, { onConflict: 'email' });
            } catch (e) {}
            startSessionHeartbeat(email);
        };

        const releaseActiveSession = async () => {
            stopSessionHeartbeat();
            const email = currentSessionEmail;
            const sid = activeSessionId;
            activeSessionId = null;
            currentSessionEmail = null;
            try { sessionStorage.removeItem('activeSessionId'); } catch (e) {}
            if (!email || !sid) return;
            try {
                await supabaseClient
                    .from('active_sessions')
                    .delete()
                    .eq('email', email)
                    .eq('session_id', sid);
            } catch (e) {}
        };

        const resetIdleTimer = () => { lastActivityAt = Date.now(); };

        const startIdleWatcher = () => {
            lastActivityAt = Date.now();
            IDLE_EVENTS.forEach(evt => window.addEventListener(evt, resetIdleTimer, { passive: true }));
            idleTimer = setInterval(() => {
                const idleMinutes = (Date.now() - lastActivityAt) / 60000;
                if (idleMinutes >= SESSION_TIMEOUT_MINUTES) expireSessionDueToIdle();
            }, 30000);
        };

        const stopIdleWatcher = () => {
            IDLE_EVENTS.forEach(evt => window.removeEventListener(evt, resetIdleTimer));
            if (idleTimer) clearInterval(idleTimer);
            idleTimer = null;
        };

        const SESSION_SYNC_REQUEST_KEY = 'apv_session_sync_request';
        const SESSION_SYNC_RESPONSE_PREFIX = 'apv_session_sync_response_';

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

                setTimeout(() => { try { localStorage.removeItem(responseKey); } catch (e) {} }, 2000);
            } catch (e) {}
        });

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

        const clearSessionState = () => {
            isLoggedIn.value = false;
            userEmail.value = '';
            userRole.value = '';
            userBrand.value = null;
            selectedBrand.value = '';
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
            await releaseActiveSession();
            clearSessionState();
            sessionExpiredMessage.value = `Ups! Antum ke-logout karena gak ada aktivitas (lebih dari ${SESSION_TIMEOUT_MINUTES} menit). Login lagi ya.`;
        };

        supabaseClient.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT' && !manualSignOut && isLoggedIn.value) {
                stopIdleWatcher();
                releaseActiveSession();
                clearSessionState();
                sessionExpiredMessage.value = 'Sesi login Antum udah gak valid lagi. Login lagi ya.';
            }
        });

        const selectedBrand = ref('');
        const userBrand = ref(null);
        const chooseBrand = (brand) => {
            selectedBrand.value = brand;
            try { localStorage.setItem('activeBrandChoice', brand); } catch (e) {}
        };
        const backToBrandPicker = () => {
            selectedBrand.value = '';
            try { localStorage.removeItem('activeBrandChoice'); } catch (e) {}
        };

        const currentTab = ref('dashboard');

        const SIDEBAR_TABS = ['dashboard', 'daftar-pr', 'daftar-po', 'master-hub'];

        const tabFromHash = () => {
            const h = (window.location.hash || '').replace('#', '');
            return SIDEBAR_TABS.includes(h) ? h : null;
        };
        watch(currentTab, (val) => {
            try { localStorage.setItem('lastActiveTab', val); } catch (e) {}
            try {
                if (SIDEBAR_TABS.includes(val)) history.replaceState(null, '', '#' + val);
            } catch (e) {}
        });
        const restoreLastTab = (role) => {
            try {
                const hashTab = tabFromHash();
                if (hashTab && (hashTab !== 'master-hub' || role === 'Master')) {
                    currentTab.value = hashTab;
                    return;
                }
                const saved = localStorage.getItem('lastActiveTab');

                if (saved && saved !== 'edit-pr' && saved !== 'view-po' && (!saved.startsWith('master') || role === 'Master')) {
                    currentTab.value = saved;
                }
            } catch (e) {}
        };

        const goToTab = (e, tab) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            currentTab.value = tab;
        };
        const prs = ref([]);
        const pos = ref([]);
        const prItems = ref([]);
        const masterBranches = ref([]);
        const masterProducts = ref([]);
        const masterPics = ref([]);
        const masterUsers = ref([]);

        const form = ref({ branch_name: '', required_date: '', shipping_category: '', pic: '', notes: '', items: [] });
        watch(() => form.value.shipping_category, () => {
            form.value.pic = '';
        });
        const newItemProductId = ref('');
        const newItemQty = ref(null);

        const editingFormItemIdx = ref(null);
        const editFormItemProductId = ref('');
        const editFormItemQty = ref(null);

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
        const prFilterShipping = ref('');
        const prDateRange = ref({ from: '', to: '' });
        const poDateRange = ref({ from: '', to: '' });
        const poFilterShipping = ref('');
        const branchSearchQuery = ref('');
        const productSearchQuery = ref('');
        const picSearchQuery = ref('');
        const userSearchQuery = ref('');

        const prSearchField = ref('pr_number');
        const prSearchFieldLabel = computed(() => (PR_SEARCH_FIELDS.find(f => f.value === prSearchField.value) || {}).label || '');
        const searchQuery = ref('');
        const prBranchFilter = ref([]);

        const poSearchField = ref('po_number');
        const poSearchFieldLabel = computed(() => (PO_SEARCH_FIELDS.find(f => f.value === poSearchField.value) || {}).label || '');
        const poSearchQuery = ref('');
        const poBranchFilter = ref([]);

        const dashBranchFilter = ref([]);
        const dashDateRange = ref({ from: '', to: '' });

        const itemsByPrId = computed(() => {
            const map = {};
            prItems.value.forEach(it => {
                if (!map[it.pr_id]) map[it.pr_id] = [];
                map[it.pr_id].push(it);
            });
            return map;
        });

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

        const editingPRId = ref(null);

        const editingPR = computed(() => editingPRId.value ? (prs.value.find(pr => pr.id === editingPRId.value) || null) : null);
        const editPRNewItemProductId = ref('');
        const editPRNewItemQty = ref(null);

        const editPRItems = computed(() => editingPR.value ? (itemsByPrId.value[editingPR.value.id] || []) : []);
        const canEditPR = computed(() =>
            !!editingPR.value && editingPR.value.status === 'Pending' && (userRole.value === 'AM' || userRole.value === 'Master')
        );

        const viewingPOId = ref(null);
        const viewingPO = computed(() => viewingPOId.value ? (pos.value.find(po => po.id === viewingPOId.value) || null) : null);
        const viewingPOItems = computed(() => viewingPO.value ? (itemsByPrId.value[viewingPO.value.pr_id] || []) : []);
        const openViewPO = (po) => { viewingPOId.value = po.id; currentTab.value = 'view-po'; };
        const backFromViewPO = () => { viewingPOId.value = null; currentTab.value = 'daftar-po'; };

        const PO_EXPORT_HEADERS = ['Purchase Date', 'Required Date', 'PO Number', 'PR Number', 'Branch', 'Product Name', 'Unit', 'Purchase Qty', 'Shipping', 'PIC', 'Notes', 'PO Created By'];
        const PO_EXPORT_COLS = [
            { wch: 13.89 }, { wch: 13.55 }, { wch: 16.78 }, { wch: 11 }, { wch: 7.33 },
            { wch: 13.55 }, { wch: 4.55 }, { wch: 12.89 }, { wch: 10 }, { wch: 10 }, { wch: 6.11 }, { wch: 14.11 }
        ];

        const productNameUnitFor = (it) => {
            const product = masterProducts.value.find(p => p.id === it.product_id);
            if (product) return { name: product.name, unit: product.unit || '' };
            const m = String(it.item_name || '').match(/^(.*)\s\(([^()]+)\)$/);
            if (m) return { name: m[1], unit: m[2] };
            return { name: it.item_name || '', unit: '' };
        };

        const poExportRows = (po) => {
            const pr = po.purchase_requests || {};
            const items = itemsByPrId.value[po.pr_id] || [];
            const base = [formatDate(po.created_at), formatDate(pr.required_date), po.po_number, pr.pr_number || '-', pr.branch_name || '-'];
            if (items.length === 0) return [[...base, '-', '', '', pr.shipping_category || '-', pr.pic || '-', pr.notes || '', po.created_by || '-']];
            return items.map(it => {
                const { name, unit } = productNameUnitFor(it);
                return [...base, name, unit, it.qty, pr.shipping_category || '-', pr.pic || '-', pr.notes || '', po.created_by || '-'];
            });
        };

        const PO_EXPORT_HEADER_STYLE = {
            font: { name: 'Arial', size: 10, italic: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF163E64' } },
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: {
                top: { style: 'dashed' },
                bottom: { style: 'dashed' },
                left: { style: 'dashed' },
                right: { style: 'dashed' }
            }
        };

        const downloadWorkbookBuffer = async (workbook, filename) => {
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        const buildPOFlatSheet = (workbook, poList) => {
            const ws = workbook.addWorksheet('Purchase Order');
            ws.columns = PO_EXPORT_HEADERS.map((header, i) => ({ header, width: PO_EXPORT_COLS[i].wch }));
            ws.getRow(1).eachCell((cell) => {
                cell.font = PO_EXPORT_HEADER_STYLE.font;
                cell.fill = PO_EXPORT_HEADER_STYLE.fill;
                cell.alignment = PO_EXPORT_HEADER_STYLE.alignment;
                cell.border = PO_EXPORT_HEADER_STYLE.border;
            });
            poList.forEach(po => poExportRows(po).forEach(row => ws.addRow(row)));
            return ws;
        };

        const exportPOExcel = async (po) => {
            const workbook = new ExcelJS.Workbook();
            buildPOFlatSheet(workbook, [po]);
            await downloadWorkbookBuffer(workbook, (po.po_number || 'PO') + '.xlsx');
        };

        const exportAllPOExcel = async () => {
            const workbook = new ExcelJS.Workbook();
            buildPOFlatSheet(workbook, filteredPOs.value);
            await downloadWorkbookBuffer(workbook, 'Purchase_Order_' + new Date().toISOString().slice(0, 10) + '.xlsx');
        };

        const editingBranchId = ref(null);
        const editBranchForm = ref({ branch_name: '', branch_code: '', brand: '' });
        const selectedBranchIds = ref([]);

        const editingProductId = ref(null);
        const editProductForm = ref({ name: '', unit: '', brand: '' });
        const selectedProductIds = ref([]);

        const editingPicId = ref(null);
        const editPicForm = ref({ pic_name: '', shipping: '', brand: '' });
        const selectedPicIds = ref([]);
        const addPicForm = ref({ pic_name: '', shipping: '', brand: '' });

        const newUserForm = ref({ username: '', password: '', role: '', brand: '' });
        const isCreatingUser = ref(false);
        const editingUserId = ref(null);
        const editUserForm = ref({ role: '', brand: '' });
        const selectedUserIds = ref([]);
        const isDeletingUsers = ref(false);

        const activeBrand = computed(() => userBrand.value || selectedBrand.value || null);

        const shippingCategoryOptions = computed(() => {
            if (activeBrand.value === 'Kebuli Abuya') {
                return SHIPPING_CATEGORY_OPTIONS.filter(o => o.value === 'Direct');
            }
            return SHIPPING_CATEGORY_OPTIONS;
        });

        const brandPRs = computed(() => {
            if (!activeBrand.value) return prs.value;
            return prs.value.filter(pr => pr.brand === activeBrand.value);
        });
        const brandPOs = computed(() => {
            if (!activeBrand.value) return pos.value;
            return pos.value.filter(po => po.purchase_requests?.brand === activeBrand.value);
        });

        const pendingPRs = computed(() => brandPRs.value.filter(pr => pr.status === 'Pending'));

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

        const prStatusCounts = computed(() => {
            const counts = { Pending: 0, Approved: 0, Rejected: 0, Expired: 0 };
            dashFilteredPRs.value.forEach(pr => {
                if (Object.prototype.hasOwnProperty.call(counts, pr.status)) counts[pr.status]++;
            });
            return counts;
        });
        const donutTotal = computed(() => dashFilteredPRs.value.length);

        const donutSegments = computed(() => {
            const total = donutTotal.value;
            const R = 70, CX = 100, CY = 100;
            const circumference = 2 * Math.PI * R;

            const visibleCount = DASHBOARD_STATUS_CONFIG.filter(cfg => (prStatusCounts.value[cfg.key] || 0) > 0).length;
            const GAP = visibleCount > 1 ? 2 : 0;
            let cumulative = 0;
            return DASHBOARD_STATUS_CONFIG.map(cfg => {
                const count = prStatusCounts.value[cfg.key] || 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                const dash = total > 0 ? (count / total) * circumference : 0;
                const offset = cumulative;
                cumulative += dash;

                const midAngle = total > 0 ? ((offset + dash / 2) / circumference) * 2 * Math.PI - Math.PI / 2 : 0;

                const labelR = R + 40;
                const lineR1 = R + 15;
                const lineR2 = labelR - 12;

                const renderDash = Math.max(dash - GAP, 0);
                const renderOffset = offset + (dash - renderDash) / 2;
                return {
                    key: cfg.key,
                    label: cfg.label,
                    color: cfg.color,
                    soft: cfg.soft,
                    bg: cfg.bg,
                    count,
                    pct,
                    dashArray: `${renderDash} ${circumference - renderDash}`,
                    dashOffset: -renderOffset,
                    labelX: CX + labelR * Math.cos(midAngle),
                    labelY: CY + labelR * Math.sin(midAngle),
                    lineX1: CX + lineR1 * Math.cos(midAngle),
                    lineY1: CY + lineR1 * Math.sin(midAngle),
                    lineX2: CX + lineR2 * Math.cos(midAngle),
                    lineY2: CY + lineR2 * Math.sin(midAngle)
                };
            });
        });

        const donutLabelSegments = computed(() => donutSegments.value.filter(s => s.count > 0));

        const expiringSoonPRs = computed(() => {
            const limit = tomorrowWIB();
            return brandPRs.value.filter(pr => pr.status === 'Pending' && pr.required_date === limit);
        });

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

        const brandManagedBranches = computed(() => {
            if (!activeBrand.value) return masterBranches.value;
            return masterBranches.value.filter(b => !b.brand || b.brand === activeBrand.value);
        });
        const brandManagedProducts = computed(() => {
            if (!activeBrand.value) return masterProducts.value;
            return masterProducts.value.filter(p => !p.brand || p.brand === activeBrand.value);
        });
        const brandManagedPics = computed(() => {
            if (!activeBrand.value) return masterPics.value;
            return masterPics.value.filter(p => !p.brand || p.brand === activeBrand.value);
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

        const filteredPics = computed(() => {
            if (!picSearchQuery.value) return brandManagedPics.value;
            const query = picSearchQuery.value.toLowerCase();
            return brandManagedPics.value.filter(p => (p.pic_name || '').toLowerCase().includes(query));
        });

        const filteredUsers = computed(() => {
            if (!userSearchQuery.value) return masterUsers.value;
            const query = userSearchQuery.value.toLowerCase();
            return masterUsers.value.filter(u => (u.email || '').toLowerCase().includes(query));
        });

        const isSelfUserRow = (u) => {
            const selfUsername = (userEmail.value || '').toLowerCase();
            const rowUsername = (u.email || '').split('@')[0].toLowerCase();
            return !!selfUsername && rowUsername === selfUsername;
        };

        const selectableFilteredUserIds = computed(() =>
            filteredUsers.value.filter(u => !isSelfUserRow(u)).map(u => u.id)
        );

        const allBranchesSelected = computed(() =>
            filteredBranches.value.length > 0 && selectedBranchIds.value.length === filteredBranches.value.length
        );
        const allProductsSelected = computed(() =>
            filteredProducts.value.length > 0 && selectedProductIds.value.length === filteredProducts.value.length
        );
        const allPicsSelected = computed(() =>
            filteredPics.value.length > 0 && selectedPicIds.value.length === filteredPics.value.length
        );
        const allUsersSelected = computed(() =>
            selectableFilteredUserIds.value.length > 0 && selectedUserIds.value.length === selectableFilteredUserIds.value.length
        );

        const picOptions = computed(() => {
            let list = brandManagedPics.value;
            if (form.value.shipping_category) list = list.filter(p => !p.shipping || p.shipping === form.value.shipping_category);
            return list.map(p => ({ value: p.pic_name, label: p.pic_name }));
        });

        const brandBranches = brandManagedBranches;
        const brandProducts = brandManagedProducts;

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

        const formatDateTime = (dateStr) => {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
            const timePart = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            return `${datePart}, ${timePart}`;
        };

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

                const claimed = await claimActiveSession(fullEmail);
                if (!claimed) {
                    manualSignOut = true;
                    await supabaseClient.auth.signOut();
                    manualSignOut = false;
                    loginError.value = 'Akun nya lagi kita pake bang!';
                    return;
                }

                const { role, brand } = await fetchRoleAndBrand(fullEmail);

                isLoggedIn.value = true;
                userEmail.value = usernameInput;
                userRole.value = role;
                userBrand.value = brand;
                if (brand) {
                    selectedBrand.value = brand;
                }
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
            await releaseActiveSession();
            clearSessionState();
            sessionExpiredMessage.value = '';
            try { localStorage.removeItem('lastActiveTab'); } catch (e) {}
        };

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
            overdue.forEach(pr => { pr.status = 'Expired'; });
        };

        const fetchData = async () => {
            try {
                const [prRes, poRes, branchRes, productRes, itemRes, picRes] = await Promise.all([
                    supabaseClient.from('purchase_requests').select('*').order('created_at', { ascending: false }),
                    supabaseClient.from('purchase_orders').select('*, purchase_requests(pr_number, branch_name, brand, shipping_category, pic, required_date)').order('created_at', { ascending: false }),
                    supabaseClient.from('master_branches').select('*').order('branch_name'),
                    supabaseClient.from('master_products').select('*').order('name'),
                    supabaseClient.from('purchase_request_items').select('*').order('id'),
                    supabaseClient.from('master_pics').select('*').order('pic_name'),
                ]);
                prs.value = prRes.data || [];
                pos.value = poRes.data || [];
                masterBranches.value = branchRes.data || [];
                masterProducts.value = productRes.data || [];
                prItems.value = itemRes.data || [];
                masterPics.value = picRes.data || [];

                if (userRole.value === 'Master') {
                    const { data: userRolesData } = await supabaseClient.from('user_roles').select('*').order('email');
                    masterUsers.value = userRolesData || [];
                }

                if (userRole.value === 'AM' || userRole.value === 'Master') {
                    await expireOverduePRs();
                }
            } catch (err) {
                console.error('Gagal ambil data:', err);
            }
        };

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

        const handlePicFileUpload = async (event) => {
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

                const nameCol = findCol(rows[0], 'PIC', 'pic', 'Nama PIC', 'nama_pic');
                if (!nameCol) {
                    toast(`Gagal! Kolom PIC tidak ditemukan. Kolom yang kebaca: ${Object.keys(rows[0]).join(', ')}`, 'error');
                    return;
                }

                const shippingCol = findCol(rows[0], 'SHIPPING', 'shipping', 'Shipping Category', 'shipping_category');
                const brandCol = findCol(rows[0], 'BRAND', 'brand', 'Merk', 'merk');

                const payload = rows
                    .map((row) => ({
                        pic_name: String(row[nameCol] ?? '').trim(),
                        shipping: shippingCol ? (String(row[shippingCol] ?? '').trim() || null) : null,
                        brand: brandCol ? (String(row[brandCol] ?? '').trim() || null) : null
                    }))
                    .filter((r) => r.pic_name && r.pic_name.toLowerCase() !== 'nan');

                if (payload.length === 0) {
                    toast('Gak ada baris valid buat diimport.', 'warn');
                    return;
                }

                const { error } = await supabaseClient
                    .from('master_pics')
                    .upsert(payload, { onConflict: 'pic_name,shipping,brand', ignoreDuplicates: true });

                if (error) {
                    toast('Gagal upload: ' + error.message, 'error');
                    return;
                }

                toast(`Berhasil diproses ${payload.length} baris PIC!`, 'success');
                fetchData();
            } catch (err) {
                console.error(err);
                toast('Gagal memproses file Excel.', 'error');
            } finally {
                isLoading.value = false;
                event.target.value = '';
            }
        };

        const addPic = async () => {
            if (!addPicForm.value.pic_name.trim()) { toast('Nama PIC gak boleh kosong.', 'warn'); return; }
            if (!addPicForm.value.shipping) { toast('Pilih Shipping dulu ya.', 'warn'); return; }
            const { error } = await supabaseClient.from('master_pics').insert({
                pic_name: addPicForm.value.pic_name.trim(),
                shipping: addPicForm.value.shipping,
                brand: addPicForm.value.brand || null
            });
            if (error) {
                toast('Gagal simpan PIC: ' + error.message, 'error');
                return;
            }
            addPicForm.value = { pic_name: '', shipping: '', brand: '' };
            toast('PIC berhasil ditambahkan!', 'success');
            fetchData();
        };

        const createNewUser = async () => {
            const username = newUserForm.value.username.trim();
            const password = newUserForm.value.password;
            const role = newUserForm.value.role;
            const brand = newUserForm.value.brand;

            if (!username) { toast('Username gak boleh kosong.', 'warn'); return; }
            if (!password || password.length < 6) { toast('Password minimal 6 karakter.', 'warn'); return; }
            if (!role) { toast('Pilih role dulu ya.', 'warn'); return; }
            if (role !== 'Master' && !brand) { toast('Pilih brand dulu ya.', 'warn'); return; }

            isCreatingUser.value = true;
            try {
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (!session?.access_token) {
                    toast('Sesi login gak valid, coba login ulang.', 'error');
                    return;
                }

                const res = await fetch(CREATE_USER_FUNCTION_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                        'apikey': SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({
                        username,
                        password,
                        role,
                        brand: role === 'Master' ? null : brand
                    })
                });

                const result = await res.json();

                if (!res.ok || result.error) {
                    toast('Gagal bikin akun: ' + (result.error || 'Unknown error'), 'error');
                    return;
                }

                newUserForm.value = { username: '', password: '', role: '', brand: '' };
                toast(`Akun ${result.email} berhasil dibuat!`, 'success');
            } catch (err) {
                console.error(err);
                toast('Gagal terhubung ke server buat bikin akun.', 'error');
            } finally {
                isCreatingUser.value = false;
            }
        };

        const handleUserFileUpload = async (event) => {
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

                const usernameCol = findCol(rows[0], 'Username', 'username', 'Email', 'email');
                const passwordCol = findCol(rows[0], 'Password', 'password');
                const roleCol = findCol(rows[0], 'Role', 'role');
                const brandCol = findCol(rows[0], 'Brand', 'brand');

                if (!usernameCol || !passwordCol || !roleCol) {
                    toast(`Gagal! Kolom Username/Password/Role tidak ditemukan. Kolom yang kebaca: ${Object.keys(rows[0]).join(', ')}`, 'error');
                    return;
                }

                const { data: { session } } = await supabaseClient.auth.getSession();
                if (!session?.access_token) {
                    toast('Sesi login gak valid, coba login ulang.', 'error');
                    return;
                }

                let success = 0;
                let failed = 0;
                const errors = [];

                for (const row of rows) {
                    const username = String(row[usernameCol] ?? '').trim();
                    const password = String(row[passwordCol] ?? '').trim();
                    const role = String(row[roleCol] ?? '').trim();
                    const brand = brandCol ? String(row[brandCol] ?? '').trim() : '';

                    if (!username || !password || !role) continue;

                    try {
                        const res = await fetch(CREATE_USER_FUNCTION_URL, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${session.access_token}`,
                                'apikey': SUPABASE_ANON_KEY
                            },
                            body: JSON.stringify({
                                username,
                                password,
                                role,
                                brand: role === 'Master' ? null : (brand || null)
                            })
                        });
                        const result = await res.json();
                        if (!res.ok || result.error) {
                            failed++;
                            errors.push(`${username}: ${result.error || 'Unknown error'}`);
                        } else {
                            success++;
                        }
                    } catch (err) {
                        failed++;
                        errors.push(`${username}: gagal konek server`);
                    }
                }

                if (success > 0) toast(`${success} akun berhasil dibuat.`, 'success');
                if (failed > 0) {
                    console.error('Gagal bikin akun:', errors);
                    toast(`${failed} akun gagal dibuat. Cek console buat detail.`, 'error');
                }
            } catch (err) {
                console.error(err);
                toast('Gagal memproses file Excel.', 'error');
            } finally {
                isLoading.value = false;
                event.target.value = '';
            }
        };

        const submitPR = async () => {
            if (!form.value.branch_name) { toast('Pilih cabang dulu ya.', 'warn'); return; }
            if (!form.value.required_date) { toast('Pilih Required Date dulu ya.', 'warn'); return; }
            if (!form.value.shipping_category) { toast('Pilih kategori pengiriman dulu ya.', 'warn'); return; }
            if (!form.value.pic) { toast('Pilih PIC dulu ya.', 'warn'); return; }
            if (form.value.items.length === 0) { toast('Tambahkan minimal 1 item barang dulu ya.', 'warn'); return; }
            try {

                const matchedBranch = masterBranches.value.find(b => b.branch_name === form.value.branch_name);
                const prBrand = matchedBranch?.brand || deriveBrandFromBranchName(form.value.branch_name);

                const prNumber = await generateNumber('PR');

                const { data: newPR, error } = await supabaseClient.from('purchase_requests').insert({
                    pr_number: prNumber,
                    branch_name: form.value.branch_name,
                    shipping_category: form.value.shipping_category,
                    pic: form.value.pic || null,
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

        const openEditPR = (pr) => {
            editingPRId.value = pr.id;
            editPRNewItemProductId.value = '';
            editPRNewItemQty.value = null;
            currentTab.value = 'edit-pr';

            try { history.replaceState(null, '', '#edit-pr/' + pr.id); } catch (e) {}
        };
        const backFromEditPR = () => {
            editingPRId.value = null;
            currentTab.value = 'daftar-pr';
        };

        const goToEditPR = (e, pr) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            openEditPR(pr);
        };

        const tryOpenPRFromHash = () => {
            const h = (window.location.hash || '').replace('#', '');
            const m = h.match(/^edit-pr\/(\d+)$/);
            if (!m) return false;
            const pr = prs.value.find(p => p.id === Number(m[1]));
            if (pr) { openEditPR(pr); return true; }
            return false;
        };

        const touchPR = async (prId) => {
            await supabaseClient.from('purchase_requests').update({
                updated_at: new Date().toISOString(),
                updated_by: userEmail.value
            }).eq('id', prId);
        };

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

        const toggleBranchSelect = (id) => {
            const idx = selectedBranchIds.value.indexOf(id);
            if (idx === -1) selectedBranchIds.value.push(id);
            else selectedBranchIds.value.splice(idx, 1);
        };
        const toggleSelectAllBranches = () => {
            selectedBranchIds.value = allBranchesSelected.value ? [] : filteredBranches.value.map(b => b.id);
        };
        const startEditBranch = (b) => {
            editingProductId.value = null;
            editingPicId.value = null;
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

        const toggleProductSelect = (id) => {
            const idx = selectedProductIds.value.indexOf(id);
            if (idx === -1) selectedProductIds.value.push(id);
            else selectedProductIds.value.splice(idx, 1);
        };
        const toggleSelectAllProducts = () => {
            selectedProductIds.value = allProductsSelected.value ? [] : filteredProducts.value.map(p => p.id);
        };
        const startEditProduct = (p) => {
            editingBranchId.value = null;
            editingPicId.value = null;
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

        const togglePicSelect = (id) => {
            const idx = selectedPicIds.value.indexOf(id);
            if (idx === -1) selectedPicIds.value.push(id);
            else selectedPicIds.value.splice(idx, 1);
        };
        const toggleSelectAllPics = () => {
            selectedPicIds.value = allPicsSelected.value ? [] : filteredPics.value.map(p => p.id);
        };

        const toggleUserSelect = (id) => {
            const idx = selectedUserIds.value.indexOf(id);
            if (idx === -1) selectedUserIds.value.push(id);
            else selectedUserIds.value.splice(idx, 1);
        };
        const toggleSelectAllUsers = () => {
            selectedUserIds.value = allUsersSelected.value ? [] : [...selectableFilteredUserIds.value];
        };
        const deleteUsers = async (ids) => {
            if (ids.length === 0) return;
            if (!(await confirmDialog(`Yakin mau hapus ${ids.length} akun ini? Akun bakal ke-hapus permanen (gak bisa login lagi). Gak bisa di-undo.`, { danger: true, confirmLabel: 'Ya, Hapus' }))) return;

            isDeletingUsers.value = true;
            try {
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (!session?.access_token) {
                    toast('Sesi login gak valid, coba login ulang.', 'error');
                    return;
                }

                const res = await fetch(DELETE_USER_FUNCTION_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                        'apikey': SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({ ids })
                });

                const result = await res.json();

                if (!res.ok || result.error) {
                    toast('Gagal hapus: ' + (result.error || 'Unknown error'), 'error');
                    return;
                }

                if (result.deleted?.length > 0) toast(`${result.deleted.length} akun berhasil dihapus.`, 'success');
                if (result.failed?.length > 0) {
                    console.error('Gagal hapus sebagian akun:', result.failed);
                    toast(`${result.failed.length} akun gagal dihapus. Cek console buat detail.`, 'error');
                }

                selectedUserIds.value = [];
                fetchData();
            } catch (err) {
                console.error(err);
                toast('Gagal terhubung ke server buat hapus akun.', 'error');
            } finally {
                isDeletingUsers.value = false;
            }
        };

        const startEditUser = (u) => {
            if (isSelfUserRow(u)) {
                toast('Gak bisa edit role akun sendiri lewat sini.', 'warn');
                return;
            }
            editingBranchId.value = null;
            editingProductId.value = null;
            editingPicId.value = null;
            editingUserId.value = u.id;
            editUserForm.value = { role: u.role || '', brand: u.brand || '' };
        };
        const cancelEditUser = () => { editingUserId.value = null; };
        const saveEditUser = async (id) => {
            const target = masterUsers.value.find(u => u.id === id);
            if (target && isSelfUserRow(target)) {
                toast('Gak bisa edit role akun sendiri lewat sini.', 'warn');
                editingUserId.value = null;
                return;
            }
            if (!editUserForm.value.role) { toast('Pilih role dulu ya.', 'warn'); return; }
            const { error } = await supabaseClient
                .from('user_roles')
                .update({
                    role: editUserForm.value.role,
                    brand: editUserForm.value.role === 'Master' ? null : (editUserForm.value.brand || null)
                })
                .eq('id', id);
            if (error) {
                toast('Gagal simpan: ' + error.message, 'error');
                return;
            }
            editingUserId.value = null;
            toast('Role/brand user berhasil diupdate!', 'success');
            fetchData();
        };

        const startEditPic = (p) => {
            editingBranchId.value = null;
            editingProductId.value = null;
            editingPicId.value = p.id;
            editPicForm.value = { pic_name: p.pic_name, shipping: p.shipping || '', brand: p.brand || '' };
        };
        const cancelEditPic = () => { editingPicId.value = null; };
        const saveEditPic = async (id) => {
            if (!editPicForm.value.pic_name.trim()) { toast('Nama PIC gak boleh kosong.', 'warn'); return; }
            const { error } = await supabaseClient
                .from('master_pics')
                .update({
                    pic_name: editPicForm.value.pic_name.trim(),
                    shipping: editPicForm.value.shipping || null,
                    brand: editPicForm.value.brand || null
                })
                .eq('id', id);
            if (error) {
                toast('Gagal simpan: ' + error.message, 'error');
                return;
            }
            editingPicId.value = null;
            fetchData();
        };
        const deletePics = async (ids) => {
            if (ids.length === 0) return;
            if (!(await confirmDialog(`Yakin mau hapus ${ids.length} PIC ini? Gak bisa di-undo.`, { danger: true, confirmLabel: 'Ya, Hapus' }))) return;
            const { error } = await supabaseClient.from('master_pics').delete().in('id', ids);
            if (error) {
                toast('Gagal hapus: ' + error.message, 'error');
                return;
            }
            selectedPicIds.value = selectedPicIds.value.filter(id => !ids.includes(id));
            fetchData();
        };

        onMounted(async () => {

            let { data: { session } } = await supabaseClient.auth.getSession();

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
                if (brand) {
                    selectedBrand.value = brand;
                } else {
                    try {
                        const savedBrand = localStorage.getItem('activeBrandChoice');
                        if (savedBrand) selectedBrand.value = savedBrand;
                    } catch (e) {}
                }
                restoreLastTab(role);
                startIdleWatcher();
                await touchActiveSession(session.user.email);
                await fetchData();

                tryOpenPRFromHash();
            }

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
            isLoggedIn, userEmail, userRole, loginForm, loginError, sessionExpiredMessage, isLoading, showPassword, handleLogin, handleLogout,
            selectedBrand, userBrand, activeBrand, chooseBrand, backToBrandPicker,
            currentTab, goToTab, prs, pos, prItems, itemsByPrId, form, pendingPRs, filteredPRs, brandPRs, brandPOs, filteredPOs, filterStatus,
            donutTotal, donutSegments, donutLabelSegments, expiringSoonPRs, topItemsByPOCount, topItemsByQtyCount,
            dashBranchFilter, dashDateRange,
            prFilterShipping, poFilterShipping, SHIPPING_FILTER_OPTIONS,
            prSortField, prSortDir, poSortField, poSortDir, toggleSortPR, toggleSortPO,
            prDateRange, poDateRange,
            prSearchField, prSearchFieldLabel, PR_SEARCH_FIELDS, searchQuery, prBranchFilter,
            poSearchField, poSearchFieldLabel, PO_SEARCH_FIELDS, poSearchQuery, poBranchFilter,
            masterBranches, masterProducts, masterPics, brandBranches, brandProducts, branchOptions, productOptions, STATUS_OPTIONS,
            SHIPPING_CATEGORY_OPTIONS, shippingCategoryOptions, picOptions, PIC_SHIPPING_SELECT_OPTIONS, BRAND_SELECT_OPTIONS, newItemProductId, newItemQty, addFormItem, removeFormItem, openBuatPR, cancelBuatPR,
            editingFormItemIdx, editFormItemProductId, editFormItemQty, startEditFormItem, cancelEditFormItem, saveEditFormItem,
            editingPR, editPRNewItemProductId, editPRNewItemQty, editPRItems, canEditPR,
            openEditPR, goToEditPR, backFromEditPR, addItemToEditingPR, updateEditingPRItemQty, removeItemFromEditingPR,
            viewingPO, viewingPOItems, openViewPO, backFromViewPO, exportPOExcel, exportAllPOExcel,
            branchSearchQuery, filteredBranches, productSearchQuery, filteredProducts, picSearchQuery, filteredPics,
            handleFileUpload, handleProductFileUpload, handlePicFileUpload,
            editingBranchId, editBranchForm, selectedBranchIds, allBranchesSelected,
            toggleBranchSelect, toggleSelectAllBranches, startEditBranch, cancelEditBranch, saveEditBranch, deleteBranches,
            editingProductId, editProductForm, selectedProductIds, allProductsSelected,
            toggleProductSelect, toggleSelectAllProducts, startEditProduct, cancelEditProduct, saveEditProduct, deleteProducts,
            editingPicId, editPicForm, selectedPicIds, allPicsSelected, addPicForm, addPic,
            togglePicSelect, toggleSelectAllPics, startEditPic, cancelEditPic, saveEditPic, deletePics,
            newUserForm, isCreatingUser, createNewUser, handleUserFileUpload, ROLE_SELECT_OPTIONS,
            masterUsers, filteredUsers, userSearchQuery, editingUserId, editUserForm, startEditUser, cancelEditUser, saveEditUser, isSelfUserRow,
            selectedUserIds, allUsersSelected, toggleUserSelect, toggleSelectAllUsers, deleteUsers, isDeletingUsers,
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