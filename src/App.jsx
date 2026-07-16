import React, { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Package,
  CalendarDays,
  Shirt,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Minus,
  RotateCcw,
  Building2,
  Users,
  Check,
  ChevronDown,
  ChevronUp,
  Link2,
} from "lucide-react";
import ical from 'ical';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

// ---------- Catalog ----------
const CATEGORIES = [
  { key: "towels", label: "Полотенца" },
  { key: "sheets", label: "Простыни" },
  { key: "duvet", label: "Пододеяльники" },
  { key: "pillowcase", label: "Наволочки" },
];

const LINEN_TYPES = [
  { key: "towel_medium", name: "Средние", cat: "towels" },
  { key: "towel_small", name: "Маленькие", cat: "towels" },
  { key: "towel_large", name: "Большие", cat: "towels" },
  { key: "towel_kitchen", name: "Кухня", cat: "towels" },
  { key: "towel_feet", name: "Для ног", cat: "towels" },
  { key: "sheet_fitted", name: "На резинке", cat: "sheets" },
  { key: "sheet_double", name: "Двухспальная", cat: "sheets" },
  { key: "sheet_euro", name: "Евро", cat: "sheets" },
  { key: "duvet_1_5", name: "Полуторный", cat: "duvet" },
  { key: "duvet_double", name: "Двухспальный", cat: "duvet" },
  { key: "pillowcase", name: "Наволочка", cat: "pillowcase" },
];

const typeByKey = Object.fromEntries(LINEN_TYPES.map((t) => [t.key, t]));

// ---------- Date helpers ----------
const DAY = 86400000;
const today = new Date();
today.setHours(0, 0, 0, 0);
const addDays = (n) => new Date(today.getTime() + n * DAY);
const fmt = (d) =>
  new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
const daysUntil = (d) => Math.round((new Date(d) - today) / DAY);

// ---------- Default mock data ----------
function defaultKit(overrides) {
  const base = Object.fromEntries(LINEN_TYPES.map((t) => [t.key, 0]));
  return { ...base, ...overrides };
}

function makeDefaultState() {
  const objects = [
    {
      id: "obj1",
      name: "Крутой переулок, 12",
      rcId: "RC-10432",
      allocated: {
        towel_medium: 3,
        towel_small: 2,
        towel_large: 2,
        towel_kitchen: 1,
        towel_feet: 1,
        sheet_fitted: 1,
        sheet_double: 1,
        sheet_euro: 1,
        duvet_1_5: 1,
        duvet_double: 1,
        pillowcase: 3,
      },
      bookings: [],
    },
    {
      id: "obj2",
      name: "Московское шоссе, 27А",
      rcId: "RC-10433",
      allocated: {
        towel_medium: 3,
        towel_small: 2,
        towel_large: 2,
        towel_kitchen: 1,
        towel_feet: 1,
        sheet_fitted: 1,
        sheet_double: 1,
        sheet_euro: 1,
        duvet_1_5: 1,
        duvet_double: 1,
        pillowcase: 3,
      },
      bookings: [],
    },
  ];

  const stock = {
    towel_medium: 10,
    towel_small: 8,
    towel_large: 6,
    towel_kitchen: 3,
    towel_feet: 3,
    sheet_fitted: 2,
    sheet_double: 3,
    sheet_euro: 2,
    duvet_1_5: 2,
    duvet_double: 3,
    pillowcase: 10,
  };

  return { objects, stock, laundry: [] };
}

function sumItems(...maps) {
  const out = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

// ---------- Расчет комплекта белья на бронь ----------
function getLinenSet(objId, guests) {
  const baseGuests = objId === 'obj1' ? 2 : 4;
  let baseSet;
  if (objId === 'obj1') {
    baseSet = {
      towel_medium: 2,
      towel_small: 2,
      towel_large: 2,
      towel_kitchen: 1,
      towel_feet: 1,
      sheet_double: 0,
      sheet_euro: 1,
      sheet_fitted: 0,
      duvet_1_5: 0,
      duvet_double: 1,
      pillowcase: 2,
    };
  } else {
    baseSet = {
      towel_medium: 4,
      towel_small: 4,
      towel_large: 4,
      towel_kitchen: 1,
      towel_feet: 1,
      sheet_double: 0,
      sheet_euro: 1,
      sheet_fitted: 2,
      duvet_1_5: 2,
      duvet_double: 1,
      pillowcase: 4,
    };
  }
  const extraPerGuest = {
    towel_medium: 1,
    towel_small: 1,
    towel_large: 1,
    duvet_1_5: 1,
  };
  const result = { ...baseSet };
  const extraGuests = Math.max(0, guests - baseGuests);
  for (const key in extraPerGuest) {
    result[key] = (result[key] || 0) + extraGuests * extraPerGuest[key];
  }
  if (extraGuests > 0) {
    result.sheet_double = (result.sheet_double || 0) + 1;
  }
  return result;
}

// ---------- iCalendar loading ----------
async function loadBookingsFromICal(icalUrl, objId, defaultGuests = 1) {
  try {
    let text;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      const response = await fetch(icalUrl);
      text = await response.text();
    } else {
      const proxyUrl = `/.netlify/functions/iCalProxy?url=${encodeURIComponent(icalUrl)}`;
      const response = await fetch(proxyUrl);
      text = await response.text();
    }
    const data = ical.parseICS(text);
    const bookings = [];
    for (const key in data) {
      const event = data[key];
      if (event.type === 'VEVENT') {
        const summary = event.summary || '';
        const match = summary.match(/RC\((\d+)\)/);
        const id = match ? match[1] : `ical_${key}`;
        bookings.push({
          id: `ical_${id}`,
          guest: `Бронь ${id}`,
          guests: defaultGuests,
          checkIn: new Date(event.start),
          checkOut: new Date(event.end),
          rc: `RC-${id}`,
          items: getLinenSet(objId, defaultGuests),
        });
      }
    }
    bookings.sort((a, b) => a.checkIn - b.checkIn);
    return bookings;
  } catch (e) {
    console.error('Ошибка загрузки iCalendar:', e);
    return [];
  }
}

