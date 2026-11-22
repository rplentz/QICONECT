import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type Session, type Therapist, type Therapy } from "../../lib/api.js";

interface Specialty {
  id: string;
  name: string;
}

interface SettingsPageProps {
  session: Session;
}

const weekdays = [
  { value: 1, label: "Segunda-feira" },
  { value: 2, label: "Terça-feira" },
  { value: 3, label: "Quarta-feira" },
  { value: 4, label: "Quinta-feira" },
  { value: 5, label: "Sexta-feira" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

export function SettingsPage({ session }: SettingsPageProps) {
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [therapies, setTherapies] = useState<Therapy[]>([]);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [specialtyName, setSpecialtyName] = useState("");
  const [therapy, setTherapy] = useState({ specialtyId: "", name: "", durationMinutes: "60" });
  const [therapist, setTherapist] = useState({
    fullName: "",
    email: "",
    password: "",
    professionalRegistration: "",
    formation: "",
    specialtyIds: [] as string[],
  });
  const [availability, setAvailability] = useState({
    therapistId: "",
    weekday: "1",
    startsAt: "08:00",
    endsAt: "18:00",
  });
  const isAdmin = session.activeClinic.role === "CLINIC_ADMIN";

  async function load() {
    const [catalog, therapistResult] = await Promise.all([
      apiRequest<{ specialties: Specialty[]; therapies: Therapy[] }>("/catalog"),
      apiRequest<{ therapists: Therapist[] }>("/therapists"),
    ]);
    setSpecialties(catalog.specialties);
    setTherapies(catalog.therapies);
    setTherapists(therapistResult.therapists);
    if (catalog.specialties.length > 0) {
      setTherapy((value) => ({ ...value, specialtyId: value.specialtyId || catalog.specialties[0].id }));
    }
    if (!isAdmin) {
      const current = therapistResult.therapists.find((item) => item.email === session.user.email);
      if (current) setAvailability((value) => ({ ...value, therapistId: current.id }));
    }
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    body: Record<string, unknown>,
    onSuccess: () => void,
  ) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
      onSuccess();
      setNotice("Alterações salvas.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar.");
    }
  }

  return (
    <div className="page-content">
      <div className="page-heading"><div><p className="eyebrow">Administração da clínica</p><h1>Configurações</h1><p className="muted">Catálogo de terapias, equipe e disponibilidade.</p></div></div>
      {error && <p className="alert alert-error">{error}</p>}
      {notice && <p className="alert alert-success">{notice}</p>}
      {isAdmin && (
        <section className="settings-grid">
          <form className="panel form-panel" onSubmit={(event) => submit(event, "/specialties", { name: specialtyName }, () => setSpecialtyName(""))}>
            <div><h2>Nova especialidade</h2><p className="muted">Organize os serviços da clínica.</p></div>
            <label>Nome<input required minLength={2} value={specialtyName} onChange={(event) => setSpecialtyName(event.target.value)} /></label>
            <button className="button button-primary">Adicionar especialidade</button>
          </form>
          <form className="panel form-panel" onSubmit={(event) => submit(event, "/therapies", {
            specialtyId: therapy.specialtyId,
            name: therapy.name,
            durationMinutes: Number(therapy.durationMinutes),
            
          }, () => setTherapy({ ...therapy, name: "" }))}>
            <div><h2>Nova terapia</h2><p className="muted">Configure a especialidade e a duração.</p></div>
            <label>Especialidade<select required value={therapy.specialtyId} onChange={(event) => setTherapy({ ...therapy, specialtyId: event.target.value })}>
              <option value="">Selecione</option>{specialties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>Nome<input required minLength={2} value={therapy.name} onChange={(event) => setTherapy({ ...therapy, name: event.target.value })} /></label>
            <div className="form-grid">
              <label>Duração (min)<input required type="number" min={10} max={480} step={5} value={therapy.durationMinutes} onChange={(event) => setTherapy({ ...therapy, durationMinutes: event.target.value })} /></label>
              
            </div>
            <button className="button button-primary" disabled={specialties.length === 0}>Adicionar terapia</button>
          </form>
          <form className="panel form-panel" onSubmit={(event) => submit(event, "/therapists", {
            ...therapist,
            professionalRegistration: therapist.professionalRegistration || undefined,
            formation: therapist.formation || undefined,
          }, () => setTherapist({ fullName: "", email: "", password: "", professionalRegistration: "", formation: "", specialtyIds: [] }))}>
            <div><h2>Adicionar terapeuta</h2><p className="muted">A senha inicial deve ser compartilhada com segurança.</p></div>
            <div className="form-grid">
              <label>Nome<input required minLength={2} value={therapist.fullName} onChange={(event) => setTherapist({ ...therapist, fullName: event.target.value })} /></label>
              <label>E-mail<input required type="email" value={therapist.email} onChange={(event) => setTherapist({ ...therapist, email: event.target.value })} /></label>
              
              <label>Registro profissional<input value={therapist.professionalRegistration} onChange={(event) => setTherapist({ ...therapist, professionalRegistration: event.target.value })} /></label>
              <label>Formação<input value={therapist.formation} onChange={(event) => setTherapist({ ...therapist, formation: event.target.value })} /></label>
              <label className="span-two">Senha inicial<input required type="password" minLength={10} value={therapist.password} onChange={(event) => setTherapist({ ...therapist, password: event.target.value })} /></label>
              <fieldset className="span-two checkbox-field">
                <legend>Especialidades habilitadas</legend>
                {specialties.length === 0 && <span className="muted">Cadastre uma especialidade antes de habilitar o profissional.</span>}
                <div className="checkbox-grid">
                  {specialties.map((item) => (
                    <label className="checkbox-option" key={item.id}>
                      <input
                        type="checkbox"
                        checked={therapist.specialtyIds.includes(item.id)}
                        onChange={(event) => setTherapist({
                          ...therapist,
                          specialtyIds: event.target.checked
                            ? [...therapist.specialtyIds, item.id]
                            : therapist.specialtyIds.filter((id) => id !== item.id),
                        })}
                      />
                      {item.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <button className="button button-primary">Criar terapeuta</button>
          </form>
        </section>
      )}
      <form className="panel form-panel" onSubmit={(event) => submit(event, "/availability", {
        ...availability,
        weekday: Number(availability.weekday),
      }, () => undefined)}>
        <div><h2>Disponibilidade semanal</h2><p className="muted">Os agendamentos só serão aceitos dentro destes horários.</p></div>
        <div className="form-grid">
          {isAdmin && <label>Terapeuta<select required value={availability.therapistId} onChange={(event) => setAvailability({ ...availability, therapistId: event.target.value })}>
            <option value="">Selecione</option>{therapists.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}
          </select></label>}
          <label>Dia da semana<select value={availability.weekday} onChange={(event) => setAvailability({ ...availability, weekday: event.target.value })}>
            {weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
          </select></label>
          <label>Início<input required type="time" value={availability.startsAt} onChange={(event) => setAvailability({ ...availability, startsAt: event.target.value })} /></label>
          <label>Fim<input required type="time" value={availability.endsAt} onChange={(event) => setAvailability({ ...availability, endsAt: event.target.value })} /></label>
        </div>
        <button className="button button-primary">Adicionar horário disponível</button>
      </form>
      <section className="panel">
        <div className="panel-heading"><div><h2>Catálogo ativo</h2><p className="muted">Serviços configurados nesta clínica.</p></div></div>
        <div className="table-wrap">
          <table><thead><tr><th>Terapia</th><th>Especialidade</th><th>Duração</th></tr></thead>
            <tbody>{therapies.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.specialtyName}</td><td>{item.durationMinutes} min</td></tr>)}</tbody>
          </table>
          {therapies.length === 0 && <p className="empty-state">Nenhuma terapia cadastrada.</p>}
        </div>
      </section>
    </div>
  );
}
