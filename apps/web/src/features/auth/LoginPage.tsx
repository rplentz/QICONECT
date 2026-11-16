import { useState, type FormEvent } from "react";
import logoImage from "../../../../../Documentacao/Logo1.png";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onLogin(email, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-brand">
          <div className="brand-glow brand-glow-blue" />
          <div className="brand-glow brand-glow-red" />
          <img className="login-logo" src={logoImage} alt="QIConect" />
          <h2 className="login-slogan">
            <span>Conectando terapeutas</span>
            <span>Harmonizando vidas</span>
          </h2>
          <div className="brand-spectrum" aria-hidden="true"><span /><span /><span /></div>
        </div>
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-card-heading">
            <p className="eyebrow login-eyebrow">Acesso seguro</p>
            <h1 id="login-title">Acesse seu espaço</h1>
            <p className="muted">Entre com seu e-mail e senha cadastrados.</p>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <label>
              E-mail
              <input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Senha
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error && <p className="alert alert-error">{error}</p>}
            <button className="button button-primary button-wide" disabled={busy}>
              {busy ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
