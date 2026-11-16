import { useEffect, useState } from "react";
import { AppointmentsPage } from "./features/appointments/AppointmentsPage.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { LoginPage } from "./features/auth/LoginPage.js";
import { PatientsPage } from "./features/patients/PatientsPage.js";
import { RecordsPage } from "./features/records/RecordsPage.js";
import { RegistrationPage, type RegistrationId } from "./features/registrations/RegistrationPage.js";
import { SettingsPage } from "./features/settings/SettingsPage.js";
import { apiRequest, type Session } from "./lib/api.js";
import logoImage from "../../../Documentacao/Logo3.png";

type Page = "dashboard" | "appointments" | "patients" | "records" | "settings" | `registration:${RegistrationId}`;

const registrations: Array<{
  id: RegistrationId;
  label: string;
  icon: string;
}> = [
  { id: "clinic", label: "Clínica", icon: "⌂" },
  { id: "user", label: "Usuário", icon: "●" },
  { id: "patient", label: "Paciente", icon: "♡" },
  { id: "therapist", label: "Terapeuta", icon: "✚" },
  { id: "specialty", label: "Especialidade", icon: "✧" },
  { id: "therapy", label: "Terapia", icon: "✦" },
  { id: "protocol", label: "Protocolo", icon: "▤" },
  { id: "diagnosis", label: "Diagnóstico", icon: "⌕" },
  { id: "evolution", label: "Evolução", icon: "↗" },
  { id: "agenda", label: "Agenda", icon: "◷" },
  { id: "encounter", label: "Atendimento", icon: "◉" },
  { id: "chart", label: "Prontuário", icon: "▤" },
];

const navigation: Array<{ id: Page; label: string; icon: string; roles?: Session["activeClinic"]["role"][] }> = [
  { id: "dashboard", label: "Visão geral", icon: "⌂" },
  { id: "appointments", label: "Agenda", icon: "◷", roles: ["THERAPIST", "PATIENT"] },
  { id: "patients", label: "Pacientes", icon: "♡", roles: ["THERAPIST", "PATIENT"] },
  { id: "records", label: "Prontuário", icon: "▤", roles: ["THERAPIST", "PATIENT"] },
  { id: "settings", label: "Configurações", icon: "⚙", roles: ["CLINIC_ADMIN", "THERAPIST"] },
];

const roleLabels = {
  CLINIC_ADMIN: "Administração",
  THERAPIST: "Terapeuta",
  PATIENT: "Paciente",
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [page, setPage] = useState<Page>("dashboard");
  const [registrationsExpanded, setRegistrationsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadSession() {
    try {
      const current = await apiRequest<Session>("/auth/me");
      setSession(current);
    } catch (reason) {
      if (!(reason instanceof Error) || !("status" in reason) || reason.status !== 401) {
        setError(reason instanceof Error ? reason.message : "Não foi possível conectar à API.");
      }
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  async function login(email: string, password: string) {
    await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    await loadSession();
  }

  async function logout() {
    await apiRequest("/auth/logout", { method: "POST" });
    setSession(null);
    setPage("dashboard");
  }

  async function changeClinic(clinicId: string) {
    setError("");
    try {
      await apiRequest("/auth/clinic", { method: "POST", body: JSON.stringify({ clinicId }) });
      await loadSession();
      setPage("dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível trocar de clínica.");
    }
  }

  if (loading) {
    return <main className="loading-screen"><div className="loading-mark">QI</div><p>Preparando seu espaço...</p></main>;
  }

  if (!session) {
    return (
      <>
        {error && <div className="global-error">{error}</div>}
        <LoginPage onLogin={login} />
      </>
    );
  }

  const activeRegistration = registrations.find((item) => page === `registration:${item.id}`);
  const pageLabel = activeRegistration?.label ?? navigation.find((item) => item.id === page)?.label ?? "Visão geral";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="#" onClick={(event) => { event.preventDefault(); setPage("dashboard"); }}>
          <img className="brand-image" src={logoImage} alt="" />
          <span><strong>QIConect</strong><small>Saúde integrativa</small></span>
        </a>
        <div className="clinic-switcher">
          <span className="eyebrow">Espaço de trabalho</span>
          <select aria-label="Clínica ativa" value={session.activeClinic.id} onChange={(event) => void changeClinic(event.target.value)}>
            {session.clinics.map((clinic) => <option key={clinic.clinicId} value={clinic.clinicId}>{clinic.clinicName}</option>)}
          </select>
        </div>
        <span className="nav-section-label">MENU PRINCIPAL</span>
        <nav className="main-nav" aria-label="Navegação principal">
          {navigation.filter((item) => !item.roles || item.roles.includes(session.activeClinic.role)).map((item) => (
            <button className={`nav-item ${page === item.id ? "nav-item-active" : ""}`} key={item.id} aria-label={item.label} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {page === item.id && <span className="nav-indicator" />}
            </button>
          ))}
          {session.activeClinic.role === "CLINIC_ADMIN" && (
            <div className="nav-group">
              <button
                className={`nav-item nav-group-toggle ${activeRegistration ? "nav-item-active" : ""}`}
                aria-label="Cadastros"
                aria-expanded={registrationsExpanded}
                onClick={() => setRegistrationsExpanded((expanded) => !expanded)}
              >
                <span className="nav-icon" aria-hidden="true">▦</span>
                <span>Cadastros</span>
                <span className={`nav-chevron ${registrationsExpanded ? "nav-chevron-open" : ""}`} aria-hidden="true">⌄</span>
                {activeRegistration && <span className="nav-indicator" />}
              </button>
              {registrationsExpanded && (
                <div className="nav-submenu" aria-label="Cadastros">
                  {registrations.map((item) => {
                    const itemPage = `registration:${item.id}` as const;
                    return (
                      <button
                        className={`nav-item nav-subitem ${page === itemPage ? "nav-item-active" : ""}`}
                        key={item.id}
                        aria-label={item.label}
                        aria-current={page === itemPage ? "page" : undefined}
                        onClick={() => {
                          setPage(itemPage);
                          setRegistrationsExpanded(true);
                        }}
                      >
                        <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                        <span>{item.label}</span>
                        {page === itemPage && <span className="nav-indicator" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note"><span>✦</span><p>Seu cuidado é pessoal.<br /><strong>Seus dados também.</strong></p></div>
          <div className="sidebar-version">QIConect <span>•</span> MVP</div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{session.activeClinic.name}</span><b>/</b>
            {activeRegistration && <><span>Cadastros</span><b>/</b></>}
            <strong>{pageLabel}</strong>
          </div>
          <div className="topbar-actions">
            <span className="role-chip">{roleLabels[session.activeClinic.role]}</span>
            <div className="profile-menu">
              <span className="avatar avatar-large">{session.user.fullName.charAt(0)}</span>
              <span className="profile-copy"><strong>{session.user.fullName}</strong><small>{session.user.email}</small></span>
              <button className="button button-quiet" onClick={() => void logout()}>Sair</button>
            </div>
          </div>
        </header>
        <main className="main-content">
          {error && <div className="alert alert-error global-alert">{error}<button onClick={() => setError("")}>Fechar</button></div>}
          {page === "dashboard" && <DashboardPage session={session} />}
          {page === "appointments" && <AppointmentsPage session={session} />}
          {page === "patients" && <PatientsPage session={session} />}
          {page === "records" && <RecordsPage session={session} />}
          {page === "settings" && session.activeClinic.role !== "PATIENT" && <SettingsPage session={session} />}
          {activeRegistration && <RegistrationPage resource={activeRegistration.id} session={session} />}
        </main>
      </div>
    </div>
  );
}