// ---------- Firebase helpers ----------
const DOC_PATH = 'appData/main';

async function saveStateToFirebase(state) {
  try {
    const docRef = doc(db, 'appData', 'main');
    // Сериализуем даты в строки (JSON.stringify превращает Date в строки ISO)
    const serialized = JSON.parse(JSON.stringify(state));
    await setDoc(docRef, serialized);
    console.log('✅ Данные успешно сохранены в Firebase');
  } catch (e) {
    console.error('❌ Ошибка сохранения в Firebase:', e);
  }
}
// ---------- Helper: merge bookings, сохраняя ручные правки ----------
function mergeBookings(existingBookings, icalBookings) {
  // Создаём карту существующих броней по id
  const existingMap = {};
  existingBookings.forEach(b => {
    existingMap[b.id] = b;
  });

  // Проходим по новым броням из iCal
  const merged = icalBookings.map(icalB => {
    if (existingMap[icalB.id]) {
      // Если бронь уже существует – оставляем её guests и items (ручные правки), но обновляем даты
      const existing = existingMap[icalB.id];
      return {
        ...existing,          // сохраняем guests, items, и другие поля
        checkIn: icalB.checkIn,
        checkOut: icalB.checkOut,
        // опционально можно обновить guest (имя), если оно изменилось
        guest: icalB.guest,
      };
    } else {
      // Новая бронь – добавляем как есть
      return icalB;
    }
  });

  // Также можно добавить старые брони, которых нет в iCal (если хотите их сохранить)
  // Для этого нужно пройтись по existingMap и добавить те, которых нет в merged
  const mergedIds = new Set(merged.map(b => b.id));
  const extra = existingBookings.filter(b => !mergedIds.has(b.id));
  // Возвращаем объединённый массив
  return [...merged, ...extra];
}
// ---------- Main App ----------
export default function App() {
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [objFilter, setObjFilter] = useState('obj1');

  useEffect(() => {
    const docRef = doc(db, 'appData', 'main');

       const initData = async () => {
      try {
        // Всегда загружаем свежие брони из iCal
        const icalBookings1 = await loadBookingsFromICal(
          'https://realtycalendar.ru/apartments/export.ics?q=MTk5ODIz%0A',
          'obj1',
          2
        );
        const icalBookings2 = await loadBookingsFromICal(
          'https://realtycalendar.ru/apartments/export.ics?q=MjY2ODg3%0A',
          'obj2',
          4
        );

        // Получаем текущие данные из Firebase (если есть)
        const snap = await getDoc(docRef);
        let existingData = null;
        if (snap.exists()) {
          existingData = snap.data();
          // Восстанавливаем даты для существующих броней (чтобы потом сравнивать)
          existingData.objects.forEach((o) =>
            o.bookings.forEach((b) => {
              b.checkIn = new Date(b.checkIn);
              b.checkOut = new Date(b.checkOut);
            })
          );
          existingData.laundry.forEach((l) => (l.checkOut = new Date(l.checkOut)));
        }

        // Создаём новый объект состояния
        let newState;
        if (existingData) {
          // Копируем существующее состояние, но заменяем брони для каждого объекта
          newState = { ...existingData };
          // Для каждого объекта обновляем брони
          newState.objects = newState.objects.map((obj) => {
            let newBookings;
            if (obj.name === 'Крутой переулок, 12') {
              newBookings = mergeBookings(obj.bookings, icalBookings1);
            } else if (obj.name === 'Московское шоссе, 27А') {
              newBookings = mergeBookings(obj.bookings, icalBookings2);
            } else {
              newBookings = obj.bookings;
            }
            return { ...obj, bookings: newBookings };
          });
        } else {
          // Если данных нет – создаём начальное состояние
          const defaultState = makeDefaultState();
          const updatedObjects = defaultState.objects.map((obj) => {
            if (obj.name === 'Крутой переулок, 12') {
              return { ...obj, bookings: icalBookings1 };
            }
            if (obj.name === 'Московское шоссе, 27А') {
              return { ...obj, bookings: icalBookings2 };
            }
            return obj;
          });
          newState = { ...defaultState, objects: updatedObjects };
        }

        // Сохраняем в Firebase
        await saveStateToFirebase(newState);
        setState(newState);
        setLoaded(true);
      } catch (e) {
        console.error('Ошибка инициализации:', e);
        // В случае ошибки используем дефолтное состояние
        const defaultState = makeDefaultState();
        setState(defaultState);
        setLoaded(true);
      }
    };

    initData();
  }, []);

  // Функция обновления состояния с сохранением в Firebase
  const updateState = async (newStateOrUpdater) => {
    setState((prev) => {
      const newState = typeof newStateOrUpdater === 'function'
        ? newStateOrUpdater(prev)
        : newStateOrUpdater;
      saveStateToFirebase(newState);
      return newState;
    });
  };

  // Автоматическое добавление в стирку
  useEffect(() => {
    if (!state) return;
    const existingIds = new Set(state.laundry.map((l) => l.bookingId));
    const newEntries = [];
    for (const obj of state.objects) {
      for (const b of obj.bookings) {
        if (b.checkOut <= today && !existingIds.has(b.id)) {
          newEntries.push({
            id: 'l_' + b.id,
            bookingId: b.id,
            objectId: obj.id,
            objectName: obj.name,
            guest: b.guest,
            checkOut: b.checkOut,
            items: b.items || getLinenSet(obj.id, b.guests),
            status: 'in_laundry',
          });
        }
      }
    }
    if (newEntries.length) {
      updateState((s) => ({ ...s, laundry: [...s.laundry, ...newEntries] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.objects?.length, loaded]);

  if (!state) {
    return <div style={{ padding: 40, fontFamily: "'Onest', sans-serif", color: "#8E8B84" }}>Загрузка…</div>;
  }

  return (
    <div className="lt-root">
      <style>{CSS}</style>
      <Sidebar tab={tab} setTab={setTab} />
      <main className="lt-main">
        {tab === 'dashboard' && (
          <DashboardTab
            state={state}
            setState={updateState}
            objFilter={objFilter}
            setObjFilter={setObjFilter}
          />
        )}
        {tab === 'warehouse' && <WarehouseTab state={state} setState={updateState} />}
        {tab === 'bookings' && (
          <BookingsTab
            state={state}
            setState={updateState}
            objFilter={objFilter}
            setObjFilter={setObjFilter}
          />
        )}
        {tab === 'laundry' && <LaundryTab state={state} setState={updateState} />}
      </main>
    </div>
  );
}

// ============== Все компоненты из вашего старого файла ==============

// ----- Sidebar -----
function Sidebar({ tab, setTab }) {
  const items = [
    { key: "dashboard", label: "Дефицит", icon: LayoutDashboard },
    { key: "warehouse", label: "Склад", icon: Package },
    { key: "bookings", label: "Брони", icon: CalendarDays },
    { key: "laundry", label: "В стирке", icon: Shirt },
  ];
  return (
    <nav className="lt-sidebar">
      <div className="lt-brand">
        <div className="lt-brand-mark">Б</div>
        <div>
          <div className="lt-brand-title">Бельевой учёт</div>
          <div className="lt-brand-sub">2 объекта · RealtyCalendar</div>
        </div>
      </div>
      <div className="lt-nav">
        {items.map((it) => (
          <button
            key={it.key}
            className={"lt-nav-item" + (tab === it.key ? " active" : "")}
            onClick={() => setTab(it.key)}
          >
            <it.icon size={17} strokeWidth={1.8} />
            <span>{it.label}</span>
          </button>
        ))}
      </div>
      <div className="lt-sidebar-foot">
        <Link2 size={13} strokeWidth={1.8} />
        <span>Данные из RealtyCalendar (iCal) с ручным вводом гостей.</span>
      </div>
    </nav>
  );
}

// ----- DashboardTab -----
function DashboardTab({ state, setState, objFilter, setObjFilter }) {
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = (objId, booking) => {
    setSelectedBooking({ ...booking, objectId: objId });
    setIsModalOpen(true);
  };
  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedBooking(null);
  };
  const updateBookingItems = (objId, bookingId, newItems) => {
    setState((prev) => ({
      ...prev,
      objects: prev.objects.map((obj) =>
        obj.id === objId
          ? {
              ...obj,
              bookings: obj.bookings.map((b) =>
                b.id === bookingId ? { ...b, items: newItems } : b
              ),
            }
          : obj
      ),
    }));
  };

  const updateAllocated = (objId, key, delta) => {
    setState((prev) => {
      const obj = prev.objects.find(o => o.id === objId);
      if (!obj) return prev;
      const current = obj.allocated?.[key] || 0;
      const newAllocated = Math.max(0, current + delta);
      const diff = newAllocated - current;
      const newStock = { ...prev.stock };
      newStock[key] = Math.max(0, (newStock[key] || 0) - diff);
      return {
        ...prev,
        objects: prev.objects.map(o =>
          o.id === objId
            ? { ...o, allocated: { ...o.allocated, [key]: newAllocated } }
            : o
        ),
        stock: newStock,
      };
    });
  };

  const perObjectNeed = state.objects.map((obj) => {
    const upcoming = obj.bookings
      .filter((b) => b.checkIn >= today)
      .sort((a, b) => a.checkIn - b.checkIn)
      .slice(0, 2);
    const need = sumItems(...upcoming.map((b) => b.items || getLinenSet(obj.id, b.guests)));
    return { obj, upcoming, need };
  });

  const filtered = perObjectNeed.filter(
    (p) => objFilter === "all" || p.obj.id === objFilter
  );

  let hasShortage = false;
  for (const p of filtered) {
    for (const t of LINEN_TYPES) {
      const need = p.need[t.key] || 0;
      const allocated = p.obj.allocated?.[t.key] || 0;
      if (need > allocated) {
        hasShortage = true;
        break;
      }
    }
    if (hasShortage) break;
  }

  return (
    <div>
      <header className="lt-header">
        <div>
          <h1>Дефицит белья к ближайшим заездам</h1>
        </div>
        <div className="lt-objfilter">
          {state.objects.map((o) => (
            <button
              key={o.id}
              className={objFilter === o.id ? "active" : ""}
              onClick={() => setObjFilter(o.id)}
            >
              {o.name}
            </button>
          ))}
        </div>
      </header>

      <div className="lt-alertbar">
        {hasShortage ? (
          <>
            <AlertTriangle size={16} strokeWidth={2} />
            <span>Имеется дефицит белья на объектах — см. таблицы ниже</span>
          </>
        ) : (
          <>
            <CheckCircle2 size={16} strokeWidth={2} />
            <span>На всех объектах белья достаточно под ближайшие заезды</span>
          </>
        )}
      </div>

      <div className="lt-objcards">
        {filtered.map(({ obj, upcoming }) => (
          <div className="lt-card" key={obj.id}>
            <div className="lt-card-head">
              <Building2 size={15} strokeWidth={1.8} />
              <span>Ближайшие брони</span>
              <span className="lt-tag-id">{obj.rcId}</span>
            </div>
            <div className="lt-timeline">
              {upcoming.length === 0 && (
                <div className="lt-empty-small">Будущих броней нет</div>
              )}
              {upcoming.map((b) => (
                <div
                  className="lt-tl-item"
                  key={b.id}
                  onClick={() => openModal(obj.id, b)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="lt-tl-dates">
                    {fmt(b.checkIn)} – {fmt(b.checkOut)}
                  </div>
                  <div className="lt-tl-meta">
                    <Users size={12} strokeWidth={2} /> {b.guests} · через{" "}
                    {daysUntil(b.checkIn)} дн.
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="lt-tablewrap">
        {filtered.map(({ obj, need }) => {
          const categoriesWithData = CATEGORIES.filter((cat) => {
            const types = LINEN_TYPES.filter((t) => t.cat === cat.key);
            return types.some(
              (t) => (need[t.key] || 0) > 0 || (obj.allocated?.[t.key] || 0) > 0
            );
          });
          if (categoriesWithData.length === 0) return null;

          return (
            <div key={obj.id} className="lt-section">
              {categoriesWithData.map((cat) => {
                const types = LINEN_TYPES.filter((t) => t.cat === cat.key);
                return (
                  <div key={cat.key} style={{ marginBottom: '16px' }}>
                    <div className="lt-section-title" style={{ fontSize: '13px', borderBottom: '1px dashed var(--line)' }}>
                      {cat.label}
                    </div>
                    <table className="lt-table">
                      <thead>
                        <tr>
                          <th>Тип</th>
                          <th>Нужно</th>
                          <th>На объекте</th>
                          <th>Дефицит</th>
                        </tr>
                      </thead>
                      <tbody>
                        {types.map((t) => {
                          const needVal = need[t.key] || 0;
                          const allocated = obj.allocated?.[t.key] || 0;
                          if (needVal === 0 && allocated === 0) return null;
                          const short = Math.max(0, needVal - allocated);
                          return (
                            <tr key={t.key}>
                              <td>{t.name}</td>
                              <td className="mono">{needVal}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span className="mono">{allocated}</span>
                                  <button
                                    className="lt-stock-btn"
                                    onClick={() => updateAllocated(obj.id, t.key, -1)}
                                    disabled={allocated === 0}
                                  >
                                    −
                                  </button>
                                  <button
                                    className="lt-stock-btn"
                                    onClick={() => updateAllocated(obj.id, t.key, 1)}
                                    disabled={state.stock[t.key] === 0}
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td>
                                {short > 0 ? (
                                  <span className="lt-badge short">−{short}</span>
                                ) : (
                                  <span className="lt-badge ok"><Check size={11} strokeWidth={2.5} /> ок</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {isModalOpen && selectedBooking && (
        <EditBookingModal
          booking={selectedBooking}
          objectId={selectedBooking.objectId}
          onClose={closeModal}
          onUpdate={updateBookingItems}
        />
      )}
    </div>
  );
}

// ----- WarehouseTab -----
function WarehouseTab({ state, setState }) {
  const setQty = (key, val) => {
    const v = Math.max(0, Math.round(val));
    setState((s) => ({ ...s, stock: { ...s.stock, [key]: v } }));
  };
  return (
    <div>
      <header className="lt-header">
        <div>
          <h1>Склад чистого белья</h1>
          <p className="lt-sub">Общий остаток на оба объекта. Меняется вручную или автоматически при возврате из стирки.</p>
        </div>
      </header>
      <div className="lt-tablewrap">
        {CATEGORIES.map((cat) => (
          <div key={cat.key} className="lt-section">
            <div className="lt-section-title">{cat.label}</div>
            <div className="lt-stockgrid">
              {LINEN_TYPES.filter((t) => t.cat === cat.key).map((t) => (
                <div className="lt-stockrow" key={t.key}>
                  <span className="lt-stockname">{t.name}</span>
                  <div className="lt-stepper">
                    <button onClick={() => setQty(t.key, (state.stock[t.key] || 0) - 1)}>
                      <Minus size={13} strokeWidth={2.2} />
                    </button>
                    <input
                      type="number"
                      className="mono"
                      value={state.stock[t.key] || 0}
                      onChange={(e) => setQty(t.key, Number(e.target.value) || 0)}
                    />
                    <button onClick={() => setQty(t.key, (state.stock[t.key] || 0) + 1)}>
                      <Plus size={13} strokeWidth={2.2} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----- BookingsTab -----
function BookingsTab({ state, setState, objFilter, setObjFilter }) {
  const [expanded, setExpanded] = useState({});
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const updateGuests = (objId, bookingId, newGuests) => {
    const guests = Math.max(1, parseInt(newGuests) || 1);
    const newItems = getLinenSet(objId, guests);
    setState((prev) => ({
      ...prev,
      objects: prev.objects.map((obj) =>
        obj.id === objId
          ? {
              ...obj,
              bookings: obj.bookings.map((b) =>
                b.id === bookingId ? { ...b, guests, items: newItems } : b
              ),
            }
          : obj
      ),
    }));
  };

  const toggleExpand = (objId, type) => {
    setExpanded((prev) => ({
      ...prev,
      [`${objId}-${type}`]: !prev[`${objId}-${type}`],
    }));
  };

  const openModal = (objId, booking) => {
    setSelectedBooking({ ...booking, objectId: objId });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedBooking(null);
  };

  const handleItemChange = (key, value) => {
    if (!selectedBooking) return;
    const newItems = { ...selectedBooking.items, [key]: Math.max(0, Number(value) || 0) };
    setState((prev) => ({
      ...prev,
      objects: prev.objects.map((obj) =>
        obj.id === selectedBooking.objectId
          ? {
              ...obj,
              bookings: obj.bookings.map((b) =>
                b.id === selectedBooking.id ? { ...b, items: newItems } : b
              ),
            }
          : obj
      ),
    }));
    setSelectedBooking({ ...selectedBooking, items: newItems });
  };

  const filteredObjects = state.objects.filter(
    (obj) => objFilter === obj.id
  );

  return (
    <div>
      <header className="lt-header">
        <div>
          <h1>Брони</h1>
        </div>
        <div className="lt-objfilter">
          {state.objects.map((o) => (
            <button
              key={o.id}
              className={objFilter === o.id ? "active" : ""}
              onClick={() => setObjFilter(o.id)}
            >
              {o.name}
            </button>
          ))}
        </div>
      </header>

      {filteredObjects.map((obj) => {
        const sorted = [...obj.bookings].sort((a, b) => a.checkIn - b.checkIn);
        const past = sorted.filter((b) => b.checkOut < today);
        const future = sorted.filter((b) => b.checkIn >= today);
        const visibleFuture = future.slice(0, 4);
        const hiddenFuture = future.slice(4);

        return (
          <div className="lt-section" key={obj.id}>

            {visibleFuture.length > 0 && (
              <table className="lt-table">
                <thead>
                  <tr>
                    <th>Гость</th>
                    <th>Заезд</th>
                    <th>Выезд</th>
                    <th>Гостей</th>
                    <th>Статус</th>
                    <th>RC №</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFuture.map((b) => (
                    <tr key={b.id} onClick={() => openModal(obj.id, b)} style={{ cursor: 'pointer' }}>
                      <td>{b.guest}</td>
                      <td className="mono">{fmt(b.checkIn)}</td>
                      <td className="mono">{fmt(b.checkOut)}</td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          className="mono lt-guest-input"
                          value={b.guests}
                          onChange={(e) => updateGuests(obj.id, b.id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td>
                        <span className="lt-badge status-будущая">будущая</span>
                      </td>
                      <td className="mono lt-dim">{b.rc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {hiddenFuture.length > 0 && (
              <div style={{ marginTop: '8px', marginBottom: '12px' }}>
                <button
                  className="lt-history-toggle"
                  onClick={() => toggleExpand(obj.id, 'future')}
                >
                  {expanded[`${obj.id}-future`] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expanded[`${obj.id}-future`] ? 'Скрыть' : 'Показать'} остальные будущие брони ({hiddenFuture.length})
                </button>
                {expanded[`${obj.id}-future`] && (
                  <table className="lt-table" style={{ marginTop: '8px' }}>
                    <thead>
                      <tr>
                        <th>Гость</th>
                        <th>Заезд</th>
                        <th>Выезд</th>
                        <th>Гостей</th>
                        <th>Статус</th>
                        <th>RC №</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hiddenFuture.map((b) => (
                        <tr key={b.id} onClick={() => openModal(obj.id, b)} style={{ cursor: 'pointer' }}>
                          <td>{b.guest}</td>
                          <td className="mono">{fmt(b.checkIn)}</td>
                          <td className="mono">{fmt(b.checkOut)}</td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              className="mono lt-guest-input"
                              value={b.guests}
                              onChange={(e) => updateGuests(obj.id, b.id, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td>
                            <span className="lt-badge status-будущая">будущая</span>
                          </td>
                          <td className="mono lt-dim">{b.rc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {past.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <button
                  className="lt-history-toggle"
                  onClick={() => toggleExpand(obj.id, 'history')}
                >
                  {expanded[`${obj.id}-history`] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  История завершённых броней ({past.length})
                </button>
                {expanded[`${obj.id}-history`] && (
                  <table className="lt-table" style={{ marginTop: '8px' }}>
                    <thead>
                      <tr>
                        <th>Гость</th>
                        <th>Заезд</th>
                        <th>Выезд</th>
                        <th>Гостей</th>
                        <th>Статус</th>
                        <th>RC №</th>
                      </tr>
                    </thead>
                    <tbody>
                      {past.map((b) => (
                        <tr key={b.id} onClick={() => openModal(obj.id, b)} style={{ cursor: 'pointer' }}>
                          <td>{b.guest}</td>
                          <td className="mono">{fmt(b.checkIn)}</td>
                          <td className="mono">{fmt(b.checkOut)}</td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              className="mono lt-guest-input"
                              value={b.guests}
                              onChange={(e) => updateGuests(obj.id, b.id, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td>
                            <span className="lt-badge status-завершена">завершена</span>
                          </td>
                          <td className="mono lt-dim">{b.rc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {sorted.length === 0 && (
              <div className="lt-empty">Нет бронирований для этого объекта</div>
            )}
          </div>
        );
      })}

      {isModalOpen && selectedBooking && (
        <div className="lt-modal-overlay" onClick={closeModal}>
          <div className="lt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lt-modal-header">
              <h3>Редактирование комплекта белья</h3>
              <button onClick={closeModal} className="lt-modal-close">×</button>
            </div>
            <div className="lt-modal-body">
              <p><strong>Бронь:</strong> {selectedBooking.guest}</p>
              <p><strong>Гостей:</strong> {selectedBooking.guests}</p>
              <table className="lt-table">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Количество</th>
                  </tr>
                </thead>
                <tbody>
                  {LINEN_TYPES.map((t) => (
                    <tr key={t.key}>
                      <td>{t.name}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          className="mono lt-guest-input"
                          value={selectedBooking.items?.[t.key] || 0}
                          onChange={(e) => handleItemChange(t.key, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lt-modal-footer">
              <button onClick={closeModal} className="lt-btn-primary">Готово</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- LaundryTab -----
function LaundryTab({ state, setState }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const active = state.laundry.filter((l) => l.status === "in_laundry");
  const history = state.laundry
    .filter((l) => l.status === "returned")
    .sort((a, b) => b.checkOut - a.checkOut);

  const updateItem = (entryId, key, delta) => {
    setState((s) => ({
      ...s,
      laundry: s.laundry.map((l) => {
        if (l.id !== entryId) return l;
        const cur = l.items[key] || 0;
        const next = Math.max(0, cur + delta);
        const items = { ...l.items };
        if (next === 0) delete items[key];
        else items[key] = next;
        return { ...l, items };
      }),
    }));
  };

  const addItem = (entryId, key) => {
    if (!key) return;
    setState((s) => ({
      ...s,
      laundry: s.laundry.map((l) =>
        l.id === entryId ? { ...l, items: { ...l.items, [key]: (l.items[key] || 0) + 1 } } : l
      ),
    }));
  };

  const returnToStock = (entryId) => {
    setState((s) => {
      const entry = s.laundry.find((l) => l.id === entryId);
      if (!entry) return s;
      const stock = { ...s.stock };
      for (const [k, v] of Object.entries(entry.items)) {
        stock[k] = (stock[k] || 0) + v;
      }
      return {
        ...s,
        stock,
        laundry: s.laundry.map((l) => (l.id === entryId ? { ...l, status: "returned" } : l)),
      };
    });
  };

  return (
    <div>
      <header className="lt-header">
        <div>
          <h1>В стирке</h1>
          <p className="lt-sub">
            Комплекты попадают сюда автоматически после даты выезда. Количество можно
            скорректировать вручную перед сдачей в стирку.
          </p>
        </div>
      </header>

      {active.length === 0 && (
        <div className="lt-empty">Сейчас ничего не в стирке — все выезды закрыты.</div>
      )}

      <div className="lt-laundrylist">
        {active
          .sort((a, b) => b.checkOut - a.checkOut)
          .map((entry) => (
            <div className="lt-lcard" key={entry.id}>
              <div className="lt-lcard-head">
                <div>
                  <div className="lt-lcard-title">
                    {entry.objectName} · {entry.guest}
                  </div>
                  <div className="lt-lcard-sub mono">выезд {fmt(entry.checkOut)}</div>
                </div>
                <button className="lt-btn-primary" onClick={() => returnToStock(entry.id)}>
                  <RotateCcw size={13} strokeWidth={2} /> Вернуть на склад
                </button>
              </div>
              <div className="lt-litems">
                {Object.entries(entry.items).map(([k, v]) => (
                  <div className="lt-litem" key={k}>
                    <span>{typeByKey[k]?.name || k}</span>
                    <div className="lt-stepper">
                      <button onClick={() => updateItem(entry.id, k, -1)}>
                        <Minus size={13} strokeWidth={2.2} />
                      </button>
                      <span className="mono">{v}</span>
                      <button onClick={() => updateItem(entry.id, k, 1)}>
                        <Plus size={13} strokeWidth={2.2} />
                      </button>
                    </div>
                  </div>
                ))}
                <AddItemPicker onAdd={(key) => addItem(entry.id, key)} exclude={entry.items} />
              </div>
            </div>
          ))}
      </div>

      {history.length > 0 && (
        <div className="lt-history">
          <button className="lt-history-toggle" onClick={() => setHistoryOpen((v) => !v)}>
            {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            История возвратов ({history.length})
          </button>
          {historyOpen && (
            <div className="lt-tablewrap">
              <table className="lt-table">
                <thead>
                  <tr>
                    <th>Объект</th>
                    <th>Гость</th>
                    <th>Выезд</th>
                    <th>Позиций</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{h.objectName}</td>
                      <td>{h.guest}</td>
                      <td className="mono">{fmt(h.checkOut)}</td>
                      <td className="mono">
                        {Object.values(h.items).reduce((a, b) => a + b, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----- AddItemPicker -----
function AddItemPicker({ onAdd, exclude }) {
  const [open, setOpen] = useState(false);
  const options = LINEN_TYPES.filter((t) => !(exclude && exclude[t.key]));
  if (!open) {
    return (
      <button className="lt-additem" onClick={() => setOpen(true)}>
        <Plus size={12} strokeWidth={2.2} /> добавить позицию
      </button>
    );
  }
  return (
    <select
      autoFocus
      className="lt-select"
      onChange={(e) => {
        onAdd(e.target.value);
        setOpen(false);
      }}
      onBlur={() => setOpen(false)}
      defaultValue=""
    >
      <option value="" disabled>
        выбрать тип…
      </option>
      {options.map((t) => (
        <option key={t.key} value={t.key}>
          {CATEGORIES.find((c) => c.key === t.cat)?.label} · {t.name}
        </option>
      ))}
    </select>
  );
}

// ----- EditBookingModal -----
function EditBookingModal({ booking, objectId, onClose, onUpdate }) {
  const [items, setItems] = useState(booking.items || {});
  const handleChange = (key, value) => {
    const num = Math.max(0, Number(value) || 0);
    const newItems = { ...items, [key]: num };
    setItems(newItems);
  };
  const save = () => {
    onUpdate(objectId, booking.id, items);
    onClose();
  };
  return (
    <div className="lt-modal-overlay" onClick={onClose}>
      <div className="lt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lt-modal-header">
          <h3>Редактирование комплекта белья</h3>
          <button onClick={onClose} className="lt-modal-close">×</button>
        </div>
        <div className="lt-modal-body">
          <p><strong>Бронь:</strong> {booking.guest}</p>
          <p><strong>Гостей:</strong> {booking.guests}</p>
          <table className="lt-table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>Количество</th>
              </tr>
            </thead>
            <tbody>
              {LINEN_TYPES.map((t) => (
                <tr key={t.key}>
                  <td>{t.name}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      className="mono lt-guest-input"
                      value={items[t.key] || 0}
                      onChange={(e) => handleChange(t.key, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lt-modal-footer">
          <button onClick={save} className="lt-btn-primary">Сохранить</button>
        </div>
      </div>
    </div>
  );
}

// ---------- CSS ----------
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Work+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.lt-root {
  /* фирменная шкала (тёмный -> светлый) */
  --navy: #213140;
  --slate: #4F6472;
  --mist: #8F9EAB;
  --lavender: #E1DDEB;

  /* фон и поверхности — всё чисто белое, разделяем бордером/тенью */
  --linen: #FFFFFF;
  --paper: #FFFFFF;

  /* текст — только оттенки чёрного */
  --ink: #1C1B19;
  --ink-soft: #5A5750;
  --ink-faint: #8E8B84;

  /* служебные акценты (базируются на фирменной шкале) */
  --line: var(--lavender);
  --chambray: var(--navy);
  --chambray-soft: #EDEAF3;
  --rust: #bb6853;
  --rust-soft: #F2E1DA;
  --sage: #4F7057;
  --sage-soft: #E1EADF;
  --shadow: 0 1px 2px rgba(33,49,64,0.05), 0 1px 8px rgba(33,49,64,0.04);

  display: flex;
  min-height: 100%;
  background: var(--linen);
  color: var(--ink);
  font-family: 'Onest', sans-serif;
  font-size: 14.5px;
}
.lt-root * { box-sizing: border-box; }

.lt-sidebar {
  width: 216px;
  flex-shrink: 0;
  background: #e9f4fc;
  border-right: 1px solid var(--line);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.lt-brand { display: flex; align-items: center; gap: 10px; padding: 0 4px; }
.lt-brand-mark {
  width: 32px; height: 32px; border-radius: 7px;
  background: var(--navy); color: #FFFFFF;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Golos Text', sans-serif; font-weight: 600; font-size: 16px;
}
.lt-brand-title { font-family: 'Golos Text', sans-serif; font-weight: 600; font-size: 15.5px; color: var(--ink); }
.lt-brand-sub { font-size: 11px; color: var(--ink-faint); margin-top: 1px; }

.lt-nav { display: flex; flex-direction: column; gap: 2px; }
.lt-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: 6px; border: none;
  background: transparent; color: var(--ink-soft);
  font-family: 'Onest', sans-serif; font-size: 14px;
  font-weight: 500;
  cursor: pointer; text-align: left;
}
.lt-nav-item:hover { background: #bdd1dd; color: var(--ink); }
.lt-nav-item.active { background: #2c3248; color: #FFFFFF; }

.lt-sidebar-foot {
  margin-top: auto; display: flex; gap: 6px; align-items: flex-start;
  font-size: 11px; color: var(--ink-faint); line-height: 1.4;
  padding: 10px; border-top: 1px dashed var(--line);
}

.lt-main { flex: 1; padding: 30px 36px 60px; overflow-y: auto; }

.lt-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
.lt-header h1 { font-family: 'Golos Text', sans-serif; font-weight: 600; font-size: 26px; color: var(--ink); margin: 0 0 5px; letter-spacing: -0.01em; }
.lt-sub { color: var(--ink-soft); font-size: 13px; margin: 0; max-width: 520px; line-height: 1.55; }

.lt-objfilter { display: flex; gap: 4px; background: var(--paper); border: 1px solid var(--line); box-shadow: var(--shadow); border-radius: 8px; padding: 3px; }
.lt-objfilter button { border: none; background: transparent; padding: 6px 12px; border-radius: 6px; font-size: 14px; font-weight: 500; color: var(--ink-soft); cursor: pointer; font-family: 'Onest', sans-serif; }
.lt-objfilter button.active { background: #2c3248; color: white; }

.lt-alertbar {
  display: flex; align-items: center; gap: 8px;
  background: var(--rust-soft); color: var(--rust);
  border-radius: 8px; padding: 10px 14px; font-size: 13px; font-weight: 500;
  margin-bottom: 20px;
}
.lt-alertbar svg { flex-shrink: 0; }

.lt-objcards { display: flex; gap: 14px; margin-bottom: 28px; flex-wrap: wrap; }
.lt-card { flex: 1; min-width: 260px; background: var(--paper); border: 1px solid var(--line); box-shadow: var(--shadow); border-radius: 10px; padding: 15px 17px; }
.lt-card-head { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 14px; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px dashed var(--line); }
.lt-tag-id { margin-left: auto; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); background: var(--linen); padding: 2px 6px; border-radius: 4px; }
.lt-timeline { display: flex; flex-direction: column; gap: 8px; }
.lt-tl-item { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.lt-tl-dates { font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
.lt-tl-meta { display: flex; align-items: center; gap: 4px; color: var(--ink-soft); font-size: 13px; }
.lt-empty-small { color: var(--ink-soft); font-size: 13px; font-style: italic; }
.lt-empty { color: var(--ink-soft); font-size: 14px; font-style: italic; padding: 16px 0; }

.lt-section { margin-bottom: 26px; }
.lt-section-title {
  font-family: 'Golos Text', sans-serif; font-weight: 600; font-size: 17px; color: var(--ink);
  padding-bottom: 8px; margin-bottom: 11px; border-bottom: 1px dashed var(--line);
  display: flex; align-items: center; gap: 8px;
}

.lt-table { width: 100%; border-collapse: collapse; background: var(--paper); border: 1px solid var(--line); box-shadow: var(--shadow); border-radius: 8px; overflow: hidden; }
.lt-table th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); font-weight: 600; padding: 9px 12px; border-bottom: 1px solid var(--line); }
.lt-table td { padding: 9px 12px; border-bottom: 1px solid var(--line); font-size: 14px; }
.lt-table tr:last-child td { border-bottom: none; }
.mono { font-family: 'IBM Plex Mono', monospace; }
.lt-dim { color: var(--ink-soft); }

.lt-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 20px; font-family: 'IBM Plex Mono', monospace; }
.lt-badge.short { background: var(--rust-soft); color: var(--rust); }
.lt-badge.ok { background: var(--sage-soft); color: var(--sage); font-family: 'Onest', sans-serif; }
.lt-badge.status-завершена { background: #ECEAE6; color: var(--ink-soft); font-family: 'Onest', sans-serif; }
.lt-badge.status-идёт { background: var(--chambray-soft); color: var(--navy); font-family: 'Onest', sans-serif; }
.lt-badge.status-будущая { background: var(--sage-soft); color: var(--sage); font-family: 'Onest', sans-serif; }

.lt-stockgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.lt-stockrow { display: flex; align-items: center; justify-content: space-between; background: var(--paper); border: 1px solid var(--line); border-radius: 7px; padding: 9px 11px; gap: 10px; }
.lt-stockname { font-size: 13px; }
.lt-stepper { display: flex; align-items: center; gap: 6px; }
.lt-stepper button { width: 21px; height: 21px; border-radius: 5px; border: 1px solid var(--line); background: white; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--slate); }
.lt-stepper button:hover { background: var(--chambray-soft); color: var(--navy); }
.lt-stepper input { width: 34px; text-align: center; border: none; background: transparent; font-size: 13px; }
.lt-stepper.small button { width: 16px; height: 16px; }
.lt-kitinput { width: 46px; border: 1px solid var(--line); border-radius: 5px; padding: 3px 5px; text-align: center; font-size: 12.5px; }

.lt-kitgroup { margin-bottom: 12px; }
.lt-kitgroup-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); margin-bottom: 6px; }

.lt-laundrylist { display: flex; flex-direction: column; gap: 12px; }
.lt-lcard { background: var(--paper); border: 1px solid var(--line); box-shadow: var(--shadow); border-radius: 10px; padding: 15px 17px; }
.lt-lcard-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px dashed var(--line); }
.lt-lcard-title { font-weight: 600; font-size: 14px; }
.lt-lcard-sub { color: var(--ink-soft); font-size: 12px; margin-top: 2px; }
.lt-btn-primary { display: flex; align-items: center; gap: 6px; background: var(--navy); color: white; border: none; border-radius: 7px; padding: 7px 13px; font-size: 12.5px; font-weight: 500; cursor: pointer; font-family: 'Onest', sans-serif; }
.lt-btn-primary:hover { background: #17222C; }
.lt-litems { display: flex; flex-wrap: wrap; gap: 8px; }
.lt-litem { display: flex; align-items: center; gap: 8px; background: var(--linen); border-radius: 20px; padding: 4px 8px 4px 14px; font-size: 13px; }
.lt-additem { display: flex; align-items: center; gap: 4px; border: 1px dashed var(--line); background: transparent; border-radius: 20px; padding: 5px 12px; font-size: 12px; color: var(--ink-soft); cursor: pointer; font-family: 'Onest', sans-serif; }
.lt-additem:hover { color: var(--navy); border-color: var(--mist); }
.lt-select { border: 1px solid var(--line); border-radius: 20px; padding: 5px 10px; font-size: 12px; font-family: 'Onest', sans-serif; }

.lt-history { margin-top: 26px; }
.lt-history-toggle { display: flex; align-items: center; gap: 6px; background: transparent; border: none; color: var(--ink-soft); font-size: 12.5px; font-weight: 500; cursor: pointer; padding: 6px 0; font-family: 'Onest', sans-serif; }
.lt-history-toggle:hover { color: var(--ink); }
.lt-guest-input {
  width: 60px;
  text-align: center;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 4px 2px;
  font-size: 12.5px;
  font-family: 'IBM Plex Mono', monospace;
  background: var(--paper);
  color: var(--ink);
}
.lt-stock-btn {
  width: 21px;
  height: 21px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--slate);
  line-height: 1;
  padding: 0;
}
.lt-stock-btn:hover {
  background: var(--chambray-soft);
  color: var(--navy);
}
.lt-stock-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #ECE9E3;
}
/* Скрываем стрелки в полях ввода количества на складе */
.lt-stepper input[type=number]::-webkit-inner-spin-button,
.lt-stepper input[type=number]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.lt-stepper input[type=number] {
  -moz-appearance: textfield; /* для Firefox */
}
.lt-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(33,49,64,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.lt-modal {
  background: var(--paper);
  border-radius: 12px;
  max-width: 600px;
  width: 100%;
  padding: 20px;
  max-height: 80vh;
  overflow-y: auto;
  color: var(--ink);
  box-shadow: 0 12px 32px rgba(33,49,64,0.22);
}
.lt-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding-bottom: 10px;
  margin-bottom: 15px;
}
.lt-modal-header h2, .lt-modal-header h3 { font-family: 'Golos Text', sans-serif; font-weight: 600; }
.lt-modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--ink-soft);
}
.lt-modal-footer {
  margin-top: 15px;
  text-align: right;
}
@media (max-width: 720px) {
  .lt-root {
    flex-direction: column;
  }
  .lt-sidebar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    flex-direction: row;
    justify-content: space-around;
    background: #e9f4fc;
    border-top: 1px solid var(--line);
    padding: 6px 10px;
    z-index: 100;
    height: 60px;
    box-shadow: 0 -2px 8px rgba(0,0,0,0.05);
  }
  .lt-brand {
    display: none;
  }
  .lt-nav {
    flex-direction: row;
    justify-content: space-around;
    width: 100%;
    gap: 0;
  }
  .lt-nav-item {
    flex-direction: column;
    gap: 2px;
    padding: 4px 6px;
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
    background: transparent;
    border: none;
    color: var(--ink-soft);
    align-items: center;
    justify-content: center;
    flex: 1;
  }
  .lt-nav-item svg {
    width: 20px;
    height: 20px;
    margin-bottom: 1px;
  }
  .lt-nav-item.active {
    background: transparent;
    color: var(--chambray);
  }
  .lt-nav-item span {
    font-size: 9px;
    line-height: 1.2;
  }
  .lt-sidebar-foot {
    display: none;
  }
  .lt-main {
    padding: 18px 18px 80px 18px;
    flex: 1;
    overflow-y: auto;
  }
  .lt-guest-input {
    width: 70px !important;
    height: 36px !important;
    font-size: 16px !important;
  }
  .lt-stepper button {
    width: 36px !important;
    height: 36px !important;
    font-size: 18px !important;
  }
}
`;

// Экспорт по умолчанию уже есть в App
