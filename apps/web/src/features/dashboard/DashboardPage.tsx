import { useEffect, useState } from "react";
import { apiRequest, type Appointment, type Session } from "../../lib/api.js";

interface DashboardData {
  counts: { patients: number; appointmentsToday: number };
  upcomingAppointments: Appointment[];
}

interface DashboardPageProps {
  session: Session;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DashboardPage({ session }: DashboardPageProps) {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<DashboardData>("/dashboard").then(setData).catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h1>Olá, {session.user.fullName.split(" ")[0]}</h1>
          <p className="muted">Acompanhe a rotina da {session.activeClinic.name}.</p>
        </div>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      <div className="stat-grid">
        <article className="stat-card">
          <span className="stat-icon">◷</span>
          <span className="stat-label">Atendimentos de hoje</span>
          <strong>{data?.counts.appointmentsToday ?? "—"}</strong>
          <span className="stat-footnote">Na clínica selecionada</span>
        </article>
        <article className="stat-card">
          <span className="stat-icon">♡</span>
          <span className="stat-label">{session.activeClinic.role === "PATIENT" ? "Seu perfil" : "Pacientes ativos"}</span>
          <strong>{data?.counts.patients ?? "—"}</strong>
          <span className="stat-footnote">Acesso protegido por clínica</span>
        </article>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Próximos atendimentos</h2>
            <p className="muted">Agenda confirmada da clínica.</p>
          </div>
          <span className="soft-badge">{data?.upcomingAppointments.length ?? 0} próximos</span>
        </div>
        {!data ? (
          <p className="empty-state">Carregando agenda...</p>
        ) : data.upcomingAppointments.length === 0 ? (
          <p className="empty-state">Nenhum atendimento próximo. Os novos agendamentos aparecerão aqui.</p>
        ) : (
          <div className="appointment-list">
            {data.upcomingAppointments.map((appointment) => (
              <article className="appointment-row" key={appointment.id}>
                <div className="appointment-date">
                  <strong>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(new Date(appointment.startsAt))}</strong>
                  <span>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(appointment.startsAt)).replace(".", "")}</span>
                </div>
                <div className="appointment-main">
                  <strong>{appointment.therapyName}</strong>
                  <span className="muted">
                    {session.activeClinic.role === "PATIENT" ? appointment.therapistName : appointment.patientName}
                  </span>
                </div>
                <span className="appointment-time">{formatDate(appointment.startsAt)}</span>
                <span className="status-pill status-confirmed">Confirmado</span>
              </article>
            ))}
          </div>
        )}
      </section>
      <div className="notice-card">
        <span className="notice-icon">✦</span>
        <div>
          <strong>Seus dados, com cuidado</strong>
          <p>As informações são exibidas de acordo com seu vínculo e perfil nesta clínica.</p>
        </div>
      </div>
    </div>
  );
}
