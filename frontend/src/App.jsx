import React, { useEffect, useState, useCallback } from 'react';
import { db, auth, isFirebaseConfigured } from './firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const DEFAULT_COUNTRIES = [
  { id: 'uk',  name: 'UNITED KINGDOM', rpm: 51.61 },
  { id: 'ca',  name: 'CANADA',         rpm: 51.23 },
  { id: 'us',  name: 'EUA',            rpm: 47.41 },
  { id: 'de',  name: 'GERMANY',        rpm: 37.87 },
  { id: 'au',  name: 'AUSTRALIA',      rpm: 35.77 },
  { id: 'nl',  name: 'NETHERLANDS',    rpm: 32.15 },
  { id: 'fr',  name: 'FRANCE',         rpm: 25.99 },
  { id: 'pt',  name: 'PORTUGAL',       rpm: 25.94 },
  { id: 'ph',  name: 'FILIPINAS',      rpm: 12.23 },
  { id: 'ng',  name: 'NIGERIA',        rpm: 12.06 },
  { id: 'br',  name: 'BRAZIL',         rpm: 11.92 },
  { id: 'id',  name: 'INDONESIA',      rpm:  9.63 },
  { id: 'kz',  name: 'CAZAQUISTÃO',    rpm:  8.02 },
  { id: 'tr',  name: 'TURKEY',         rpm:  7.53 },
];

const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

const fmt = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
const fmtInt = (val) => (val === 0 || val) ? new Intl.NumberFormat('pt-BR').format(val) : '';
const parseMask = (val) => parseInt(val.toString().replace(/\D/g, '')) || 0;
const uid = () => Math.random().toString(36).slice(2, 9);
const getMonthStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ─── LOCAL STORAGE HELPERS ──────────────────────────────────────────────────

