import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api.js";

type Specialty = { id: string; name: string; description: string | null };
type Therapy = { id: string; name: string; description: string | null; specialtyId: string; specialtyName: string; durationMinutes: number };

export function CatalogPage({ kind }: { kind: "specialty" | "therapy" }) {
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [therapies, setTherapies] = useState<Therapy[]>([]);
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [specialtyId, setSpecialtyId] = useState(""); const [duration, setDuration] = useState("60");
  const [editingSpecialtyId, setEditingSpecialtyId] = useState<string | null>(null);
  const [editingTherapyId, setEditingTherapyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  async function load() { const catalog = await apiRequest<{ specialties: Specialty[]; therapies: Therapy[] }>("/catalog"); setSpecialties(catalog.specialties); setTherapies(catalog.therapies); if (!specialtyId && catalog.specialties[0]) setSpecialtyId(catalog.specialties[0].id); }
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o catálogo.")); }, []);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); setNotice(""); try {
    if (kind === "specialty") await apiRequest(editingSpecialtyId ? `/specialties/${editingSpecialtyId}` : "/specialties", { method: editingSpecialtyId ? "PUT" : "POST", body: JSON.stringify({ name, description }) });
    else await apiRequest(editingTherapyId ? `/therapies/${editingTherapyId}` : "/therapies", { method: editingTherapyId ? "PUT" : "POST", body: JSON.stringify({ name, description, specialtyId, durationMinutes: Number(duration) }) });
    setName(""); setDescription(""); setNotice(kind === "specialty" ? (editingSpecialtyId ? "Especialidade atualizada." : "Especialidade cadastrada.") : (editingTherapyId ? "Terapia atualizada." : "Terapia cadastrada e vinculada à especialidade.")); setEditingSpecialtyId(null); setEditingTherapyId(null); await load();
  } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar o cadastro."); } finally { setBusy(false); } }
  const title = kind === "specialty" ? "Especialidades" : "Terapias";
  return <div className="page-content"><header className="page-heading"><div><span className="eyebrow">CADASTROS</span><h1>{title}</h1><p>{kind === "specialty" ? "Cadastre as especialidades clínicas disponíveis." : "Cadastre terapias e associe cada uma a uma especialidade."}</p></div></header>
    {error && <div className="alert alert-error">{error}</div>}{notice && <div className="alert alert-success">{notice}</div>}
    <form className="panel form-panel" onSubmit={(event) => void save(event)}><h2>{kind === "specialty" ? (editingSpecialtyId ? "Editar especialidade" : "Nova especialidade") : (editingTherapyId ? "Editar terapia" : "Nova terapia")}</h2><div className="form-grid">
      <label>Nome<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
      {kind === "therapy" && <><label>Especialidade<select required value={specialtyId} onChange={(event) => setSpecialtyId(event.target.value)}><option value="">Selecione</option>{specialties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Duração (minutos)<input required type="number" min={1} max={480} value={duration} onChange={(event) => setDuration(event.target.value)} /></label></>}
      <label className="form-grid-full">Descrição<textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    </div>{kind === "therapy" && specialties.length === 0 && <p className="muted">Cadastre uma especialidade antes de criar terapias.</p>}<div className="registration-form-actions">{(editingSpecialtyId || editingTherapyId) && <button type="button" className="button button-secondary" onClick={() => { setEditingSpecialtyId(null); setEditingTherapyId(null); setName(""); setDescription(""); }}>Cancelar edição</button>}<button className="button button-primary" disabled={busy || (kind === "therapy" && specialties.length === 0)}>{busy ? "Salvando..." : (editingSpecialtyId || editingTherapyId) ? "Salvar alterações" : `Cadastrar ${kind === "specialty" ? "especialidade" : "terapia"}`}</button></div></form>
    <section className="panel registration-table-panel"><h2>{kind === "specialty" ? "Especialidades cadastradas" : "Terapias cadastradas"}</h2>{kind === "specialty" ? <div className="catalog-list">{specialties.map((item) => <button type="button" className="catalog-row catalog-row-button" key={item.id} onClick={() => { setEditingSpecialtyId(item.id); setEditingTherapyId(null); setName(item.name); setDescription(item.description ?? ""); setNotice(""); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}><strong>{item.name}</strong>{item.description && <span className="muted">{item.description}</span>}</button>)}</div> : <div className="catalog-list">{therapies.map((item) => <button type="button" className="catalog-row catalog-row-button" key={item.id} onClick={() => { setEditingTherapyId(item.id); setEditingSpecialtyId(null); setName(item.name); setDescription(item.description ?? ""); setSpecialtyId(item.specialtyId); setDuration(String(item.durationMinutes)); setNotice(""); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}><strong>{item.name}</strong><span className="soft-badge">{item.specialtyName}</span><span>{item.durationMinutes} min</span>{item.description && <span className="muted">{item.description}</span>}</button>)}</div>}</section>
  </div>;
}
