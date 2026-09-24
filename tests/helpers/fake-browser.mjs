// Lingkungan browser tiruan agar modul aplikasi yang bergantung pada `window`, localStorage, dan klien
// Supabase bisa dijalankan di Node tanpa jaringan. Panggil installFakeBrowser() SEBELUM mengimpor modul
// aplikasi (js/sales.js dst), lalu impor dengan `await import(...)`.

export function installFakeBrowser() {
  const store = new Map();
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    key: (index) => [...store.keys()][index] ?? null,
    get length() { return store.size; }
  };

  const state = {
    calls: [],
    selects: [],
    session: { user: { id: 'user-1' } },
    rpcHandler: () => ({ data: null, error: null, status: 200 }),
    tableHandler: () => ({ data: [], error: null, status: 200 })
  };

  // Hasil query PostgREST/SDK: dapat di-await, dan mendukung rantai .order() .range() .abortSignal().
  const thenable = (produce) => {
    const chain = {
      order: () => chain,
      range: () => chain,
      abortSignal: () => chain,
      then: (resolve, reject) => Promise.resolve().then(produce).then(resolve, reject)
    };
    return chain;
  };

  const client = {
    rpc(name, args) {
      state.calls.push({ name, args: structuredClone(args) });
      return thenable(() => state.rpcHandler(name, args));
    },
    from(table) {
      return {
        select(columns) {
          state.selects.push({ table, columns });
          return thenable(() => state.tableHandler(table, columns));
        }
      };
    },
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      signOut: async () => ({}),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  };

  globalThis.window = { supabase: { createClient: () => client }, localStorage, addEventListener() {}, location: { hash: '' } };
  globalThis.localStorage = localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

  return {
    get calls() { return state.calls; },
    get selects() { return state.selects; },
    rpc(handler) { state.rpcHandler = handler; },
    tables(handler) { state.tableHandler = handler; },
    setSession(session) { state.session = session; },
    setOnline(value) { globalThis.navigator.onLine = value; },
    outbox: () => JSON.parse(localStorage.getItem('klontonk:outbox:v1') || '[]'),
    reset() {
      store.clear();
      state.calls = [];
      state.selects = [];
      state.session = { user: { id: 'user-1' } };
      state.rpcHandler = () => ({ data: null, error: null, status: 200 });
      state.tableHandler = () => ({ data: [], error: null, status: 200 });
      globalThis.navigator.onLine = true;
    }
  };
}