function ls(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function lsSet(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

// ─── INITIAL STATE & MIGRATION ──────────────────────────────────────────────

function initState() {
  const currentMonthStr = getMonthStr(new Date());

  // Migrate accounts
  let rawAccounts = ls('accounts', null);
  if (!rawAccounts) {
    rawAccounts = [{ id: uid(), name: 'Conta 1', views: {} }];
  } else {
    // Check if views is flat (old structure without month keys)
    rawAccounts = rawAccounts.map(acc => {
      const views = acc.views || {};
      const keys = Object.keys(views);
      // If there are keys and none of them match YYYY-MM pattern, it's old flat structure
      if (keys.length > 0 && !keys.some(k => /^\d{4}-\d{2}$/.test(k))) {
        return { ...acc, views: { [currentMonthStr]: views } };
      }
      return acc;
    });
  }

  // Migrate videoCount
  let rawVideoCount = ls('videoCount', {});
  if (typeof rawVideoCount === 'number') {
    rawVideoCount = { [currentMonthStr]: rawVideoCount };
  }

  // Migrate videoGoal
  let rawVideoGoal = ls('videoGoal', {});
  if (typeof rawVideoGoal === 'number') {
    rawVideoGoal = { [currentMonthStr]: rawVideoGoal };
  }

  return {
    countries: ls('countries', DEFAULT_COUNTRIES),
    accounts: rawAccounts,
    videoCount: rawVideoCount,
    videoGoal: rawVideoGoal,
    quarterly: ls('quarterly', []),
    geminiKey: ls('geminiKey', ''),
  };
}

// ─── GEMINI AI ──────────────────────────────────────────────────────────────

async function askGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta.';
}

// ─── APP ────────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(undefined); // undefined=loading, null=logged_out, false=local_mode
  const [state, setStateRaw] = useState(initState);
  const [activeTab, setActiveTab] = useState('resumo');
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthStr(new Date()));

  // Setup Auth Monitor
  useEffect(() => {
    if (!isFirebaseConfigured) {
      setUser(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u || null);
    });
    return () => unsub();
  }, []);

  // Fetch Cloud Data when logged in
  useEffect(() => {
    if (!user || user === false) return; // not logged in or in local mode

    const fetchUserData = async () => {
      try {
        const ref = doc(db, 'projects', 'master_finance'); // Modo Dados Globais
        const d = await getDoc(ref);
        if (d.exists()) {
          // Merge cloud data over initial state to avoid missing keys
          setStateRaw(s => ({ ...s, ...d.data() }));
        } else {
          // First time logging in (Global Master): migrate from LocalStorage
          await setDoc(ref, state);
        }
      } catch (err) {
        console.error("Erro ao puxar dados da nuvem", err);
      }
    };
    fetchUserData();
  }, [user]);

  const setState = useCallback((updater) => {
    setStateRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      
      // Save logic: Cloud or Local
      if (user === false) { 
        // Local Mode
        lsSet('countries', next.countries);
        lsSet('accounts', next.accounts);
        lsSet('videoCount', next.videoCount);
        lsSet('videoGoal', next.videoGoal);
        lsSet('quarterly', next.quarterly);
        lsSet('geminiKey', next.geminiKey);
      } else if (user) { 
        // Cloud Mode (Global Master Data)
        setDoc(doc(db, 'projects', 'master_finance'), next).catch(err => console.error("Erro ao salvar", err));
      }

      return next;
    });
  }, [user]);

  // Loading Screen
  if (user === undefined) {
    return <div style={{ color: 'white', padding: 40, fontFamily: 'Sora' }}>Carregando...</div>;
  }

  // Login Screen
  if (user === null) {
    return <LoginScreen />;
  }

  // Parse selected month
  const [selYear, selMonthIdx] = selectedMonth.split('-').map(Number);
  const currentShowDate = new Date(selYear, selMonthIdx - 1, 1);

  // Derived helpers
  const totalEstimado = computeTotal(state.accounts, state.countries, selectedMonth);
  const totalTrimestral = state.quarterly.reduce((s, q) => s + Number(q.valor || 0), 0);
  const totalGeral = totalEstimado + totalTrimestral;

  const nextPayDt = new Date(selYear, selMonthIdx, 25);
  const nextPayStr = `25 de ${MONTH_NAMES[nextPayDt.getMonth()]} de ${nextPayDt.getFullYear()}`;

  const tabs = [
    { id: 'resumo',     icon: '📊', label: 'Resumo' },
    { id: 'contas',     icon: '📋', label: 'Contas' },
    { id: 'videos',     icon: '🎬', label: 'Vídeos' },
    { id: 'pagamentos', icon: '💳', label: 'Pagamentos' },
    { id: 'config',     icon: '⚙',  label: 'Config' },
  ];

  // Month selector options
  const monthOptions = [];
  const now = new Date();
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
    for (let m = 0; m < 12; m++) {
      const val = `${y}-${String(m + 1).padStart(2, '0')}`;
      const label = `${MONTH_NAMES[m]} ${y}`;
      monthOptions.push({ val, label });
    }
  }

  return (
    <div className="app-wrapper">
      {/* TOP NAV */}
      <nav className="topnav">
        <div className="topnav-brand" style={{ gap: 20 }}>
          <span className="topnav-logo">◫ Creator<span>Finance</span></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select 
              value={selectedMonth} 
              onChange={e => setSelectedMonth(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '4px 10px',
                borderRadius: '6px',
                fontFamily: 'Sora',
                fontSize: 12,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {monthOptions.map(opt => (
                <option key={opt.val} value={opt.val} style={{background: '#0d1117'}}>{opt.label}</option>
              ))}
            </select>
            <div className="topnav-sub">Próx. pagamento: {nextPayStr}</div>
          </div>
        </div>
        <div className="topnav-right">
          <span className="topnav-total">{fmt(totalEstimado)}</span>
        </div>
      </nav>

      {/* TAB NAV */}
      <div className="tabnav">
        {tabs.map(t => (
          <button key={t.id} className={`tabnav-btn ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div className="main fade-in">
        {activeTab === 'resumo'     && <TabResumo     state={state} setState={setState} selectedMonth={selectedMonth} currentShowDate={currentShowDate} totalEstimado={totalEstimado} totalTrimestral={totalTrimestral} totalGeral={totalGeral} nextPayStr={nextPayStr} />}
        {activeTab === 'contas'     && <TabContas     state={state} setState={setState} selectedMonth={selectedMonth} currentShowDate={currentShowDate} />}
        {activeTab === 'videos'     && <TabVideos     state={state} setState={setState} selectedMonth={selectedMonth} />}
        {activeTab === 'pagamentos' && <TabPagamentos state={state} setState={setState} currentShowDate={currentShowDate} totalEstimado={totalEstimado} />}
        {activeTab === 'config'     && <TabConfig     state={state} setState={setState} user={user} />}
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ───────────────────────────────────────────────────────────

function LoginScreen() {
  const login = () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch(err => alert("Erro ao logar: " + err.message));
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-dark)' }}>
      <div className="card fade-in" style={{ width: 340, textAlign: 'center', padding: '40px 30px' }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'white', marginBottom: 6, fontFamily: 'Sora' }}>
          ◫ Creator<span style={{ color: 'var(--accent-red)' }}>Finance</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 28 }}>Faça login pelo Google para acessar seu controle financeiro isolado e sincronizado na nuvem.</p>
        <button className="btn-gold" style={{ width: '100%', display: 'flex', gap: 10, justifyContent: 'center', padding: '12px', fontSize: 14 }} onClick={login}>
          <svg style={{ width: 18, height: 18 }} viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Entrar com Google
        </button>
      </div>
    </div>
  );
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function computeTotal(accounts, countries, month) {
  let total = 0;
  for (const acc of accounts) {
    for (const c of countries) {
      const views = Number(acc.views?.[month]?.[c.id] || 0);
      total += views * c.rpm;
    }
  }
  return total;
}

function computeAccTotal(acc, countries, month) {
  let total = 0;
  for (const c of countries) {
    total += Number(acc.views?.[month]?.[c.id] || 0) * c.rpm;
  }
  return total;
}

function computeCountryTotal(countryId, accounts, rpm, month) {
  return accounts.reduce((s, acc) => s + Number(acc.views?.[month]?.[countryId] || 0) * rpm, 0);
}

// ─── TAB RESUMO ─────────────────────────────────────────────────────────────

function TabResumo({ state, setState, selectedMonth, currentShowDate, totalEstimado, totalTrimestral, totalGeral, nextPayStr }) {
  const { accounts, countries, geminiKey } = state;
  const [geminiPrompt, setGeminiPrompt] = useState('');
  const [geminiMessages, setGeminiMessages] = useState([]);
  const [geminiLoading, setGeminiLoading] = useState(false);

  const vCount = state.videoCount?.[selectedMonth] || 0;
  const vGoal = state.videoGoal?.[selectedMonth] || 500;

  const progress = vGoal > 0 ? Math.min((vCount / vGoal) * 100, 100) : 0;
  const progressColor = progress < 40 ? '#3b82f6' : progress < 75 ? '#f0a500' : '#10b981';

  // breakdown por conta
  const breakdown = accounts.map(acc => {
    const total = computeAccTotal(acc, countries, selectedMonth);
    const pct = totalEstimado > 0 ? ((total / totalEstimado) * 100).toFixed(1) : '0.0';
    return { ...acc, total, pct, payStr: nextPayStr };
  });

  // Top países (somados no mês selecionado)
  const topCountries = countries
    .map(c => ({ ...c, earn: computeCountryTotal(c.id, accounts, c.rpm, selectedMonth) }))
    .filter(c => c.earn > 0)
    .sort((a, b) => b.earn - a.earn)
    .slice(0, 9);

  // Evolução e Tendência
  const currentMonthDate = new Date(currentShowDate.getFullYear(), currentShowDate.getMonth(), 1);
  const prevMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
  
  const totalPrev = computeTotal(accounts, countries, prevMonthKey);
  const diff = totalEstimado - totalPrev;
  const pctChange = totalPrev > 0 ? ((diff / totalPrev) * 100).toFixed(1) : (totalEstimado > 0 ? 100 : 0);

  // Histórico (6 meses)
  const history = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - i, 1);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const val = computeTotal(accounts, countries, mKey);
    history.push({ 
      label: MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase(), 
      val, 
      isCurrent: i === 0,
      fullKey: mKey 
    });
  }
  const maxHistory = Math.max(...history.map(h => h.val), 100);

  const handleAsk = async () => {
    if (!geminiPrompt.trim()) return;
    if (!geminiKey) {
      setGeminiMessages(m => [...m, { role: 'ai', text: 'Configure sua chave da API Gemini na aba ⚙ Config para usar insights com IA.' }]);
      return;
    }
    const userMsg = geminiPrompt;
    setGeminiMessages(m => [...m, { role: 'user', text: userMsg }]);
    setGeminiPrompt('');
    setGeminiLoading(true);
    try {
      const ctx = `Você é um assistente financeiro para criadores de conteúdo TikTok. Dados do mês selecionado (${selectedMonth}):
Total estimado do mês: ${fmt(totalEstimado)}
Ganhos trimestrais globais contínuos: ${fmt(totalTrimestral)}
Projeção geral total: ${fmt(totalGeral)}
Contas no mês: ${accounts.map(a => a.name + ' = ' + fmt(computeAccTotal(a, countries, selectedMonth))).join(', ')}
Pergunta do usuário: ${userMsg}`;
      const resp = await askGemini(geminiKey, ctx);
      setGeminiMessages(m => [...m, { role: 'ai', text: resp }]);
    } catch (e) {
      setGeminiMessages(m => [...m, { role: 'ai', text: 'Erro: ' + e.message }]);
    } finally {
      setGeminiLoading(false);
    }
  };

  return (
    <div>
      {/* 4 CARDS */}
      {/* 4 CARDS PRINCIPAIS */}
      <div className="grid-4">
        <div className="card">
          <div className="card-label">Total Estimado ({MONTH_NAMES[currentShowDate.getMonth()]})</div>
          <div className="card-value-gold">{fmt(totalEstimado)}</div>
          <div className="card-sub">Pagamento: {nextPayStr}</div>
        </div>
        <div className="card">
          <div className="card-label">Ganhos Trimestrais (Publish)</div>
          <div className="card-value-purple">{fmt(totalTrimestral)}</div>
          <div className="card-sub">{state.quarterly.length} lançamento(s) ativo(s)</div>
        </div>
        <div className="card">
          <div className="card-label">Seu Desempenho</div>
          <div className="card-value-green" style={{ color: diff >= 0 ? 'var(--accent-green)' : '#ef4444' }}>
            {diff >= 0 ? '+' : ''}{fmt(diff).replace('R$', '').trim()}
          </div>
          <div className={`trend-badge ${diff >= 0 ? 'trend-up' : 'trend-down'}`}>
            {diff >= 0 ? '▲' : '▼'} {Math.abs(pctChange)}% vs mês ant.
          </div>
        </div>
        <div className="card">
          <div className="card-label">Progresso de Vídeos</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="card-value-blue">{fmtInt(vCount)}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>/ {fmtInt(vGoal)}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${progress}%`, background: progressColor }} />
            </div>
          </div>
          <div className="card-sub" style={{ marginTop: 6 }}>{progress.toFixed(1)}% da meta</div>
        </div>
      </div>

      {/* BREAKDOWN POR CONTA */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <div className="dot-accent" style={{ background: '#3b82f6' }} />
          Breakdown por Conta ({MONTH_NAMES[currentShowDate.getMonth()]} {currentShowDate.getFullYear()})
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Conta</th>
              <th>Estimativa do Mês</th>
              <th>% do Total</th>
              <th>Data de Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map(acc => (
              <tr key={acc.id}>
                <td style={{ fontWeight: 700, color: 'white' }}>{acc.name}</td>
                <td style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-gold)', fontWeight: 700 }}>{fmt(acc.total)}</td>
                <td style={{ color: 'var(--text-muted)' }}>{acc.pct}%</td>
                <td style={{ color: 'var(--text-sub)' }}>{acc.payStr}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <td style={{ fontWeight: 700, color: 'white' }}>Total Geral do Mês</td>
              <td style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-gold)', fontWeight: 700 }}>{fmt(totalEstimado)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* EVOLUÇÃO MENSAL (GRÁFICO) */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <span>📈</span> Evolução dos Ganhos Mensais (Últimos 6 meses)
        </div>
        <div className="evolution-container">
          {history.map((h, i) => {
            const hPct = (h.val / maxHistory) * 100;
            return (
              <div key={i} className="evolution-bar-wrap">
                <div className="evolution-val" style={{ opacity: h.val > 0 ? 1 : 0.3 }}>{fmt(h.val).split(',')[0]}</div>
                <div className="evolution-bar-track">
                  <div 
                    className={`evolution-bar-fill ${h.isCurrent ? 'active' : ''}`} 
                    style={{ height: `${Math.max(hPct, 5)}%` }} 
                  />
                </div>
                <div className="evolution-label">{h.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TOP PAÍSES + GEMINI */}
      <div className="grid-2">
        <div className="card">
          <div className="section-header">
            <span>🌍</span> Top Países (Todas as Contas)
          </div>
          {topCountries.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Insira views nas contas para ver o ranking por país.</div>
          ) : (
            <div className="countries-top-grid">
              {topCountries.map(c => (
                <div key={c.id} className="country-top-item">
                  <span className="country-top-name">{c.name}</span>
                  <span className="country-top-val">{fmt(c.earn)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="gemini-box">
          <div className="section-header">
            <span>✨</span> Insights com Gemini AI
          </div>
          {!geminiKey && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
              Configure sua chave da API Gemini na aba <strong style={{ color: 'var(--accent-gold)' }}>⚙ Config</strong> para usar insights com IA.
            </div>
          )}
          <div className="gemini-messages">
            {geminiMessages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'gemini-msg-user' : 'gemini-msg-ai'}>
                {m.text}
              </div>
            ))}
            {geminiLoading && <div className="gemini-msg-ai" style={{ color: 'var(--accent-gold)' }}>Pensando...</div>}
          </div>
          <div className="gemini-input-row">
            <input
              className="input-dark"
              placeholder="Pergunte sobre seus ganhos..."
              value={geminiPrompt}
              onChange={e => setGeminiPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAsk()}
            />
            <button className="btn-gold" onClick={handleAsk} disabled={geminiLoading}>Perguntar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB CONTAS ──────────────────────────────────────────────────────────────

function TabContas({ state, setState, selectedMonth, currentShowDate }) {
  const { accounts, countries } = state;
  const [selectedId, setSelectedId] = useState(accounts[0]?.id || null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');

  const selectedAcc = accounts.find(a => a.id === selectedId) || accounts[0];

  const handleAdd = () => {
    if (!newName.trim()) return;
    const acc = { id: uid(), name: newName.trim(), views: {} };
    setState(s => ({ ...s, accounts: [...s.accounts, acc] }));
    setSelectedId(acc.id);
    setNewName('');
    setShowNewModal(false);
  };

  const handleDel = (id) => {
    if (!window.confirm('Tem certeza que deseja excluir este canal e todas as suas visualizações? Esta ação é irreversível.')) return;
    setState(s => {
      const accounts = s.accounts.filter(a => a.id !== id);
      return { ...s, accounts };
    });
    if (selectedId === id) setSelectedId(accounts.find(a => a.id !== id)?.id || null);
  };

  const handleViewChange = (countryId, val) => {
    setState(s => {
      const newAccounts = s.accounts.map(a => {
        if (a.id !== selectedAcc.id) return a;
        const monthViews = { ...(a.views?.[selectedMonth] || {}) };
        monthViews[countryId] = val === '' ? '' : parseFloat(val) || 0;
        return { ...a, views: { ...a.views, [selectedMonth]: monthViews } };
      });
      return { ...s, accounts: newAccounts };
    });
  };

  const accTotal = selectedAcc ? computeAccTotal(selectedAcc, countries, selectedMonth) : 0;

  return (
    <div className="accounts-layout">
      {/* SIDEBAR */}
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="accounts-sidebar-header">Minhas Contas</div>
        {accounts.map(acc => (
          <div key={acc.id} className={`account-item ${selectedAcc?.id === acc.id ? 'selected' : ''}`} onClick={() => setSelectedId(acc.id)}>
            <span className="account-item-name">{acc.name}</span>
            <button className="account-item-del" onClick={e => { e.stopPropagation(); handleDel(acc.id); }}>✕</button>
          </div>
        ))}
        <button className="btn-new-account" onClick={() => setShowNewModal(true)}>+ Nova Conta</button>
      </div>

      {/* DETAIL */}
      <div className="accounts-detail">
        {selectedAcc ? (
          <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}>
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'white' }}>{selectedAcc.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Views em Milhões · {MONTH_NAMES[currentShowDate.getMonth()]} {currentShowDate.getFullYear()}
                </div>
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 700, color: 'var(--accent-gold)' }}>{fmt(accTotal)}</div>
            </div>
            {/* Table */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px 24px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>País</th>
                    <th>RPM (R$)</th>
                    <th>Views (Milhões)</th>
                    <th>Ganho Estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {countries.map(c => {
                    const v = selectedAcc.views?.[selectedMonth]?.[c.id] ?? '';
                    const earn = Number(v || 0) * c.rpm;
                    return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 700, color: 'white', fontSize: 12, letterSpacing: 0.5 }}>{c.name}</td>
                        <td style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-sub)' }}>R$ {c.rpm.toFixed(2)}</td>
                        <td>
                          <input
                            className="input-mono"
                            type="number"
                            step="0.001"
                            min="0"
                            placeholder="0"
                            value={v}
                            onChange={e => handleViewChange(c.id, e.target.value)}
                            style={{ width: 110 }}
                          />
                        </td>
                        <td style={{ fontFamily: 'JetBrains Mono, monospace', color: earn > 0 ? 'var(--accent-gold)' : 'var(--text-muted)' }}>
                          {fmt(earn)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="empty-state">
              <div style={{ fontSize: 32 }}>📋</div>
              <div>Adicione ou selecione uma conta para gerenciar views.</div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL NOVA CONTA */}
      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Nova Conta</div>
            <input className="input-dark" placeholder="Nome da conta..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} autoFocus />
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowNewModal(false)}>Cancelar</button>
              <button className="btn-gold" onClick={handleAdd}>Criar Conta</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB VÍDEOS ─────────────────────────────────────────────────────────────

function TabVideos({ state, setState, selectedMonth }) {
  const vCount = state.videoCount?.[selectedMonth] || 0;
  const vGoal = state.videoGoal?.[selectedMonth] || 500;

  const progress = vGoal > 0 ? Math.min((vCount / vGoal) * 100, 100) : 0;
  const progressColor = progress < 40 ? '#3b82f6' : progress < 75 ? '#f0a500' : '#10b981';
  const faltam = Math.max(0, vGoal - vCount);

  const updateCount = (newCount) => {
    setState(s => ({ 
      ...s, 
      videoCount: { ...(s.videoCount || {}), [selectedMonth]: newCount } 
    }));
  };

  const updateGoal = (newGoal) => {
    setState(s => ({ 
      ...s, 
      videoGoal: { ...(s.videoGoal || {}), [selectedMonth]: newGoal } 
    }));
  };

  const inc = () => updateCount(vCount + 1);
  const dec = () => updateCount(Math.max(0, vCount - 1));

  return (
    <div>
      <div className="videos-layout">
        {/* PROGRESSO */}
        <div className="card">
          <div className="section-header">
            <span>🎬</span> Progresso de Vídeos no Mês
          </div>
          <div className="video-counter-box">
            <div className="video-count-num">{vCount}</div>
            <button className="btn-counter btn-counter-plus" onClick={inc}>+1</button>
            <button className="btn-counter btn-counter-minus" onClick={dec}>−1</button>
          </div>
          <div className="video-count-meta">de {fmtInt(vGoal)} (meta)</div>
          <div style={{ marginTop: 14 }}>
            <div className="progress-bar-track" style={{ height: 10 }}>
              <div className="progress-bar-fill" style={{ width: `${progress}%`, background: progressColor }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              faltam {fmtInt(faltam)} vídeo(s) — {progress.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* META */}
        <div className="card">
          <div className="section-header">
            <span>🎯</span> Configurar Meta
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Meta de Vídeos</div>
              <input
                className="input-dark"
                type="text"
                placeholder="Ex: 500"
                value={fmtInt(vGoal)}
                onChange={e => updateGoal(parseMask(e.target.value))}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Vídeos Publicados</div>
              <input
                className="input-dark"
                type="text"
                placeholder="0"
                value={fmtInt(vCount)}
                onChange={e => updateCount(parseMask(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ESTATÍSTICAS */}
      <div className="card" style={{ marginTop: 0 }}>
        <div className="section-header">📈 Estatísticas</div>
        <div className="stats-mini-grid">
          <div className="stat-mini-card">
            <div className="stat-mini-label">Publicados</div>
            <div className="stat-mini-val" style={{ color: 'var(--accent-blue)' }}>{fmtInt(vCount)}</div>
          </div>
          <div className="stat-mini-card">
            <div className="stat-mini-label">Meta</div>
            <div className="stat-mini-val" style={{ color: 'var(--accent-gold)' }}>{fmtInt(vGoal)}</div>
          </div>
          <div className="stat-mini-card">
            <div className="stat-mini-label">Faltam</div>
            <div className="stat-mini-val" style={{ color: faltam === 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{fmtInt(faltam)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB PAGAMENTOS ──────────────────────────────────────────────────────────

function TabPagamentos({ state, setState, currentShowDate, totalEstimado }) {
  const { quarterly } = state;
  const [qTrimestre, setQTrimestre] = useState('');
  const [qValor, setQValor] = useState('');

  // Calendar: show 4 months (prev, current, next, next+1) relative to chosen month
  const months = [-1, 0, 1, 2].map(offset => {
    const d = new Date(currentShowDate.getFullYear(), currentShowDate.getMonth() + offset, 1);
    const viewsMonth = MONTH_NAMES[d.getMonth()];
    const viewsYear = d.getFullYear();
    const payMonth = new Date(d.getFullYear(), d.getMonth() + 1, 25);
    return {
      label: `${viewsMonth} ${viewsYear}`,
      payLabel: `Pago em: 25/${MONTH_NAMES[payMonth.getMonth()].slice(0,3)}/${payMonth.getFullYear()}`,
      isCurrent: offset === 0,
      isPast: offset < 0,
      value: offset === 0 ? totalEstimado : null,
    };
  });

  const addQuarterly = () => {
    if (!qTrimestre.trim() || !qValor) return;
    const entry = { id: uid(), trimestre: qTrimestre.trim(), valor: parseFloat(qValor) || 0, pago: false };
    setState(s => ({ ...s, quarterly: [entry, ...s.quarterly] }));
    setQTrimestre('');
    setQValor('');
  };

  const togglePago = (id) => {
    setState(s => ({
      ...s,
      quarterly: s.quarterly.map(q => q.id === id ? { ...q, pago: !q.pago } : q),
    }));
  };

  const delQuarterly = (id) => {
    setState(s => ({ ...s, quarterly: s.quarterly.filter(q => q.id !== id) }));
  };

  return (
    <div>
      {/* CALENDAR */}
      <div className="section-header" style={{ marginBottom: 14 }}>
        <span>📅</span> Calendário de Pagamentos AdSense
      </div>
      <div className="payment-calendar">
        {months.map((m, i) => (
          <div key={i} className={`pay-month-card ${m.isCurrent ? 'current' : ''}`}>
            <div className="pay-month-name">{m.label} {m.isCurrent ? '← selecionado' : ''}</div>
            <div className="pay-month-date">{m.payLabel}</div>
            {m.isPast && <div className="pay-pago-label">✓ Pago</div>}
            {m.isCurrent && (
              <div className="pay-month-value">{fmt(m.value)}</div>
            )}
          </div>
        ))}
      </div>

      {/* QUARTERLY EARNINGS */}
      <div className="section-header" style={{ marginBottom: 14 }}>
        <span>🔥</span> Ganhos Trimestrais (Publish) globais
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        {/* Form */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <input
            className="input-dark"
            placeholder="Trimestre (ex: Q1 2026)"
            value={qTrimestre}
            onChange={e => setQTrimestre(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addQuarterly()}
          />
          <input
            className="input-dark"
            type="number"
            placeholder="Valor (R$)"
            value={qValor}
            onChange={e => setQValor(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addQuarterly()}
            style={{ width: 160 }}
          />
          <button className="btn-gold" onClick={addQuarterly}>+ Lançar</button>
        </div>

        {/* Table */}
        {quarterly.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nenhum lançamento trimestral ainda.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Trimestre</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Obs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {quarterly.map(q => (
                <tr key={q.id}>
                  <td style={{ fontWeight: 700, color: 'white' }}>{q.trimestre}</td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-purple)', fontWeight: 700 }}>{fmt(q.valor)}</td>
                  <td>
                    <span className={q.pago ? 'badge-paid' : 'badge-pending'} onClick={() => togglePago(q.id)}>
                      {q.pago ? 'Pago' : 'Pendente'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</td>
                  <td>
                    <button className="btn-icon" onClick={() => delQuarterly(q.id)} title="Deletar">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── TAB CONFIG ──────────────────────────────────────────────────────────────

function TabConfig({ state, setState, user }) {
  const { countries, geminiKey } = state;
  const [localKey, setLocalKey] = useState(geminiKey);
  const [newCountry, setNewCountry] = useState('');
  const [newRpm, setNewRpm] = useState('');

  const saveKey = () => {
    setState(s => ({ ...s, geminiKey: localKey }));
  };

  const addCountry = () => {
    if (!newCountry.trim()) return;
    const c = { id: uid(), name: newCountry.trim().toUpperCase(), rpm: parseFloat(newRpm) || 0 };
    setState(s => ({ ...s, countries: [...s.countries, c] }));
    setNewCountry('');
    setNewRpm('');
  };

  const delCountry = (id) => {
    setState(s => ({
      ...s,
      countries: s.countries.filter(c => c.id !== id),
      // Clean up deleted country views
      accounts: s.accounts.map(a => {
        const newViews = { ...a.views };
        for (const month in newViews) {
           const mv = { ...newViews[month] };
           delete mv[id];
           newViews[month] = mv;
        }
        return { ...a, views: newViews };
      }),
    }));
  };

  const updateRpm = (id, val) => {
    setState(s => ({
      ...s,
      countries: s.countries.map(c => c.id === id ? { ...c, rpm: parseFloat(val) || 0 } : c),
    }));
  };

  return (
    <div>
      {/* CLOUD STATUS */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-header" style={{ marginBottom: 14 }}>
          <span>☁️</span> Sincronização em Nuvem (Firebase)
        </div>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16,185,129,0.1)', padding: 14, borderRadius: 8, border: '1px solid rgba(16,185,129,0.2)' }}>
            <div>
              <div style={{ color: 'var(--accent-green)', fontWeight: 700 }}>Modo Dados Globais Ativado</div>
              <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 4 }}>Conectado como {user.displayName || user.email}. Todos os usuários logados com o Google veem e editam os mesmos dados.</div>
            </div>
            <button className="btn-cancel" onClick={() => signOut(auth)}>Sair</button>
          </div>
        ) : (
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: 14, borderRadius: 8, border: '1px dashed rgba(255,255,255,0.1)' }}>
            <div style={{ color: 'white', fontWeight: 700 }}>Modo Local Ativado</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>O SDK do Firebase não está configurado. Usando apenas LocalStorage do navegador.</div>
          </div>
        )}
      </div>

      {/* GEMINI KEY */}
      <div className="card config-section">
        <div className="section-header" style={{ marginBottom: 14 }}>
          <span>✨</span> Chave da API Gemini (Google AI Studio)
        </div>
        <div className="gem-key-input-wrap">
          <input
            className="input-dark"
            type="password"
            placeholder="AIzaSy..."
            value={localKey}
            onChange={e => setLocalKey(e.target.value)}
            onBlur={saveKey}
          />
          <button className="btn-gold" onClick={saveKey}>Salvar</button>
        </div>
        <div className="card-sub" style={{ marginTop: 8 }}>
          Obtenha sua chave em <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>aistudio.google.com</a>
        </div>
      </div>

      {/* PAÍSES */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <span>🌍</span> Países e RPM Global
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Os valores de RPM são compartilhados entre todas as contas. As views são inseridas por conta.
        </div>
        {/* ADD */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <input className="input-dark" placeholder="Nome do país" value={newCountry} onChange={e => setNewCountry(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCountry()} />
          <input className="input-dark" type="number" step="0.01" placeholder="RPM (R$)" value={newRpm} onChange={e => setNewRpm(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCountry()} style={{ width: 140 }} />
          <button className="btn-gold" onClick={addCountry}>+ País</button>
        </div>

        {/* TABLE */}
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>País</th>
              <th>RPM (R$)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {countries.map((c, i) => (
              <tr key={c.id}>
                <td style={{ color: 'var(--text-muted)', width: 40 }}>{i + 1}</td>
                <td style={{ fontWeight: 700, color: 'white', fontSize: 12, letterSpacing: 0.5 }}>{c.name}</td>
                <td>
                  <input
                    className="input-mono"
                    type="number"
                    step="0.01"
                    value={c.rpm}
                    onChange={e => updateRpm(c.id, e.target.value)}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <button className="btn-outline-red" onClick={() => delCountry(c.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
