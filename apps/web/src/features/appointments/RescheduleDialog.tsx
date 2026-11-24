import { useEffect, useRef, useState } from "react";
import { MaskedInput } from "../../lib/masked-input.js";

interface RescheduleDialogProps {
  currentStart: string;
  onCancel: () => void;
  onConfirm: (startsAt: string) => void;
}

export function RescheduleDialog({ currentStart, onCancel, onConfirm }: RescheduleDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(() => {
    const nextDay = new Date(new Date(currentStart).getTime() + 86_400_000);
    return new Date(nextDay.getTime() - nextDay.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="panel" aria-labelledby="reschedule-title" onCancel={onCancel}>
      <form className="form-panel" onSubmit={(event) => {
        event.preventDefault();
        onConfirm(new Date(value).toISOString());
      }}>
        <h2 id="reschedule-title">Remarcar agendamento</h2>
        <label>Novo horário <MaskedInput mask="datetime-local" required value={value} onValueChange={setValue} /></label>
        <div className="registration-form-actions">
          <button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button>
          <button className="button button-primary">Confirmar</button>
        </div>
      </form>
    </dialog>
  );
}
