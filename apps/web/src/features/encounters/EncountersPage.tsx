import { useEffect, useState } from "react";
import { apiRequest, type EncounterSummary, type Session } from "../../lib/api.js";

interface EncountersPageProps {
  session: Session;
  patientId?: string;
  onOpen: (appointmentId: string) => void;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const statusLabels: Record<EncounterSummary["appointmentStatus"], string> = {
    CONFIRMED: "Confirmado", CANCELLED: "Cancelado", RESCHEDULED: "Remarcado", WAITING: "Aguardando", IN_PROGRESS: "Em atendimento", PAID: "Pago", ACTIVE: "Ativo", INACTIVE: "Inativo"
  };

export function EncountersPage({ session, patientId, onOpen }: EncountersPageProps) {
  const [encounters, setEncounters] = useState<EncounterSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<{ encounters: EncounterSummary[] }>("/encounters")
      .then(({ encounters: items }) => setEncounters(patientId ? items.filter((item) => item.patientId === patientId) : items))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const isPatient = session.activeClinic.role === "PATIENT";

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Acompanhamento clínico</p>
          <h1>Atendimentos</h1>
          <p className="muted">Consulte os atendimentos agendados e acesse seus registros.</p>
        </div>
        <span className="soft-badge">{encounters.length} atendimentos</span>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Histórico e próximos atendimentos</h2>
            <p className="muted">Acesse um atendimento para consultar as guias clínicas.</p>
          </div>
        </div>
        {encounters.length === 0 ? (
          <p className="empty-state">Nenhum atendimento encontrado.</p>
        ) : (
          <div className="encounter-list">
            {encounters.map((encounter) => (
              <article className="encounter-list-row" key={encounter.appointmentId}>
                <div className="appointment-date">
                  <strong>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(new Date(encounter.startsAt))}</strong>
                  <span>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(encounter.startsAt)).replace(".", "")}</span>
                </div>
                <div className="encounter-list-main">
                  <strong>{encounter.patientName}</strong>
                  <span>{formatDate(encounter.startsAt)} · {encounter.therapyName}</span>
                  {isPatient && <span>Terapeuta: {encounter.therapistName}</span>}
                </div>
                <span className={`status-pill status-${encounter.appointmentStatus.toLowerCase()}`}>
                  {statusLabels[encounter.appointmentStatus]}
                </span>
                <button className="button button-secondary" onClick={() => onOpen(encounter.appointmentId)}>
                  Acessar atendimento
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
