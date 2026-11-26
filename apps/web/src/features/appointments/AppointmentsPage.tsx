import { RescheduleDialog } from "./RescheduleDialog.js";
import { MaskedInput } from "../../lib/masked-input.js";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type Appointment, type Patient, type Session, type Therapist, type Therapy } from "../../lib/api.js";

interface AppointmentsPageProps {
  session: Session;
  onOpenEncounter: (appointmentId: string) => void;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function AppointmentsPage({ session, onOpenEncounter }: AppointmentsPageProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [therapies, setTherapies] = useState<Therapy[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [form, setForm] = useState({ therapistId: "", therapyId: "", patientId: "", startsAt: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState(false);
  const canBookForPatient = session.activeClinic.role !== "PATIENT";

  async function load() {
    const requests = [
      apiRequest<{ appointments: Appointment[] }>("/appointments"),
      apiRequest<{ therapists: Therapist[] }>("/therapists"),
      apiRequest<{ therapies: Therapy[] }>("/catalog"),
      ...(canBookForPatient ? [apiRequest<{ patients: Patient[] }>("/patients")] : []),
    ] as const;
    const [appointmentResult, therapistResult, catalogResult, patientResult] = await Promise.all(requests);
    setAppointments(appointmentResult.appointments);
    setTherapists(therapistResult.therapists);
    setTherapies(catalogResult.therapies);
    setPatients(patientResult?.patients ?? []);
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/appointments", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          patientId: form.patientId || undefined,
          startsAt: new Date(form.startsAt).toISOString(),
        }),
      });
      setNotice("Atendimento agendado.");
      setForm({ ...form, startsAt: "" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível agendar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(appointment: Appointment) {
    const reason = canBookForPatient ? window.prompt("Informe o motivo do cancelamento:") : undefined;
    if (canBookForPatient && !reason) return;
    if (!window.confirm("Deseja cancelar este atendimento?")) return;
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ status: string; notifications: string }>(`/appointments/${appointment.id}/cancel`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      setNotice(
        result.notifications === "NOT_CONFIGURED"
          ? "Atendimento cancelado. E-mail/WhatsApp foram registrados, mas o envio exige configurar os provedores."
          : "Atendimento cancelado e notificações enviadas.",
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível cancelar.");
    }
  }

  async function reschedule(appointment: Appointment, startsAt: string) {
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ notifications: string }>(`/appointments/${appointment.id}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ startsAt }),
      });
      setNotice(
        result.notifications === "NOT_CONFIGURED"
          ? "Atendimento remarcado. As notificações foram registradas, mas o envio exige configurar os provedores."
          : "Atendimento remarcado e notificações enviadas.",
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remarcar.");
    }
  }

  async function markInProgress(appointment: Appointment) {
    if (!window.confirm("Deseja iniciar este atendimento?")) return;
    setError("");
    setNotice("");
    try {
      await apiRequest(`/appointments/${appointment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      setNotice("Atendimento iniciado.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o status.");
    }
  }

  const upcoming = appointments.filter((appointment) => appointment.status === "CONFIRMED");
  const rescheduled = appointments.filter((appointment) => appointment.status === "RESCHEDULED");
  const cancelled = appointments.filter((appointment) => appointment.status === "CANCELLED");
  const inProgress = appointments.filter((appointment) => appointment.status === "IN_PROGRESS");
  const isTherapist = session.activeClinic.role === "THERAPIST";

  function appointmentList(items: Appointment[], emptyMessage: string, showActions = false) {
    return items.length === 0 ? <p className="empty-state">{emptyMessage}</p> : (
      <div className="appointment-list">
        {items.map((appointment) => (
          <article className="appointment-row" key={appointment.id}>
            <div className="appointment-date"><strong>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(new Date(appointment.startsAt))}</strong><span>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(appointment.startsAt)).replace(".", "")}</span></div>
            <div className="appointment-main"><strong>{session.activeClinic.role === "PATIENT" && appointment.status === "IN_PROGRESS" ? <button type="button" className="patient-attendance-link" onClick={() => onOpenEncounter(appointment.id)}>{appointment.therapyName}</button> : appointment.therapyName}</strong><span className="muted">{session.activeClinic.role === "PATIENT" ? appointment.therapistName : appointment.patientName}</span></div>
            <span className="appointment-time">{formatDate(appointment.startsAt)}</span>
            <span className={`status-pill status-${appointment.status.toLowerCase()}`}>{({ CONFIRMED: "Confirmado", CANCELLED: "Cancelado", RESCHEDULED: "Remarcado", WAITING: "Aguardando", IN_PROGRESS: "Em atendimento", PAID: "Pago", ACTIVE: "Ativo", INACTIVE: "Inativo" } as Record<string, string>)[appointment.status]}</span>
            {showActions && isTherapist && appointment.status === "CONFIRMED" && <button className="button button-success" onClick={() => void markInProgress(appointment)}>Iniciar atendimento</button>}
            {showActions && <button className="button button-secondary" onClick={() => setRescheduling(appointment)}>Remarcar</button>}
            {showActions && <button className="button button-danger" onClick={() => void cancel(appointment)}>Cancelar</button>}
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="page-content">
      {rescheduling && <RescheduleDialog currentStart={rescheduling.startsAt} onCancel={() => setRescheduling(null)} onConfirm={(startsAt) => {
        setRescheduling(null);
        void reschedule(rescheduling, startsAt);
      }} />}
      <div className="page-heading">
        <div><p className="eyebrow">Organização de horários</p><h1>Agenda</h1><p className="muted">Agendamentos da clínica selecionada.</p></div>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {notice && <p className="alert alert-success">{notice}</p>}
      <form className="panel form-panel" onSubmit={book}>
        <div className="panel-heading"><div><h2>Novo agendamento</h2><p className="muted">Horários são confirmados após validação da disponibilidade.</p></div><span className="soft-badge">Fuso: {session.activeClinic.timezone}</span></div>
        <div className="form-grid">
          {canBookForPatient && (
            <label>Paciente<select required value={form.patientId} onChange={(event) => setForm({ ...form, patientId: event.target.value })}>
              <option value="">Selecione</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}</option>)}
            </select></label>
          )}
          <label>Terapeuta<select required value={form.therapistId} onChange={(event) => setForm({ ...form, therapistId: event.target.value })}>
            <option value="">Selecione</option>{therapists.map((therapist) => <option key={therapist.id} value={therapist.id}>{therapist.fullName}</option>)}
          </select></label>
          <label>Terapia<select required value={form.therapyId} onChange={(event) => setForm({ ...form, therapyId: event.target.value })}>
            <option value="">Selecione</option>{therapies.map((therapy) => <option key={therapy.id} value={therapy.id}>{therapy.name} · {therapy.durationMinutes} min</option>)}
          </select></label>
          <label>Data e horário<MaskedInput mask="datetime-local" required min={new Date().toISOString().slice(0, 16)} value={form.startsAt} onValueChange={(value) => setForm({ ...form, startsAt: value })} /></label>
        </div>
        <button className="button button-primary" disabled={busy}>{busy ? "Confirmando..." : "Confirmar agendamento"}</button>
      </form>
      <section className="panel">
        <div className="panel-heading"><div><h2>Atendimentos confirmados</h2><p className="muted">Cancelamentos pelo paciente exigem pelo menos quatro horas de antecedência.</p></div><span className="soft-badge">{upcoming.length} confirmados</span></div>
        {appointmentList(upcoming, "Nenhum atendimento confirmado.", true)}
      </section>
      <section className="panel appointment-history-panel">
        <div className="panel-heading"><div><h2>Em atendimento</h2><p className="muted">Sessões iniciadas pela equipe clínica.</p></div><span className="soft-badge">{inProgress.length}</span></div>
        {appointmentList(inProgress, "Nenhum atendimento em andamento.")}
      </section>
      <section className="panel appointment-history-panel">
        <div className="panel-heading"><div><h2>Atendimentos remarcados</h2><p className="muted">Histórico de horários que foram alterados.</p></div><span className="soft-badge">{rescheduled.length} remarcados</span></div>
        {appointmentList(rescheduled, "Nenhum atendimento remarcado.")}
      </section>
      <section className="panel appointment-history-panel">
        <div className="panel-heading"><div><h2>Atendimentos cancelados</h2><p className="muted">Histórico de atendimentos cancelados.</p></div><span className="soft-badge">{cancelled.length} cancelados</span></div>
        {appointmentList(cancelled, "Nenhum atendimento cancelado.")}
      </section>
    </div>
  );
}
