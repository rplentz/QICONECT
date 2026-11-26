import { MaskedInput } from "../../lib/masked-input.js";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type Session } from "../../lib/api.js";

type Specialty = { id: string; name: string };
type Profile = { id: string; fullName: string; email: string; cpf: string | null; professionalRegistration: string | null; formation: string | null };

export function TherapistProfilePage({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { void Promise.all([
    apiRequest<{ therapist: Profile; specialties: Specialty[] }>("/therapist-profile"),
    apiRequest<{ specialties: Specialty[] }>("/catalog"),
  ]).then(([current, catalog]) => { setProfile(current.therapist); setSelected(current.specialties.map((item) => item.id)); setSpecialties(catalog.specialties); })
    .catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o cadastro.")); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!profile) return; setBusy(true); setError(""); setNotice("");
    try { await apiRequest("/therapist-profile", { method: "PUT", body: JSON.stringify({ ...profile, cpf: profile.cpf ?? undefined, specialtyIds: selected }) }); setNotice("Dados cadastrais atualizados."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  if (!profile && !error) return <div className="page-content"><p>Carregando cadastro...</p></div>;
  return <div className="page-content">
    <header className="page-heading"><div><span className="eyebrow">CADASTRO PROFISSIONAL</span><h1>Terapeuta</h1><p>Atualize seus dados profissionais e especialidades.</p></div></header>
    {error && <div className="alert alert-error">{error}</div>}{notice && <div className="alert alert-success">{notice}</div>}
    {profile && <form className="panel form-panel" onSubmit={(event) => void save(event)}>
      <div className="form-grid">
        <label>Nome completo<input required minLength={2} maxLength={120} value={profile.fullName} onChange={(event) => setProfile({ ...profile, fullName: event.target.value })} /></label>
        <label>E-mail<input required type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></label>
        <label>CPF<MaskedInput mask="cpf" value={profile.cpf ?? ""} onValueChange={(value) => setProfile({ ...profile, cpf: value })} /></label>
        <label>Registro profissional<input value={profile.professionalRegistration ?? ""} onChange={(event) => setProfile({ ...profile, professionalRegistration: event.target.value })} /></label>
        <label className="form-grid-full">Formação<input value={profile.formation ?? ""} onChange={(event) => setProfile({ ...profile, formation: event.target.value })} /></label>
      </div>
      <fieldset className="specialty-picker"><legend>Especialidades</legend><div className="checkbox-grid">{specialties.map((item) => <label className="checkbox-option" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />{item.name}</label>)}</div>{specialties.length === 0 && <p className="muted">Cadastre especialidades no menu Cadastros → Especialidades.</p>}</fieldset>
      <div className="registration-form-actions"><button className="button button-primary" disabled={busy}>{busy ? "Salvando..." : "Salvar cadastro"}</button></div>
    </form>}
    <small className="muted">Sessão: {session.user.email}</small>
  </div>;
}
