import { useEffect, useState } from "react";
import { ApiError, apiRequest, type Appointment, type Session } from "../../lib/api.js";

interface DashboardData {
  counts: { patients: number; appointmentsToday: number };
  appointmentsForDate: Appointment[];
  selectedDate: string;
  lastEncounter: LastEncounter | null;
  recentPatients: TherapistRecentPatient[];
}

interface LastEncounter {
  id: string;
  attendedAt: string;
  therapyId: string;
  therapyName: string;
}

interface TherapistRecentPatient {
  id: string;
  fullName: string;
  encounterId: string;
  attendedAt: string;
  therapyId: string;
  therapyName: string;
}

type ProtocolSelection =
  | { kind: "therapy"; id: string; name: string }
  | {
      kind: "encounter";
      id: string;
      attendedAt: string;
      therapyName: string;
      patientName?: string;
    };

function formatEncounterDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(new Date(value));
}

interface TherapyProtocol {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  active: number;
  steps: Array<{
    sequence: number;
    description: string;
    startsAt: string | null;
    endsAt: string | null;
  }>;
}

interface DashboardPageProps {
  session: Session;
  onOpenPatient: (patientId: string) => void;
}

function clinicDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatAppointmentDate(value: string, timezone: string): { day: string; month: string; full: string } {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: timezone }).format(date),
    month: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: timezone }).format(date).replace(".", ""),
    full: new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone,
    }).format(date),
  };
}

function statusLabel(status: Appointment["status"]): string {
  const labels: Record<Appointment["status"], string> = {
    CONFIRMED: "Confirmado", CANCELLED: "Cancelado", RESCHEDULED: "Remarcado", WAITING: "Aguardando", IN_PROGRESS: "Em atendimento", PAID: "Pago", ACTIVE: "Ativo", INACTIVE: "Inativo"
  };
  return labels[status];
}

function errorMessage(reason: unknown): string {
  return reason instanceof ApiError || reason instanceof Error
    ? reason.message
    : "Não foi possível carregar as informações da agenda.";
}

export function DashboardPage({ session, onOpenPatient }: DashboardPageProps) {
  const [data, setData] = useState<DashboardData>();
  const [selectedDate, setSelectedDate] = useState(() => clinicDate(session.activeClinic.timezone));
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [error, setError] = useState("");
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolSelection | null>(null);
  const [protocols, setProtocols] = useState<TherapyProtocol[]>([]);
  const [loadingProtocols, setLoadingProtocols] = useState(false);
  const [protocolError, setProtocolError] = useState("");
  const isPatient = session.activeClinic.role === "PATIENT";
  const isTherapist = session.activeClinic.role === "THERAPIST";

  useEffect(() => {
    let active = true;
    setLoadingAppointments(true);
    setError("");
    apiRequest<DashboardData>(`/dashboard?date=${encodeURIComponent(selectedDate)}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoadingAppointments(false);
      });
    return () => { active = false; };
  }, [selectedDate, session.activeClinic.id]);

  useEffect(() => {
    setSelectedDate(clinicDate(session.activeClinic.timezone));
    setSelectedProtocol(null);
  }, [session.activeClinic.id, session.activeClinic.timezone]);

  useEffect(() => {
    if (!selectedProtocol) {
      setProtocols([]);
      setProtocolError("");
      return;
    }

    let active = true;
    setLoadingProtocols(true);
    setProtocolError("");
    const protocolPath = selectedProtocol.kind === "encounter"
      ? `/dashboard/encounters/${encodeURIComponent(selectedProtocol.id)}/protocols`
      : `/dashboard/therapies/${encodeURIComponent(selectedProtocol.id)}/protocols`;
    apiRequest<{ protocols: TherapyProtocol[] }>(
      protocolPath,
    )
      .then((result) => {
        if (active) setProtocols(result.protocols);
      })
      .catch((reason: unknown) => {
        if (active) setProtocolError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoadingProtocols(false);
      });
    return () => { active = false; };
  }, [selectedProtocol?.kind, selectedProtocol?.id, session.activeClinic.id]);

  function toggleTherapy(therapyId: string, therapyName: string) {
    setSelectedProtocol((current) =>
      current?.kind === "therapy" && current.id === therapyId
        ? null
        : { kind: "therapy", id: therapyId, name: therapyName },
    );
  }

  function toggleEncounter(encounter: LastEncounter, patientName?: string) {
    setSelectedProtocol((current) =>
      current?.kind === "encounter" && current.id === encounter.id
        ? null
        : {
            kind: "encounter",
            id: encounter.id,
            attendedAt: encounter.attendedAt,
            therapyName: encounter.therapyName,
            patientName,
          },
    );
  }

  function renderProtocolDetails(title: string, emptyMessage: string) {
    return (
      <div className="dashboard-protocols">
        <h3>{title}</h3>
        {loadingProtocols ? (
          <p className="muted">Carregando protocolos...</p>
        ) : protocolError ? (
          <p className="alert alert-error" role="alert">{protocolError}</p>
        ) : protocols.length === 0 ? (
          <p className="muted">{emptyMessage}</p>
        ) : (
          <div className="dashboard-protocol-list">
            {protocols.map((protocol) => (
              <article className="dashboard-protocol-card" key={protocol.id}>
                <div className="dashboard-protocol-title">
                  <strong>{protocol.name}</strong>
                  <span className={`status-pill ${protocol.active ? "status-confirmed" : "status-cancelled"}`}>
                    {protocol.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                {protocol.description && <p>{protocol.description}</p>}
                {protocol.objective && <p><strong>Objetivo:</strong> {protocol.objective}</p>}
                {protocol.steps.length > 0 && (
                  <ol>
                    {protocol.steps.map((step) => (
                      <li key={`${protocol.id}-${step.sequence}`}>{step.description}</li>
                    ))}
                  </ol>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  const lastEncounter = data?.lastEncounter;

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h1>Olá, {session.user.fullName.split(" ")[0]}</h1>
          <p className="muted">Acompanhe a rotina da {session.activeClinic.name}.</p>
        </div>
      </div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="stat-grid">
        <article className="stat-card">
          <span className="stat-icon">◷</span>
          <span className="stat-label">Atendimentos de hoje</span>
          <strong>{data?.counts.appointmentsToday ?? "—"}</strong>
          <span className="stat-footnote">Na clínica selecionada</span>
        </article>
        <article className={`stat-card ${isTherapist ? "dashboard-patients-card" : ""}`}>
          <span className="stat-icon">{isPatient ? "◷" : "♡"}</span>
          <span className="stat-label">{isPatient ? "Último Atendimento" : "Pacientes ativos"}</span>
          {isPatient ? (
            lastEncounter ? (
              <>
                <button
                  type="button"
                  className="dashboard-last-encounter-link"
                  aria-expanded={selectedProtocol?.kind === "encounter" && selectedProtocol.id === lastEncounter.id}
                  onClick={() => toggleEncounter(lastEncounter)}
                >
                  {formatEncounterDate(lastEncounter.attendedAt, session.activeClinic.timezone)}
                </button>
                <span className="stat-footnote">{lastEncounter.therapyName}</span>
              </>
            ) : (
              <span className="stat-footnote">Nenhum atendimento registrado</span>
            )
          ) : isTherapist ? (
            data?.recentPatients.length ? (
              <div className="dashboard-recent-patients">
                {data.recentPatients.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    className="dashboard-recent-patient-link"
                    aria-expanded={selectedProtocol?.kind === "encounter" && selectedProtocol.id === patient.encounterId}
                    onClick={() => onOpenPatient(patient.id)}
                  >
                    {patient.fullName}
                  </button>
                ))}
              </div>
            ) : (
              <span className="stat-footnote">Nenhum paciente com atendimento recente</span>
            )
          ) : (
            <>
              <strong>{data?.counts.patients ?? "—"}</strong>
              <span className="stat-footnote">Acesso protegido por clínica</span>
            </>
          )}
        </article>
      </div>
      {(isPatient || isTherapist) && selectedProtocol?.kind === "encounter" && (
        <section className="panel dashboard-last-encounter-panel">
          <div className="panel-heading">
            <div>
              <h2>
                {selectedProtocol.patientName
                  ? `Protocolos do atendimento de ${selectedProtocol.patientName}`
                  : "Protocolos vinculados ao último atendimento"}
              </h2>
              <p className="muted">
                {formatEncounterDate(selectedProtocol.attendedAt, session.activeClinic.timezone)}
                {" · "}{selectedProtocol.therapyName}
              </p>
            </div>
          </div>
          {renderProtocolDetails("Protocolos", "Este atendimento não possui protocolos vinculados.")}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading dashboard-agenda-heading">
          <div>
            <h2>Atendimentos por data</h2>
            <p className="muted">Selecione uma data para consultar a agenda e os protocolos de cada terapia.</p>
          </div>
          <label className="dashboard-date-filter">
            Data da agenda
            <input
              aria-label="Data da agenda"
              type="date"
              value={selectedDate}
              onChange={(event) => {
                if (event.target.value) {
                  setSelectedDate(event.target.value);
                  setSelectedProtocol(null);
                }
              }}
            />
          </label>
        </div>
        {loadingAppointments ? (
          <p className="empty-state">Carregando agenda...</p>
        ) : !data || data.appointmentsForDate.length === 0 ? (
          <p className="empty-state">Nenhum atendimento na agenda para esta data.</p>
        ) : (
          <div className="appointment-list">
            {data.appointmentsForDate.map((appointment) => {
              const date = formatAppointmentDate(appointment.startsAt, session.activeClinic.timezone);
              const therapyExpanded =
                selectedProtocol?.kind === "therapy" && selectedProtocol.id === appointment.therapyId;
              return (
                <div className="dashboard-appointment-group" key={appointment.id}>
                  <article className="appointment-row dashboard-appointment-row">
                    <div className="appointment-date">
                      <strong>{date.day}</strong>
                      <span>{date.month}</span>
                    </div>
                    <div className="appointment-main">
                      <button
                        type="button"
                        className="dashboard-therapy-button"
                        aria-expanded={selectedProtocol?.kind === "therapy" && selectedProtocol.id === appointment.therapyId}
                        onClick={() => toggleTherapy(appointment.therapyId, appointment.therapyName)}
                      >
                        {appointment.therapyName}
                      </button>
                      <span className="muted">Terapeuta responsável: {appointment.therapistName}</span>
                      {session.activeClinic.role !== "PATIENT" && (
                        <span className="muted">Paciente: {appointment.patientName}</span>
                      )}
                    </div>
                    <span className="appointment-time">{date.full}</span>
                    <span className={`status-pill status-${appointment.status.toLowerCase()}`}>{statusLabel(appointment.status)}</span>
                  </article>
                  {therapyExpanded && (
                    renderProtocolDetails(
                      `Protocolos vinculados a ${
                        selectedProtocol?.kind === "therapy" ? selectedProtocol.name : appointment.therapyName
                      }`,
                      "Esta terapia não possui protocolos cadastrados.",
                    )
                  )}
                </div>
              );
            })}
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
